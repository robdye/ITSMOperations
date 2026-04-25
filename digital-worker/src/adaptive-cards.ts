// ITSM Operations — Adaptive Card Templates
// Adaptive Cards 1.6 Universal Actions for interactive ITSM workflows.
// Replaces HTML widgets for write paths (approvals, voting, forms).

import { Attachment } from '@microsoft/agents-activity';

// ── Types ──

export interface AdaptiveCard {
  type: 'AdaptiveCard';
  $schema: string;
  version: string;
  body: unknown[];
  actions?: unknown[];
}

interface ChangeScheduleEntry {
  changeId: string;
  title: string;
  scheduledStart: string;
  risk: string;
  implementer: string;
}

interface KPIMetric {
  name: string;
  value: string;
  target: string;
  status: 'on-track' | 'at-risk' | 'breached';
}

// ── Card Builder Helpers ──

const SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';
const VERSION = '1.6';

function createCard(body: unknown[], actions?: unknown[]): AdaptiveCard {
  return {
    type: 'AdaptiveCard',
    $schema: SCHEMA,
    version: VERSION,
    body,
    ...(actions?.length ? { actions } : {}),
  };
}

function toAttachment(card: AdaptiveCard): Attachment {
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: card,
  };
}

// Legacy helper — delegates to createCard for backward compatibility
function card(body: unknown[], actions?: unknown[]): AdaptiveCard {
  return createCard(body, actions);
}

function heading(text: string, size: string = 'Large'): unknown {
  return { type: 'TextBlock', text, size, weight: 'Bolder', wrap: true };
}

function textBlock(text: string, opts: Record<string, unknown> = {}): unknown {
  return { type: 'TextBlock', text, wrap: true, ...opts };
}

function factSet(facts: Array<{ title: string; value: string }>): unknown {
  return { type: 'FactSet', facts };
}

function columnSet(columns: unknown[]): unknown {
  return { type: 'ColumnSet', columns };
}

function column(items: unknown[], width: string = 'stretch'): unknown {
  return { type: 'Column', width, items };
}

// ── Card Builders ──

/**
 * CAB Voting card — lets CAB members approve, reject, or defer a change.
 */
export function buildCABVotingCard(
  changeId: string,
  title: string,
  risk: string,
  rollback: string,
  implementer: string
): AdaptiveCard {
  return card(
    [
      heading(`🗳️ CAB Vote Required — ${changeId}`),
      factSet([
        { title: 'Change ID', value: changeId },
        { title: 'Title', value: title },
        { title: 'Risk Level', value: risk },
        { title: 'Implementer', value: implementer },
      ]),
      textBlock(`**Rollback Plan:** ${rollback}`, { spacing: 'Medium' }),
      {
        type: 'Input.ChoiceSet',
        id: 'vote',
        label: 'Your Vote',
        isRequired: true,
        choices: [
          { title: 'Approve', value: 'approve' },
          { title: 'Reject', value: 'reject' },
          { title: 'Defer', value: 'defer' },
        ],
      },
      {
        type: 'Input.Text',
        id: 'comments',
        label: 'Comments (optional)',
        isMultiline: true,
        placeholder: 'Add any conditions or concerns…',
      },
    ],
    [
      {
        type: 'Action.Submit',
        title: 'Submit Vote',
        data: { action: 'cab_vote', changeId },
      },
    ]
  );
}

/**
 * Incident Bridge notification card — alerts responders to a major incident.
 */
export function buildIncidentBridgeCard(
  incidentId: string,
  severity: string,
  summary: string,
  bridgeUrl: string
): AdaptiveCard {
  const sevColor = severity === 'P1' ? 'Attention' : severity === 'P2' ? 'Warning' : 'Default';
  return card(
    [
      heading(`🚨 Major Incident — ${incidentId}`),
      textBlock(severity, { color: sevColor, size: 'Medium', weight: 'Bolder' }),
      textBlock(summary, { spacing: 'Medium' }),
      factSet([
        { title: 'Incident', value: incidentId },
        { title: 'Severity', value: severity },
      ]),
    ],
    [
      {
        type: 'Action.OpenUrl',
        title: 'Join Incident Bridge',
        url: bridgeUrl,
      },
      {
        type: 'Action.Submit',
        title: 'Acknowledge',
        data: { action: 'incident_ack', incidentId },
      },
    ]
  );
}

