/**
 * MCP Tools Definition
 * 
 * This file defines the tools your MCP server exposes.
 * Each tool has:
 * - name: Unique identifier for the tool
 * - description: What the tool does (shown to AI clients)
 * - inputSchema: JSON Schema defining expected parameters
 * 
 * Add your own tools by:
 * 1. Adding a tool definition to the 'tools' array
 * 2. Adding a case in handleToolCall() to implement it
 */

import { generateResponse } from './agent.js';
import { transcribe, summarize } from './services/transcript-extractor.js';

// ============================================================================
// Tool Definitions
// Add new tools here - these are exposed to MCP clients
// ============================================================================

export const tools = [
  {
    name: 'chat',
    description: 'Have a conversation with the AI agent',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'The message to send to the agent',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'transcribe_video',
    description: 'Transcribe a YouTube video given its URL',
    inputSchema: {
      type: 'object',
      properties: {
        videoUrl: {
          type: 'string',
          description: 'The URL of the YouTube video to transcribe',
        }
      },
      required: ['videoUrl'],
    },
  },
  {
    name: 'summarize_video',
    description: 'Summarize a YouTube video given its URL',
    inputSchema: {
      type: 'object',
      properties: {
        videoUrl: {
          type: 'string',
          description: 'The URL of the YouTube video to summarize',
        }
      },
      required: ['videoUrl'],
    },
  }
];

// ============================================================================
// Tool Implementations
// Add the logic for each tool here
// ============================================================================

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    // Chat tool - uses the LLM agent
    case 'chat': {
      const message = args.message as string;
      const response = await generateResponse(message);
      return { response };
    }

    case 'summarize_video': {
      const videoUrl = args.videoUrl as string;
      const summaryResult = await summarize(videoUrl);
      return summaryResult;
    }

    case 'transcribe_video': {
      const videoUrl = args.videoUrl as string;
      const transcriptResult = await transcribe(videoUrl);
      return transcriptResult;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
