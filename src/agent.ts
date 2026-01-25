/**
 * LLM Agent
 * 
 * This file contains the AI logic for your agent.
 * By default, it uses OpenAI's GPT-4o-mini model.
 * 
 * To customize:
 * - Change the model in chat() (e.g., 'gpt-4o', 'gpt-3.5-turbo')
 * - Modify the system prompt in generateResponse()
 * - Add custom logic, tools, or RAG capabilities
 * 
 * To use a different LLM provider:
 * - Replace the OpenAI import with your preferred SDK
 * - Update the chat() function accordingly
 */

import { openai } from './lib/openai.js';
import { tools, handleToolCall } from './tools.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ============================================================================
// Core Functions
// ============================================================================

function convertToolsToOpenAI() {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }
  }))
}

export async function generateResponseWithTools(
  userMessage: string,
  history: AgentMessage[] = []
): Promise<string> {
  console.log('Generating response with tools...');
  
  const systemPrompt: AgentMessage = {
    role: 'system',
    content: `You are a Youtube video analysis assistant. 
    You can transcribe and summarize videos using the provided tools.  
    When a users ask to transcribe or summarize a video, use the appropriate
    tool`,
  };

  const messages: AgentMessage[] = [
    systemPrompt,
    ...history,
    { role: 'user', content: userMessage },
  ];

  // Primera llamada con tools disponibles
  const response = await openai.chat.completions.create({ 
    model: 'gpt-4o-mini',
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    tools: convertToolsToOpenAI(),
    tool_choice: 'auto',
  });

  const choice = response.choices[0];
  const message = choice.message;

  // Si OpenAI o LLM decide usar una herramienta
  if(message.tool_calls && message.tool_calls.length > 0) { 
    const toolCall = message.tool_calls[0];
    const toolName = toolCall.function.name;
    const toolArgs = JSON.parse(toolCall.function.arguments);

    // Ejecutar la tool usando handleToolCall
    const toolResult = await handleToolCall(toolName, toolArgs);

    // Segunda llamada: darle el resultado de la tool a OpenAI
    const finalResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        {
          role: 'assistant',
          content: `The tool ${toolName} was called with arguments ${JSON.stringify(toolArgs)} and returned: ${JSON.stringify(toolResult)}`,
          tool_calls: message.tool_calls,
        },
        {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        }
      ]
    })
    return finalResponse.choices[0]?.message?.content ?? 'No response';
  }

  // si no uso tool, devolver respuesta directa
  return message.content ?? 'No response';
}

/**
 * Stream a response WITH tool support (generator function)
 * Handles the complexity of streaming + function calling
 *
 * Flow:
 * 1. First call to OpenAI with tools available
 * 2. If tool_call detected → execute tool → second call with result → stream
 * 3. If no tool_call → stream directly
 */
export async function* streamResponseWithTools(
  userMessage: string,
  history: AgentMessage[] = []
): AsyncGenerator<string> {
  const systemPrompt: AgentMessage = {
    role: 'system',
    content: `You are a Youtube video analysis assistant.
    You have access to these tools:
    - transcribe_video: Use this when user wants to transcribe a YouTube video
    - summarize_video: Use this when user wants to summarize a YouTube video

    IMPORTANT: When the user provides a YouTube URL and asks to "transcribe" or "summarize",
    you MUST use the appropriate tool. Do not try to do it yourself.`,
  };

  console.log('[Agent] Processing message:', userMessage);

  const messages: AgentMessage[] = [
    systemPrompt,
    ...history,
    { role: 'user', content: userMessage },
  ];

  // Primera llamada: detectar si necesita usar una tool
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    tools: convertToolsToOpenAI(),
    tool_choice: 'auto',
  });

  const choice = response.choices[0];
  const message = choice.message;

  console.log('[Agent] OpenAI response:', {
    hasToolCalls: !!message.tool_calls,
    toolCalls: message.tool_calls,
    content: message.content,
    finishReason: choice.finish_reason,
  });

  // Si OpenAI decidió usar una tool
  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolCall = message.tool_calls[0];
    const toolName = toolCall.function.name;
    const toolArgs = JSON.parse(toolCall.function.arguments);

    console.log('[Agent] Executing tool:', toolName, 'with args:', toolArgs);

    // Ejecutar la tool
    const toolResult = await handleToolCall(toolName, toolArgs);

    console.log('[Agent] Tool result received, length:', JSON.stringify(toolResult).length);

    // Segunda llamada: stream con el resultado de la tool
    const streamWithTool = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        {
          role: 'assistant',
          content: null,
          tool_calls: message.tool_calls,
        },
        {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        },
      ],
      stream: true,
    });

    // Stream la respuesta final
    for await (const chunk of streamWithTool) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  } else {
    // No usó tool, stream directo
    const streamDirect = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    });

    for await (const chunk of streamDirect) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}
/**
 * Send messages to the LLM and get a response
 * This is the low-level function that calls the OpenAI API
 * 
 * @param messages - Array of conversation messages
 * @returns The assistant's response text
 */
export async function chat(messages: AgentMessage[]): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini', // Change model here if needed
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    // Add more options as needed:
    // temperature: 0.7,
    // max_tokens: 1000,
  });

  return response.choices[0]?.message?.content ?? 'No response';
}

/**
 * Generate a response to a user message
 * This is the main function called by A2A and MCP handlers
 * 
 * @param userMessage - The user's input
 * @param history - Previous conversation messages (for context)
 * @returns The agent's response
 */
export async function generateResponse(userMessage: string, history: AgentMessage[] = []): Promise<string> {
  // System prompt defines your agent's personality and behavior
  // Customize this to match your agent's purpose
  const systemPrompt: AgentMessage = {
    role: 'system',
    content: 'You are a helpful AI assistant registered on the ERC-8004 protocol. Be concise and helpful.',
  };

  // Build the full message array: system prompt + history + new message
  const messages: AgentMessage[] = [
    systemPrompt,
    ...history,
    { role: 'user', content: userMessage },
  ];

  return chat(messages);
}

/**
 * Stream a response to a user message (generator function)
 * Yields chunks of text as they are generated by the LLM
 * 
 * @param userMessage - The user's input
 * @param history - Previous conversation messages (for context)
 * @yields Text chunks as they are generated
 */
export async function* streamResponse(userMessage: string, history: AgentMessage[] = []): AsyncGenerator<string> {
  const systemPrompt: AgentMessage = {
    role: 'system',
    content: 'You are a helpful AI assistant registered on the ERC-8004 protocol. Be concise and helpful.',
  };

  const messages: AgentMessage[] = [
    systemPrompt,
    ...history,
    { role: 'user', content: userMessage },
  ];

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}
