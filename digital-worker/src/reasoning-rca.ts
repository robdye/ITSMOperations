// ITSM Operations — Reasoning Model for Problem Management & RCA
// Routes RCA, post-incident review, and "five whys" analysis to an o-series reasoning model.
// Falls back to standard model if reasoning deployment is not configured.

import { getOpenAIClient, isAzureOpenAI, getModelName } from './openai-config';

// ── Types ──

export interface RCAResult {
  analysis: string;
  chainOfThought: string[];
  confidence: number;
  recommendations: string[];
}

export interface IncidentInput {
  incidentId: string;
  title: string;
  description: string;
  severity: string;
  category?: string;
  affectedCI?: string;
  timeline?: Array<{ time: string; event: string }>;
}

export interface CMDBContext {
  ciName: string;
  ciType?: string;
  dependencies?: string[];
  recentChanges?: Array<{ changeId: string; description: string; date: string }>;
}

// ── Helpers ──

function getReasoningDeployment(): string | undefined {
  return process.env.AZURE_OPENAI_REASONING_DEPLOYMENT;
}

function isReasoningAvailable(): boolean {
  return !!(getReasoningDeployment() && (process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_BASE));
}

/**
 * Call the reasoning model (o-series) via Azure OpenAI REST API.
 * Falls back to the standard model if reasoning deployment is not configured.
 */
async function callModel(systemPrompt: string, userPrompt: string): Promise<string> {
  const useReasoning = isReasoningAvailable();
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_BASE || '';
  const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY || '';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';
  const deployment = useReasoning ? getReasoningDeployment()! : getModelName();

  if (isAzureOpenAI() && endpoint && apiKey) {
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: useReasoning ? 1 : 0.2,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Azure OpenAI ${res.status}: ${errText}`);
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }

  // Fallback: use the configured OpenAI SDK client
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('No OpenAI client configured. Set AZURE_OPENAI_ENDPOINT + key or OPENAI_API_KEY.');
  }
  const completion = await client.chat.completions.create({
    model: deployment,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
  });
  return completion.choices?.[0]?.message?.content ?? '';
}

/** Parse a structured JSON response, falling back to a best-effort extraction. */
function parseRCAResponse(raw: string): RCAResult {
  try {
    // Try to extract JSON from markdown code fences
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const toParse = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    const parsed = JSON.parse(toParse);
    return {
      analysis: parsed.analysis ?? raw,
      chainOfThought: Array.isArray(parsed.chainOfThought) ? parsed.chainOfThought : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    };
  } catch {
    // Couldn't parse structured output — wrap the raw text
    return {
      analysis: raw,
      chainOfThought: [],
      confidence: 0.5,
      recommendations: [],
    };
  }
}

// ── Public API ──

/**
 * Perform deep root cause analysis using a reasoning model.
 */
export async function analyzeRootCause(
  incidentData: IncidentInput,
  relatedIncidents: IncidentInput[],
  cmdbContext: CMDBContext
): Promise<RCAResult> {
  const systemPrompt = `You are an expert ITIL 4 Problem Manager performing Root Cause Analysis.
Think step-by-step through the evidence. Consider timeline correlations, recent changes, dependency chains, and recurring patterns.
Return your answer as JSON with this schema:
{
  "analysis": "detailed root cause narrative",
  "chainOfThought": ["step 1 reasoning", "step 2 reasoning", ...],
  "confidence": 0.0-1.0,
  "recommendations": ["recommendation 1", ...]
}`;

  const userPrompt = `Perform Root Cause Analysis for this incident:

**Primary Incident:**
${JSON.stringify(incidentData, null, 2)}

**Related Incidents (potential pattern):**
${JSON.stringify(relatedIncidents, null, 2)}

**CMDB Context (affected CI, dependencies, recent changes):**
${JSON.stringify(cmdbContext, null, 2)}

Analyze the root cause, identify contributing factors, and provide actionable recommendations.`;

  const raw = await callModel(systemPrompt, userPrompt);
  return parseRCAResponse(raw);
}

/**
 * Generate a Five-Whys analysis tree for a problem.
 */
export async function generateFiveWhys(
  problem: string,
  context: string
): Promise<RCAResult> {
  const systemPrompt = `You are an ITIL 4 Problem Manager using the Five-Whys technique.
For each "why", dig deeper into the causal chain. Stop when you reach a root cause that is actionable.
Return your answer as JSON:
{
  "analysis": "narrative summary of the five-whys chain",
  "chainOfThought": ["Why 1: ...", "Why 2: ...", "Why 3: ...", "Why 4: ...", "Why 5: ..."],
  "confidence": 0.0-1.0,
  "recommendations": ["recommended corrective action 1", ...]
}`;

  const userPrompt = `Perform a Five-Whys analysis:

**Problem statement:** ${problem}

**Context:** ${context}

Walk through the five whys, each building on the previous answer.`;

  const raw = await callModel(systemPrompt, userPrompt);
  return parseRCAResponse(raw);
}

/**
 * Generate a full Post-Incident Review document.
 */
export async function generatePostIncidentReview(
  incident: IncidentInput,
  timeline: Array<{ time: string; event: string }>,
  resolution: string
): Promise<RCAResult> {
  const systemPrompt = `You are an ITIL 4 Problem Manager writing a Post-Incident Review (PIR).
Structure the review with: Executive Summary, Timeline, Root Cause, Contributing Factors, Impact Assessment, Lessons Learned, and Action Items.
Return your answer as JSON:
{
  "analysis": "full PIR document in markdown",
  "chainOfThought": ["key reasoning step 1", "key reasoning step 2", ...],
  "confidence": 0.0-1.0,
  "recommendations": ["action item 1", "action item 2", ...]
}`;

  const userPrompt = `Generate a Post-Incident Review:

**Incident:**
${JSON.stringify(incident, null, 2)}

**Timeline:**
${JSON.stringify(timeline, null, 2)}

**Resolution:** ${resolution}

Provide a comprehensive PIR suitable for stakeholder review and ServiceNow Problem record attachment.`;

  const raw = await callModel(systemPrompt, userPrompt);
  return parseRCAResponse(raw);
}
