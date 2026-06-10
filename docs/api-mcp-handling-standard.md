# API and MCP Handling Standard

Date: 2026-06-10

## Purpose

Keep ITSMOperations reliable, safe and token-efficient when calling ServiceNow, MCP tools, Microsoft Graph, Azure services and LLM APIs.

## Request design

- Prefer small, scoped calls over broad payload grabs.
- Require explicit schemas for every tool input and output.
- Use result limits by default.
- Use pagination for list/search endpoints.
- Do not pass raw large payloads to the model.
- Summarise and rank records before adding to model context.
- Include source, query, result count, latency and source mode in tool metadata.

## Error handling

- Use clear timeout boundaries.
- Retry transient failures with exponential backoff and jitter.
- Do not retry validation/auth failures blindly.
- Surface auth failures explicitly.
- Fail closed when required IDs, auth or source system access is missing.
- Never silently fall back to fake data.

## Source mode

Every tool response must include `sourceMode`:

- `live-servicenow`
- `synthetic-servicenow`
- `scenario-injected`
- `cached`
- `auth-failed`
- `mcp-unavailable`
- `crm-enrichment-only`

## Token and message efficiency

- Return compact summaries first.
- Fetch detail only when the user asks or the workflow requires it.
- Cap incident/change lists.
- Avoid including unchanged records repeatedly.
- Cache stable reference data such as assignment groups, CI classes and service catalogue metadata.
- Use IDs and links rather than full record dumps where possible.

## Read/write separation

Read tools may execute immediately.

Write, send, page, assign, escalate, close, approve, update, create and delete tools must:

1. Show proposed payload.
2. Name target system and record/channel/recipient.
3. Ask for explicit confirmation.
4. Execute only after approval.

## Anthropic-style tool-use discipline

- Keep tool contracts narrow.
- Let tools do retrieval, not reasoning over huge payloads.
- Feed the model selected facts and evidence, not entire API responses.
- Use deterministic routing for common intents.
- Return actionable errors that tell the user what is missing.
