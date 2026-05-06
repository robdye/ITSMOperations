/**
 * Enrichment MCP — Express + StreamableHTTP entry point.
 *
 * Mirrors `mcp-server/src/index.ts` (CORS allow-list + per-request server
 * factory + StreamableHTTPServerTransport) and adds:
 *   - OBO + tenant header validation middleware (Phase E hard rule #2).
 *   - `/enrichment/mcp` and `/mcp` mount points.
 *   - `/health` is the only path that bypasses the OBO check.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createEnrichmentServer } from './server.js';
import { buildAuthContextFromRequest, isPublicPath, type EnrichmentAuthContext } from './auth.js';
import { getStats as getCacheStats } from './cache.js';

const PORT = parseInt(process.env.PORT ?? '3010', 10);
const app = express();

/* ── CORS allow-list (mirror of mcp-server) ────────────────────────────── */

const ALLOWED_SUFFIXES = [
  '.microsoft.com',
  '.cloud.microsoft',
  '.office.com',
  '.office365.com',
  '.sharepoint.com',
  '.live.com',
  '.microsoft365.com',
  '.teams.microsoft.com',
  '.chatgpt.com',
  '.openai.com',
  '.devtunnels.ms',
  '.widgetcopilot.net',
  '.widget-renderer.usercontent.microsoft.com',
];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin || origin === 'null') return true;
  if (origin.startsWith('http://localhost') || origin.startsWith('https://localhost')) return true;
  if (origin.startsWith('http://127.0.0.1') || origin.startsWith('https://127.0.0.1')) return true;
  if (origin.startsWith('vscode-webview://')) return true;
  const extra = process.env.ADDITIONAL_ALLOWED_ORIGINS?.split(',').map((s) => s.trim()) ?? [];
  for (const suffix of [...ALLOWED_SUFFIXES, ...extra]) {
    try {
      const hostname: string = new URL(origin).hostname;
      if (suffix.startsWith('.') && (hostname.endsWith(suffix) || hostname === suffix.slice(1))) return true;
      if (origin === suffix) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

app.use(
  cors({
    origin: (origin, cb) => {
      cb(null, isOriginAllowed(origin) ? origin ?? true : false);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'Mcp-Session-Id',
      'mcp-session-id',
      'Last-Event-ID',
      'Mcp-Protocol-Version',
      'mcp-protocol-version',
      'x-ms-tenant-id',
      'x-itsm-profile',
      'x-caller-agent-id',
      'x-correlation-id',
    ],
    exposedHeaders: ['Mcp-Session-Id'],
    credentials: false,
  }),
);
app.options('*', cors());
app.use(express.json({ limit: '2mb' }));

/* ── Health (public) ───────────────────────────────────────────────────── */

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: 'enrichment-mcp',
    version: '1.0.0',
    cache: getCacheStats(),
    sources: [
      'cisa-kev',
      'nvd',
      'msrc',
      'azure-status',
      'm365-service-health',
      'nager-holidays',
    ],
  });
});

/* ── OBO middleware: block everything except /health without bearer + tenant. */

app.use((req: Request, res: Response, next: NextFunction) => {
  if (isPublicPath(req.path)) return next();
  if (req.method === 'OPTIONS') return next();

  const ctx = buildAuthContextFromRequest(req);
  if (!ctx) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message:
          'Unauthorized — enrichment MCP requires an OBO bearer token (Authorization: Bearer ...) and an x-ms-tenant-id header.',
      },
      id: null,
    });
    return;
  }
  // Stash on res.locals so the MCP handler can read it.
  (res.locals as { authCtx?: EnrichmentAuthContext }).authCtx = ctx;
  next();
});

/* ── MCP handler ───────────────────────────────────────────────────────── */

function mcpHandler(req: Request, res: Response): void {
  void (async () => {
    try {
      const ctx = (res.locals as { authCtx?: EnrichmentAuthContext }).authCtx;
      if (!ctx) {
        res.status(401).json({ error: 'no-auth-context' });
        return;
      }
      const server = createEnrichmentServer(ctx);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        transport.close().catch(() => undefined);
        server.close().catch(() => undefined);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[enrichment] MCP handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  })();
}

app.post('/enrichment/mcp', mcpHandler);
app.get('/enrichment/mcp', mcpHandler);
app.delete('/enrichment/mcp', mcpHandler);

app.post('/mcp', mcpHandler);
app.get('/mcp', mcpHandler);
app.delete('/mcp', mcpHandler);

/* ── Server start ──────────────────────────────────────────────────────── */

const RUN_AS_SCRIPT = (() => {
  if (typeof process === 'undefined' || !process.argv?.[1]) return false;
  // Avoid auto-listening when imported from tests.
  return process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js');
})();

export function startEnrichmentServer(port: number = PORT) {
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    const handle = app.listen(port, () => {
      const actual = (handle.address() as { port: number }).port;
      console.log(`[enrichment] listening on http://localhost:${actual}/enrichment/mcp`);
      resolve({
        port: actual,
        close: () =>
          new Promise<void>((r) => {
            handle.close(() => r());
          }),
      });
    });
  });
}

export { app };

if (RUN_AS_SCRIPT) {
  startEnrichmentServer(PORT).catch((err) => {
    console.error('[enrichment] failed to start:', err);
    process.exit(1);
  });
}
