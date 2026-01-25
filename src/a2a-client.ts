/**
 * A2A Client Example
 *
 * Demonstrates the full A2A protocol flow:
 * 1. Agent Discovery - Fetch agent card to learn capabilities
 * 2. Multi-turn Conversations - Using contextId for continuity
 * 3. Streaming Responses - Real-time SSE updates
 * 4. Task Management - Track task states (working, input-required, completed)
 * 5. Interactive Flow - Handle input-required when agent needs clarification
 *
 * Run: npx tsx src/a2a-client.ts
 */

import 'dotenv/config';

// ============================================================================
// Types
// ============================================================================

interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples: string[];
  }>;
}

interface Task {
  id: string;
  contextId: string;
  status: 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';
  messages: Array<{
    role: 'user' | 'agent';
    parts: Array<{ type: 'text'; text: string }>;
  }>;
  artifacts: Array<{
    name: string;
    parts: Array<{ type: 'text'; text: string }>;
  }>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: Task;
  error?: { code: number; message: string };
  id: number;
}

// ============================================================================
// A2A Client Class
// ============================================================================

class A2AClient {
  private baseUrl: string;
  private currentContextId?: string;
  private requestId = 0;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Step 1: Discover agent capabilities via Agent Card
   * This is always FREE - no payment required
   */
  async discoverAgent(): Promise<AgentCard> {
    console.log('\n--- AGENT DISCOVERY ---');
    console.log(`Fetching: ${this.baseUrl}/.well-known/agent-card.json\n`);

    const response = await fetch(`${this.baseUrl}/.well-known/agent-card.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch agent card: ${response.status}`);
    }

    const card: AgentCard = await response.json();

    console.log(`Agent: ${card.name}`);
    console.log(`Description: ${card.description}`);
    console.log(`Version: ${card.version}`);
    console.log(`Streaming: ${card.capabilities.streaming ? 'Yes' : 'No'}`);
    console.log('\nSkills:');
    card.skills.forEach(skill => {
      console.log(`  - ${skill.name}: ${skill.description}`);
      console.log(`    Examples: ${skill.examples.join(', ')}`);
    });

    return card;
  }

  /**
   * Step 2: Send a message to the agent
   * Returns a Task object with status and response
   */
  async sendMessage(text: string, options?: {
    contextId?: string;
    streaming?: boolean;
  }): Promise<Task> {
    const contextId = options?.contextId || this.currentContextId;
    const streaming = options?.streaming ?? false;

    console.log('\n--- SENDING MESSAGE ---');
    console.log(`User: ${text}`);
    console.log(`Context ID: ${contextId || '(new conversation)'}`);
    console.log(`Streaming: ${streaming}`);

    const payload = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text }],
        },
        configuration: {
          ...(contextId && { contextId }),
          streaming,
        },
      },
      id: ++this.requestId,
    };

    console.log('\nRequest payload:');
    console.log(JSON.stringify(payload, null, 2));

    if (streaming) {
      return this.handleStreamingResponse(payload);
    }

    const response = await fetch(`${this.baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Check for 402 Payment Required
    if (response.status === 402) {
      const paymentInfo = await response.json();
      console.log('\n--- PAYMENT REQUIRED (402) ---');
      console.log(JSON.stringify(paymentInfo, null, 2));
      throw new Error('Payment required - x402 payment needed');
    }

    const result: JsonRpcResponse = await response.json();

    if (result.error) {
      throw new Error(`RPC Error: ${result.error.message}`);
    }

    const task = result.result!;
    this.currentContextId = task.contextId;

    this.printTask(task);
    return task;
  }

  /**
   * Handle SSE streaming response
   */
  private async handleStreamingResponse(payload: object): Promise<Task> {
    console.log('\n--- STREAMING RESPONSE ---');

    const response = await fetch(`${this.baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status === 402) {
      throw new Error('Payment required - x402 payment needed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let lastTask: Task | null = null;
    let buffer = '';

    console.log('\nAgent: ', '');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            console.log('\n[Stream completed]');
            continue;
          }

          try {
            const parsed: JsonRpcResponse = JSON.parse(data);
            if (parsed.result) {
              lastTask = parsed.result;

              // Print only the latest agent response incrementally
              const agentMsg = lastTask.messages.find(m => m.role === 'agent');
              if (agentMsg) {
                process.stdout.write(`\rAgent: ${agentMsg.parts[0].text}`);
              }
            }
          } catch (e) {
            // Ignore parse errors for partial chunks
          }
        }
      }
    }

    console.log('\n');

    if (!lastTask) throw new Error('No task received');
    this.currentContextId = lastTask.contextId;
    return lastTask;
  }

  /**
   * Step 3: Get task status (useful for async/long-running tasks)
   */
  async getTask(taskId: string): Promise<Task> {
    console.log('\n--- GETTING TASK STATUS ---');
    console.log(`Task ID: ${taskId}`);

    const response = await fetch(`${this.baseUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tasks/get',
        params: { taskId },
        id: ++this.requestId,
      }),
    });

    const result: JsonRpcResponse = await response.json();

    if (result.error) {
      throw new Error(`RPC Error: ${result.error.message}`);
    }

    this.printTask(result.result!);
    return result.result!;
  }

  /**
   * Continue conversation using existing context
   */
  continueConversation(text: string, streaming = false): Promise<Task> {
    if (!this.currentContextId) {
      throw new Error('No active conversation. Start with sendMessage first.');
    }
    return this.sendMessage(text, {
      contextId: this.currentContextId,
      streaming
    });
  }

  /**
   * Start a new conversation (clears context)
   */
  newConversation(): void {
    console.log('\n--- NEW CONVERSATION ---');
    this.currentContextId = undefined;
  }

  /**
   * Pretty print task details
   */
  private printTask(task: Task): void {
    console.log('\n--- TASK RESPONSE ---');
    console.log(`Task ID: ${task.id}`);
    console.log(`Context ID: ${task.contextId}`);
    console.log(`Status: ${task.status}`);
    console.log('\nMessages:');
    task.messages.forEach(msg => {
      const text = msg.parts.map(p => p.text).join('\n');
      console.log(`  [${msg.role}]: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
    });
    if (task.artifacts.length > 0) {
      console.log('\nArtifacts:');
      task.artifacts.forEach(a => console.log(`  - ${a.name}`));
    }
  }
}

