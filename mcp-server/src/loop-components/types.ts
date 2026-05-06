// Loop component types — Phase C.1
//
// Microsoft 365 Copilot Loop components rendered from MCP-sourced ServiceNow
// data. The DA (Declarative Agent) is the only caller. Loop components are
// **co-editable** across Microsoft Teams, Outlook, and the Loop app — sharing
// a Loop component into a chat retains the live link to the source object.
//
// Hard-rule compliance:
//   - Loop components are DA-only.
//   - Source data MUST come from MCP (ServiceNow) — never from the
//     digital-worker `/api/*` runtime.
//   - No reference to "Alex" / "signal-router" / "autonomy" / "foresight"
//     in any payload field. The `mcp-server/src/__tests__/guard-no-alex.test.ts`
//     guard scans every file under `mcp-server/src/loop-components/` for
//     forbidden tokens.
//
// Component contract (preview):
//   The payload is a `LoopComponentPayload` with:
//     - `type: "Microsoft.Loop.Component"` (required by the M365 Copilot
//       Apps SDK Loop preview surface)
//     - `version: "1.0"` (preview schema)
//     - `componentType` — chooses the high-level shape (task list, news
//       card, page).
//     - `permissions` — share + edit toggles propagated to Teams/Outlook.
//     - `blocks[]` — the block array that the Loop renderer turns into
//       live, co-editable surfaces.
//
//   When the DA forwards this payload to the Apps SDK, the Apps SDK
//   resolves it through the Loop component renderer in M365 Copilot,
//   Teams, or Outlook. Blocks render as fluid-editable surfaces.

/** Block-level types supported by the Loop renderer. */
export type LoopBlockType =
  | 'heading'
  | 'paragraph'
  | 'bulletedList'
  | 'numberedList'
  | 'task'
  | 'table'
  | 'callout'
  | 'image'
  | 'separator'
  | 'link';

export interface LoopHeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3;
  text: string;
}

export interface LoopParagraphBlock {
  type: 'paragraph';
  text: string;
}

export interface LoopBulletedListBlock {
  type: 'bulletedList';
  items: string[];
}

export interface LoopNumberedListBlock {
  type: 'numberedList';
  items: string[];
}

export interface LoopTaskBlock {
  type: 'task';
  title: string;
  completed?: boolean;
  assignee?: string;
  dueDate?: string;
  url?: string;
}

export interface LoopTableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

export interface LoopCalloutBlock {
  type: 'callout';
  variant: 'info' | 'warning' | 'success' | 'critical';
  text: string;
}

export interface LoopImageBlock {
  type: 'image';
  /** Inline data URL is preferred so the Loop component is fully
   *  self-contained and can be shared without external fetches. */
  src: string;
  alt: string;
}

export interface LoopSeparatorBlock {
  type: 'separator';
}

export interface LoopLinkBlock {
  type: 'link';
  url: string;
  text: string;
}

export type LoopBlock =
  | LoopHeadingBlock
  | LoopParagraphBlock
  | LoopBulletedListBlock
  | LoopNumberedListBlock
  | LoopTaskBlock
  | LoopTableBlock
  | LoopCalloutBlock
  | LoopImageBlock
  | LoopSeparatorBlock
  | LoopLinkBlock;

/** High-level component shape — drives the Loop renderer's choice of
 *  layout (task list vs page vs news card). */
export type LoopComponentType = 'page' | 'taskList' | 'newsCard';

/** Permissions surface forwarded to the Loop runtime. */
export interface LoopPermissions {
  /** Whether the receiving user may co-edit the component. */
  edit: boolean;
  /** Whether the component may be re-shared into Teams / Outlook / Loop. */
  share: boolean;
}

export interface LoopComponentPayload {
  /** Required by the Loop preview Apps SDK contract. */
  type: 'Microsoft.Loop.Component';
  /** Preview schema version. */
  version: '1.0';
  /** High-level component layout. */
  componentType: LoopComponentType;
  /** Title shown in the Loop component header — also the share-card title. */
  title: string;
  /** Optional one-line subtitle shown beneath the title. */
  subtitle?: string;
  /** Co-edit + share permissions. */
  permissions: LoopPermissions;
  /** Source-of-truth identifier so co-editors see updates from upstream. */
  source: {
    /** "servicenow" — only allowed value today. Loop components are
     *  MCP-sourced only, never digital-worker `/api/*`. */
    system: 'servicenow';
    /** Stable record reference so Loop components can re-fetch on share. */
    referenceId: string;
    /** Wall-clock instant the payload was generated. */
    generatedAt: string;
  };
  /** Block array — the renderable + co-editable content. */
  blocks: LoopBlock[];
}

/** Helper — empty Loop payload constructor used by the three generators. */
export function emptyLoopPayload(
  componentType: LoopComponentType,
  title: string,
  source: LoopComponentPayload['source'],
): LoopComponentPayload {
  return {
    type: 'Microsoft.Loop.Component',
    version: '1.0',
    componentType,
    title,
    permissions: { edit: true, share: true },
    source,
    blocks: [],
  };
}