/**
 * Generic approval card for any request type (access, procurement, etc.).
 */
export function buildApprovalCard(
  requestId: string,
  type: string,
  description: string,
  requestor: string
): AdaptiveCard {
  return card(
    [
      heading(`✅ Approval Required — ${type}`),
      factSet([
        { title: 'Request ID', value: requestId },
        { title: 'Type', value: type },
        { title: 'Requestor', value: requestor },
      ]),
      textBlock(description, { spacing: 'Medium' }),
      {
        type: 'Input.Text',
        id: 'approvalComments',
        label: 'Comments',
        isMultiline: true,
        placeholder: 'Reason for approval or rejection…',
      },
    ],
    [
      {
        type: 'Action.Submit',
        title: 'Approve',
        data: { action: 'approve', requestId, decision: 'approved' },
      },
      {
        type: 'Action.Submit',
        title: 'Reject',
        data: { action: 'approve', requestId, decision: 'rejected' },
      },
    ]
  );
}

/**
 * Weekly change schedule overview card.
 */
export function buildChangeScheduleCard(changes: ChangeScheduleEntry[]): AdaptiveCard {
  const rows = changes.map((c) =>
    columnSet([
      column([textBlock(c.changeId, { weight: 'Bolder' })], 'auto'),
      column([textBlock(c.title)], 'stretch'),
      column([textBlock(c.scheduledStart)], 'auto'),
      column([textBlock(c.risk, {
        color: c.risk === 'High' ? 'Attention' : c.risk === 'Medium' ? 'Warning' : 'Good',
      })], 'auto'),
    ])
  );

  return card(
    [
      heading('📅 Weekly Change Schedule'),
      textBlock(`${changes.length} change(s) scheduled`, { isSubtle: true }),
      // Header row
      columnSet([
        column([textBlock('**ID**')], 'auto'),
        column([textBlock('**Title**')], 'stretch'),
        column([textBlock('**Scheduled**')], 'auto'),
        column([textBlock('**Risk**')], 'auto'),
      ]),
      ...rows,
    ],
    [
      {
        type: 'Action.Submit',
        title: 'View Full Schedule',
        data: { action: 'view_change_schedule' },
      },
    ]
  );
}

/**
 * SLA breach warning card.
 */
export function buildSLAWarningCard(
  ticketId: string,
  slaName: string,
  timeRemaining: string
): AdaptiveCard {
  return card(
    [
      heading('⏰ SLA Breach Warning'),
      textBlock(`Ticket **${ticketId}** is approaching SLA breach.`, { color: 'Attention' }),
      factSet([
        { title: 'Ticket', value: ticketId },
        { title: 'SLA', value: slaName },
        { title: 'Time Remaining', value: timeRemaining },
      ]),
    ],
    [
      {
        type: 'Action.Submit',
        title: 'Escalate Now',
        data: { action: 'sla_escalate', ticketId },
      },
      {
        type: 'Action.Submit',
        title: 'Acknowledge',
        data: { action: 'sla_ack', ticketId },
      },
    ]
  );
}

/**
 * KPI summary dashboard card.
 */
export function buildKPIDashboardCard(metrics: KPIMetric[]): AdaptiveCard {
  const rows = metrics.map((m) =>
    columnSet([
      column([textBlock(m.name, { weight: 'Bolder' })], 'stretch'),
      column([textBlock(m.value)], 'auto'),
      column([textBlock(m.target, { isSubtle: true })], 'auto'),
      column([textBlock(
        m.status === 'on-track' ? '✅' : m.status === 'at-risk' ? '⚠️' : '🔴'
      )], 'auto'),
    ])
  );

  return card(
    [
      heading('📊 KPI Dashboard'),
      columnSet([
        column([textBlock('**Metric**')], 'stretch'),
        column([textBlock('**Actual**')], 'auto'),
        column([textBlock('**Target**')], 'auto'),
        column([textBlock('**Status**')], 'auto'),
      ]),
      ...rows,
    ],
    [
      {
        type: 'Action.Submit',
        title: 'View Full Report',
        data: { action: 'view_kpi_report' },
      },
    ]
  );
}

