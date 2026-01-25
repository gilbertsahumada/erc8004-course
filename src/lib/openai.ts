/**
 * Shared OpenAI Client
 *
 * Esta instancia es compartida por:
 * - agent.ts (para chat general y function calling)
 * - transcript-extractor.ts (para summarize)
 *
 * Beneficios de centralizar:
 * - DRY (Don't Repeat Yourself)
 * - Una sola configuración
 * - Fácil de mockear en tests
 */

import OpenAI from 'openai';

// Inicializar OpenAI client una sola vez
// API key se carga de OPENAI_API_KEY en .env
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
