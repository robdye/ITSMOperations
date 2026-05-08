// ═══════════════════════════════════════════════════════════════════
// Mission Control — ITSM Operations Client-Side Logic
// ═══════════════════════════════════════════════════════════════════

const BASE = window.location.origin;
const feedItems = [];
let graphInitialized = false;
let graphNodes = [], graphEdges = [];
let firstFetch = true;

// ── Worker Mappings ──
const WORKER_TIERS = {
  'incident-manager': 'core', 'change-manager': 'core', 'problem-manager': 'core',
  'asset-cmdb-manager': 'core', 'sla-manager': 'core', 'knowledge-manager': 'core',
  'vendor-manager': 'core',
  'service-desk-manager': 'extended', 'monitoring-manager': 'extended', 'release-manager': 'extended',
  'capacity-manager': 'strategic', 'continuity-manager': 'strategic', 'security-manager': 'strategic',
  'request-fulfilment-manager': 'operational', 'catalogue-manager': 'operational', 'risk-manager': 'operational',
  'deployment-manager': 'operational', 'availability-manager': 'operational', 'reporting-manager': 'operational',
  'relationship-manager': 'operational', 'finops-manager': 'operational', 'continuous-improvement-manager': 'operational',
  'command-center': 'orchestrator',
};

const WORKER_ICONS = {
  'incident-manager': '🔥', 'change-manager': '🔄', 'problem-manager': '🔍',
  'asset-cmdb-manager': '🖥️', 'sla-manager': '📊', 'knowledge-manager': '📚',
  'vendor-manager': '🤝', 'service-desk-manager': '🎫', 'monitoring-manager': '👁️',
  'release-manager': '🚀', 'capacity-manager': '📈', 'continuity-manager': '🛡️',
  'security-manager': '🔒', 'request-fulfilment-manager': '📋', 'catalogue-manager': '📖',
  'risk-manager': '⚠️', 'deployment-manager': '📦', 'availability-manager': '⏰',
  'reporting-manager': '📉', 'relationship-manager': '🤲', 'finops-manager': '💰',
  'continuous-improvement-manager': '🔧', 'command-center': '⚡',
};

const TIER_COLORS = {
  core: 'var(--green)', extended: 'var(--blue)', strategic: 'var(--purple)', operational: 'var(--cyan)', orchestrator: 'var(--orange)',
};

// ── Navigation ──
document.querySelectorAll('.nav-items li').forEach(li => {
  li.addEventListener('click', () => {
    document.querySelectorAll('.nav-items li').forEach(l => l.classList.remove('active'));
    li.classList.add('active');
    const viewId = li.dataset.view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
    const titles = { 'command-center': 'Command Center', 'agent-mind': 'Agent Mind', 'neural-core': 'Neural Core', 'actions': 'Actions', 'signals': 'Signals', 'foresight': 'Foresight', 'outcomes': 'Outcomes', 'governance': 'Governance', 'goals': 'Goals', 'workday': "Today's Plan", 'operator-console': 'Operator Console' };
    document.getElementById('view-title').textContent = titles[viewId] || viewId;
    if (viewId === 'neural-core' && !graphInitialized) initGraph();
    if (viewId === 'operator-console') loadOperatorConsole();
  });
});

// ── Feed helper ──
function addFeed(msg, agent) {
  const now = new Date().toLocaleTimeString('en-US', { hour12: false });
  feedItems.unshift({ time: now, msg, agent: agent || 'system' });
  if (feedItems.length > 100) feedItems.length = 100;
  const el = document.getElementById('feed-list');
  el.innerHTML = feedItems.map(f =>
    `<div class="feed-item"><span class="feed-time">${f.time}</span><div class="feed-msg"><span class="feed-agent">${f.agent}</span> — ${f.msg}</div></div>`
  ).join('');
}

// ── Utilities ──
function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function byId(id) { return document.getElementById(id); }
function safeText(id, value) { const el = byId(id); if (el) el.textContent = value; }
function timeAgo(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 0) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  return `${Math.floor(sec/86400)}d ago`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function cronToHuman(cron) {
  if (!cron || cron === '—') return cron;
  const p = cron.trim().split(/\s+/);
  if (p.length < 5) return cron;
  const [min, hour, dom, mon, dow] = p;
  // Every N minutes
  if (min.startsWith('*/') && hour === '*' && dom === '*' && dow === '*') return `Every ${min.slice(2)} min`;
  // Every N hours
  if (min === '0' && hour.startsWith('*/') && dom === '*' && dow === '*') return `Every ${hour.slice(2)}h`;
  // Hourly
  if (min === '0' && hour === '*' && dom === '*' && dow === '*') return 'Every hour';
  // Specific day of week
  if (dow !== '*' && dom === '*') {
    const days = dow.split(',').map(d => {
      if (d === '1-5') return 'Weekdays';
      const n = parseInt(d);
      return isNaN(n) ? d : (DAY_NAMES[n] || d);
    }).join(', ');
    const time = `${hour.padStart(2,'0')}:${min.padStart(2,'0')}`;
    return `${days} ${time}`;
  }
  // Specific day of month
  if (dom !== '*' && dow === '*') {
    const suffix = dom === '1' ? 'st' : dom === '15' ? 'th' : 'th';
    const time = `${hour.padStart(2,'0')}:${min.padStart(2,'0')}`;
    return `${dom}${suffix} of month ${time}`;
  }
  // Daily at specific time
  if (hour !== '*' && !hour.startsWith('*/') && dom === '*' && dow === '*') {
    return `Daily ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`;
  }
  return cron;
}

// ── Data Fetching ──
async function fetchAll() {
  const [healthR, workersR, routinesR, approvalsR, auditR, memoryR, reasoningR, signalsR, decisionsR, foresightR, outcomesR, governanceR, goalsR,
         voiceKpiR, workiqKpiR, a2aKpiR, outcomesKpiR, casesKpiR, reviewerKpiR, metaKpiR, briefingsKpiR] = await Promise.allSettled([
    fetch(`${BASE}/api/health`).then(r => r.json()),
    fetch(`${BASE}/api/workers`).then(r => r.json()),
    fetch(`${BASE}/api/routines`).then(r => r.json()),
    fetch(`${BASE}/api/approvals`).then(r => r.json()),
    fetch(`${BASE}/api/audit`).then(r => r.json()),
    fetch(`${BASE}/api/memory`).then(r => r.json()),
    fetch(`${BASE}/api/reasoning`).then(r => r.json()),
    fetch(`${BASE}/api/signals?limit=50`).then(r => r.json()),
    fetch(`${BASE}/api/decisions?limit=50`).then(r => r.json()),
    fetch(`${BASE}/api/foresight?limit=50`).then(r => r.json()),
    fetch(`${BASE}/api/outcomes?limit=50`).then(r => r.json()),
    fetch(`${BASE}/api/governance`).then(r => r.json()),
    fetch(`${BASE}/api/goals`).then(r => r.json()),
    // Phase 1.x/2.x/3.x hardening KPIs
    fetch(`${BASE}/api/voice/kpi`).then(r => r.json()).catch(() => null),
    fetch(`${BASE}/api/workiq/kpi`).then(r => r.json()).catch(() => null),
    fetch(`${BASE}/api/a2a/kpi`).then(r => r.json()).catch(() => null),
    fetch(`${BASE}/api/outcomes/kpi`).then(r => r.json()).catch(() => null),
    fetch(`${BASE}/api/cases/kpi`).then(r => r.json()).catch(() => null),
    fetch(`${BASE}/api/reviewer/kpi`).then(r => r.json()).catch(() => null),
    fetch(`${BASE}/api/meta/kpi`).then(r => r.json()).catch(() => null),
    fetch(`${BASE}/api/briefings/kpi`).then(r => r.json()).catch(() => null),
  ]);

  const health = healthR.status === 'fulfilled' ? healthR.value : null;
  const workers = workersR.status === 'fulfilled' ? workersR.value : null;
  const routines = routinesR.status === 'fulfilled' ? routinesR.value : null;
  const approvals = approvalsR.status === 'fulfilled' ? approvalsR.value : null;
  const audit = auditR.status === 'fulfilled' ? auditR.value : null;
  const memory = memoryR.status === 'fulfilled' ? memoryR.value : null;
  const reasoning = reasoningR.status === 'fulfilled' ? reasoningR.value : null;
  const signals = signalsR.status === 'fulfilled' ? signalsR.value : null;
  const decisions = decisionsR.status === 'fulfilled' ? decisionsR.value : null;
  const foresight = foresightR.status === 'fulfilled' ? foresightR.value : null;
  const outcomes = outcomesR.status === 'fulfilled' ? outcomesR.value : null;
  const governance = governanceR.status === 'fulfilled' ? governanceR.value : null;
  const goals = goalsR.status === 'fulfilled' ? goalsR.value : null;

  try { if (health) renderHealth(health); } catch (e) { console.error('renderHealth failed', e); }
  try { if (workers) renderWorkers(workers); } catch (e) { console.error('renderWorkers failed', e); }
  try { if (routines) renderRoutines(routines); } catch (e) { console.error('renderRoutines failed', e); }
  try { if (approvals) renderApprovals(approvals); } catch (e) { console.error('renderApprovals failed', e); }
  try { if (audit) renderAudit(audit); } catch (e) { console.error('renderAudit failed', e); }
  try { if (memory) renderMemory(memory); } catch (e) { console.error('renderMemory failed', e); }
  try { renderAgentMind(reasoning); } catch (e) { console.error('renderAgentMind failed', e); }
  try { renderCommandCenterActivity(reasoning); } catch (e) { console.error('renderCommandCenterActivity failed', e); }
  try { streamReasoningToFeed(reasoning); } catch (e) { console.error('streamReasoningToFeed failed', e); }
  try { streamSignalsToFeed(signals, decisions, outcomes, routines); } catch (e) { console.error('streamSignalsToFeed failed', e); }
  try { renderTodaysPlan(routines); } catch (e) { console.error('renderTodaysPlan failed', e); }
  try { updateGraph(workers); } catch (e) { console.error('updateGraph failed', e); }
  try { renderSignals(signals, decisions); } catch (e) { console.error('renderSignals failed', e); }
  try { renderForesight(foresight); } catch (e) { console.error('renderForesight failed', e); }
  try { renderOutcomes(outcomes); } catch (e) { console.error('renderOutcomes failed', e); }
  try { renderGovernance(governance); } catch (e) { console.error('renderGovernance failed', e); }
  try { renderGoals(goals); } catch (e) { console.error('renderGoals failed', e); }

  // Hardening KPI tiles (one numeric per subsystem)
  try {
    const voiceKpi = voiceKpiR.status === 'fulfilled' ? voiceKpiR.value : null;
    const workiqKpi = workiqKpiR.status === 'fulfilled' ? workiqKpiR.value : null;
    const a2aKpi = a2aKpiR.status === 'fulfilled' ? a2aKpiR.value : null;
    const outcomesKpi = outcomesKpiR.status === 'fulfilled' ? outcomesKpiR.value : null;
    const casesKpi = casesKpiR.status === 'fulfilled' ? casesKpiR.value : null;
    const reviewerKpi = reviewerKpiR.status === 'fulfilled' ? reviewerKpiR.value : null;
    const metaKpi = metaKpiR.status === 'fulfilled' ? metaKpiR.value : null;
    const briefingsKpi = briefingsKpiR.status === 'fulfilled' ? briefingsKpiR.value : null;
    if (voiceKpi) safeText('kpi-voice', String(voiceKpi.callsStarted ?? voiceKpi.runs ?? 0));
    if (workiqKpi && workiqKpi.transport) safeText('kpi-workiq', String(workiqKpi.transport));
    if (a2aKpi) safeText('kpi-a2a', String(a2aKpi.accepted ?? a2aKpi.evaluated ?? 0));
    if (outcomesKpi) safeText('kpi-outcome', `${Math.round((outcomesKpi.successRate || 0) * 100)}%`);
    if (casesKpi) safeText('kpi-cases', String(casesKpi.open ?? 0));
    if (reviewerKpi) safeText('kpi-reviewer', `${Math.round((reviewerKpi.blockRate || 0) * 100)}%`);
    if (metaKpi) safeText('kpi-meta', String(metaKpi.alertsRaised ?? 0));
    if (briefingsKpi) safeText('kpi-briefings', String(briefingsKpi.briefingsPerShift ?? 0));
  } catch (e) { console.error('renderHardeningKpis failed', e); }

  const healthBadge = byId('health-badge');
  if (healthBadge) {
    if (health) {
      healthBadge.textContent = 'Healthy';
      healthBadge.className = 'health-badge healthy';
    } else {
      healthBadge.textContent = 'Offline';
      healthBadge.className = 'health-badge unhealthy';
    }
  }
  if (firstFetch) {
    addFeed('All systems online — polling every 10s', 'system');
    firstFetch = false;
  }
}