// ══════════════════════════════════════════════════════════════════
// Universal Actions (Action.Execute) — Adaptive Cards 1.6
// These replace HTML widgets for interactive write paths.
// ══════════════════════════════════════════════════════════════════

// ── Incident Escalation Approval Card ──

export function createIncidentEscalationCard(incident: {
  number: string;
  shortDescription: string;
  priority: string;
  assignedTo: string;
  currentState: string;
  escalationReason: string;
  requestedBy: string;
}): Attachment {
  const card = createCard([
    {
      type: 'TextBlock',
      text: '🔴 Incident Escalation Approval',
      weight: 'bolder',
      size: 'large',
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Incident', value: incident.number },
        { title: 'Description', value: incident.shortDescription },
        { title: 'Priority', value: incident.priority },
        { title: 'Current State', value: incident.currentState },
        { title: 'Assigned To', value: incident.assignedTo },
        { title: 'Requested By', value: incident.requestedBy },
      ],
    },
    {
      type: 'TextBlock',
      text: `**Escalation Reason:** ${incident.escalationReason}`,
      wrap: true,
    },
    {
      type: 'Input.Text',
      id: 'approverComments',
      label: 'Comments (optional)',
      isMultiline: true,
      placeholder: 'Add any notes for the escalation...',
    },
  ], [
    {
      type: 'Action.Execute',
      title: '✅ Approve Escalation',
      verb: 'approveEscalation',
      data: { incidentNumber: incident.number, action: 'approve' },
      style: 'positive',
    },
    {
      type: 'Action.Execute',
      title: '❌ Reject',
      verb: 'rejectEscalation',
      data: { incidentNumber: incident.number, action: 'reject' },
      style: 'destructive',
    },
  ]);

  return toAttachment(card);
}

// ── Change Request Approval Card (CAB Voting) ──

export function createChangeApprovalCard(change: {
  number: string;
  shortDescription: string;
  type: string;
  risk: string;
  impact: string;
  plannedStart: string;
  plannedEnd: string;
  requestedBy: string;
  backoutPlan: string;
  testPlan: string;
  affectedCIs: string[];
}): Attachment {
  const riskColor = change.risk.toLowerCase().includes('high') ? '🔴' :
                    change.risk.toLowerCase().includes('moderate') ? '🟡' : '🟢';

  const card = createCard([
    {
      type: 'TextBlock',
      text: `📋 Change Request — CAB Review`,
      weight: 'bolder',
      size: 'large',
    },
    {
      type: 'ColumnSet',
      columns: [
        {
          type: 'Column',
          width: 'stretch',
          items: [
            { type: 'TextBlock', text: 'Change Number', weight: 'bolder', size: 'small' },
            { type: 'TextBlock', text: change.number, spacing: 'none' },
          ],
        },
        {
          type: 'Column',
          width: 'stretch',
          items: [
            { type: 'TextBlock', text: 'Type', weight: 'bolder', size: 'small' },
            { type: 'TextBlock', text: change.type, spacing: 'none' },
          ],
        },
        {
          type: 'Column',
          width: 'stretch',
          items: [
            { type: 'TextBlock', text: 'Risk', weight: 'bolder', size: 'small' },
            { type: 'TextBlock', text: `${riskColor} ${change.risk}`, spacing: 'none' },
          ],
        },
      ],
    },
    {
      type: 'TextBlock',
      text: change.shortDescription,
      wrap: true,
      weight: 'bolder',
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Requested By', value: change.requestedBy },
        { title: 'Impact', value: change.impact },
        { title: 'Planned Start', value: change.plannedStart },
        { title: 'Planned End', value: change.plannedEnd },
      ],
    },
    {
      type: 'TextBlock',
      text: '**Affected Configuration Items:**',
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: change.affectedCIs.map(ci => `• ${ci}`).join('\n'),
      wrap: true,
    },
    {
      type: 'Container',
      style: 'emphasis',
      items: [
        { type: 'TextBlock', text: '**Backout Plan:**', wrap: true },
        { type: 'TextBlock', text: change.backoutPlan || 'Not provided', wrap: true, size: 'small' },
        { type: 'TextBlock', text: '**Test Plan:**', wrap: true },
        { type: 'TextBlock', text: change.testPlan || 'Not provided', wrap: true, size: 'small' },
      ],
    },
    {
      type: 'Input.ChoiceSet',
      id: 'cabVote',
      label: 'Your CAB Vote',
      isRequired: true,
      choices: [
        { title: 'Approve — No concerns', value: 'approve' },
        { title: 'Approve with conditions', value: 'approve_conditional' },
        { title: 'Reject — Concerns identified', value: 'reject' },
        { title: 'Defer — More information needed', value: 'defer' },
      ],
    },
    {
      type: 'Input.Text',
      id: 'cabComments',
      label: 'Comments',
      isMultiline: true,
      placeholder: 'Provide rationale for your vote, especially if rejecting or deferring...',
    },
  ], [
    {
      type: 'Action.Execute',
      title: '📝 Submit CAB Vote',
      verb: 'submitCabVote',
      data: { changeNumber: change.number },
    },
  ]);

  return toAttachment(card);
}

