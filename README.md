# YouTube Transcription Agent

Agente de IA que transcribe y resume videos de YouTube usando OpenAI Whisper API, con soporte para micropagos via protocolo x402.

## Descripcion

Este agente expone dos interfaces:

| Interfaz | Protocolo | Puerto | Pago | Uso |
|----------|-----------|--------|------|-----|
| MCP | stdio | - | Gratis | Humanos (Claude Desktop, Cursor) |
| A2A | HTTP JSON-RPC | 5002 | x402 | Otros agentes |

### Funcionalidades

- **transcribe_video**: Transcribe audio de YouTube a texto con timestamps usando Whisper API
- **summarize_video**: Transcribe y genera resumen con puntos clave
- **chat**: Conversacion general con el agente

## Arquitectura

```
                    Clientes
         ┌────────────┴────────────┐
         │                         │
    [Humanos]                 [Agentes]
    MCP (gratis)              A2A (x402)
         │                         │
         └──────────┬──────────────┘
                    │
              ┌─────▼─────┐
              │  agent.ts │
              │ (GPT-4o)  │
              └─────┬─────┘
                    │
              ┌─────▼─────┐
              │ tools.ts  │
              └─────┬─────┘
                    │
         ┌──────────▼──────────┐
         │ transcript-extractor│
         │   yt-dlp + Whisper  │
         └─────────────────────┘
```

## Requisitos

- Node.js 20+
- ffmpeg
- deno (requerido por yt-dlp)
- Cuenta OpenAI con API key

## Instalacion

### 1. Clonar e instalar dependencias

```bash
git clone <repo-url>
cd my-agent
yarn install
```

### 2. Instalar dependencias del sistema

```bash
# macOS
brew install ffmpeg deno

# Ubuntu/Debian
sudo apt install ffmpeg
curl -fsSL https://deno.land/install.sh | sh
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env`:

```env
# OpenAI API key (requerido)
OPENAI_API_KEY=sk-...

# Direccion para recibir pagos x402 (requerido para A2A)
X402_PAYEE_ADDRESS=0x...

# Clave privada para registro en registry (opcional)
PRIVATE_KEY=...
```

## Uso

### Servidor A2A (para agentes)

```bash
yarn start:a2a
```

El servidor inicia en `http://localhost:5002`.

### Servidor MCP (para humanos)

```bash
yarn start:mcp
```

Se comunica via stdio. Configurar en Claude Desktop o Cursor.

### Cliente A2A (para testing)

```bash
# Ejecutar demos
npx tsx src/a2a-client.ts

# Modo interactivo
npx tsx src/a2a-client.ts -i
```

## API A2A

### Descubrir Agente

```bash
curl http://localhost:5002/.well-known/agent-card.json
```

### Enviar Mensaje

```bash
curl -X POST http://localhost:5002/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"type": "text", "text": "Hola, que puedes hacer?"}]
      }
    },
    "id": 1
  }'
```

### Enviar Mensaje con Streaming

```bash
curl -N -X POST http://localhost:5002/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"type": "text", "text": "Hola!"}]
      },
      "configuration": {"streaming": true}
    },
    "id": 1
  }'
```

### Transcribir Video

```bash
curl -X POST http://localhost:5002/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"type": "text", "text": "transcribe https://youtu.be/VIDEO_ID"}]
      }
    },
    "id": 1
  }'
```

## Precios x402

| Servicio | Precio | Red |
|----------|--------|-----|
| transcribe_video | $0.07 | Base Sepolia |
| summarize_video | $0.10 | Base Sepolia |
| chat | $0.07 | Base Sepolia |

Los precios se determinan dinamicamente segun el contenido del mensaje.

## Configuracion MCP (Claude Desktop)

Agregar a `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "youtube-transcriber": {
      "command": "npx",
      "args": ["tsx", "/ruta/completa/src/mcp-server.ts"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## Estructura del Proyecto

```
my-agent/
├── src/
│   ├── lib/
│   │   └── openai.ts           # Cliente OpenAI singleton
│   ├── services/
│   │   └── transcript-extractor.ts  # Logica de transcripcion
│   ├── agent.ts                # Agente con function calling
│   ├── tools.ts                # Definicion y handlers de tools
│   ├── a2a-server.ts           # Servidor A2A con x402
│   ├── a2a-client.ts           # Cliente A2A para testing
│   ├── mcp-server.ts           # Servidor MCP
│   └── register.ts             # Registro en agent registry
├── .well-known/
│   └── agent-card.json         # Metadata del agente (A2A)
├── docs/
│   └── workshop-transcription-service.md
├── test-requests.http          # Requests para testing manual
├── .env.example
├── package.json
└── tsconfig.json
```

## Protocolos

### MCP (Model Context Protocol)

- Protocolo stdio para comunicacion con clientes humanos
- Sin autenticacion ni pagos
- Usado por Claude Desktop, Cursor, etc.

### A2A (Agent-to-Agent Protocol)

- HTTP JSON-RPC 2.0
- Soporta streaming via SSE
- Pagos via x402 (micropagos en Base Sepolia)
- Conversaciones multi-turno con contextId

### x402

- Protocolo de micropagos HTTP
- Header `X-Payment` con prueba de pago
- Respuesta 402 cuando se requiere pago

## Scripts

| Script | Descripcion |
|--------|-------------|
| `yarn start:a2a` | Inicia servidor A2A en puerto 5002 |
| `yarn start:mcp` | Inicia servidor MCP (stdio) |
| `yarn register` | Registra agente en registry |
| `yarn build` | Compila TypeScript |

## Tecnologias

- **TypeScript** - Lenguaje
- **OpenAI GPT-4o-mini** - LLM para function calling y respuestas
- **OpenAI Whisper** - Transcripcion de audio
- **yt-dlp** - Descarga de audio de YouTube
- **Express** - Servidor HTTP
- **x402** - Micropagos
- **MCP SDK** - Protocolo para clientes humanos

## Troubleshooting

### Error: 403 Forbidden al descargar video

yt-dlp requiere deno para descifrar URLs de YouTube:

```bash
brew install deno
```

### Error: ENOENT ffmpeg

Instalar ffmpeg:

```bash
brew install ffmpeg
```

### Error: Payment Required (402)

El endpoint A2A requiere pago x402. Para testing sin pago, usar el servidor MCP o deshabilitar temporalmente el middleware de pago.

## Licencia

MIT
