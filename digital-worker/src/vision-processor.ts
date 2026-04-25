// ITSM Operations — Vision + Document Intelligence
// Uses GPT-4o vision capability via Azure OpenAI to process images and documents.
// Falls back to a text-only description if vision model is not available.

import { getOpenAIClient, isAzureOpenAI, getModelName } from './openai-config';

// ── Types ──

export interface VisionResult {
  extracted: Record<string, unknown>;
  summary: string;
  confidence: number;
}

// ── Helpers ──

function getVisionDeployment(): string {
  // GPT-4o supports vision natively; use the same deployment unless overridden
  return process.env.AZURE_OPENAI_VISION_DEPLOYMENT || getModelName();
}

/**
 * Call GPT-4o with a vision (image) payload via Azure OpenAI REST or OpenAI SDK.
 */
async function callVisionModel(
  systemPrompt: string,
  textPrompt: string,
  imageBase64: string,
  mediaType: string = 'image/png'
): Promise<string> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_BASE || '';
  const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY || '';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';
  const deployment = getVisionDeployment();

  const userContent = [
    { type: 'text' as const, text: textPrompt },
    { type: 'image_url' as const, image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
  ];

  if (isAzureOpenAI() && endpoint && apiKey) {
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Azure OpenAI Vision ${res.status}: ${errText}`);
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }

  // Fallback: standard OpenAI SDK
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('No OpenAI client configured for vision processing.');
  }
  const completion = await client.chat.completions.create({
    model: deployment,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  });
  return completion.choices?.[0]?.message?.content ?? '';
}

/** Call the model with text only (no image). Used as a fallback. */
async function callTextModel(systemPrompt: string, userPrompt: string): Promise<string> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_BASE || '';
  const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY || '';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';
  const deployment = getModelName();

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
        temperature: 0.1,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Azure OpenAI ${res.status}: ${errText}`);
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }

  const client = getOpenAIClient();
  if (!client) {
    throw new Error('No OpenAI client configured.');
  }
  const completion = await client.chat.completions.create({
    model: deployment,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
  });
  return completion.choices?.[0]?.message?.content ?? '';
}

/** Parse a JSON response, with fallback. */
function parseVisionResponse(raw: string): VisionResult {
  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const toParse = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    const parsed = JSON.parse(toParse);
    return {
      extracted: typeof parsed.extracted === 'object' && parsed.extracted !== null ? parsed.extracted : {},
      summary: parsed.summary ?? raw,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch {
    return { extracted: {}, summary: raw, confidence: 0.5 };
  }
}

// ── Public API ──

/**
 * Analyze an error screenshot — extract error codes, messages, affected services.
 */
export async function processScreenshot(imageBase64: string): Promise<VisionResult> {
  const systemPrompt = `You are an ITSM triage analyst examining a screenshot of an error or system issue.
Extract all relevant information: error codes, error messages, affected application/service, timestamps, and severity indicators.
Return JSON: { "extracted": { "errorCode": "...", "errorMessage": "...", "application": "...", "timestamp": "...", "severity": "..." }, "summary": "brief description", "confidence": 0.0-1.0 }`;

  const textPrompt = 'Analyze this error screenshot. Extract all error codes, messages, and relevant details for incident triage.';

  try {
    const raw = await callVisionModel(systemPrompt, textPrompt, imageBase64);
    return parseVisionResponse(raw);
  } catch {
    // Fallback to text-only
    const fallback = await callTextModel(systemPrompt, 'A user submitted an error screenshot but vision processing is unavailable. Ask the user to describe the error in text.');
    return { extracted: {}, summary: fallback, confidence: 0.1 };
  }
}

/**
 * Extract key info from a vendor RCA document, contract, or PDF (sent as base64 image of pages).
 */
export async function processVendorPDF(pdfBase64: string): Promise<VisionResult> {
  const systemPrompt = `You are an ITSM analyst extracting key information from a vendor document (RCA report, contract, or technical bulletin).
Extract: vendor name, document type, key dates, findings/clauses, action items, and SLA references.
Return JSON: { "extracted": { "vendorName": "...", "documentType": "...", "keyDates": [...], "findings": [...], "actionItems": [...] }, "summary": "brief summary", "confidence": 0.0-1.0 }`;

  const textPrompt = 'Extract key information from this vendor document. Focus on findings, dates, action items, and SLA references.';

  try {
    const raw = await callVisionModel(systemPrompt, textPrompt, pdfBase64, 'application/pdf');
    return parseVisionResponse(raw);
  } catch {
    const fallback = await callTextModel(systemPrompt, 'A vendor document was submitted but vision/document processing is unavailable. Ask the user to provide key details in text.');
    return { extracted: {}, summary: fallback, confidence: 0.1 };
  }
}

/**
 * Interpret a monitoring dashboard screenshot (Grafana, Azure Monitor, etc.).
 */
export async function processDashboardImage(imageBase64: string): Promise<VisionResult> {
  const systemPrompt = `You are an ITSM monitoring analyst interpreting a dashboard screenshot (e.g., Grafana, Azure Monitor, Datadog).
Identify: metric names, current values, thresholds/alerts, trends (increasing/decreasing/stable), and any anomalies.
Return JSON: { "extracted": { "metrics": [...], "alerts": [...], "trends": [...], "anomalies": [...] }, "summary": "brief interpretation", "confidence": 0.0-1.0 }`;

  const textPrompt = 'Interpret this monitoring dashboard screenshot. Identify metrics, alerts, trends, and anomalies relevant to IT service management.';

  try {
    const raw = await callVisionModel(systemPrompt, textPrompt, imageBase64);
    return parseVisionResponse(raw);
  } catch {
    const fallback = await callTextModel(systemPrompt, 'A dashboard screenshot was submitted but vision processing is unavailable. Ask the user to describe the dashboard readings.');
    return { extracted: {}, summary: fallback, confidence: 0.1 };
  }
}

/**
 * Extract structured data from an image per a caller-provided schema description.
 */
export async function extractStructuredData(
  imageBase64: string,
  schema: string
): Promise<VisionResult> {
  const systemPrompt = `You are a data extraction specialist. Extract structured data from the image according to the provided schema.
Return JSON: { "extracted": { ...fields per schema... }, "summary": "brief description of what was extracted", "confidence": 0.0-1.0 }`;

  const textPrompt = `Extract data from this image using the following schema:\n${schema}`;

  try {
    const raw = await callVisionModel(systemPrompt, textPrompt, imageBase64);
    return parseVisionResponse(raw);
  } catch {
    const fallback = await callTextModel(systemPrompt, `Vision processing unavailable. Schema requested: ${schema}. Ask the user to provide the data manually.`);
    return { extracted: {}, summary: fallback, confidence: 0.1 };
  }
}
