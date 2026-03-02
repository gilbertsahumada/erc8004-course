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
╔══════════════════════════════════════════════════════════════════════════════╗
║                  YOUTUBE TRANSCRIPTION AGENT — ECOSISTEMA                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║   ┌─────────────────────────┐       ┌──────────────────────────────────┐     ║
║   │   INTERFAZ MCP (gratis) │       │      INTERFAZ A2A (pago)         │     ║
║   │   ─────────────────     │       │      ────────────────            │     ║
║   │   Claude Desktop        │       │      POST /a2a                   │     ║
║   │   Cursor / IDEs         │       │      + header X-Payment          │     ║
║   │   stdio (local)         │       │      HTTP (remoto)               │     ║
║   │                         │       │                                  │     ║
║   │    Humanos              │       │        Otros Agentes             │     ║
║   └────────────┬────────────┘       └───────────────┬──────────────────┘     ║
║                └──────────────┬─────────────────────┘                        ║
║                               ▼                                              ║
║                ┌──────────────────────────────┐                              ║
║                │       CORE DEL AGENTE        │                              ║
║                │   ┌────────────────────────┐ │                              ║
║                │   │  agent.ts              │ │                              ║
║                │   │  GPT-4o-mini           │ │                              ║
║                │   │  (function calling +   │ │                              ║
║                │   │   streaming)           │ │                              ║
║                │   └───────────┬────────────┘ │                              ║
║                │               ▼              │                              ║
║                │   ┌────────────────────────┐ │                              ║
║                │   │  tools.ts              │ │                              ║
║                │   │  handleToolCall()      │ │                              ║
║                │   └───────────┬────────────┘ │                              ║
║                │               ▼              │                              ║
║                │   ┌────────────────────────┐ │                              ║
║                │   │ transcript-extractor   │ │                              ║
║                │   │  yt-dlp + Whisper API  │ │                              ║
║                │   └────────────────────────┘ │                              ║
║                └──────────────────────────────┘                              ║
║                                                                              ║
║  ═══════════════════  CAPAS DE PROTOCOLO  ════════════════════════════       ║
║                                                                              ║
║  ┌─────────────────────┐ ┌──────────────────┐ ┌───────────────────────┐      ║
║  │   IDENTIDAD         │ │   PAGOS          │ │   DESCUBRIMIENTO      │      ║
║  │  ─────────          │ │  ─────           │ │  ──────────────       │      ║
║  │  ERC-8004           │ │  x402 Protocol   │ │  Agent Card           │      ║
║  │  Identity Registry  │ │  HTTP 402 flow   │ │  .well-known/         │      ║
║  │                     │ │                  │ │    agent-card.json    │      ║
║  │  Ethereum Sepolia   │ │  Base Sepolia    │ │                       │      ║
║  │  (registro unico)   │ │  (cada request)  │ │  Skills, auth,        │      ║
║  │                     │ │                  │ │  capabilities         │      ║
║  │  0x8004...8847      │ │  $0.07 / $0.10   │ │  (gratis, publico)    │      ║
║  └─────────────────────┘ └──────────────────┘ └───────────────────────┘      ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

## Flujo Completo

El siguiente diagrama muestra las 4 fases del ciclo de vida de una request, desde el registro del agente hasta la entrega de la transcripcion:

### Fase 1 — Registro (ERC-8004) · Una sola vez

```
┌──────────────┐                      ┌───────────────────────────┐
│ Desarrollador│                      │  Identity Registry        │
│ (register.ts)│                      │  Ethereum Sepolia         │
└──────┬───────┘                      │  0x8004...8847            │
       │                              └─────────────┬─────────────┘
       │  1. registerAgent({                        │
       │       agentUrl,                            │
       │       name,                                │
       │       description                          │
       │     })                                     │
       │───────────────────────────────────────────>│
       │                                            │
       │  2. Mint NFT (tokenId) ───────────────────>│  Almacena on-chain:
       │                                            │  • URL del agente
       │  3. tx confirmada                          │  • Nombre
       │<───────────────────────────────────────────│  • Descripcion
       │                                            │  • Owner address
       │  ✅ Agente tiene identidad verificable     │
       └────────────────────────────────────────────┘

       ⚡ Esto se hace UNA VEZ. Despues el agente existe como NFT en la blockchain.
```

### Fase 2 — Descubrimiento (Agent Card) · Gratis

```
┌──────────────┐                      ┌───────────────────────────┐
│  A2A Client  │                      │     A2A Server            │
│  (agente     │                      │     localhost:5002        │
│   externo)   │                      └─────────────┬─────────────┘
└──────┬───────┘                                    │
       │                                            │
       │  1. GET /.well-known/agent-card.json       │
       │───────────────────────────────────────────>│
       │                                            │
       │  2. 200 OK                                 │
       │<───────────────────────────────────────────│
       │     {                                      │
       │       "name": "YouTube Transcription...",  │
       │       "skills": ["transcribe", "summarize"]│
       │       "authentication": { "schemes":       │
       │         ["x402"] }                         │
       │     }                                      │
       │                                            │
       │  ✅ Cliente sabe QUE hace el agente        │
       │     y que necesita pago x402               │
       └────────────────────────────────────────────┘

       💡 Esto es GRATIS — cualquiera puede descubrir el agente.
```

### Fase 3 — Request + Pago (x402) · Cada request

