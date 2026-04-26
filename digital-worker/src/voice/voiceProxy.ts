// ITSM Operations Digital Worker — Voice Live WebSocket proxy
// Bridges browser audio to Azure Voice Live service for ITSM operations.

import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';
import { DefaultAzureCredential } from '@azure/identity';
import { VOICE_TOOLS, executeVoiceTool } from './voiceTools';
import { isVoiceEnabled } from './voiceGate';

const VOICELIVE_ENDPOINT = process.env.VOICELIVE_ENDPOINT || '';
const VOICELIVE_MODEL = process.env.VOICELIVE_MODEL || 'gpt-4o-realtime-preview';
const MANAGER_NAME = process.env.MANAGER_NAME || 'the IT Director';

function extractVoiceData(result: unknown): string {
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  if (str.includes('<!DOCTYPE html>') || str.includes('<html')) {
    const dataMatch = str.match(/window\.__TOOL_DATA__\s*=\s*({[\s\S]*?});?\s*<\/script>/);
    if (dataMatch) { try { return JSON.stringify(JSON.parse(dataMatch[1])); } catch {} }
    const text = str.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 4000);
    return text || '(No extractable data)';
  }
  return str.length > 8000 ? str.substring(0, 8000) + '...' : str;
}

const VOICE_SYSTEM_PROMPT = `You are an ITSM Operations Manager who handles incidents, problems, changes, and SLAs for a financial services firm. You follow ITIL V4 and NIST 800-53.

You are speaking via voice. Keep responses concise and conversational. No markdown, no tables, no emoji. Speak numbers clearly.

TOOL USAGE - always call tools for real data:
- For incident status: call get_incident_dashboard or get_incidents
- For incidents on a specific system: call get_incidents_for_ci
- For problems and known errors: call get_problem_dashboard
- For change requests: call get_change_dashboard or get_change_request
- For blast radius/dependencies: call get_blast_radius
- For change metrics and KPIs: call get_change_metrics
- For change collisions: call detect_collisions
- For CAB preparation: call generate_cab_agenda
- For post-implementation review: call post_implementation_review  
- For SLA compliance: call get_sla_dashboard
- For knowledge base search: call search_knowledge
- For CMDB lookups: call get_cmdb_ci
- For EOL status: call check_eol_status
- For the full ITSM briefing: call get_itsm_briefing
- For asset lifecycle: call get_asset_lifecycle
- For expired warranties: call get_expired_warranties

RULES:
- Always call tools for real data from ServiceNow
- Use real ticket numbers (INC, CHG, PRB) and CI names
- When citing risk scores, explain: "Risk score X out of 25, classified as [Low/Medium/High/Critical]"
- Keep voice responses under 30 seconds
- For ITIL references, keep them brief: "Per ITIL V4..." not the full standard text

Your manager is ${MANAGER_NAME}.`;

function buildVoiceLiveUrl(): string {
  const url = new URL(VOICELIVE_ENDPOINT);
  // GA format: /openai/v1/realtime?model=<deployment>
  // Preview format uses /openai/realtime?api-version=...&deployment=...
  // The GA path MUST use model= (not deployment=) and has NO api-version.
  return `wss://${url.host}/openai/v1/realtime?model=${VOICELIVE_MODEL}`;
}

async function getAccessToken(): Promise<string> {
  const cred = new DefaultAzureCredential();
  // GA Realtime API requires the ai.azure.com scope
  const token = await cred.getToken('https://ai.azure.com/.default');
  return token.token;
}

