// ITSM Operations Digital Worker — OpenAI configuration (Azure OpenAI or standard)

import { configDotenv } from 'dotenv';
configDotenv();

import OpenAI from 'openai';

let openaiClient: any = null;

export function isAzureOpenAI(): boolean {
  return !!(process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_BASE);
}

export function getModelName(): string {
  return process.env.AZURE_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o';
}

export function configureOpenAIClient(): void {
  try {
    if (isAzureOpenAI()) {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_BASE || '';
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';

      if (process.env.AZURE_OPENAI_API_KEY) {
        openaiClient = new OpenAI({
          apiKey: process.env.AZURE_OPENAI_API_KEY,
          baseURL: `${endpoint}/openai/deployments/${getModelName()}`,
          defaultQuery: { 'api-version': apiVersion },
          defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
        });
      } else {
        // Use managed identity — lazy auth on first call
        openaiClient = new OpenAI({
          apiKey: 'placeholder',
          baseURL: `${endpoint}/openai/deployments/${getModelName()}`,
          defaultQuery: { 'api-version': apiVersion },
        });
      }
      console.log(`[OpenAI] Azure OpenAI configured: ${endpoint}, model: ${getModelName()}`);
    } else if (process.env.OPENAI_API_KEY) {
      openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      console.log(`[OpenAI] Standard OpenAI configured, model: ${getModelName()}`);
    } else {
      console.warn('[OpenAI] No API key configured. LLM features will not work until credentials are provided.');
    }
  } catch (err) {
    console.error('[OpenAI] Configuration error (non-fatal):', err);
  }
}

export function getOpenAIClient(): any {
  return openaiClient;
}