```
┌──────────────┐           ┌──────────────┐           ┌──────────────────┐
│  A2A Client  │           │  A2A Server  │           │    Facilitator   │
│              │           │  (a2a-server │           │    x402.org      │
│              │           │    .ts)      │           │                  │
└──────┬───────┘           └──────┬───────┘           └────────┬─────────┘
       │                          │                            │
       │  1. POST /a2a            │                            │
       │  { "transcribe video" }  │                            │
       │─────────────────────────>│                            │
       │                          │                            │
       │  2. 402 Payment Required │                            │
       │  {                       │                            │
       │    "price": "$0.07",     │                            │
       │    "network":            │                            │
       │      "eip155:84532",     │                            │
       │    "payTo": "0x..."      │                            │
       │  }                       │                            │
       │<─────────────────────────│                            │
       │                          │                            │
       │  3. Cliente paga         │                            │
       │     on-chain (Base       │                            │
       │     Sepolia) y obtiene   │                            │
       │     proof de pago        │                            │
       │                          │                            │
       │  4. POST /a2a            │                            │
       │  + header: X-Payment     │                            │
       │  { "transcribe video" }  │                            │
       │─────────────────────────>│                            │
       │                          │                            │
       │                          │  5. Verificar pago         │
       │                          │─────────────────────────── >│
       │                          │                            │
       │                          │  6. { "valid": true }      │
       │                          │<───────────────────────────│
       │                          │                            │
       │  7. 200 OK (procesar)    │                            │
       │<─────────────────────────│                            │
       │                          │                            │
       │  ✅ Pago verificado,     │                            │
       │     request procesado    │                            │
       └──────────────────────────┘                            │

       💰 Esto pasa en CADA REQUEST de pago (A2A).
          MCP es gratis — no pasa por este flujo.
```

### Fase 4 — Transcripcion (Procesamiento interno)

```
┌──────────────┐    ┌────────────┐    ┌────────────────────┐    ┌──────────┐
│  a2a-server  │    │  agent.ts  │    │      tools.ts      │    │transcript│
│    .ts       │    │            │    │  handleToolCall()  │    │-extractor│
└──────┬───────┘    └─────┬──────┘    └─────────┬──────────┘    └────┬─────┘
       │                  │                     │                    │
       │  1. mensaje del  │                     │                    │
       │     usuario      │                     │                    │
       │─────────────────>│                     │                    │
       │                  │                     │                    │
       │                  │  2. GPT-4o-mini     │                    │
       │                  │     decide: usar    │                    │
       │                  │     tool            │                    │
       │                  │     "transcribe_    │                    │
       │                  │      video"         │                    │
       │                  │────────────────────>│                    │
       │                  │                     │                    │
       │                  │                     │  3. transcribe()   │
       │                  │                     │───────────────────>│
       │                  │                     │                    │
       │                  │                     │    a. yt-dlp       │
       │                  │                     │       descarga     │
       │                  │                     │       audio        │
       │                  │                     │                    │
       │                  │                     │    b. Whisper API  │
       │                  │                     │       transcribe   │
       │                  │                     │                    │
       │                  │                     │  4. VideoTranscript│
       │                  │                     │<───────────────────│
       │                  │                     │                    │
       │                  │  5. tool result     │                    │
       │                  │<────────────────────│                    │
       │                  │                     │                    │
       │                  │  6. GPT-4o-mini     │                    │
       │                  │     formatea        │                    │
       │  7. respuesta    │     respuesta       │                    │
       │     (streaming)  │                     │                    │
       │<─────────────────│                     │                    │
       │                  │                     │                    │

       🎬 El usuario recibe la transcripcion via SSE streaming.
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

### x402 vs ERC-8004

```
┌───────────────────────┬──────────────────────┬──────────────────────────┐
│                       │      ERC-8004        │         x402             │
│                       │   (Identity NFT)     │    (Payment Protocol)    │
├───────────────────────┼──────────────────────┼──────────────────────────┤
│  Proposito            │  Registrar agente    │  Cobrar por servicio     │
│                       │  como entidad unica  │  en cada request         │
├───────────────────────┼──────────────────────┼──────────────────────────┤
│  Cuando se usa        │  UNA VEZ             │  CADA REQUEST            │
│                       │  (al crear agente)   │  (que requiera pago)     │
├───────────────────────┼──────────────────────┼──────────────────────────┤
│  Donde vive           │  Ethereum Sepolia    │  Base Sepolia            │
│                       │  (L1)                │  (L2)                    │
├───────────────────────┼──────────────────────┼──────────────────────────┤
│  Responde a           │  "QUIEN es este      │  "CUANTO cuesta usar     │
│                       │   agente?"           │   este servicio?"        │
└───────────────────────┴──────────────────────┴──────────────────────────┘
```

```
┌────────────────┬────────────────────────────────────────────────────┐
│  Protocolo     │  Responde a...                                    │
├────────────────┼────────────────────────────────────────────────────┤
│  ERC-8004      │  QUIEN soy y DONDE estoy registrado               │
│  x402          │  CUANTO cuesta y COMO pagar                        │
│  Agent Card    │  QUE hago y QUE necesitas para usarme              │
│  A2A           │  COMO comunicarte conmigo (protocolo de mensajes)  │
└────────────────┴────────────────────────────────────────────────────┘
```

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