export function attachVoiceWebSocket(server: Server): void {
  if (!VOICELIVE_ENDPOINT) {
    console.log('[voice] VOICELIVE_ENDPOINT not set - voice proxy disabled');
    return;
  }
  if (!VOICELIVE_MODEL.includes('realtime')) {
    console.warn(`[voice] WARNING: VOICELIVE_MODEL="${VOICELIVE_MODEL}" does not look like a Realtime deployment. Expected a model like "gpt-4o-realtime-preview". Voice may fail to connect.`);
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    if (pathname === '/api/voice') {
      if (!isVoiceEnabled()) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => { wss.emit('connection', ws, request); });
    }
  });

  wss.on('connection', async (clientWs) => {
    console.log('[voice] Browser connected');
    let serviceWs: WebSocket | null = null;
    const wsUrl = buildVoiceLiveUrl();

    async function connectToService(isRetry = false): Promise<WebSocket> {
      const label = isRetry ? 'Retry connecting' : 'Connecting';
      console.log(`[voice] ${label} to ${wsUrl.replace(/api-version=[^&]+/, 'api-version=...')}`);
      const token = await getAccessToken();
      const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}` } });

      // 5-second connection timeout
      const connectTimeout = setTimeout(() => {
        console.error(`[voice] Connection timeout (5s) - endpoint: ${VOICELIVE_ENDPOINT}, deployment: ${VOICELIVE_MODEL}`);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'error',
            error: { message: `Voice connection timed out. Check that "${VOICELIVE_MODEL}" deployment exists and is a Realtime model.`, code: 'connection_timeout' },
          }));
        }
        ws.close();
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1011);
      }, 5000);

      ws.on('open', () => clearTimeout(connectTimeout));
      ws.on('error', () => clearTimeout(connectTimeout));
      ws.on('close', () => clearTimeout(connectTimeout));
      return ws;
    }

    function wireServiceEvents(ws: WebSocket) {
      ws.on('open', () => {
        console.log(`[voice] Connected to Voice Live (deployment: ${VOICELIVE_MODEL})`);
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: VOICE_SYSTEM_PROMPT,
            voice: 'ash',
            temperature: 0.8,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_noise_reduction: { type: 'near_field' },
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'auto',
              interrupt_response: true,
              create_response: true,
            },
            tools: VOICE_TOOLS,
            tool_choice: 'auto',
          },
        }));
      });

      ws.on('message', async (data) => {
        let event: any;
        try { event = JSON.parse(data.toString()); } catch { return; }

        if (event.type === 'response.function_call_arguments.done') {
          const { call_id, name: fnName, arguments: fnArgs } = event;
          console.log(`[voice] Tool: ${fnName}(${fnArgs})`);
          try {
            const result = await executeVoiceTool(fnName, JSON.parse(fnArgs));
            const voiceData = extractVoiceData(result);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: voiceData } }));
              ws.send(JSON.stringify({ type: 'response.create' }));
            }
          } catch (err) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify({ error: String(err) }) } }));
              ws.send(JSON.stringify({ type: 'response.create' }));
            }
          }
          return;
        }

        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data.toString());
      });

      ws.on('close', (code, reason) => {
        const reasonStr = reason?.toString() || 'none';
        console.log(`[voice] Voice Live disconnected (code: ${code}, reason: ${reasonStr})`);
        // Forward a structured error event to the browser before closing
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'error',
            error: { message: `Voice service disconnected (code: ${code}). Check that deployment "${VOICELIVE_MODEL}" is a Realtime-capable model.`, code: 'service_disconnected' },
          }));
          clientWs.close(1000, `Service closed: ${code}`);
        }
      });
      ws.on('error', (err) => {
        console.error(`[voice] Voice Live error: ${err.message} (endpoint: ${VOICELIVE_ENDPOINT}, deployment: ${VOICELIVE_MODEL})`);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'error',
            error: { message: `Voice connection failed: ${err.message}. Ensure VOICELIVE_ENDPOINT and VOICELIVE_MODEL (${VOICELIVE_MODEL}) are configured correctly.`, code: 'connection_error' },
          }));
          clientWs.close(1011, 'Service error');
        }
      });
    }

    clientWs.on('message', (data) => {
      if (!serviceWs || serviceWs.readyState !== WebSocket.OPEN) return;
      if (typeof data === 'string') { serviceWs.send(data); }
      else { serviceWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.from(data as ArrayBuffer).toString('base64') })); }
    });

    try {
      serviceWs = await connectToService();
      wireServiceEvents(serviceWs);
    } catch (err) {
      console.error(`[voice] Failed to connect: ${err} (endpoint: ${VOICELIVE_ENDPOINT}, deployment: ${VOICELIVE_MODEL})`);
      // Single reconnect attempt after 2s delay
      setTimeout(async () => {
        try {
          serviceWs = await connectToService(true);
          wireServiceEvents(serviceWs);
        } catch (retryErr) {
          console.error(`[voice] Retry failed: ${retryErr}`);
          if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1011);
        }
      }, 2000);
    }

    clientWs.on('close', (code, reason) => {
      console.log(`[voice] Browser disconnected (code: ${code}, reason: ${reason?.toString() || 'none'})`);
      if (serviceWs?.readyState === WebSocket.OPEN) serviceWs.close();
    });
    clientWs.on('error', (err) => {
      console.error(`[voice] Browser WebSocket error: ${err.message}`);
      if (serviceWs?.readyState === WebSocket.OPEN) serviceWs.close();
    });
  });

  console.log('[voice] ITSM Voice proxy ready at /api/voice');
}
