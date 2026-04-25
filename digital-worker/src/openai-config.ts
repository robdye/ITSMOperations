// ITSM Operations Digital Worker — OpenAI configuration (Azure OpenAI or standard)

import { configDotenv } from 'dotenv';
configDotenv();

import OpenAI from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { isApimEnabled, getProxiedEndpoint } from './apim-gateway';

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
      const rawEndpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_BASE || '';
      const endpoint = isApimEnabled()
        ? getProxiedEndpoint('openai') || rawEndpoint
        : rawEndpoint;
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';

      if (process.env.AZURE_OPENAI_API_KEY) {
        openaiClient = new OpenAI({
          apiKey: process.env.AZURE_OPENAI_API_KEY,
          baseURL: `${endpoint}/openai/deployments/${getModelName()}`,
          defaultQuery: { 'api-version': apiVersion },
          defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
        });
      } else {
        // Use managed identity via DefaultAzureCredential
        const credential = new DefaultAzureCredential();
        const tokenProvider = getBearerTokenProvider(credential, 'https://cognitiveservices.azure.com/.default');
        openaiClient = new OpenAI({
          apiKey: '',
          baseURL: `${endpoint}/openai/deployments/${getModelName()}`,
          defaultQuery: { 'api-version': apiVersion },
          fetch: async (url: string | Request | URL, init?: RequestInit) => {
            const token = await tokenProvider();
            const headers = new Headers(init?.headers);
            headers.set('Authorization', `Bearer ${token}`);
            return fetch(url, { ...init, headers });
          },
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

// ── Model Routing ──

// Model routing by task type
// o4-mini for reasoning-heavy tasks (RCA, risk scoring, Five-Whys)
// gpt-4o for standard chat/CRUD
// gpt-4o-mini for routing/classification

type TaskType = 
  | 'routing'      // Intent classification
  | 'rca'          // Root cause analysis
  | 'risk'         // Risk assessment, blast radius
  | 'five-whys'    // Problem investigation
  | 'finops'       // FinOps analysis, rightsizing
  | 'chat'         // General conversation
  | 'crud'         // CRUD operations
  | 'briefing'     // Dashboard/report generation
  | 'default';     // Fallback

const MODEL_ROUTING: Record<TaskType, string> = {
  routing: process.env.ROUTING_MODEL || 'gpt-4o-mini',
  rca: process.env.REASONING_MODEL || 'o4-mini',
  risk: process.env.REASONING_MODEL || 'o4-mini',
  'five-whys': process.env.REASONING_MODEL || 'o4-mini',
  finops: process.env.REASONING_MODEL || 'o4-mini',
  chat: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
  crud: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
  briefing: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
  default: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
};

export function getModelForTask(taskType: string): string {
  return MODEL_ROUTING[taskType as TaskType] || MODEL_ROUTING.default;
}

/** Detect task type from worker ID and user message context */
export function detectTaskType(workerId: string, message: string): TaskType {
  const lower = message.toLowerCase();
  
  // Explicit reasoning tasks
  if (/root cause|rca|root-cause/i.test(lower)) return 'rca';
  if (/five.whys|5.whys|why.*why.*why/i.test(lower)) return 'five-whys';
  if (/blast radius|risk assess|risk scor|change.*risk/i.test(lower)) return 'risk';
  if (/rightsiz|cost optim|finops|cloud spend/i.test(lower)) return 'finops';
  
  // Worker-based routing
  if (workerId === 'problem-manager' && /investigat|analyz|diagnos/i.test(lower)) return 'rca';
  if (workerId === 'change-manager' && /risk|impact|collision/i.test(lower)) return 'risk';
  
  // CRUD operations
  if (/create|update|close|assign|resolve|approve/i.test(lower)) return 'crud';
  
  // Briefing/reports
  if (/briefing|dashboard|report|summary|overview|status/i.test(lower)) return 'briefing';
  
  return 'default';
}
