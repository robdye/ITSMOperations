/**
 * Fluent UI System Icons — inline SVG constants library.
 *
 * All icons are 16-px viewBox, currentColor stroke/fill, no external refs.
 * Used by build.mjs to inline `{{icon:name}}` tokens in widget HTML files
 * and by adaptive-card renderers that emit SVG data URIs.
 *
 * Source: https://github.com/microsoft/fluentui-system-icons (Apache-2.0)
 * Each glyph is hand-traced from the Regular 16-px family for self-containment.
 *
 * Usage in HTML widget:
 *   <span class="icon">{{icon:incident}}</span>
 *
 * Usage in TypeScript:
 *   import { ICONS } from "./_icons.mjs";
 *   const svg = ICONS.incident;
 */

export const ICONS = {
  // Status / severity
  incident: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.75 1.5 13.25h13L8 1.75z"/><path d="M8 6v3"/><circle cx="8" cy="11.2" r=".7" fill="currentColor" stroke="none"/></svg>',
  problem: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M6.2 6c.2-.9 1-1.5 1.9-1.5 1.1 0 1.9.9 1.9 1.9 0 1-.7 1.4-1.4 1.8-.5.3-.6.6-.6 1.1"/><circle cx="8" cy="11.4" r=".6" fill="currentColor" stroke="none"/></svg>',
  change: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h8l-2-2"/><path d="M13 11H5l2 2"/></svg>',
  sla: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l2.5 2"/></svg>',
  // Navigation / workflow
  approve: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.2 6.5 11.7 13 4.5"/></svg>',
  reject: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  pending: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><circle cx="5" cy="8" r=".7" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".7" fill="currentColor" stroke="none"/><circle cx="11" cy="8" r=".7" fill="currentColor" stroke="none"/></svg>',
  // Concepts
  bridge: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 11h12M3.5 11V7M12.5 11V7M6 11V8M10 11V8M2 7c0-2.5 2.5-3 6-3s6 .5 6 3"/></svg>',
  heatmap: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="1.5" width="4" height="4" rx="0.5"/><rect x="6.5" y="1.5" width="4" height="4" rx="0.5"/><rect x="11.5" y="1.5" width="3" height="4" rx="0.5"/><rect x="1.5" y="6.5" width="4" height="4" rx="0.5"/><rect x="6.5" y="6.5" width="4" height="4" rx="0.5"/><rect x="11.5" y="6.5" width="3" height="4" rx="0.5"/><rect x="1.5" y="11.5" width="4" height="3" rx="0.5"/><rect x="6.5" y="11.5" width="4" height="3" rx="0.5"/><rect x="11.5" y="11.5" width="3" height="3" rx="0.5"/></svg>',
  timetravel: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 1.5"/><path d="M2.4 6 5 6.5"/></svg>',
  collision: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l3 3-3 3"/><path d="M13 3l-3 3 3 3"/><path d="M6 10h8"/><path d="M2 6h8"/></svg>',
  cab: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M1.5 6h13M5 1.5v3M11 1.5v3"/></svg>',
  story: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M5 6.5h6M5 9h6M5 11.5h4"/></svg>',
  // KPI / state
  arrowUp: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4"/></svg>',
  arrowDown: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v10M4 9l4 4 4-4"/></svg>',
  arrowRight: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  warning: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.75 1.5 13.25h13L8 1.75z"/><path d="M8 6v3"/><circle cx="8" cy="11.2" r=".7" fill="currentColor" stroke="none"/></svg>',
  shield: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5 2.5 3.5v4.2c0 3 2.3 5.6 5.5 6.7 3.2-1.1 5.5-3.7 5.5-6.7V3.5L8 1.5z"/></svg>',
  spark: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1"/></svg>',
  // Misc
  printer: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="10" height="6" rx="1"/><path d="M5 6V2.5h6V6M5 12v2h6v-2"/><circle cx="11" cy="8" r=".6" fill="currentColor" stroke="none"/></svg>',
  link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5l3-3M9 5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L12.5 8.5M7 11.5 5.5 13a2.5 2.5 0 0 1-3.5-3.5L3.5 8"/></svg>',
  filter: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h12l-4.5 6V14l-3-1.5V9L2 3z"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 6a5.5 5.5 0 1 0 .5 4"/><path d="M14 1.5V6h-4.5"/></svg>',
  bell: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 11.5h9c-1-1-1.5-2-1.5-3.5V6.5a3 3 0 0 0-6 0V8c0 1.5-.5 2.5-1.5 3.5z"/><path d="M6.5 13.5a1.5 1.5 0 0 0 3 0"/></svg>',
  empty: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" opacity=".55"><circle cx="8" cy="8" r="6"/><path d="M5.5 9.5c.7-.7 1.7-1 2.5-1s1.8.3 2.5 1"/><circle cx="6" cy="6.5" r=".6" fill="currentColor" stroke="none"/><circle cx="10" cy="6.5" r=".6" fill="currentColor" stroke="none"/></svg>',
};

/** Wordmark used in widget header (4px brand bar above + "ITSM Operations" wordmark). */
export const WORDMARK_SVG = '<svg viewBox="0 0 110 14" aria-hidden="true" style="height:12px"><text x="0" y="11" font-family="Segoe UI,system-ui,sans-serif" font-size="11" font-weight="700" fill="currentColor">ITSM Operations</text></svg>';