// ============================================================================
// Demo Scenarios
// ============================================================================

async function demoBasicFlow(client: A2AClient) {
  console.log('\n========================================');
  console.log('DEMO 1: Basic Agent Discovery & Chat');
  console.log('========================================');

  // 1. Discover what the agent can do
  await client.discoverAgent();

  // 2. Simple greeting (no tool needed)
  await client.sendMessage('Hello! What can you help me with?');
}

async function demoMultiTurnConversation(client: A2AClient) {
  console.log('\n========================================');
  console.log('DEMO 2: Multi-turn Conversation');
  console.log('========================================');

  client.newConversation();

  // First message
  await client.sendMessage("Hi, I want to transcribe a video");

  // Continue the conversation (uses same contextId)
  await client.continueConversation("The video is about AI agents");

  // Continue further
  await client.continueConversation("Can you tell me what tools you have?");
}

async function demoStreamingResponse(client: A2AClient) {
  console.log('\n========================================');
  console.log('DEMO 3: Streaming Response');
  console.log('========================================');

  client.newConversation();

  // Send with streaming enabled
  await client.sendMessage(
    'Tell me a short story about two AI agents meeting for the first time',
    { streaming: true }
  );
}

async function demoTranscription(client: A2AClient) {
  console.log('\n========================================');
  console.log('DEMO 4: Tool Usage (Transcription)');
  console.log('========================================');

  client.newConversation();

  // This should trigger the transcribe_video tool
  // Note: Will fail with 402 if x402 payment is required
  try {
    await client.sendMessage(
      'Please transcribe this video: https://www.youtube.com/watch?v=P1HLBgU-vds'
    );
  } catch (error: any) {
    if (error.message.includes('Payment required')) {
      console.log('\nThis demonstrates the x402 payment flow!');
      console.log('In production, the client would need to send a payment header.');
    } else {
      throw error;
    }
  }
}

async function interactiveMode(client: A2AClient) {
  console.log('\n========================================');
  console.log('INTERACTIVE MODE');
  console.log('========================================');
  console.log('Commands:');
  console.log('  /new     - Start new conversation');
  console.log('  /stream  - Toggle streaming mode');
  console.log('  /status  - Show current context');
  console.log('  /exit    - Exit');
  console.log('');

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let streaming = false;

  const prompt = () => {
    rl.question('You: ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === '/exit') {
        console.log('Goodbye!');
        rl.close();
        return;
      }

      if (trimmed === '/new') {
        client.newConversation();
        console.log('Started new conversation.');
        prompt();
        return;
      }

      if (trimmed === '/stream') {
        streaming = !streaming;
        console.log(`Streaming mode: ${streaming ? 'ON' : 'OFF'}`);
        prompt();
        return;
      }

      if (trimmed === '/status') {
        console.log(`Streaming: ${streaming}`);
        prompt();
        return;
      }

      try {
        await client.sendMessage(trimmed, { streaming });
      } catch (error: any) {
        console.error(`Error: ${error.message}`);
      }

      prompt();
    });
  };

  prompt();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const serverUrl = process.env.A2A_SERVER_URL || 'http://localhost:5002';
  const client = new A2AClient(serverUrl);

  console.log('A2A Client Demo');
  console.log(`Connecting to: ${serverUrl}`);

  const args = process.argv.slice(2);

  if (args.includes('--interactive') || args.includes('-i')) {
    await client.discoverAgent();
    await interactiveMode(client);
    return;
  }

  // Run all demos
  try {
    await demoBasicFlow(client);
    await demoMultiTurnConversation(client);
    await demoStreamingResponse(client);
    await demoTranscription(client);
  } catch (error: any) {
    console.error(`\nError: ${error.message}`);
  }

  console.log('\n========================================');
  console.log('DEMOS COMPLETE');
  console.log('========================================');
  console.log('\nTry interactive mode: npx tsx src/a2a-client.ts -i');
}

main().catch(console.error);
