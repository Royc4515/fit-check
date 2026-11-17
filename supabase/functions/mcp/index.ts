import { adminClient, authenticate } from "../_shared/auth.ts";
import { TOOL_BY_NAME, TOOLS, type ToolContext } from "./tools.ts";

/**
 * mcp: Fit Check as an MCP server, so Claude (claude.ai connectors, Claude Code) can read and manage the wardrobe.
 *
 * Transport: MCP Streamable HTTP, stateless. Every JSON-RPC request is a POST answered with one JSON body (the spec
 * allows JSON instead of an SSE stream when the server has nothing to push). GET and DELETE answer 405: there are no
 * server-initiated messages and no sessions.
 *
 * Auth: OAuth 2.1 through Supabase Auth's OAuth server. A request without a valid user token gets 401 with a
 * WWW-Authenticate header pointing at this function's protected-resource metadata, which names Supabase Auth as
 * the authorization server; the client then registers itself, sends Roy through the app's /oauth/consent page and
 * comes back with an access token. verify_jwt is OFF for this function on purpose: the platform's own 401 carries
 * no WWW-Authenticate header, and without it an MCP client cannot discover where to log in.
 *
 * Failure modes: 401 (no or bad token), 400 (body is not JSON-RPC), JSON-RPC errors for unknown methods or tools,
 * and tool errors returned as `isError` results so Claude can read and recover from them.
 */

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "fit-check", title: "Fit Check", version: "0.1.0" };
const INSTRUCTIONS =
  "Fit Check is Roy's personal wardrobe app (Hebrew-first, religious-modest menswear). Use wardrobe_search to see what he owns " +
  "and to find ids, item_get to look at one garment, item_update to fix names or tags, item_archive/item_restore to remove or bring back. " +
  "Ask before archiving or editing several items at once. Answer Roy in Hebrew.";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

type JsonRpcId = string | number | null;
const rpcResult = (id: JsonRpcId, result: unknown) => json(200, { jsonrpc: "2.0", id, result });
const rpcError = (id: JsonRpcId, code: number, message: string) => json(200, { jsonrpc: "2.0", id, error: { code, message } });
function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors, ...headers } });
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return json(500, { error: "server env missing" });
  const url = new URL(req.url);
  // The public address of this function; inside the runtime the request URL lacks the /functions/v1 prefix.
  const resource = `${supabaseUrl}/functions/v1/mcp`;
  const metadataUrl = `${resource}/.well-known/oauth-protected-resource`;

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // RFC 9728 protected-resource metadata: where an MCP client learns which server issues tokens for this one.
  if (req.method === "GET" && url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return json(200, {
      resource,
      authorization_servers: [`${supabaseUrl}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "Fit Check",
    });
  }
  if (req.method !== "POST") return json(405, { error: "method not allowed" }, { allow: "POST" });

  const auth = await authenticate(req);
  if (!auth.ok) {
    return json(401, { error: "unauthorized" }, { "www-authenticate": `Bearer resource_metadata="${metadataUrl}"` });
  }

  let msg: { jsonrpc?: unknown; id?: JsonRpcId; method?: unknown; params?: Record<string, unknown> };
  try {
    msg = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  if (Array.isArray(msg) || msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id ?? null, -32600, "Invalid request");
  const id = msg.id ?? null;

  // Notifications (initialized, cancelled) carry no id and need no answer beyond "accepted".
  if (msg.id === undefined) return new Response(null, { status: 202, headers: cors });

  switch (msg.method) {
    case "initialize": {
      const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
      });
    case "tools/call": {
      const name = msg.params?.name;
      const tool = typeof name === "string" ? TOOL_BY_NAME.get(name) : undefined;
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
      // Service role (see _shared/auth.ts); every tool filters on this user id itself.
      const ctx: ToolContext = { db: adminClient(), userId: auth.userId, supabaseUrl };
      try {
        return rpcResult(id, await tool.run(msg.params?.arguments ?? {}, ctx));
      } catch (error) {
        // zod and database errors become readable tool errors, so Claude can fix its arguments and retry.
        const detail = error instanceof Error ? error.message : String(error);
        console.error("tool failed", name, detail);
        return rpcResult(id, { content: [{ type: "text", text: `Error: ${detail.slice(0, 800)}` }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
});
