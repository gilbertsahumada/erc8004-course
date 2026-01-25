/**
 * A2A (Agent-to-Agent) Server
 * 
 * This server implements the A2A protocol for agent communication.
 * Learn more: https://a2a-protocol.org/
 * 
 * Endpoints:
 * - GET  /.well-known/agent-card.json  → Agent discovery card
 * - POST /a2a                          → JSON-RPC 2.0 endpoint
 * 
 * Supported methods:
 * - message/send   → Send a message and get a response
 * - tasks/get      → Get status of a previous task
 * - tasks/cancel   → Cancel a running task
 */

import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { streamResponseWithTools, type AgentMessage } from './agent.js';
import { paymentMiddleware, x402ResourceServer, Network } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';

const app = express();
app.use(express.json());

// ============================================================================
// In-Memory Storage
// In production, replace with a database (Redis, PostgreSQL, etc.)
// ============================================================================

/**
 * Task storage - tracks all tasks and their current state
 * A task represents a single request/response interaction
 */
const tasks = new Map<string, {
  id: string;
  contextId: string;
  status: 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';
  messages: Array<{ role: 'user' | 'agent'; parts: Array<{ type: 'text'; text: string }> }>;
  artifacts: Array<{ name: string; parts: Array<{ type: 'text'; text: string }> }>;
}>();

/**
 * Conversation history storage - maintains context across messages
 * The contextId allows multiple messages to share conversation history
 */
const conversationHistory = new Map<string, AgentMessage[]>();

// ============================================================================
// Middleware & Routes
// ============================================================================

const PRICES: Record<string, string> = {
  transcribe: '$0.07', // Price for transcription tool
  summarize: '$0.10', // Price for summarization tool
}

const x402Config = {
  payeeAddress: process.env.X402_PAYEE_ADDRESS || '0x2AAF0454eB4B6D59B09E1BB49B00a8cF2dDDa89e',
  network: 'eip155:84532' as Network, // CAIP-2 EVM network
  //facilitatorUrl: 'https://x402.org/facilitator', // Testnet facilitator
}
// x402 v2 payment middleware - protects the /a2a endpoint
// See: https://docs.cdp.coinbase.com/x402/quickstart-for-sellers
//const PAYEE_ADDRESS = process.env.X402_PAYEE_ADDRESS || '0x2AAF0454eB4B6D59B09E1BB49B00a8cF2dDDa89e';
//const X402_NETWORK = 'eip155:11155111'; // CAIP-2 EVM network

// Create facilitator client (testnet - change URL for mainnet)
const facilitatorClient = new HTTPFacilitatorClient({
  url: 'https://x402.org/facilitator', // Testnet facilitator
});

const x402Server = new x402ResourceServer(facilitatorClient)
  .register(x402Config.network, new ExactEvmScheme());

function dynamicPricing(req: Request, res: Response, next: NextFunction) {
  const method = req.body?.params?.message?.parts?.[0]?.text || '';

  let price = PRICES['transcribe']; // Default price
  for (const [service, servicePrice] of Object.entries(PRICES)) {
    if (method.toLowerCase().includes(service)) {
      price = servicePrice;
      break;
    }
  }

  return paymentMiddleware(
    {
      'POST /a2a': {
        accepts: [
          {
            scheme: 'exact',
            price: price,
            network: x402Config.network,
            payTo: x402Config.payeeAddress,
          },
        ],
        description: 'A2A JSON-RPC endpoint with dynamic pricing',
        mimeType: 'application/json',
      },
    },
    x402Server,
  )(req, res, next);
}

/**
 * Agent Card endpoint - required for A2A discovery
 * Other agents use this to learn about your agent's capabilities
 * This endpoint is FREE (no payment required)
 */
app.get('/.well-known/agent-card.json', async (_req: Request, res: Response) => {
  const agentCard = await import('../.well-known/agent-card.json', 
    { assert: { type: 'json' } });
  res.json(agentCard.default);
});

/**
 * Main JSON-RPC 2.0 endpoint
 * All A2A protocol methods are called through this single endpoint
 * Protected by x402 payment middleware with dynamic pricing
 */
//app.post('/a2a', dynamicPricing, async (req: Request, res: Response) => {
app.post('/a2a', dynamicPricing, async (req: Request, res: Response) => {
  const { jsonrpc, method, params, id } = req.body;

  // Validate JSON-RPC version
  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id });
  }

  try {
    const result = await handleMethod(method, params, res);
    // If result is null, response was already sent (streaming)
    if (result !== null) {
      res.json({ jsonrpc: '2.0', result, id });
    }
  } catch (error: any) {
    res.json({
      jsonrpc: '2.0',
      error: { code: -32603, message: error.message || 'Internal error' },
      id,
    });
  }
});

// ============================================================================
// Method Handlers
// ============================================================================

/**
 * Route JSON-RPC methods to their handlers
 * Add new methods here as needed
 */
