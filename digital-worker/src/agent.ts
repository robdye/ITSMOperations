// ITSM Operations Digital Worker — Agent handler

import { configDotenv } from 'dotenv';
configDotenv();

import { TurnState, AgentApplication, TurnContext, MemoryStorage } from '@microsoft/agents-hosting';
import { Activity, ActivityTypes } from '@microsoft/agents-activity';
import { BaggageBuilder } from '@microsoft/agents-a365-observability';
import { AgenticTokenCacheInstance, BaggageBuilderUtils } from '@microsoft/agents-a365-observability-hosting';
import { getObservabilityAuthenticationScope } from '@microsoft/agents-a365-runtime';

import '@microsoft/agents-a365-notifications';
import { AgentNotificationActivity } from '@microsoft/agents-a365-notifications';

import { Client, getClient, getStandaloneClient } from './client';
import { ItsmMcpClient } from './mcp-client';
import { WorkIqClient } from './workiq-client';
import { addMessage, getHistory } from './conversation-memory';
import { enableVoice, disableVoice, isVoiceEnabled } from './voice/voiceGate';
import tokenCache, { createAgenticTokenCacheKey } from './token-cache';
import { classifyIntent } from './worker-registry';
import { runWorker, type PromptContext } from './agent-harness';
import { createConfirmationCard } from './adaptive-cards';
import { publishIncidentEvent, publishChangeEvent, publishProblemEvent } from './service-bus';
import { startConversation, logIntent, logRouting, logOutcome, logError } from './reasoning-trace';
import { logAuditEntry } from './audit-trail';

const mcp = new ItsmMcpClient();
const workiq = new WorkIqClient();

// Store conversation references for proactive messaging
const conversationReferences = new Map<string, any>();
const MAX_CONVERSATION_REFS = 200;

export function getConversationReferences(): Map<string, any> {
  return conversationReferences;
}

function captureConversationReference(context: TurnContext): void {
  const activity = context.activity;
  const key = activity.conversation?.id || '';
  if (key) {
    // Evict oldest if at capacity
    if (!conversationReferences.has(key) && conversationReferences.size >= MAX_CONVERSATION_REFS) {
      const oldest = conversationReferences.keys().next().value;
      if (oldest) conversationReferences.delete(oldest);
    }
    conversationReferences.set(key, {
      activityId: activity.id,
      user: activity.from,
      bot: activity.recipient,
      conversation: activity.conversation,
      channelId: activity.channelId,
      serviceUrl: activity.serviceUrl,
    });
  }
}

