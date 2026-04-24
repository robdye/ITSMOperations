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
  }

  async handleMessage(context: TurnContext, state: TurnState): Promise<void> {
    const text = context.activity.text?.trim() || '';
    const from = context.activity?.from;
    const userId = from?.aadObjectId || from?.id || 'unknown';
    const displayName = from?.name ?? 'unknown';
    console.log(`[Agent] Message from ${displayName}: ${text.substring(0, 100)}`);

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

    // Build prompt with conversation history
    let enrichedPrompt = text;
    const history = getHistory(userId);
    if (history) enrichedPrompt += `\n\nConversation history:\n${history}`;

    // Get AI response with agentic auth context
    const baggageScope = BaggageBuilderUtils.fromTurnContext(
      new BaggageBuilder(), context
    ).sessionDescription(`ITSM Operations — ${classification.worker.name}`)
      .build();

    await this.preloadObservabilityToken(context);

    try {
      await baggageScope.run(async () => {
        const ctx: PromptContext = { userMessage: text, displayName };
        const result = await runWorker(classification.worker, enrichedPrompt, ctx);
        addMessage(userId, 'assistant', result.output);
        stopTypingLoop();

        // Prefix with worker badge so the user sees which practice handled it
        const badge = `🏷️ *${classification.worker.name}*\n\n`;
        await context.sendActivity(badge + result.output);
      });
    } catch (err) {
      stopTypingLoop();
      console.error('[Agent] AI response error:', err);
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