// ── HITL Confirmation Card (Generic) ──

export function createConfirmationCard(action: {
  toolName: string;
  description: string;
  riskLevel: 'write' | 'notify';
  parameters: Record<string, unknown>;
  workerId: string;
  conversationId: string;
}): Attachment {
  const icon = action.riskLevel === 'notify' ? '📧' : '✏️';
  const params = Object.entries(action.parameters)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ({
      title: k,
      value: typeof v === 'string' ? v.substring(0, 100) : JSON.stringify(v).substring(0, 100),
    }));

  const card = createCard([
    {
      type: 'TextBlock',
      text: `${icon} Confirmation Required`,
      weight: 'bolder',
      size: 'large',
    },
    {
      type: 'TextBlock',
      text: `**Action:** ${action.toolName}`,
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: `**Worker:** ${action.workerId}`,
      wrap: true,
      size: 'small',
      isSubtle: true,
    },
    {
      type: 'TextBlock',
      text: action.description,
      wrap: true,
    },
    {
      type: 'FactSet',
      facts: params,
    },
  ], [
    {
      type: 'Action.Execute',
      title: '✅ Approve',
      verb: 'approveAction',
      data: {
        toolName: action.toolName,
        workerId: action.workerId,
        conversationId: action.conversationId,
        decision: 'approve',
      },
      style: 'positive',
    },
    {
      type: 'Action.Execute',
      title: '❌ Reject',
      verb: 'rejectAction',
      data: {
        toolName: action.toolName,
        workerId: action.workerId,
        conversationId: action.conversationId,
        decision: 'reject',
      },
      style: 'destructive',
    },
  ]);

  return toAttachment(card);
}

// ── Incident Summary Card (Read-only) ──

export function createIncidentSummaryCard(incidents: Array<{
  number: string;
  shortDescription: string;
  priority: string;
  state: string;
  assignedTo: string;
  openedAt: string;
}>): Attachment {
  const p1Count = incidents.filter(i => i.priority.includes('1')).length;
  const p2Count = incidents.filter(i => i.priority.includes('2')).length;

  const rows = incidents.slice(0, 10).map(inc => ({
    type: 'TableRow',
    cells: [
      { type: 'TableCell', items: [{ type: 'TextBlock', text: inc.number, size: 'small' }] },
      { type: 'TableCell', items: [{ type: 'TextBlock', text: inc.shortDescription.substring(0, 60), size: 'small', wrap: true }] },
      { type: 'TableCell', items: [{ type: 'TextBlock', text: inc.priority, size: 'small' }] },
      { type: 'TableCell', items: [{ type: 'TextBlock', text: inc.state, size: 'small' }] },
    ],
  }));

  const card = createCard([
    {
      type: 'TextBlock',
      text: `🔴 Active Incidents (${incidents.length})`,
      weight: 'bolder',
      size: 'large',
    },
    {
      type: 'ColumnSet',
      columns: [
        { type: 'Column', width: 'auto', items: [
          { type: 'TextBlock', text: `**P1:** ${p1Count}`, color: 'attention' },
        ]},
        { type: 'Column', width: 'auto', items: [
          { type: 'TextBlock', text: `**P2:** ${p2Count}`, color: 'warning' },
        ]},
        { type: 'Column', width: 'auto', items: [
          { type: 'TextBlock', text: `**Total:** ${incidents.length}` },
        ]},
      ],
    },
    {
      type: 'Table',
      columns: [
        { width: 1 }, { width: 3 }, { width: 1 }, { width: 1 },
      ],
      rows: [
        {
          type: 'TableRow',
          style: 'accent',
          cells: [
            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Number', weight: 'bolder', size: 'small' }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Description', weight: 'bolder', size: 'small' }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Priority', weight: 'bolder', size: 'small' }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'State', weight: 'bolder', size: 'small' }] },
          ],
        },
        ...rows,
      ],
    },
  ]);

  return toAttachment(card);
}