async function handleMethod(method: string, params: any, res?: express.Response) {
  switch (method) {
    case 'message/send':
      return handleMessageSend(params, res);
    case 'message/stream':
      // Alias for streaming - some clients use this
      return handleMessageSend({ ...params, configuration: { ...params.configuration, streaming: true } }, res);
    case 'tasks/get':
      return handleTasksGet(params);
    case 'tasks/cancel':
      return handleTasksCancel(params);
    case 'tasks/resubmit':
      // Continue a task that was in input-required state
      return handleTaskResubmit(params, res);
    default:
      throw new Error(`Method not found: ${method}`);
  }
}

/**
 * Handle tasks/resubmit - continue a task that needs input
 * This is used when a task is in 'input-required' state
 */
async function handleTaskResubmit(
  params: {
    taskId: string;
    message: { role: string; parts: Array<{ type: string; text?: string }> };
    configuration?: { streaming?: boolean };
  },
  res?: express.Response
) {
  const task = tasks.get(params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  if (task.status !== 'input-required') {
    throw new Error(`Task is not awaiting input. Current status: ${task.status}`);
  }

  // Continue the task by sending a new message with the same context
  return handleMessageSend({
    message: params.message,
    configuration: {
      contextId: task.contextId,
      streaming: params.configuration?.streaming,
    },
  }, res);
}

/**
 * Handle message/send with streaming support
 * 
 * @param params.message - The user's message with role and parts
 * @param params.configuration.contextId - Optional ID to continue a conversation
 * @param res - Express response object for SSE streaming
 * @returns A task object (or streams response via SSE)
 */
async function handleMessageSend(
  params: {
    message: { role: string; parts: Array<{ type: string; text?: string }> };
    configuration?: { contextId?: string; streaming?: boolean };
  },
  res?: express.Response
) {
  const { message, configuration } = params;
  const streaming = configuration?.streaming ?? false;
  
  // Use existing contextId for conversation continuity, or create new one
  const contextId = configuration?.contextId || uuidv4();
  const taskId = uuidv4();

  // Extract text content from message parts
  const userText = message.parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text)
    .join('\n');

  // Get conversation history for context-aware responses
  const history = conversationHistory.get(contextId) || [];

  if (streaming && res) {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Create initial task in 'working' state
    const task = {
      id: taskId,
      contextId,
      status: 'working' as const,
      messages: [
        { role: 'user' as const, parts: [{ type: 'text' as const, text: userText }] },
      ],
      artifacts: [],
    };
    tasks.set(taskId, task);

    // Send initial task state
    res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', result: task })}\n\n`);

    // Stream the response
    let fullResponse = '';
    for await (const chunk of streamResponseWithTools(userText, history)) {
      fullResponse += chunk;
      
      // Send each chunk as an SSE event
      const partialTask = {
        ...task,
        status: 'working' as const,
        messages: [
          { role: 'user' as const, parts: [{ type: 'text' as const, text: userText }] },
          { role: 'agent' as const, parts: [{ type: 'text' as const, text: fullResponse }] },
        ],
      };
      res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', result: partialTask })}\n\n`);
    }

    // Update conversation history
    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: fullResponse });
    conversationHistory.set(contextId, history);

    // Send final completed task
    const completedTask = {
      id: taskId,
      contextId,
      status: 'completed' as const,
      messages: [
        { role: 'user' as const, parts: [{ type: 'text' as const, text: userText }] },
        { role: 'agent' as const, parts: [{ type: 'text' as const, text: fullResponse }] },
      ],
      artifacts: [],
    };
    tasks.set(taskId, completedTask);
    
    res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', result: completedTask })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    
    return null; // Response already sent via SSE
  }

  // Non-streaming: generate complete response
  let responseText = '';
  for await (const chunk of streamResponseWithTools(userText, history)) {
    responseText += chunk;
  }

  // Update conversation history for future messages
  history.push({ role: 'user', content: userText });
  history.push({ role: 'assistant', content: responseText });
  conversationHistory.set(contextId, history);

  // Create the task response object
  const task = {
    id: taskId,
    contextId,
    status: 'completed' as const,
    messages: [
      { role: 'user' as const, parts: [{ type: 'text' as const, text: userText }] },
      { role: 'agent' as const, parts: [{ type: 'text' as const, text: responseText }] },
    ],
    artifacts: [],
  };

  tasks.set(taskId, task);
  return task;
}

/**
 * Handle tasks/get - retrieve a task by ID
 * Useful for checking status of async operations
 */
async function handleTasksGet(params: { taskId: string }) {
  const task = tasks.get(params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }
  return task;
}

/**
 * Handle tasks/cancel - cancel a running task
 * For long-running tasks, this allows early termination
 */
async function handleTasksCancel(params: { taskId: string }) {
  const task = tasks.get(params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }
  task.status = 'canceled';
  return task;
}

// ============================================================================
// Start Server
// ============================================================================

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
  console.log(`🤖 A2A Server running on http://localhost:${PORT}`);
  console.log(`📋 Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`🔗 JSON-RPC endpoint: http://localhost:${PORT}/a2a`);
});
