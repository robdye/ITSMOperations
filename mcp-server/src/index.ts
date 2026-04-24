/**
 * Change Management MCP Server — Express + Streamable HTTP.
 * Mirrors the Portfolio Agent architecture.
 */
import express, { type Request, type Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createChangeServer } from "./mcp-server.js";

const PORT = parseInt(process.env.PORT ?? "3002", 10);

const app = express();

// ── CORS ──
const ALLOWED_SUFFIXES = [
  ".microsoft.com", ".cloud.microsoft", ".office.com", ".office365.com",
  ".sharepoint.com", ".live.com", ".microsoft365.com", ".teams.microsoft.com",
  ".chatgpt.com", ".openai.com", ".devtunnels.ms", ".widgetcopilot.net",
  ".widget-renderer.usercontent.microsoft.com",
];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  if (origin.startsWith("http://localhost") || origin.startsWith("https://localhost")) return true;
  if (origin.startsWith("http://127.0.0.1") || origin.startsWith("https://127.0.0.1")) return true;
  if (origin.startsWith("vscode-webview://")) return true;
  const extra = process.env.ADDITIONAL_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? [];
  for (const suffix of [...ALLOWED_SUFFIXES, ...extra]) {
    try {
      const hostname: string = new URL(origin).hostname;
      if (suffix.startsWith(".") && (hostname.endsWith(suffix) || hostname === suffix.slice(1))) return true;
      if (origin === suffix) return true;
    } catch { /* ignore */ }
  }
  return false;
}

app.use(cors({
  origin: (origin, cb) => { cb(null, isOriginAllowed(origin) ? (origin ?? true) : false); },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "mcp-session-id", "Last-Event-ID", "Mcp-Protocol-Version", "mcp-protocol-version"],
  exposedHeaders: ["Mcp-Session-Id"],
  credentials: false,
}));
app.options("*", cors());
app.use(express.json());

/** Public-facing URL of this server */
export function getPublicServerUrl(): string {
  const base = process.env.SERVER_BASE_URL;
  if (base) return base.replace(/\/+$/, "");
  return `http://localhost:${PORT}`;
}

// ── Health ──
app.get("/health", (_req, res) => res.json({ status: "ok", server: "change-mgmt-mcp" }));

// ── Helper: create MCP handler ──
function mcpHandler(createServer: () => any) {
  return async (req: Request, res: Response) => {
    try {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP error:", err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  };
}

// ── Change Management MCP at /change/mcp ──
app.post("/change/mcp", mcpHandler(createChangeServer));
app.get("/change/mcp", mcpHandler(createChangeServer));
app.delete("/change/mcp", mcpHandler(createChangeServer));

// ── Also expose at /mcp for convenience ──
app.post("/mcp", mcpHandler(createChangeServer));
app.get("/mcp", mcpHandler(createChangeServer));
app.delete("/mcp", mcpHandler(createChangeServer));

// ── Start ──
app.listen(PORT, () => {
  const pub = getPublicServerUrl();
  console.log(`\n  Change Management MCP Server`);
  console.log(`  Change:  ${pub}/change/mcp`);
  console.log(`  Health:  ${pub}/health\n`);
});