// ── SLA Breach Warning Card ──

export function createSlaBreachCard(breaches: Array<{
  ticketNumber: string;
  slaType: string;
  timeRemaining: string;
  assignedGroup: string;
  priority: string;
}>): Attachment {
  const card = createCard([
    {
      type: 'TextBlock',
      text: `⏰ SLA Breach Warning (${breaches.length} at risk)`,
      weight: 'bolder',
      size: 'large',
      color: 'attention',
    },
    ...breaches.slice(0, 5).map(b => ({
      type: 'Container',
      style: 'warning',
      items: [
        {
          type: 'ColumnSet',
          columns: [
            { type: 'Column', width: 'stretch', items: [
              { type: 'TextBlock', text: `**${b.ticketNumber}** — ${b.slaType}`, wrap: true },
              { type: 'TextBlock', text: `Group: ${b.assignedGroup}`, size: 'small', isSubtle: true },
            ]},
            { type: 'Column', width: 'auto', items: [
              { type: 'TextBlock', text: b.timeRemaining, weight: 'bolder', color: 'attention' },
            ]},
          ],
        },
      ],
      separator: true,
    })),
  ], [
    {
      type: 'Action.Execute',
      title: '📋 View All Breaches',
      verb: 'viewAllBreaches',
    },
    {
      type: 'Action.Execute',
      title: '🔔 Escalate All',
      verb: 'escalateBreaches',
      data: { tickets: breaches.map(b => b.ticketNumber) },
      style: 'destructive',
    },
  ]);

  return toAttachment(card);
}

// ── Shift Handover Card ──

export function createHandoverCard(handover: {
  shift: string;
  incidentSummary: string;
  changeSummary: string;
  slaStatus: string;
  actionItems: string[];
  generatedAt: string;
}): Attachment {
  const card = createCard([
    {
      type: 'TextBlock',
      text: `📋 Shift Handover — ${handover.shift}`,
      weight: 'bolder',
      size: 'large',
    },
    { type: 'TextBlock', text: `Generated: ${handover.generatedAt}`, size: 'small', isSubtle: true },
    {
      type: 'Container',
      items: [
        { type: 'TextBlock', text: '**🔴 Incidents**', wrap: true },
        { type: 'TextBlock', text: handover.incidentSummary, wrap: true, size: 'small' },
      ],
    },
    {
      type: 'Container',
      items: [
        { type: 'TextBlock', text: '**📋 Changes**', wrap: true },
        { type: 'TextBlock', text: handover.changeSummary, wrap: true, size: 'small' },
      ],
    },
    {
      type: 'Container',
      items: [
        { type: 'TextBlock', text: '**⏰ SLA Status**', wrap: true },
        { type: 'TextBlock', text: handover.slaStatus, wrap: true, size: 'small' },
      ],
    },
    {
      type: 'TextBlock',
      text: '**Action Items:**',
      wrap: true,
    },
    ...handover.actionItems.map((item, i) => ({
      type: 'TextBlock' as const,
      text: `${i + 1}. ${item}`,
      wrap: true,
      size: 'small' as const,
    })),
  ], [
    {
      type: 'Action.Execute',
      title: '✅ Acknowledge Handover',
      verb: 'acknowledgeHandover',
      data: { shift: handover.shift },
    },
  ]);

  return toAttachment(card);
}
