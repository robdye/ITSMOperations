/**
 * Azure Service Bus — Event-driven inter-worker messaging.
 * Replaces in-process worker-to-worker calls with decoupled pub/sub.
 *
 * Topics:
 * - itsm-incident-events: incident created/updated/resolved/escalated
 * - itsm-change-events: change submitted/approved/implemented/failed
 * - itsm-problem-events: problem created/rca-completed/known-error-added
 * - itsm-sla-events: sla-warning/sla-breached
 * - itsm-notification-events: email/teams/approval notifications
 */

import crypto from 'crypto';
import { ServiceBusClient, ServiceBusSender, ServiceBusReceiver, ServiceBusReceivedMessage } from '@azure/service-bus';

// ── Configuration ──
const SERVICE_BUS_CONNECTION = process.env.SERVICE_BUS_CONNECTION_STRING || '';
const SERVICE_BUS_NAMESPACE = process.env.SERVICE_BUS_NAMESPACE || '';

let client: ServiceBusClient | null = null;
const senders = new Map<string, ServiceBusSender>();
const receivers = new Map<string, ServiceBusReceiver>();

// ── Topic Definitions ──
export const TOPICS = {
  INCIDENT: 'itsm-incident-events',
  CHANGE: 'itsm-change-events',
  PROBLEM: 'itsm-problem-events',
  SLA: 'itsm-sla-events',
  NOTIFICATION: 'itsm-notification-events',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

// ── Event Types ──
export interface ServiceBusEvent<T = Record<string, unknown>> {
  eventType: string;
  source: string;
  timestamp: string;
  correlationId: string;
  data: T;
}

export interface IncidentEvent {
  incidentId: string;
  number: string;
  action: 'created' | 'updated' | 'resolved' | 'escalated' | 'reassigned';
  priority: number;
  state: string;
  assignmentGroup?: string;
  assignedTo?: string;
  shortDescription: string;
}

export interface ChangeEvent {
  changeId: string;
  number: string;
  action: 'submitted' | 'approved' | 'rejected' | 'implemented' | 'failed' | 'rolled-back';
  type: 'Normal' | 'Standard' | 'Emergency';
  risk: string;
  cabRequired: boolean;
}

export interface ProblemEvent {
  problemId: string;
  number: string;
  action: 'created' | 'rca-started' | 'rca-completed' | 'known-error-added' | 'resolved';
  relatedIncidents: string[];
}

export interface SlaEvent {
  recordId: string;
  recordType: 'incident' | 'change' | 'problem';
  slaName: string;
  action: 'warning' | 'breached';
  timeRemaining?: number;
  priority: number;
}

// ── Initialization ──

export function isServiceBusEnabled(): boolean {
  return !!(SERVICE_BUS_CONNECTION || SERVICE_BUS_NAMESPACE);
}

export async function initServiceBus(): Promise<void> {
  if (!isServiceBusEnabled()) {
    console.log('[ServiceBus] Not configured — using local event dispatch');
    return;
  }

  try {
    client = new ServiceBusClient(SERVICE_BUS_CONNECTION);
    console.log('[ServiceBus] Connected to Azure Service Bus');
  } catch (err) {
    console.error('[ServiceBus] Connection failed:', (err as Error).message);
  }
}

// ── Publishing ──

async function getSender(topic: TopicName): Promise<ServiceBusSender | null> {
  if (!client) return null;

  if (!senders.has(topic)) {
    senders.set(topic, client.createSender(topic));
  }
  return senders.get(topic)!;
}

export async function publishEvent<T>(
  topic: TopicName,
  eventType: string,
  data: T,
  correlationId?: string,
): Promise<void> {
  const event: ServiceBusEvent<T> = {
    eventType,
    source: 'itsm-digital-worker',
    timestamp: new Date().toISOString(),
    correlationId: correlationId || crypto.randomUUID(),
    data,
  };

  const sender = await getSender(topic);
  if (sender) {
    try {
      await sender.sendMessages({
        body: event,
        subject: eventType,
        correlationId: event.correlationId,
        applicationProperties: {
          eventType,
          source: event.source,
        },
      });
      console.log(`[ServiceBus] Published ${eventType} to ${topic}`);
    } catch (err) {
      console.error(`[ServiceBus] Publish failed for ${topic}:`, (err as Error).message);
      // Fall through to local dispatch
      dispatchLocal(topic, event);
    }
  } else {
    // Local fallback when Service Bus not configured
    dispatchLocal(topic, event);
  }
}

// ── Subscribing ──

type EventHandler = (event: ServiceBusEvent) => Promise<void>;
const localHandlers = new Map<string, EventHandler[]>();

export function subscribe(
  topic: TopicName,
  subscription: string,
  handler: EventHandler,
): void {
  // Register for local dispatch (always, as fallback)
  const key = `${topic}:${subscription}`;
  if (!localHandlers.has(key)) localHandlers.set(key, []);
  localHandlers.get(key)!.push(handler);

  // Register Service Bus receiver if connected
  if (client) {
    try {
      const receiver = client.createReceiver(topic, subscription);
      receivers.set(key, receiver);

      receiver.subscribe({
        processMessage: async (message: ServiceBusReceivedMessage) => {
          try {
            await handler(message.body as ServiceBusEvent);
            await receiver.completeMessage(message);
          } catch (err) {
            console.error(`[ServiceBus] Handler error for ${key}:`, (err as Error).message);
            // Message will be retried via Service Bus dead-letter
          }
        },
        processError: async (args) => {
          console.error(`[ServiceBus] Receiver error for ${key}:`, args.error.message);
        },
      });

      console.log(`[ServiceBus] Subscribed: ${subscription} on ${topic}`);
    } catch (err) {
      console.error(`[ServiceBus] Subscribe failed for ${key}:`, (err as Error).message);
    }
  }
}

// ── Local Event Dispatch (fallback when Service Bus unavailable) ──

function dispatchLocal<T>(topic: TopicName, event: ServiceBusEvent<T>): void {
  for (const [key, handlers] of localHandlers.entries()) {
    if (key.startsWith(topic)) {
      for (const handler of handlers) {
        handler(event as ServiceBusEvent).catch(err =>
          console.error(`[ServiceBus:Local] Handler error:`, (err as Error).message)
        );
      }
    }
  }
}

// Convenience publishers
export const publishIncidentEvent = (data: IncidentEvent, correlationId?: string) =>
  publishEvent(TOPICS.INCIDENT, `incident.${data.action}`, data, correlationId);

export const publishChangeEvent = (data: ChangeEvent, correlationId?: string) =>
  publishEvent(TOPICS.CHANGE, `change.${data.action}`, data, correlationId);

export const publishProblemEvent = (data: ProblemEvent, correlationId?: string) =>
  publishEvent(TOPICS.PROBLEM, `problem.${data.action}`, data, correlationId);

export const publishSlaEvent = (data: SlaEvent, correlationId?: string) =>
  publishEvent(TOPICS.SLA, `sla.${data.action}`, data, correlationId);

// ── Cleanup ──

export async function closeServiceBus(): Promise<void> {
  for (const [, receiver] of receivers) {
    await receiver.close().catch(() => {});
  }
  for (const [, sender] of senders) {
    await sender.close().catch(() => {});
  }
  await client?.close();
  receivers.clear();
  senders.clear();
  client = null;
  console.log('[ServiceBus] Closed all connections');
}

// ── Status ──

export function getServiceBusStatus(): {
  enabled: boolean;
  connected: boolean;
  topics: string[];
  activeSubscriptions: number;
} {
  return {
    enabled: isServiceBusEnabled(),
    connected: client !== null,
    topics: Object.values(TOPICS),
    activeSubscriptions: receivers.size,
  };
}