// People lookup via Microsoft Graph
async function resolveUserEmail(displayName: string): Promise<string | null> {
  const appId = process.env.GRAPH_APP_ID;
  const secret = process.env.GRAPH_APP_SECRET;
  const tenantId = process.env.GRAPH_TENANT_ID || process.env.MicrosoftAppTenantId;
  if (!appId || !secret || !tenantId) return null;
  try {
    const tokenBody = `client_id=${appId}&client_secret=${encodeURIComponent(secret)}&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default&grant_type=client_credentials`;
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody,
    });
    if (!tokenRes.ok) return null;
    const tokenData = await tokenRes.json() as any;
    const safeName = displayName.replace(/['"\\()]/g, '').substring(0, 100);
    const userRes = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=startswith(displayName,'${encodeURIComponent(safeName)}')&$select=displayName,mail,userPrincipalName&$top=3`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) return null;
    const users = (await userRes.json() as any).value || [];
    if (users.length > 0) return users[0].mail || users[0].userPrincipalName || null;
    return null;
  } catch { return null; }
}

export class ItsmAgent extends AgentApplication<TurnState> {
  static authHandlerName: string = 'agentic';
  private _processedMessageIds?: Set<string>;

  constructor() {
    super({
      storage: new MemoryStorage(),
      authorization: { agentic: { type: 'agentic' } },
    });

    // Handle direct messages
    this.onActivity(ActivityTypes.Message, async (context: TurnContext, state: TurnState) => {
      await this.handleMessage(context, state);
    }, [ItsmAgent.authHandlerName]);

    this.onActivity(ActivityTypes.InstallationUpdate, async (context) => {
      captureConversationReference(context);
      const action = context.activity.action || '';
      if (action === 'add') {
        await context.sendActivity(
          '👋 **ITSM Operations agent installed.**\n\n' +
          'I monitor incidents, problems, changes, and SLAs 24/7.\n\n' +
          '- 📊 Say **"briefing"** for an ITSM operations summary\n' +
          '- 🔴 Say **"show incidents"** to see active P1/P2s\n' +
          '- 🎙️ Say **"enable voice"** for hands-free operations\n\n' +
          'I also send shift handover briefings at 08:00 and 20:00 automatically.'
        );
      }
    });

    // Handle Agent-to-Agent notifications (email, document events)
    this.onAgentNotification('agents:*', async (context, state, notification) => {
      await this.handleNotification(context, state, notification);
    }, 1, [ItsmAgent.authHandlerName]);

    // Handle Adaptive Card Action.Execute invokes (CAB votes, approvals, etc.)
    this.onActivity('invoke' as ActivityTypes, async (context: TurnContext, _state: TurnState) => {
      const invoke = context.activity;
      if (invoke.name === 'adaptiveCard/action') {
        const actionValue = (invoke as any).value?.action;
        const verb: string = actionValue?.verb ?? '';
        const data: Record<string, any> = actionValue?.data ?? {};

        console.log(`[Agent] Adaptive Card action: ${verb}`, JSON.stringify(data).substring(0, 200));

        let responseText = '';
        switch (verb) {
          case 'approveEscalation':
            responseText = `✅ Escalation approved for ${data.incidentNumber}`;
            break;
          case 'rejectEscalation':
            responseText = `❌ Escalation rejected for ${data.incidentNumber}`;
            break;
          case 'submitCabVote':
            responseText = `📝 CAB vote recorded for ${data.changeNumber}: ${data.cabVote || 'submitted'}`;
            break;
          case 'approveAction':
            responseText = `✅ Action ${data.toolName} approved`;
            break;
          case 'rejectAction':
            responseText = `❌ Action ${data.toolName} rejected`;
            break;
          case 'acknowledgeHandover':
            responseText = `✅ Handover acknowledged for ${data.shift} shift`;
            break;
          case 'escalateBreaches':
            responseText = `🔔 Escalation triggered for ${(data.tickets || []).length} tickets`;
            break;
          default:
            responseText = `Action received: ${verb}`;
        }

        await context.sendActivity(responseText);

        // Return invoke response for the Adaptive Card runtime
        const invokeResponse = {
          status: 200,
          body: {
            statusCode: 200,
            type: 'application/vnd.microsoft.activity.message',
            value: responseText,
          },
        };
        (context as any).turnState?.set('BotFrameworkAdapter.InvokeResponse', invokeResponse);
      }
    });
  }

  async handleMessage(context: TurnContext, state: TurnState): Promise<void> {
    const text = context.activity.text?.trim() || '';
    const from = context.activity?.from;
    const userId = from?.aadObjectId || from?.id || 'unknown';
    const displayName = from?.name ?? 'unknown';
    console.log(`[Agent] Message from ${displayName}: ${text.substring(0, 100)}`);

    const conversationId = startConversation();

    await logAuditEntry({
      workerId: 'command-center',
      workerName: 'ITSM Operations',
      toolName: 'message.received',
      riskLevel: 'read',
      triggeredBy: displayName,
      triggerType: 'user',
      parameters: JSON.stringify({ text: text.substring(0, 500) }),
      resultSummary: 'Inbound user message accepted',
      requiredConfirmation: false,
      durationMs: 0,
    });

    // Capture conversation reference for proactive messaging
    captureConversationReference(context);

    // Voice commands
    if (text.toLowerCase().includes('enable voice')) {
      enableVoice();
      const voiceUrl = `https://${process.env.WEBSITE_HOSTNAME || 'localhost:3978'}/voice`;
      await context.sendActivity(`✅ **Voice interface enabled.**\n\nConnect at:\n${voiceUrl}\n\nSay **"disable voice"** when done.`);
      return;
    }
    if (text.toLowerCase().includes('disable voice')) {
      disableVoice();
      await context.sendActivity('⏹️ **Voice interface disabled.** Say **"enable voice"** to reactivate.');
      return;
    }
    if (text.toLowerCase().includes('voice status')) {
      const msg = isVoiceEnabled()
        ? '🎙️ **Voice is currently enabled.**'
        : '🔇 **Voice is currently disabled.** Say **"enable voice"** to activate.';
      await context.sendActivity(msg);
      return;
    }

    // People lookup command
    if (text.toLowerCase().startsWith('lookup ') || text.toLowerCase().startsWith('find user ')) {
      const name = text.replace(/^(lookup|find user)\s+/i, '').trim();
      if (name.length > 1) {
        const email = await resolveUserEmail(name);
        await context.sendActivity(email ? `Found: **${name}** → ${email}` : `No user found matching "${name}".`);
        return;
      }
    }

    addMessage(userId, 'user', text);

    const requesterEmail =
      (context.activity as any)?.from?.userPrincipalName ||
      (context.activity as any)?.from?.email ||
      await resolveUserEmail(displayName) ||
      '';

    // Deduplicate — Teams/Copilot may deliver the same message twice
    const msgId = context.activity.id || '';
    if (msgId && this._processedMessageIds?.has(msgId)) {
      console.log(`[Agent] Duplicate message ${msgId} — skipping`);
      return;
    }
    if (msgId) {
      if (!this._processedMessageIds) this._processedMessageIds = new Set();
      this._processedMessageIds.add(msgId);
      // Evict old entries to prevent memory leak (keep last 200)
      if (this._processedMessageIds.size > 200) {
        const first = this._processedMessageIds.values().next().value;
        if (first) this._processedMessageIds.delete(first);
      }
    }

    // Send typing indicator loop while processing (official A365 pattern — 4s interval)
    let typingInterval: ReturnType<typeof setInterval> | undefined;
    const startTypingLoop = () => {
      typingInterval = setInterval(async () => {
        try { await context.sendActivities([{ type: 'typing' } as any]); } catch { /* ignore */ }
      }, 4000);
    };
    const stopTypingLoop = () => { if (typingInterval) clearInterval(typingInterval); };

    // Immediate ack — reaches the user right away
    try { await context.sendActivity('Got it — routing to the right specialist...'); } catch { /* ignore */ }
    startTypingLoop();

    // --- Worker-based routing (replaces monolithic keyword pre-fetching) ---
    // The agent harness + worker registry handle intent classification and
    // tool-scoped execution. Each ITIL 4 child worker has its own instruction
    // prompt and filtered tool set, so the LLM reasons with only relevant tools.

    // Classify intent → select the right ITIL 4 child worker
    const classification = classifyIntent(text);
    console.log(`[Agent] Routed to ${classification.worker.name} (confidence: ${classification.confidence}): ${classification.reason}`);

    logIntent(
      conversationId,
      text,
      classification.worker.id,
      classification.worker.name,
      classification.confidence,
      classification.reason,
    );
    logRouting(
      conversationId,
      'command-center',
      classification.worker.id,
      `Teams message routed to ${classification.worker.name} (${classification.worker.id}) with ${classification.confidence} confidence`,
    );

    // Build prompt with conversation history
    let enrichedPrompt = text;
    const history = getHistory(userId);
    if (history) enrichedPrompt += `\n\nConversation history:\n${history}`;

    if (requesterEmail) {
      enrichedPrompt += `\n\nRequester context:\n- Name: ${displayName}\n- Email: ${requesterEmail}`;
    }

    const asksEmailSelf = /\b(email|send)\b[\s\S]{0,120}\b(me|myself|my mail|my email)\b/i.test(text) || /\bemail me\b/i.test(text);
    if (asksEmailSelf && requesterEmail) {
      enrichedPrompt += `\n\nIMPORTANT: The user asked to email themselves. Use recipient email: ${requesterEmail}.`;
    }

    // Get AI response with agentic auth context
    const baggageScope = BaggageBuilderUtils.fromTurnContext(
      new BaggageBuilder(), context
    ).sessionDescription(`ITSM Operations — ${classification.worker.name}`)
      .build();

    await this.preloadObservabilityToken(context);

    try {
      await baggageScope.run(async () => {
        const startedAt = Date.now();
        const ctx: PromptContext = { userMessage: text, displayName, requesterEmail };
        const result = await runWorker(classification.worker, enrichedPrompt, ctx);
        addMessage(userId, 'assistant', result.output);
        stopTypingLoop();

        // Publish domain events to Service Bus for downstream consumers
        const conversationId = context.activity.conversation?.id || '';
        if (classification.worker.id === 'incident-manager') {
          publishIncidentEvent({ incidentId: '', number: '', action: 'updated', priority: 3, state: 'processed', shortDescription: text.substring(0, 200) }, conversationId).catch(() => {});
        } else if (classification.worker.id === 'change-manager') {
          publishChangeEvent({ changeId: '', number: '', action: 'submitted', type: 'Normal', risk: 'low', cabRequired: false }, conversationId).catch(() => {});
        } else if (classification.worker.id === 'problem-manager') {
          publishProblemEvent({ problemId: '', number: '', action: 'created', relatedIncidents: [] }, conversationId).catch(() => {});
        }

        // Prefix with worker badge so the user sees which practice handled it
        const badge = `🏷️ *${classification.worker.name}*\n\n`;
        await context.sendActivity(badge + result.output);

        const durationMs = Date.now() - startedAt;
        logOutcome(conversationId, classification.worker.id, result.output, durationMs);

        await logAuditEntry({
          workerId: classification.worker.id,
          workerName: classification.worker.name,
          toolName: 'message.responded',
          riskLevel: 'notify',
          triggeredBy: displayName,
          triggerType: 'user',
          parameters: JSON.stringify({ conversationId }),
          resultSummary: result.output.substring(0, 500),
          requiredConfirmation: false,
          durationMs,
        });
      });
    } catch (err) {
      stopTypingLoop();
      console.error('[Agent] AI response error:', err);
      logError(conversationId, classification.worker.id, (err as Error).message || String(err));
      await context.sendActivity('Sorry, I encountered an error while processing your request. Please try again.');
    } finally {
      baggageScope.dispose();
    }
  }

  async handleNotification(context: TurnContext, _state: TurnState, notif: AgentNotificationActivity): Promise<void> {
    console.log(`[Agent] Notification received: ${(notif as any).notificationType || 'unknown'}`);
    const notifType = (notif as any).notificationType;
    if (notifType === 'email') {
      const subject = (notif as any).subject || 'No subject';
      await context.sendActivity(`📧 Email received: "${subject}"\n\nI'll review this and take action if ITSM-related.`);
    } else if (notifType === 'document') {
      const docName = (notif as any).documentName || 'unknown';
      await context.sendActivity(`📄 Document update: "${docName}"\n\nI'll check if this relates to any active changes or problems.`);
    } else {
      await context.sendActivity(`🔔 Notification: ${JSON.stringify(notif).substring(0, 200)}`);
    }
  }

  private async preloadObservabilityToken(turnContext: TurnContext): Promise<void> {
    const agentId = turnContext?.activity?.recipient?.agenticAppId ?? '';
    const tenantId = turnContext?.activity?.recipient?.tenantId ?? '';

    if (process.env.Use_Custom_Resolver === 'true') {
      const aauToken = await this.authorization.exchangeToken(turnContext, 'agentic', {
        scopes: getObservabilityAuthenticationScope(),
      });
      const cacheKey = createAgenticTokenCacheKey(agentId, tenantId);
      tokenCache.set(cacheKey, aauToken?.token || '');
    } else {
      await AgenticTokenCacheInstance.RefreshObservabilityToken(
        agentId,
        tenantId,
        turnContext,
        this.authorization,
        getObservabilityAuthenticationScope()
      );
    }
  }
}

export const agentApplication = new ItsmAgent();