// ── Render: Health ──
function renderHealth(data) {
  const uptimeMs = data.uptimeMs || data.uptime || 0;
  const h = Math.floor(uptimeMs / 3600000);
  const m = Math.floor((uptimeMs % 3600000) / 60000);
  const uptimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
  safeText('s-uptime', uptimeStr);
  safeText('topbar-uptime', uptimeStr);
}

// ── Render: Workers ──
let prevWorkerCount = 0;
function renderWorkers(data) {
  const workerList = Array.isArray(data) ? data : (data.workers || []);
  safeText('s-workers', String(workerList.length));

  if (workerList.length > prevWorkerCount && prevWorkerCount > 0) {
    addFeed(`${workerList.length - prevWorkerCount} new worker(s) registered`, 'registry');
  } else if (prevWorkerCount === 0 && workerList.length > 0) {
    addFeed(`${workerList.length} workers online`, 'registry');
  }
  prevWorkerCount = workerList.length;

  const workersPanel = byId('cc-workers-compact') || byId('cc-workers');
  if (!workersPanel) return;

  workersPanel.innerHTML = workerList.length ? workerList.map(w => {
    const name = w.name || w.id || '—';
    const tier = WORKER_TIERS[name] || 'extended';
    const icon = WORKER_ICONS[name] || '⚙';
    const tierColor = TIER_COLORS[tier] || 'var(--text-dim)';
    const toolCount = (w.tools && w.tools.length) || w.toolCount || 0;
    return `<div class="metric-row">
      <span class="metric-label"><span style="margin-right:6px">${icon}</span>${escHtml(name)}</span>
      <span style="font-size:11px"><span style="color:${tierColor};font-weight:600;text-transform:uppercase;font-size:10px">${tier}</span> <span style="color:var(--text-muted);margin-left:6px">${toolCount} tools</span></span>
    </div>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon">⚙</div><div class="empty-text">No workers registered</div></div>';
}

// ── Render: Routines ──
let prevRoutineCount = 0;
function renderRoutines(data) {
  const routineList = Array.isArray(data) ? data : (data.routines || []);
  safeText('s-routines', String(routineList.length));

  if (routineList.length > prevRoutineCount && prevRoutineCount > 0) {
    addFeed(`${routineList.length - prevRoutineCount} new routine(s) added`, 'scheduler');
  } else if (prevRoutineCount === 0 && routineList.length > 0) {
    addFeed(`${routineList.length} routines configured`, 'scheduler');
  }
  prevRoutineCount = routineList.length;

  const routinesPanel = byId('cc-routines-next') || byId('cc-routines');
  if (!routinesPanel) return;

  routinesPanel.innerHTML = routineList.length ? routineList.map(r => {
    const name = r.name || r.id || '—';
    const cron = r.cron || r.schedule || '—';
    const status = r.status || r.state || 'idle';
    const lastRun = r.lastRun ? timeAgo(r.lastRun) : 'never';
    const summary = r.lastOutputSnippet || '';
    const delivery = r.lastDelivery
      ? [r.lastDelivery.teamsPosted ? 'Teams' : '', r.lastDelivery.emailSent ? 'Email' : '', r.lastDelivery.approvalRaised ? 'Approval' : '']
          .filter(Boolean)
          .join(', ')
      : '';
    const statusColor = status === 'running' ? 'var(--blue)' : status === 'completed' ? 'var(--green)' : status === 'failed' ? 'var(--red)' : status === 'scheduled' ? 'var(--cyan)' : status === 'disabled' ? 'var(--text-dim)' : 'var(--text-muted)';
    return `<div class="metric-row">
      <span class="metric-label">${escHtml(name)} <span style="color:var(--text-muted);font-size:10px">${escHtml(cronToHuman(cron))}</span><br/>
      <span style="color:var(--text-muted);font-size:10px">last: ${escHtml(lastRun)}${delivery ? ` · via ${escHtml(delivery)}` : ''}</span>${summary ? `<br/><span style="color:var(--text-muted);font-size:10px">${escHtml(summary)}</span>` : ''}</span>
      <span style="font-size:11px;color:${statusColor};font-weight:600">${status}</span>
    </div>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon">⏱</div><div class="empty-text">No routines configured</div></div>';
}

// ── Render: Approvals ──
let prevApprovalCount = 0;
function renderApprovals(data) {
  const approvalList = Array.isArray(data) ? data : (data.approvals || []);
  const pending = approvalList.filter(a => a.status === 'pending' || !a.status);
  const approved = approvalList.filter(a => a.status === 'approved');
  const rejected = approvalList.filter(a => a.status === 'rejected');
  const escalated = approvalList.filter(a => a.status === 'escalated');

  document.getElementById('s-approvals').textContent = pending.length;
  document.getElementById('act-pending').textContent = pending.length;
  document.getElementById('act-approved').textContent = approved.length;
  document.getElementById('act-rejected').textContent = rejected.length;
  document.getElementById('act-escalated').textContent = escalated.length;

  if (pending.length > prevApprovalCount && prevApprovalCount > 0) {
    addFeed(`${pending.length - prevApprovalCount} new approval(s) pending`, 'approvals');
  }
  prevApprovalCount = pending.length;

  // Command Center panel
  document.getElementById('cc-approvals').innerHTML = pending.length ? pending.slice(0, 5).map(a => {
    const title = a.title || a.description || a.action || '—';
    const worker = a.worker || a.source || '—';
    return `<div class="metric-row">
      <span class="metric-label">${escHtml(title)} <span style="color:var(--text-muted);font-size:10px">(${escHtml(worker)})</span></span>
      <span class="action-status open">pending</span>
    </div>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon">✓</div><div class="empty-text">No pending approvals</div></div>';

  // Actions view — pending list
  document.getElementById('act-list').innerHTML = pending.length ? pending.map(a => {
    const title = a.title || a.description || a.action || '—';
    const worker = a.worker || a.source || '—';
    const severity = a.severity || a.priority || 'medium';
    return `<div class="action-card"><span class="sev-dot ${severity}"></span><div class="action-body">
      <div class="action-title">${escHtml(title)}</div>
      <div class="action-meta">${escHtml(worker)} · ${timeAgo(a.createdAt || a.timestamp)}</div>
    </div><span class="action-status open">pending</span></div>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon">✓</div><div class="empty-text">No pending approvals. Workers will create approval requests as needed.</div></div>';

  // Actions view — escalations
  document.getElementById('esc-list').innerHTML = escalated.length ? escalated.map(a => {
    const title = a.title || a.description || a.action || '—';
    const worker = a.worker || a.source || '—';
    return `<div class="action-card"><span class="sev-dot critical"></span><div class="action-body">
      <div class="action-title">${escHtml(title)}</div>
      <div class="action-meta">${escHtml(worker)} · ${timeAgo(a.createdAt || a.timestamp)}</div>
    </div><span class="action-status escalated">escalated</span></div>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-text">No recent escalations.</div></div>';
}

// ── Render: Audit ──
function renderAudit(data) {
  const auditPanel = byId('cc-audit');
  if (!auditPanel) return;

  const entries = Array.isArray(data) ? data : (data.entries || data.events || []);
  if (entries.length === 0 && data && typeof data === 'object' && data.totalEntries !== undefined) {
    const totalEntries = data.totalEntries || 0;
    const backend = data.storageBackend || 'in-memory';
    auditPanel.innerHTML = `<div class="metric-row"><span class="metric-label">Total entries</span><span class="metric-val">${totalEntries}</span></div><div class="metric-row"><span class="metric-label">Backend</span><span style="font-size:11px;color:var(--text-muted)">${escHtml(backend)}</span></div>`;
    return;
  }

  auditPanel.innerHTML = entries.length ? entries.slice(0, 10).map(e => {
    const ts = e.timestamp || e.createdAt || e.time;
    const timeStr = ts ? new Date(ts).toLocaleTimeString('en-US', { hour12: false }) : '--:--:--';
    const action = e.action || e.event || e.type || '—';
    const source = e.worker || e.source || e.user || '—';
    const actionColor = action === 'error' ? 'var(--red)' : action === 'warning' ? 'var(--orange)' : 'var(--text-dim)';
    return `<div class="metric-row">
      <span class="metric-label" style="font-size:11px"><span style="color:var(--text-muted);font-family:monospace;font-size:10px">${timeStr}</span> ${escHtml(source)}</span>
      <span style="font-size:11px;color:${actionColor}">${escHtml(action)}</span>
    </div>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No audit events yet</div></div>';
}

// ── Render: Memory ──
function renderMemory(data) {
  const memoryPanel = byId('cc-memory');
  if (!memoryPanel) return;

  const entries = Array.isArray(data) ? data : (data.entries || data.items || []);
  const count = entries.length || data.count || 0;
  memoryPanel.innerHTML = count > 0 ? `
    <div class="metric-row"><span class="metric-label">Entries</span><span class="metric-val">${count}</span></div>
    ${entries.slice(0, 5).map(e => {
      const key = e.key || e.name || e.id || '—';
      const val = e.value || e.summary || '';
      return `<div class="metric-row"><span class="metric-label" style="font-size:11px">${escHtml(key)}</span><span style="font-size:11px;color:var(--text-muted)">${escHtml(typeof val === 'string' ? val.substring(0, 40) : JSON.stringify(val).substring(0, 40))}</span></div>`;
    }).join('')}
  ` : '<div class="empty-state"><div class="empty-icon">🧠</div><div class="empty-text">No memory entries</div></div>';
}

// ── Render: Command Center "Agent Activity" panel + cross-cutting feed streamers ──
// Shared trace metadata (used by Command Center activity, feed streamer, and Agent Mind)
const CC_TYPE_ICONS = {
  intent: '🎯', routing: '🔀', 'tool-call': '🔧', 'tool-result': '📊',
  'llm-thinking': '🧠', delegation: '📤', escalation: '🚨', outcome: '✅',
  error: '❌', approval: '👤'
};
const CC_TYPE_COLORS = {
  intent: 'var(--cyan)', routing: 'var(--purple)', 'tool-call': 'var(--green)',
  'tool-result': 'var(--blue)', 'llm-thinking': 'var(--purple)', delegation: 'var(--orange)',
  escalation: 'var(--red)', outcome: 'var(--green)', error: 'var(--red)', approval: 'var(--orange)'
};

// Feed-streaming watermarks (so we only push new items into addFeed)
let lastSeenTraceTs = 0;
let lastSeenSignalIds = new Set();
let lastSeenDecisionIds = new Set();
let lastSeenOutcomeIds = new Set();
let lastSeenRoutineRuns = new Map(); // routineId -> lastRun timestamp
let feedBootDone = false;

function renderCommandCenterActivity(reasoning) {
  const el = byId('cc-activity');
  if (!el) return;
  if (!reasoning) return;
  const traces = reasoning.traces || [];
  const stats = reasoning.stats || {};

  // Top stat tiles get refreshed too (so they aren't permanently 0).
  safeText('s-conversations', String(stats.totalConversations || 0));
  safeText('s-toolcalls', String((stats.byType && stats.byType['tool-call']) || 0));

  if (!traces.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚡</div><div class="empty-text">No agent activity yet. Send a message to Alex or wait for a routine to fire.</div></div>';
    return;
  }

  // Show the most recent 25 traces, newest first.
  const recent = traces
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 25);

  el.innerHTML = recent.map(t => {
    const ts = new Date(t.timestamp).toLocaleTimeString('en-US', { hour12: false });
    const icon = CC_TYPE_ICONS[t.type] || '•';
    const color = CC_TYPE_COLORS[t.type] || 'var(--text-muted)';
    const sourceIcon = (typeof WORKER_ICONS !== 'undefined' && WORKER_ICONS[t.source]) || '⚙';
    const conf = t.confidence ? `<span style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-left:6px">${escHtml(t.confidence)}</span>` : '';
    const dur = t.durationMs ? `<span style="font-size:10px;color:var(--text-muted);margin-left:6px">${t.durationMs}ms</span>` : '';
    const summary = escHtml(t.summary || t.detail || '(no summary)');
    return `<div style="display:flex;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border)">
      <div style="flex:0 0 22px;font-size:14px;text-align:center">${icon}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-muted);margin-bottom:2px">
          <span style="color:${color};font-weight:600;text-transform:uppercase">${escHtml(t.type)}</span>
          <span>·</span>
          <span>${sourceIcon} ${escHtml(t.source || '—')}</span>
          ${conf}${dur}
          <span style="margin-left:auto">${ts}</span>
        </div>
        <div style="font-size:13px;color:var(--text);line-height:1.4;word-break:break-word">${summary}</div>
      </div>
    </div>`;
  }).join('');
}

function streamReasoningToFeed(reasoning) {
  if (!reasoning || !reasoning.traces) return;
  const traces = reasoning.traces;
  // First time through: just record the high-water-mark; don't replay history.
  if (!feedBootDone) {
    let max = 0;
    for (const t of traces) {
      const ts = new Date(t.timestamp).getTime();
      if (ts > max) max = ts;
    }
    lastSeenTraceTs = max;
    return;
  }
  // Push new traces (newest watermark since last fetch) into the feed.
  let newMax = lastSeenTraceTs;
  // Iterate oldest-first so feed reads in real chronological order.
  const sorted = traces.slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  for (const t of sorted) {
    const ts = new Date(t.timestamp).getTime();
    if (ts <= lastSeenTraceTs) continue;
    if (ts > newMax) newMax = ts;
    // Filter to high-signal types so the feed isn't drowned in llm-thinking noise.
    if (!['tool-call', 'outcome', 'escalation', 'error', 'approval', 'delegation'].includes(t.type)) continue;
    const icon = CC_TYPE_ICONS[t.type] || '•';
    const summary = (t.summary || t.detail || '').toString().slice(0, 140);
    addFeed(`${icon} ${t.type} — ${summary}`, t.source || 'alex');
  }
  lastSeenTraceTs = newMax;
}

function streamSignalsToFeed(signalsResp, decisionsResp, outcomesResp, routinesResp) {
  const signals = (signalsResp && signalsResp.signals) || [];
  const decisions = (decisionsResp && decisionsResp.decisions) || [];
  const outcomes = (outcomesResp && outcomesResp.outcomes) || [];
  const routines = (routinesResp && routinesResp.routines) || [];

  // Bootstrap watermarks on first fetch — don't replay all history.
  if (!feedBootDone) {
    for (const s of signals) lastSeenSignalIds.add(s.id);
    for (const d of decisions) lastSeenDecisionIds.add(d.id || `${d.workflowId}-${d.timestamp}`);
    for (const o of outcomes) lastSeenOutcomeIds.add(o.id || `${o.workflowId}-${o.timestamp}`);
    for (const r of routines) {
      if (r.id && r.lastRun) lastSeenRoutineRuns.set(r.id, r.lastRun);
    }
    feedBootDone = true;
    return;
  }

  for (const s of signals) {
    if (lastSeenSignalIds.has(s.id)) continue;
    lastSeenSignalIds.add(s.id);
    const sev = (s.severity || 'low').toUpperCase();
    addFeed(`⚡ signal · ${sev} · ${s.source || '?'}/${s.type || '?'}${s.asset ? ' · ' + s.asset : ''}`, 'signal-router');
  }

  for (const d of decisions) {
    const key = d.id || `${d.workflowId}-${d.timestamp}`;
    if (lastSeenDecisionIds.has(key)) continue;
    lastSeenDecisionIds.add(key);
    const verdict = d.action || d.decision || 'decision';
    addFeed(`🔀 ${verdict} → ${d.workflowId || 'workflow'}${d.reason ? ' · ' + d.reason : ''}`, 'trigger-policy');
  }

  for (const o of outcomes) {
    const key = o.id || `${o.workflowId}-${o.timestamp}`;
    if (lastSeenOutcomeIds.has(key)) continue;
    lastSeenOutcomeIds.add(key);
    const status = o.status || 'completed';
    addFeed(`✅ outcome · ${status} · ${o.workflowId || o.routineId || '?'}`, 'outcomes');
  }

  for (const r of routines) {
    if (!r.id || !r.lastRun) continue;
    const prev = lastSeenRoutineRuns.get(r.id);
    if (prev === r.lastRun) continue;
    lastSeenRoutineRuns.set(r.id, r.lastRun);
    if (!prev) continue; // first time we observed this routine; skip
    const status = r.lastStatus || 'completed';
    const ld = r.lastDelivery || {};
    const channels = [];
    if (ld.teamsPosted) channels.push('teams');
    if (ld.emailSent) channels.push('email');
    if (ld.approvalRaised) channels.push('approval');
    const delivery = channels.length ? ` · ${channels.join('+')}` : '';
    addFeed(`⏱ ${r.id} · ${status}${delivery}`, r.worker || 'scheduler');
  }
}

// ── Render: Agent Mind (reasoning trace visualization) ──
let selectedConvId = null;

function renderAgentMind(reasoning) {
  const emptyEl = byId('am-empty');
  if (!reasoning) {
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  const { traces, conversations, stats } = reasoning;

  // Stats
  safeText('am-total', String((stats && stats.totalTraces) || 0));
  safeText('am-conversations', String((stats && stats.totalConversations) || 0));
  safeText('am-tools', String(((stats && stats.byType && stats.byType['tool-call']) || 0)));
  safeText('am-avgtime', stats && stats.avgDurationMs ? `${stats.avgDurationMs}ms` : '—');

  // Type filters
  const typeLabels = {
    all: '🔍 All', intent: '🎯 Intent', routing: '🔀 Routing', 'tool-call': '🔧 Tool Call',
    'tool-result': '📊 Result', 'llm-thinking': '🧠 Thinking', delegation: '📤 Delegation',
    escalation: '🚨 Escalation', outcome: '✅ Outcome', error: '❌ Error', approval: '👤 Approval'
  };
  const types = ['all'];
  if (stats.byType) {
    for (const t of Object.keys(stats.byType)) { if (!types.includes(t)) types.push(t); }
  }
  const filtersEl = byId('am-filters');
  if (!filtersEl) return;
  filtersEl.innerHTML = types.map(t => {
    const count = t === 'all' ? (stats.totalTraces || 0) : (stats.byType[t] || 0);
    const label = typeLabels[t] || t;
    return `<button class="filter-tab${t==='all'?' active':''}" data-rtype="${t}">${label} (${count})</button>`;
  }).join('');

  let currentFilter = 'all';
  document.querySelectorAll('#am-filters .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#am-filters .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.rtype;
      renderChain(selectedConvId, currentFilter);
    });
  });

  // Conversations list
  const convList = byId('am-conversations-list');
  if (!convList) return;
  if (conversations && conversations.length > 0) {
    convList.innerHTML = conversations.map((c, i) => {
      const worker = c.worker || '—';
      const msg = c.userMessage || 'No message captured';
      const ts = new Date(c.lastTimestamp).toLocaleTimeString('en-US', { hour12: false });
      const icon = WORKER_ICONS[worker] || '⚡';
      return `<div class="conv-item${i===0?' active':''}" data-convid="${c.conversationId}">
        <div class="conv-worker">${icon} ${escHtml(worker)}</div>
        <div class="conv-msg">${escHtml(msg)}</div>
        <div class="conv-meta"><span>${ts}</span><span>${c.traceCount} steps</span></div>
      </div>`;
    }).join('');

    // Select first conversation by default
    if (!selectedConvId && conversations.length > 0) {
      selectedConvId = conversations[0].conversationId;
    }

    convList.querySelectorAll('.conv-item').forEach(item => {
      item.addEventListener('click', () => {
        convList.querySelectorAll('.conv-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        selectedConvId = item.dataset.convid;
        renderChain(selectedConvId, currentFilter);
      });
    });
  } else {
    convList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">No conversations yet</div>';
  }

  // Render the chain for the selected conversation
  renderChain(selectedConvId, currentFilter);

  function renderChain(convId, typeFilter) {
    const chainEl = byId('am-reasoning-chain');
    const emptyEl = byId('am-empty');
    const titleEl = byId('am-detail-title');
    if (!chainEl || !emptyEl || !titleEl) return;

    let filtered = traces || [];
    if (convId) {
      filtered = filtered.filter(t => t.conversationId === convId);
    }
    if (typeFilter && typeFilter !== 'all') {
      filtered = filtered.filter(t => t.type === typeFilter);
    }

    // Sort chronologically for the chain view (oldest first)
    filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (filtered.length === 0) {
      chainEl.innerHTML = '';
      emptyEl.style.display = '';
      titleEl.textContent = 'Reasoning Chain';
      return;
    }

    emptyEl.style.display = 'none';
    titleEl.textContent = `Reasoning Chain — ${filtered.length} steps`;

    const typeIcons = {
      intent: '🎯', routing: '🔀', 'tool-call': '🔧', 'tool-result': '📊',
      'llm-thinking': '🧠', delegation: '📤', escalation: '🚨', outcome: '✅',
      error: '❌', approval: '👤'
    };

    chainEl.innerHTML = filtered.map((t, idx) => {
      const ts = new Date(t.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const icon = typeIcons[t.type] || '•';
      const confHtml = t.confidence ? `<span class="step-confidence ${t.confidence}">${t.confidence}</span>` : '';
      const durHtml = t.durationMs ? `<span class="step-duration">${t.durationMs}ms</span>` : '';
      const sourceIcon = WORKER_ICONS[t.source] || WORKER_ICONS[t.metadata?.workerSource] || '⚙';
      const detailId = `detail-${idx}`;

      return `<div class="reasoning-step">
        <div class="step-dot ${t.type}"></div>
        <div class="step-header">
          <span class="step-type ${t.type}">${icon} ${t.type}</span>
          <span class="step-time">${ts}</span>
          <span class="step-source">${sourceIcon} ${escHtml(t.source)}</span>
          ${confHtml}${durHtml}
        </div>
        <div class="step-summary">${escHtml(t.summary)}</div>
        ${t.detail ? `<span class="step-toggle" onclick="var d=document.getElementById('${detailId}');d.classList.toggle('expanded');this.textContent=d.classList.contains('expanded')?'collapse':'expand'">expand</span>
        <div class="step-detail" id="${detailId}">${escHtml(t.detail)}</div>` : ''}
      </div>`;
    }).join('');
  }
}

// ── Render: Signals & Trigger-Policy Decisions ──
function renderSignals(signalsResp, decisionsResp) {
  const signals = (signalsResp && signalsResp.signals) || [];
  const decisions = (decisionsResp && decisionsResp.decisions) || [];

  const profile = (window.__missionControlProfile || 'prod');
  const visible = profile === 'prod' ? signals.filter(s => s.origin !== 'scripted') : signals;

  const totalEl = byId('sig-total'); if (totalEl) totalEl.textContent = String(visible.length);
  const obsEl = byId('sig-observed'); if (obsEl) obsEl.textContent = String(visible.filter(s => s.origin === 'observed').length);
  const predEl = byId('sig-predicted'); if (predEl) predEl.textContent = String(visible.filter(s => s.origin === 'predicted').length);
  const scrEl = byId('sig-scripted'); if (scrEl) scrEl.textContent = String(visible.filter(s => s.origin === 'scripted').length);

  const originColor = (o) => o === 'predicted' ? 'var(--purple)' : o === 'scripted' ? 'var(--green)' : 'var(--blue)';
  const sevColor = (s) => s === 'critical' ? 'var(--red)' : s === 'high' ? 'var(--orange)' : s === 'medium' ? 'var(--blue)' : 'var(--text-muted)';
  const sigList = byId('sig-list');
  if (sigList) {
    sigList.innerHTML = visible.length === 0
      ? '<div class="empty-state"><div class="empty-icon">⚡</div><div class="empty-text">No signals to display.</div></div>'
      : visible.slice(0, 50).map(s => `
        <div class="metric-row" style="border-left:3px solid ${originColor(s.origin)};padding-left:8px">
          <span class="metric-label">
            <span style="color:${originColor(s.origin)};font-weight:600;font-size:11px;text-transform:uppercase">${escHtml(s.origin || 'observed')}</span>
            <span style="color:var(--text-muted)"> · </span>
            <span style="color:${sevColor(s.severity)};font-weight:600">${escHtml(s.severity || '—')}</span>
            <span style="color:var(--text-muted)"> · </span>
            <span>${escHtml(s.source || '—')}</span>
            <span style="color:var(--text-muted)">/${escHtml(s.type || '—')}</span>
            ${s.asset ? `<br/><span style="color:var(--text-muted);font-size:11px">asset: ${escHtml(s.asset)}</span>` : ''}
          </span>
          <span style="font-size:11px;color:var(--text-muted)">${escHtml((typeof timeAgo === 'function' ? timeAgo(s.occurredAt) : (s.occurredAt || '')))}</span>
        </div>
      `).join('');
  }

  const decList = byId('dec-list');
  if (decList) {
    decList.innerHTML = decisions.length === 0
      ? '<div class="empty-state"><div class="empty-icon">⚙</div><div class="empty-text">No decisions logged yet.</div></div>'
      : decisions.slice(0, 50).map(d => `
        <div class="metric-row">
          <span class="metric-label">
            <strong>${escHtml(d.workflowId)}</strong>
            <span style="color:var(--text-muted)"> · signal=${escHtml(d.signalId)}</span>
            ${d.suppressedReason ? `<br/><span style="color:var(--orange);font-size:11px">suppressed: ${escHtml(d.suppressedReason)}</span>` : ''}
          </span>
          <span style="font-size:11px;color:${d.matched && !d.suppressedReason ? 'var(--green)' : 'var(--text-muted)'};font-weight:600">${d.matched ? (d.suppressedReason ? 'matched' : 'routed') : 'no-match'}</span>
        </div>
      `).join('');
  }
}

// ── Render: Foresight (Pillar 3) ──
function renderForesight(resp) {
  const forecasts = (resp && resp.forecasts) || [];
  const total = byId('fc-total'); if (total) total.textContent = String(forecasts.length);
  const cluster = forecasts.filter(f => (f.signal && f.signal.type || '').includes('major-predicted')).length;
  const cascade = forecasts.filter(f => (f.signal && f.signal.type || '').includes('cascade-predicted')).length;
  safeText('fc-cluster', String(cluster));
  safeText('fc-cascade', String(cascade));
  const list = byId('fc-list');
  if (!list) return;
  list.innerHTML = forecasts.length === 0
    ? '<div class="empty-state"><div class="empty-icon">△</div><div class="empty-text">No forecasts yet. Foresight engine ticks every 60s.</div></div>'
    : forecasts.slice(0, 50).map(f => {
        const s = f.signal || {};
        return `
        <div class="metric-row" style="border-left:3px solid var(--purple);padding-left:8px">
          <span class="metric-label">
            <strong>${escHtml(s.type || '—')}</strong>
            ${s.asset ? `<span style="color:var(--text-muted)"> · ${escHtml(s.asset)}</span>` : ''}
            <br/><span style="font-size:11px;color:var(--text-muted)">${escHtml(f.rationale || '')}</span>
          </span>
          <span style="font-size:11px;color:var(--purple);font-weight:600">conf ${(s.confidence || 0).toFixed(2)}</span>
        </div>`;
      }).join('');
}

// ── Render: Outcomes (Pillar 4) ──
function renderOutcomes(resp) {
  const outs = (resp && resp.outcomes) || [];
  const success = outs.filter(o => o.label === 'success').length;
  const partial = outs.filter(o => o.label === 'partial').length;
  const failure = outs.filter(o => o.label === 'failure').length;
  const rolled  = outs.filter(o => o.rolledBack).length;
  safeText('out-success', String(success));
  safeText('out-partial', String(partial));
  safeText('out-failure', String(failure));
  safeText('out-rolled', String(rolled));
  const list = byId('out-list');
  if (!list) return;
  const color = (l) => l === 'success' ? 'var(--green)' : l === 'partial' ? 'var(--orange)' : l === 'failure' ? 'var(--red)' : 'var(--text-muted)';
  list.innerHTML = outs.length === 0
    ? '<div class="empty-state"><div class="empty-icon">●</div><div class="empty-text">No outcomes yet.</div></div>'
    : outs.slice(0, 50).map(o => `
        <div class="metric-row" style="border-left:3px solid ${color(o.label)};padding-left:8px">
          <span class="metric-label">
            <strong style="color:${color(o.label)};text-transform:uppercase;font-size:11px">${escHtml(o.label)}</strong>
            <span style="color:var(--text-muted)"> · ${escHtml(o.workflowId)}</span>
            ${o.signalType ? `<span style="color:var(--text-muted)">/${escHtml(o.signalType)}</span>` : ''}
            ${o.rolledBack ? `<br/><span style="color:var(--purple);font-size:11px">rolled back</span>` : ''}
            ${o.notes ? `<br/><span style="color:var(--text-muted);font-size:11px">${escHtml(o.notes)}</span>` : ''}
          </span>
          <span style="font-size:11px;color:var(--text-muted)">${escHtml((typeof timeAgo === 'function' ? timeAgo(o.observedAt) : (o.observedAt || '')))}</span>
        </div>
      `).join('');
}

// ── Render: Governance (Pillar 7) ──
function renderGovernance(resp) {
  if (!resp) return;
  const killEl = byId('gov-kill');
  if (killEl) {
    if (resp.killSwitch && resp.killSwitch.engaged) {
      killEl.textContent = 'ENGAGED';
      killEl.style.color = 'var(--red)';
    } else {
      killEl.textContent = 'OK';
      killEl.style.color = 'var(--green)';
    }
  }
  const freezeEl = byId('gov-freeze');
  if (freezeEl) {
    if (resp.changeFreezeActive) {
      freezeEl.textContent = 'ACTIVE';
      freezeEl.style.color = 'var(--orange)';
    } else {
      freezeEl.textContent = 'OK';
      freezeEl.style.color = 'var(--green)';
    }
  }
  if (resp.budget) safeText('gov-budget', `${resp.budget.used}/${resp.budget.limit}`);
  const stmts = resp.statementsOfAutonomy || [];
  safeText('gov-workers', String(stmts.length));
  const list = byId('gov-statements');
  if (list) {
    list.innerHTML = stmts.length === 0
      ? '<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-text">No statements registered.</div></div>'
      : stmts.map(s => `
          <div class="metric-row" style="border-left:3px solid ${s.allowAutonomous ? 'var(--orange)' : 'var(--text-muted)'};padding-left:8px;align-items:flex-start">
            <span class="metric-label" style="flex:1">
              <strong>${escHtml(s.name)}</strong>
              <span style="color:var(--text-muted)"> · blast=${(s.blastRadius || 0).toFixed(2)}</span>
              <span style="color:${s.allowAutonomous ? 'var(--orange)' : 'var(--text-muted)'};font-size:11px;margin-left:8px">${s.allowAutonomous ? 'autonomous' : 'HITL only'}</span>
              <br/><span style="color:var(--text-muted);font-size:11px">${escHtml(s.statement)}</span>
            </span>
          </div>
        `).join('');
  }
}

// ── Render: Goals (Pillar 5) ──
function renderGoals(resp) {
  const recipes = (resp && resp.recipes) || [];
  safeText('goals-recipes', String(recipes.length));
  const list = byId('goals-list');
  if (list) {
    list.innerHTML = recipes.length === 0
      ? '<div class="empty-state"><div class="empty-icon">•</div><div class="empty-text">No recipes loaded.</div></div>'
      : recipes.map(r => `
          <div class="metric-row" style="border-left:3px solid var(--blue);padding-left:8px">
            <span class="metric-label">
              <strong>${escHtml(r.goal)}</strong>
              <br/><span style="font-size:11px;color:var(--text-muted)">${(r.steps || []).map(s => escHtml(s.workflowId)).join(' → ')}</span>
            </span>
          </div>
        `).join('');
  }
}

// Goal pursuit + governance buttons (idempotent — bind once)
let __goalsBound = false;
function bindGovernanceButtons() {
  if (__goalsBound) return;
  __goalsBound = true;
  const engage = byId('gov-engage');
  const release = byId('gov-release');
  const goalRun = byId('goal-run');
  if (engage) engage.addEventListener('click', async () => {
    const secret = (byId('gov-secret') || { value: '' }).value;
    await fetch(`${BASE}/api/governance/kill`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-scheduled-secret': secret }, body: JSON.stringify({ by: 'mission-control', reason: 'manual' }) });
    fetchAll().catch(() => {});
  });
  if (release) release.addEventListener('click', async () => {
    const secret = (byId('gov-secret') || { value: '' }).value;
    await fetch(`${BASE}/api/governance/release`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-scheduled-secret': secret }, body: JSON.stringify({ by: 'mission-control' }) });
    fetchAll().catch(() => {});
  });
  if (goalRun) goalRun.addEventListener('click', async () => {
    const goal = (byId('goal-input') || { value: '' }).value;
    const secret = (byId('goal-secret') || { value: '' }).value;
    if (!goal) return;
    safeText('goals-status', 'running…');
    try {
      const r = await fetch(`${BASE}/api/goals/pursue`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-scheduled-secret': secret }, body: JSON.stringify({ goal }) });
      const j = await r.json();
      const pre = byId('goals-report'); if (pre) pre.textContent = JSON.stringify(j.report || j, null, 2);
      safeText('goals-status', (j.report && j.report.status) || 'done');
    } catch (e) {
      safeText('goals-status', 'error');
    }
  });
}
bindGovernanceButtons();

// ── Render: Today's Plan ──
function renderTodaysPlan(routines) {
  const routineList = Array.isArray(routines) ? routines : (routines && routines.routines) || [];

  const scheduledCount = routineList.filter(r => (r.status || r.state) === 'scheduled' || r.enabled).length;
  const runningCount = routineList.filter(r => (r.status || r.state) === 'running').length;
  safeText('wd-active', String(runningCount || scheduledCount));
  safeText('wd-total', String(routineList.length));

  // Find workers count from routine data
  const uniqueWorkers = new Set(routineList.map(r => r.worker).filter(Boolean));
  safeText('wd-workers', String(uniqueWorkers.size));

  // Last run
  const lastRuns = routineList.map(r => r.lastRun).filter(Boolean).map(t => new Date(t).getTime());
  safeText('wd-lastrun', lastRuns.length ? timeAgo(new Date(Math.max(...lastRuns)).toISOString()) : '—');

  if (routineList.length === 0) {
    document.getElementById('wd-plan-timeline').innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No routines scheduled. Configure routines to see the plan.</div></div>';
    return;
  }

  // Group routines by time-of-day phases based on cron schedule
  const phases = {
    recurring: { label: 'Recurring (Interval-based)', routines: [] },
    morning: { label: 'Morning (06:00 – 11:59)', routines: [] },
    midday: { label: 'Midday (12:00 – 16:59)', routines: [] },
    'end-of-day': { label: 'End of Day (17:00 – 21:59)', routines: [] },
    overnight: { label: 'Overnight (22:00 – 05:59)', routines: [] },
    weekly: { label: 'Weekly', routines: [] },
    monthly: { label: 'Monthly', routines: [] },
  };

  for (const r of routineList) {
    const cron = r.cron || r.schedule || '';
    const parts = cron.split(/\s+/);
    if (parts.length < 5) { phases.morning.routines.push(r); continue; }
    const [min, hour, dom, , dow] = parts;
    // Interval-based (*/N patterns in min or hour with no specific day)
    if ((min.startsWith('*/') || hour.startsWith('*/')) && dom === '*' && dow === '*') {
      phases.recurring.routines.push(r);
    } else if (dow !== '*' && dom === '*') {
      phases.weekly.routines.push(r);
    } else if (dom !== '*') {
      phases.monthly.routines.push(r);
    } else {
      const h = parseInt(hour, 10);
      if (!isNaN(h)) {
        if (h >= 6 && h < 12) phases.morning.routines.push(r);
        else if (h >= 12 && h < 17) phases.midday.routines.push(r);
        else if (h >= 17 && h < 22) phases['end-of-day'].routines.push(r);
        else phases.overnight.routines.push(r);
      } else {
        // Hourly patterns like 0 * * * *
        phases.recurring.routines.push(r);
      }
    }
  }

  const statusIcons = { pending: '○', running: '◉', completed: '✓', failed: '✗', scheduled: '◎', disabled: '○', idle: '○' };
  const statusColors = { running: 'var(--blue)', completed: 'var(--green)', failed: 'var(--red)', scheduled: 'var(--cyan)', disabled: 'var(--text-dim)' };
  let html = '';
  for (const [key, phase] of Object.entries(phases)) {
    if (phase.routines.length === 0) continue;
    html += `<div class="plan-phase"><div class="plan-phase-header">${phase.label}</div>`;
    for (const r of phase.routines) {
      const name = r.name || r.id || '—';
      const cron = r.cron || r.schedule || '—';
      const status = r.status || r.state || 'idle';
      const worker = r.worker || '—';
      const icon = statusIcons[status] || '○';
      const workerIcon = WORKER_ICONS[worker] || '⚙';
      const color = statusColors[status] || 'var(--text-muted)';
      const summary = r.lastOutputSnippet || '';
      const delivery = r.lastDelivery
        ? [r.lastDelivery.teamsPosted ? 'Teams' : '', r.lastDelivery.emailSent ? 'Email' : '', r.lastDelivery.approvalRaised ? 'Approval' : '']
            .filter(Boolean)
            .join(', ')
        : '';
      html += `<div class="plan-task">
        <div class="plan-task-icon ${status}">${icon}</div>
        <div class="plan-task-body">
          <div class="plan-task-name">${workerIcon} ${escHtml(name)}</div>
          <div class="plan-task-desc">${escHtml(worker)} · ${escHtml(cronToHuman(cron))}${delivery ? ` · ${escHtml(delivery)}` : ''}</div>
          ${summary ? `<div class="plan-task-desc" style="font-size:11px;color:var(--text-muted)">${escHtml(summary)}</div>` : ''}
        </div>
        <div class="plan-task-time" style="color:${color}">${status}</div>
      </div>`;
    }
    html += '</div>';
  }
  document.getElementById('wd-plan-timeline').innerHTML = html;
}

// ── Neural Core: 4-Tier Hierarchical Force-Directed Graph ──
// Tier 0: ITSM Operations (center)
// Tier 1–3: Core / Extended / Strategic Workers (inner ring, size 13)
// Tier 4: Operational Workers (outer ring, size 11)
// Tool nodes hang from their parent worker (outermost, size 4)

const CHILD_AGENTS = [
  { id: 'incident-manager', label: 'Incident Manager', color: '#f85149', tier: 'core',
    tools: ['get_incident','list_incidents','create_incident','update_incident','resolve_incident','escalate_incident'] },
  { id: 'change-manager', label: 'Change Manager', color: '#3fb950', tier: 'core',
    tools: ['get_change_request','list_changes','create_rfc','update_change','approve_change','implement_change','get_cab_agenda','get_change_schedule','close_change'] },
  { id: 'problem-manager', label: 'Problem Manager', color: '#f0883e', tier: 'core',
    tools: ['get_problem','list_problems','create_problem'] },
  { id: 'asset-cmdb-manager', label: 'Asset & CMDB', color: '#58a6ff', tier: 'core',
    tools: ['get_asset','list_assets','get_cmdb_ci','list_cmdb_cis','create_asset','update_asset','get_asset_relationships','check_asset_eol'] },
  { id: 'sla-manager', label: 'SLA Manager', color: '#e3b341', tier: 'core',
    tools: ['get_sla_status'] },
  { id: 'knowledge-manager', label: 'Knowledge Manager', color: '#79c0ff', tier: 'core',
    tools: ['search_knowledge_base','create_kb_article'] },
  { id: 'vendor-manager', label: 'Vendor Manager', color: '#8b949e', tier: 'core',
    tools: ['get_vendor_contract','get_license_status'] },
  { id: 'service-desk-manager', label: 'Service Desk', color: '#bc8cff', tier: 'extended',
    tools: ['get_service_catalog','create_service_request','get_ticket_status'] },
  { id: 'monitoring-manager', label: 'Monitoring', color: '#d2a8ff', tier: 'extended',
    tools: ['get_monitoring_dashboard','get_event_summary','acknowledge_alert'] },
  { id: 'release-manager', label: 'Release Manager', color: '#56d364', tier: 'extended',
    tools: ['get_release_schedule','deploy_release'] },
  { id: 'capacity-manager', label: 'Capacity Manager', color: '#79c0ff', tier: 'strategic',
    tools: ['get_capacity_report','forecast_capacity'] },
  { id: 'continuity-manager', label: 'Continuity Manager', color: '#f778ba', tier: 'strategic',
    tools: ['get_dr_status','run_dr_test'] },
  { id: 'security-manager', label: 'Security Manager', color: '#f778ba', tier: 'strategic',
    tools: ['get_security_posture','get_vulnerability_report'] },
  { id: 'request-fulfilment-manager', label: 'Request Fulfilment', color: '#79c0ff', tier: 'operational',
    tools: ['get_service_request','list_service_requests','fulfil_request','escalate_request'] },
  { id: 'catalogue-manager', label: 'Service Catalogue', color: '#79c0ff', tier: 'operational',
    tools: ['get_catalogue_item','list_catalogue','update_catalogue_item'] },
  { id: 'risk-manager', label: 'Risk Manager', color: '#79c0ff', tier: 'operational',
    tools: ['get_risk_register','assess_risk','mitigate_risk'] },
  { id: 'deployment-manager', label: 'Deployment Manager', color: '#79c0ff', tier: 'operational',
    tools: ['get_deployment_plan','execute_deployment','rollback_deployment'] },
  { id: 'availability-manager', label: 'Availability Manager', color: '#79c0ff', tier: 'operational',
    tools: ['get_availability_report','get_uptime_sla','plan_maintenance_window'] },
  { id: 'reporting-manager', label: 'Measurement & Reporting', color: '#79c0ff', tier: 'operational',
    tools: ['generate_kpi_report','get_dashboard_metrics','schedule_report'] },
  { id: 'relationship-manager', label: 'Relationship Manager', color: '#79c0ff', tier: 'operational',
    tools: ['get_stakeholder_map','log_interaction','get_satisfaction_survey'] },
  { id: 'finops-manager', label: 'FinOps Manager', color: '#79c0ff', tier: 'operational',
    tools: ['get_cost_report','forecast_budget','optimize_spend'] },
  { id: 'continuous-improvement-manager', label: 'Continuous Improvement', color: '#79c0ff', tier: 'operational',
    tools: ['get_csi_register','create_improvement','track_improvement'] },
];

const GRAPH_TIER_COLORS = { core: '#58a6ff', extended: '#bc8cff', strategic: '#f778ba', operational: '#79c0ff' };

function initGraph() {
  graphInitialized = true;
  const canvas = document.getElementById('graph-canvas');
  const container = canvas.parentElement;
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2;

  // Tier 0: Center node — ITSM Operations parent
  graphNodes = [{ id: '__center__', label: 'ITSM Operations', group: 'Orchestrator', color: '#f0883e', x: cx, y: cy, vx: 0, vy: 0, size: 26, fixed: true, calls: 0, tier: 'center' }];

  // Build legend showing tiers
  const legend = document.getElementById('graph-legend');
  legend.innerHTML = [
    '<div class="legend-item"><div class="legend-dot" style="background:#f0883e"></div>Orchestrator</div>',
    '<div class="legend-item"><div class="legend-dot" style="background:#58a6ff"></div>Core (Tier 1)</div>',
    '<div class="legend-item"><div class="legend-dot" style="background:#bc8cff"></div>Extended (Tier 2)</div>',
    '<div class="legend-item"><div class="legend-dot" style="background:#f778ba"></div>Strategic (Tier 3)</div>',
    '<div class="legend-item"><div class="legend-dot" style="background:#79c0ff"></div>Operational (Tier 4)</div>',
    '<div class="legend-item"><div class="legend-dot" style="background:rgba(200,200,200,0.5);width:6px;height:6px"></div>Tools</div>',
  ].join('');

  // Separate agents into inner ring (core/extended/strategic) and outer ring (operational)
  const innerAgents = CHILD_AGENTS.filter(a => a.tier !== 'operational');
  const outerAgents = CHILD_AGENTS.filter(a => a.tier === 'operational');

  // Inner ring: Core, Extended, Strategic workers
  const innerRadius = 180;
  innerAgents.forEach((agent, i) => {
    const angle = (i / innerAgents.length) * Math.PI * 2 - Math.PI / 2;
    graphNodes.push({
      id: agent.id, label: agent.label, group: agent.tier, color: agent.color,
      x: cx + Math.cos(angle) * innerRadius, y: cy + Math.sin(angle) * innerRadius,
      vx: 0, vy: 0, size: 13, fixed: false, calls: 0, tier: 'agent',
      parentId: '__center__',
    });
    graphEdges.push({ source: '__center__', target: agent.id, type: 'delegation' });

    // Tools hanging from each inner agent
    const toolRadius = 80 + agent.tools.length * 4;
    agent.tools.forEach((tool, j) => {
      const toolAngle = angle + ((j - (agent.tools.length - 1) / 2) * 0.25);
      const dist = innerRadius + toolRadius;
      graphNodes.push({
        id: tool, label: tool.replace(/^get_/, '').replace(/_/g, ' '),
        group: agent.tier, color: agent.color,
        x: cx + Math.cos(toolAngle) * dist, y: cy + Math.sin(toolAngle) * dist,
        vx: 0, vy: 0, size: 4, fixed: false, calls: 0, tier: 'tool',
        parentId: agent.id,
      });
      graphEdges.push({ source: agent.id, target: tool, type: 'tool' });
    });
  });

  // Outer ring: Operational (Tier 4) workers
  const outerRadius = 320;
  // Cross-references: operational workers connect to related inner workers
  const operationalLinks = {
    'request-fulfilment-manager': ['service-desk-manager'],
    'catalogue-manager': ['service-desk-manager', 'knowledge-manager'],
    'risk-manager': ['security-manager', 'continuity-manager'],
    'deployment-manager': ['release-manager', 'change-manager'],
    'availability-manager': ['monitoring-manager', 'sla-manager'],
    'reporting-manager': ['sla-manager', 'capacity-manager'],
    'relationship-manager': ['vendor-manager', 'service-desk-manager'],
    'finops-manager': ['capacity-manager', 'vendor-manager'],
    'continuous-improvement-manager': ['problem-manager', 'knowledge-manager'],
  };
  outerAgents.forEach((agent, i) => {
    const angle = (i / outerAgents.length) * Math.PI * 2 - Math.PI / 2;
    graphNodes.push({
      id: agent.id, label: agent.label, group: agent.tier, color: agent.color,
      x: cx + Math.cos(angle) * outerRadius, y: cy + Math.sin(angle) * outerRadius,
      vx: 0, vy: 0, size: 11, fixed: false, calls: 0, tier: 'agent',
      parentId: '__center__',
    });
    graphEdges.push({ source: '__center__', target: agent.id, type: 'delegation' });

    // Cross-links to related inner workers
    const links = operationalLinks[agent.id] || [];
    for (const linked of links) {
      graphEdges.push({ source: linked, target: agent.id, type: 'collaboration' });
    }

    // Tools hanging from each outer agent
    const toolRadius = 60 + agent.tools.length * 4;
    agent.tools.forEach((tool, j) => {
      const toolAngle = angle + ((j - (agent.tools.length - 1) / 2) * 0.22);
      const dist = outerRadius + toolRadius;
      graphNodes.push({
        id: tool, label: tool.replace(/^get_/, '').replace(/_/g, ' '),
        group: agent.tier, color: agent.color,
        x: cx + Math.cos(toolAngle) * dist, y: cy + Math.sin(toolAngle) * dist,
        vx: 0, vy: 0, size: 4, fixed: false, calls: 0, tier: 'tool',
        parentId: agent.id,
      });
      graphEdges.push({ source: agent.id, target: tool, type: 'tool' });
    });
  });

  const agentRadius = outerRadius;

  // Shared tools (communications) — connect to center
  const sharedTools = ['send_email','post_to_teams_channel','generate_briefing'];
  sharedTools.forEach((tool, i) => {
    const angle = Math.PI + ((i - 1) * 0.4);
    graphNodes.push({
      id: tool, label: tool.replace(/^(send_|post_to_|generate_)/, '').replace(/_/g, ' '),
      group: 'shared', color: '#e3b341',
      x: cx + Math.cos(angle) * (agentRadius + 100), y: cy + Math.sin(angle) * (agentRadius + 100),
      vx: 0, vy: 0, size: 4, fixed: false, calls: 0, tier: 'tool',
      parentId: '__center__',
    });
    graphEdges.push({ source: '__center__', target: tool, type: 'shared' });
  });

  // ── Pulse Particles ──
  const particles = [];
  const PARTICLE_SPEED = 0.008;
  const MAX_PARTICLES = 100;

  function spawnParticle() {
    if (particles.length >= MAX_PARTICLES) return;
    const edge = graphEdges[Math.floor(Math.random() * graphEdges.length)];
    if (!edge) return;
    const outward = Math.random() > 0.3;
    particles.push({
      edge, progress: 0,
      speed: PARTICLE_SPEED + Math.random() * 0.006,
      outward,
      size: edge.type === 'delegation' ? 2.5 + Math.random() * 1.5 : 1 + Math.random() * 1.5,
      opacity: 0.5 + Math.random() * 0.5,
    });
  }

  for (let i = 0; i < 30; i++) spawnParticle();
  setInterval(() => { for (let i = 0; i < 3; i++) spawnParticle(); }, 200);
  window._graphParticles = particles;

  // Animation loop
  function animate() {
    if (!document.getElementById('view-neural-core').classList.contains('active')) { requestAnimationFrame(animate); return; }
    if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
      canvas.width = container.clientWidth; canvas.height = container.clientHeight;
      graphNodes[0].x = canvas.width / 2; graphNodes[0].y = canvas.height / 2;
    }
    const W = canvas.width, H = canvas.height;

    // Physics — repulsion between all nodes
    for (let i = 0; i < graphNodes.length; i++) {
      if (graphNodes[i].fixed) continue;
      for (let j = i + 1; j < graphNodes.length; j++) {
        const a = graphNodes[i], b = graphNodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Stronger repulsion between same-tier nodes to prevent overlap
        const sameTier = a.tier === b.tier;
        const repel = (sameTier ? 1200 : 600) / (dist * dist);
        if (!a.fixed) { a.vx -= dx / dist * repel; a.vy -= dy / dist * repel; }
        if (!b.fixed) { b.vx += dx / dist * repel; b.vy += dy / dist * repel; }
      }
    }
    // Spring forces along edges — hierarchical ideal distances
    for (const e of graphEdges) {
      const s = graphNodes.find(n => n.id === e.source), t = graphNodes.find(n => n.id === e.target);
      if (!s || !t) continue;
      let dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = e.type === 'delegation' ? 180 : e.type === 'shared' ? 200 : e.type === 'collaboration' ? 160 : 80;
      const stiffness = e.type === 'delegation' ? 0.008 : e.type === 'collaboration' ? 0.004 : 0.006;
      const force = (dist - ideal) * stiffness;
      if (!s.fixed) { s.vx += dx / dist * force; s.vy += dy / dist * force; }
      if (!t.fixed) { t.vx -= dx / dist * force; t.vy -= dy / dist * force; }
    }
    // Center gravity + damping
    for (const n of graphNodes) {
      if (n.fixed) continue;
      n.vx += (W / 2 - n.x) * 0.0003;
      n.vy += (H / 2 - n.y) * 0.0003;
      n.vx *= 0.90; n.vy *= 0.90;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(40, Math.min(W - 40, n.x));
      n.y = Math.max(40, Math.min(H - 40, n.y));
    }

    // Draw
    ctx.clearRect(0, 0, W, H);

    // Edges — different styles per type
    for (const e of graphEdges) {
      const s = graphNodes.find(n => n.id === e.source), t = graphNodes.find(n => n.id === e.target);
      if (!s || !t) continue;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
      if (e.type === 'delegation') {
        ctx.strokeStyle = 'rgba(240,136,62,0.4)';
        ctx.lineWidth = 2;
      } else if (e.type === 'shared') {
        ctx.strokeStyle = 'rgba(227,179,65,0.3)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
      } else if (e.type === 'collaboration') {
        ctx.strokeStyle = 'rgba(121,192,255,0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
      } else {
        ctx.strokeStyle = `${t.color || s.color}33`;
        ctx.lineWidth = 0.8;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Pulse particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.progress += p.speed;
      if (p.progress >= 1) { particles.splice(i, 1); continue; }
      const s = graphNodes.find(n => n.id === p.edge.source);
      const t = graphNodes.find(n => n.id === p.edge.target);
      if (!s || !t) { particles.splice(i, 1); continue; }
      const from = p.outward ? s : t, to = p.outward ? t : s;
      const px = from.x + (to.x - from.x) * p.progress;
      const py = from.y + (to.y - from.y) * p.progress;
      const fadeIn = Math.min(p.progress * 5, 1);
      const fadeOut = Math.min((1 - p.progress) * 5, 1);
      const alpha = p.opacity * fadeIn * fadeOut;
      const pColor = to.color || '#f0883e';
      ctx.beginPath(); ctx.arc(px, py, p.size + 3, 0, Math.PI * 2);
      const trailGlow = ctx.createRadialGradient(px, py, 0, px, py, p.size + 3);
      trailGlow.addColorStop(0, pColor + Math.round(alpha * 60).toString(16).padStart(2, '0'));
      trailGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = trailGlow; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fillStyle = pColor;
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Nodes — tier-aware sizing and rendering
    for (const n of graphNodes) {
      const sz = n.size + (n.calls > 0 ? Math.min(n.calls * 0.3, 6) : 0);
      // Glow for center and agents
      if (n.tier === 'center' || n.tier === 'agent') {
        ctx.beginPath(); ctx.arc(n.x, n.y, sz + 8, 0, Math.PI * 2);
        const glow = ctx.createRadialGradient(n.x, n.y, sz, n.x, n.y, sz + 8);
        glow.addColorStop(0, n.color + '30'); glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow; ctx.fill();
      }
      // Node circle
      ctx.beginPath(); ctx.arc(n.x, n.y, sz, 0, Math.PI * 2);
      ctx.fillStyle = n.tier === 'tool' ? n.color + 'aa' : n.color;
      ctx.fill();
      // Ring outline for agents
      if (n.tier === 'agent') {
        ctx.beginPath(); ctx.arc(n.x, n.y, sz + 1, 0, Math.PI * 2);
        ctx.strokeStyle = n.color; ctx.lineWidth = 1.5; ctx.stroke();
      }
      // Label
      ctx.fillStyle = n.tier === 'tool' ? '#6e7681' : '#c9d1d9';
      const fontSize = n.tier === 'center' ? 12 : n.tier === 'agent' ? 10 : 8;
      ctx.font = `${n.tier !== 'tool' ? 'bold ' : ''}${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + sz + (n.tier === 'tool' ? 10 : 16));
    }
    requestAnimationFrame(animate);
  }
  animate();
}

function updateGraph(workers) {
  if (!graphInitialized || !workers) return;
  const workerList = Array.isArray(workers) ? workers : (workers.workers || []);
  for (const w of workerList) {
    // Update agent node with tool count
    const agentNode = graphNodes.find(n => n.id === w.id && n.tier === 'agent');
    if (agentNode) {
      const newCount = w.toolCount || 0;
      if (newCount > agentNode.calls && window._graphParticles) {
        // Spawn particles on delegation edge
        const delegationEdge = graphEdges.find(e => e.target === w.id && e.type === 'delegation');
        if (delegationEdge) {
          for (let i = 0; i < Math.min(newCount - agentNode.calls, 3); i++) {
            window._graphParticles.push({
              edge: delegationEdge, progress: Math.random() * 0.2,
              speed: 0.01 + Math.random() * 0.008, outward: true,
              size: 2.5 + Math.random() * 1.5, opacity: 0.8 + Math.random() * 0.2,
            });
          }
        }
      }
      agentNode.calls = newCount;
    }
  }
}

// ÔöÇÔöÇ Boot ÔöÇÔöÇ
addFeed('Mission Control connected', 'system');
fetchAll().catch(() => {
  document.getElementById('health-badge').textContent = 'Offline';
  document.getElementById('health-badge').className = 'health-badge unhealthy';
  addFeed('Connection failed ÔÇö retrying in 10s', 'system');
});
setInterval(() => fetchAll().catch(() => {}), 10000);

// ÔöÇÔöÇ Topbar quick actions ÔöÇÔöÇ
async function postJson(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`${r.status} ${r.statusText} ${txt}`);
  }
  return r.json();
}

const btnStorm = byId('cc-btn-storm');
if (btnStorm) {
  btnStorm.addEventListener('click', async () => {
    btnStorm.disabled = true;
    const orig = btnStorm.textContent;
    btnStorm.textContent = 'ÔÅ│ injectingÔÇª';
    try {
      // live:true -> every signal carries forceMode='auto', so trigger-policy
      // bypasses confidence thresholds and the workflows run for real (not
      // dry-run). The endpoint also posts an announcement to ITSM-Alerts.
      const out = await postJson('/api/demo/scripted-storm', { live: true });
      const annDelivered = (out.announcement && out.announcement.delivered) || [];
      const channels = annDelivered.length ? ` ┬À announce ÔåÆ ${annDelivered.join(' + ')}` : '';
      addFeed(`­ƒÄ¼ demo storm injected (LIVE) ÔÇö ${out.signalsInjected || 0} signals${channels}`, 'demo');
    } catch (err) {
      addFeed(`­ƒÄ¼ demo storm failed ÔÇö ${err.message}`, 'demo');
    } finally {
      btnStorm.disabled = false;
      btnStorm.textContent = orig;
    }
  });
}

const btnPageMe = byId('cc-btn-pageme');
if (btnPageMe) {
  btnPageMe.addEventListener('click', async () => {
    btnPageMe.disabled = true;
    const orig = btnPageMe.textContent;
    btnPageMe.textContent = 'ÔÅ│ pagingÔÇª';
    try {
      const reason = prompt('Reason for the page?', 'Alex needs you on the bridge ÔÇö major incident in progress');
      if (reason === null) { btnPageMe.disabled = false; btnPageMe.textContent = orig; return; }
      // notify:false -> call-only mode. Endpoint will ONLY ring the user's
      // Teams client and surface ACS failures verbatim (HTTP 502) instead
      // of falling back to email/Teams chat.
      let out;
      try {
        out = await postJson('/api/voice/page-me', { reason, notify: false });
      } catch (httpErr) {
        // postJson throws on non-2xx ÔÇö recover the body for diagnostics so
        // the operator sees the real ACS error (e.g. tenant federation 403).
        const r = await fetch('/api/voice/page-me', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, notify: false }),
        });
        out = await r.json().catch(() => ({ status: 'failed', errors: { http: r.status + ' ' + r.statusText } }));
      }

      if (out.status === 'calling') {
        addFeed(`\ud83d\udcde Alex is calling you on Teams now (id ${(out.acsCallConnectionId || '').slice(0,8)})`, 'alex');
      } else if (out.status === 'failed') {
        const acsErr = (out.errors && out.errors.acsCall) || 'unknown ACS error';
        addFeed(`\ud83d\udcde page failed \u2014 ${acsErr}`, 'alex');
        if (out.hint) addFeed(`\ud83d\udca1 ${out.hint}`, 'alex');
        if (out.teamsCallUrl) {
          addFeed(`\ud83d\udcde fallback: opening Teams click-to-call`, 'alex');
          window.open(out.teamsCallUrl, '_blank', 'noopener');
        }
      } else if (out.status === 'sent') {
        const channels = (out.delivered || []).join(' + ') || 'voice-link';
        addFeed(`\ud83d\udcde Alex paged you via ${channels}`, 'alex');
      } else if (out.status === 'call-only' && out.teamsCallUrl) {
        addFeed(`\ud83d\udcde Opening Teams to call you`, 'alex');
        window.open(out.teamsCallUrl, '_blank', 'noopener');
      } else if (out.status === 'voice-only' && out.voiceUrl) {
        addFeed(`\ud83d\udcde no Teams/email delivery available \u2014 opening voice line`, 'alex');
        window.open(out.voiceUrl, '_blank', 'noopener');
      } else {
        addFeed(`\ud83d\udcde page status: ${out.status || 'unknown'}`, 'alex');
      }
    } catch (err) {
      addFeed(`­ƒô× page failed ÔÇö ${err.message}`, 'alex');
    } finally {
      btnPageMe.disabled = false;
      btnPageMe.textContent = orig;
    }
  });
}

// ── Phase 2.5 — Operator Console (Cases / Trust / Shift handover / Meta-monitor / A2A audit) ──
async function loadOperatorConsole() {
  const [casesR, trustR, briefR, metaR, a2aR, agentsR] = await Promise.allSettled([
    fetch(`${BASE}/api/cases`).then(r => r.json()).catch(() => ({ cases: [] })),
    fetch(`${BASE}/api/trust/score`).then(r => r.json()).catch(() => ({ available: false })),
    fetch(`${BASE}/api/briefings/recent`).then(r => r.json()).catch(() => ({ briefings: [] })),
    fetch(`${BASE}/api/meta/alerts`).then(r => r.json()).catch(() => ({ alerts: [] })),
    fetch(`${BASE}/api/a2a/kpi`).then(r => r.json()).catch(() => ({})),
    fetch(`${BASE}/api/audit?limit=50`).then(r => r.json()).catch(() => ({ items: [] })),
  ]);
  renderOpCases(casesR.status === 'fulfilled' ? casesR.value : { cases: [] });
  renderOpTrust(trustR.status === 'fulfilled' ? trustR.value : { available: false });
  renderOpHandover(briefR.status === 'fulfilled' ? briefR.value : { briefings: [] });
  renderOpMeta(metaR.status === 'fulfilled' ? metaR.value : { alerts: [] });
  renderOpA2A(
    a2aR.status === 'fulfilled' ? a2aR.value : {},
    agentsR.status === 'fulfilled' ? agentsR.value : { items: [] },
  );
}

function escapeHtmlOp(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOpCases(payload) {
  const cases = (payload && payload.cases) || [];
  byId('op-cases-count').textContent = cases.length;
  const stateSel = byId('op-cases-filter-state');
  const sevSel = byId('op-cases-filter-severity');
  const assigneeIn = byId('op-cases-filter-assignee');
  const states = Array.from(new Set(cases.map(c => c.state).filter(Boolean))).sort();
  const sevs = Array.from(new Set(cases.map(c => c.severity || c.priority).filter(Boolean))).sort();
  if (stateSel.options.length === 1) {
    for (const s of states) { const o = document.createElement('option'); o.value = s; o.textContent = s; stateSel.appendChild(o); }
  }
  if (sevSel.options.length === 1) {
    for (const s of sevs) { const o = document.createElement('option'); o.value = s; o.textContent = s; sevSel.appendChild(o); }
  }
  const apply = () => {
    const fState = stateSel.value;
    const fSev = sevSel.value;
    const fAssignee = (assigneeIn.value || '').toLowerCase().trim();
    const filtered = cases.filter(c => {
      if (fState && c.state !== fState) return false;
      if (fSev && (c.severity || c.priority) !== fSev) return false;
      if (fAssignee && !String(c.ownerWorkerId || c.assignee || '').toLowerCase().includes(fAssignee)) return false;
      return true;
    });
    const list = byId('op-cases-list');
    if (!filtered.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-text">No cases match.</div></div>';
      return;
    }
    list.innerHTML = filtered.slice(0, 50).map(c => {
      const id = c.id || c.caseId || '';
      const state = c.state || '—';
      const sev = c.severity || c.priority || '—';
      const owner = c.ownerWorkerId || c.assignee || 'unassigned';
      const subj = c.subjectRef || c.subject || c.title || '';
      return '<div style="display:grid;grid-template-columns:140px 100px 90px 1fr 160px;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">'
        + '<div style="font-family:\'JetBrains Mono\',monospace;color:var(--blue)">' + escapeHtmlOp(id) + '</div>'
        + '<div><span class="evt-badge" style="background:var(--bg-darker);color:var(--text-muted)">' + escapeHtmlOp(state) + '</span></div>'
        + '<div style="color:var(--orange)">' + escapeHtmlOp(sev) + '</div>'
        + '<div style="color:var(--text-muted)">' + escapeHtmlOp(String(subj).slice(0,80)) + '</div>'
        + '<div style="color:var(--text-dim);text-align:right">' + escapeHtmlOp(owner) + '</div>'
        + '</div>';
    }).join('');
  };
  stateSel.onchange = apply;
  sevSel.onchange = apply;
  assigneeIn.oninput = apply;
  apply();
}

function renderOpTrust(payload) {
  const body = byId('op-trust-body');
  if (!payload || payload.available === false) {
    const reason = (payload && payload.reason) || 'awaiting first run';
    body.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px">'
      + '<div style="font-size:24px;font-weight:700;color:var(--text-muted)">—</div>'
      + '<span class="evt-badge" style="background:var(--bg-darker);color:var(--orange);align-self:flex-start">PENDING</span>'
      + '<div style="font-size:11px;color:var(--text-muted);margin-top:6px">' + escapeHtmlOp(reason) + '</div>'
      + '</div>';
    return;
  }
  const score = Number(payload.score || 0);
  const color = score >= 80 ? 'var(--green)' : (score >= 60 ? 'var(--orange)' : 'var(--red)');
  const sparkline = (payload.sparkline || []).slice(-7);
  const max = Math.max(100, ...sparkline);
  const bars = sparkline.map(v => '<div style="flex:1;background:' + color + ';opacity:0.7;height:' + Math.round((v/max)*40) + 'px;border-radius:2px 2px 0 0"></div>').join('');
  const last = payload.lastRunAt ? new Date(payload.lastRunAt).toLocaleString() : 'n/a';
  body.innerHTML = '<div style="font-size:32px;font-weight:700;color:' + color + '">' + score + '</div>'
    + '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">AlexTrustScore</div>'
    + '<div style="display:flex;gap:3px;height:42px;align-items:flex-end;margin:8px 0">' + (bars || '<span style="font-size:11px;color:var(--text-dim)">no history</span>') + '</div>'
    + '<div style="font-size:11px;color:var(--text-muted)">Last red-team run: ' + escapeHtmlOp(last) + '</div>';
}

function renderOpHandover(payload) {
  const briefings = (payload && payload.briefings) || [];
  byId('op-handover-count').textContent = briefings.length;
  const list = byId('op-handover-list');
  if (!briefings.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No briefings captured yet. Click "Generate handover now" or wait for the scheduled run.</div></div>';
    return;
  }
  list.innerHTML = briefings.map(b => {
    const when = new Date(b.generatedAt).toLocaleString();
    const kindColor = b.kind === 'handover' ? 'var(--blue)' : 'var(--orange)';
    return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">'
      + '<span class="evt-badge" style="background:' + kindColor + ';color:#fff">' + escapeHtmlOp(b.kind) + '</span>'
      + '<span style="font-size:11px;color:var(--text-muted)">' + escapeHtmlOp(when) + '</span>'
      + '</div>'
      + '<pre style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:var(--text-muted);white-space:pre-wrap;margin:6px 0 0;max-height:120px;overflow-y:auto">' + escapeHtmlOp(String(b.summary || '').slice(0, 800)) + '</pre>'
      + '</div>';
  }).join('');
}

function renderOpMeta(payload) {
  const alerts = (payload && payload.alerts) || [];
  const body = byId('op-meta-body');
  if (!alerts.length) {
    body.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px">'
      + '<span class="evt-badge" style="background:var(--green);color:#fff;align-self:flex-start">BASELINE OK</span>'
      + '<div style="font-size:11px;color:var(--text-muted);margin-top:6px">No recent alerts.</div>'
      + '</div>';
    return;
  }
  body.innerHTML = '<span class="evt-badge" style="background:var(--orange);color:#fff">' + alerts.length + ' ALERTS</span>'
    + '<div style="margin-top:10px;max-height:200px;overflow-y:auto">'
    + alerts.slice(0, 10).map(a => {
        const when = a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : '—';
        return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:11px">'
          + '<div style="color:var(--orange);font-weight:600">' + escapeHtmlOp(a.kind || a.metric || 'alert') + '</div>'
          + '<div style="color:var(--text-muted)">' + escapeHtmlOp(String(a.message || a.details || '').slice(0, 120)) + '</div>'
          + '<div style="color:var(--text-dim);font-size:10px">' + escapeHtmlOp(when) + '</div>'
          + '</div>';
    }).join('') + '</div>';
}

function renderOpA2A(kpi, audit) {
  const body = byId('op-a2a-body');
  const items = (audit && audit.items) || [];
  const a2aRows = items.filter(it => {
    const path = String(it.path || it.action || '').toLowerCase();
    return path.includes('a2a') || it.fromAgent || it.attributedTo;
  }).slice(0, 30);
  const inbound = (kpi && kpi.inbound) || (kpi && kpi.totalInbound) || 0;
  const allowed = (kpi && kpi.allowed) || 0;
  const blocked = (kpi && kpi.blocked) || 0;
  const header = '<div style="display:flex;gap:16px;margin-bottom:10px">'
    + '<div><div style="font-size:18px;font-weight:700;color:var(--cyan)">' + inbound + '</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Inbound</div></div>'
    + '<div><div style="font-size:18px;font-weight:700;color:var(--green)">' + allowed + '</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Allowed</div></div>'
    + '<div><div style="font-size:18px;font-weight:700;color:var(--red)">' + blocked + '</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Blocked</div></div>'
    + '</div>';
  if (!a2aRows.length) {
    body.innerHTML = header + '<div class="empty-state"><div class="empty-text">No A2A traffic in audit window.</div></div>';
    return;
  }
  body.innerHTML = header
    + '<table class="event-table" style="width:100%">'
    + '<thead><tr><th>Time</th><th>Action</th><th>Attributed To</th><th>Result</th></tr></thead>'
    + '<tbody>' + a2aRows.map(r => {
        const when = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '—';
        const action = String(r.path || r.action || '—').slice(0, 60);
        const attrib = String(r.fromAgent || r.attributedTo || r.actor || 'unknown');
        const result = String(r.result || r.status || '—');
        const resultColor = /allow|ok|success/i.test(result) ? 'var(--green)' : (/block|deny|fail/i.test(result) ? 'var(--red)' : 'var(--text-muted)');
        return '<tr>'
          + '<td style="color:var(--text-dim);font-size:10px">' + escapeHtmlOp(when) + '</td>'
          + '<td style="font-family:\'JetBrains Mono\',monospace;font-size:11px">' + escapeHtmlOp(action) + '</td>'
          + '<td style="color:var(--cyan);font-size:11px">' + escapeHtmlOp(attrib) + '</td>'
          + '<td style="color:' + resultColor + ';font-size:11px">' + escapeHtmlOp(result) + '</td>'
          + '</tr>';
    }).join('') + '</tbody></table>';
}

// ── Operator Console — manual briefing trigger ──
async function triggerBriefing(kind) {
  const secret = byId('op-handover-secret').value || '';
  if (!secret) {
    byId('op-handover-status').textContent = 'shared secret required';
    return;
  }
  byId('op-handover-status').textContent = 'requesting ' + kind + '…';
  try {
    const r = await fetch(`${BASE}/api/briefings/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-scheduled-secret': secret },
      body: JSON.stringify({ kind })
    });
    if (!r.ok) {
      byId('op-handover-status').textContent = kind + ' failed: ' + r.status + ' ' + r.statusText;
      addFeed('📋 ' + kind + ' request failed — ' + r.status, 'system');
      return;
    }
    byId('op-handover-status').textContent = kind + ' dispatched — refreshing in 3s';
    addFeed('📋 manual ' + kind + ' requested', 'system');
    setTimeout(() => loadOperatorConsole(), 3000);
  } catch (err) {
    byId('op-handover-status').textContent = 'error: ' + err.message;
  }
}
const btnHandoverGen = byId('op-handover-generate');
if (btnHandoverGen) btnHandoverGen.addEventListener('click', () => triggerBriefing('handover'));
const btnMidshiftGen = byId('op-midshift-generate');
if (btnMidshiftGen) btnMidshiftGen.addEventListener('click', () => triggerBriefing('midshift'));
