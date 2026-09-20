# AGENTS.md

Cloudflare Workers API built with Hono + TypeScript. Package manager is Bun (`bun.lock`); npm scripts also work.

## Commands

- `npm run dev` — `wrangler dev` (local dev; Miniflare state in `.wrangler/`)
- `npm run deploy` — `wrangler deploy --minify`
- `npm run cf-typegen` — regenerates root `worker-configuration.d.ts` exposing the `CloudflareBindings` interface. Run it after editing `wrangler.jsonc` bindings/vars.

No lint, test, or typecheck scripts are configured. TypeScript is not a dependency; to typecheck run `bunx --package typescript@5 tsc --noEmit`.

## Structure

- `src/index.ts` — entrypoint; the Hono app is mounted here. Add routes via `app.route(path, router)`.
- `src/routes/*.route.ts` — route modules. `ai.route.ts` exposes `POST /ai`, `POST /ai/approvals`, `GET /ai/approvals`.
- `src/services/ai/` — agent orchestration:
  - `agents/triage.agent.ts` — entry agent; hands off to the expense subagent.
  - `agents/expense.agent.ts` — expense/income agent, wired with `tools/expense.tools.ts`.
  - `tools/expense.tools.ts` — zod-parameterized tools. Reads auto-execute; writes use `needsApproval: true`. Input and output schemas live in `src/schemas/expense.ts`. Every tool declares an `outputSchema` and returns the uniform `{ ok, data | error }` envelope; `errorFunction` must return that envelope too (a bare string fails output validation and crashes the run).
  - `run-state.ts` — persists/resumes interrupted runs in `chat_message` (`type: "tool"`, `data.kind: "pending_approval"`).
  - `index.ts` — `aiPrompt` / `aiApprove` / `aiPendingApprovals`.
- `src/utils/model.ts` — `buildAgent` / `runAgent` / `resumeAgent` (provider + Braintrust tracing). Prefer these over constructing `Agent`/`run` directly. Gemini is built by `src/services/ai/models/gemini.model.ts`, a native `@google/genai` `Model` implementation — not the AI SDK adapter, which throws on function-tool `outputSchema`. It maps tool `outputSchema` → `FunctionDeclaration.responseJsonSchema` and preserves `thoughtSignature`s across tool/handoff round-trips. Do NOT route Gemini through the OpenAI-compatible endpoint or Gemini 3 rejects replays with `400 ... missing a thought_signature`. Other providers keep the OpenAI-compatible chat completions path.
- `src/services/ai/models/gemini.model.ts` — custom `@openai/agents` `Model` over `@google/genai` (`generateContent` / `generateContentStream`). Pure mappers (`toGeminiContents`, `toFunctionDeclarations`, `toOutputItems`) convert between Agents SDK items and Gemini `Content[]`. `outputSchema` is only supported on this model path; the chat-completions path rejects it.
- `src/libs/cache.ts` — KV read-through helper. KV is eventually consistent: only cache stable data (currently the per-user category list). Never cache HITL state or balances.
- `src/constants/` — shared values: `ai.ts` (session header, pending-approval markers/TTL), `cache.ts` (KV TTLs), `error.ts`, `model-config.ts`.
- `src/types/` — shared types. `src/types/database.ts` is generated from the Supabase schema; `TSupabaseClient` is the user-scoped client type.
- `src/services/ai/tools.ts` and `src/services/ai/agent.ts` were removed.

## Agents & human-in-the-loop

- Tools always declare zod `parameters`; `execute` only runs after approval for write tools.
- Tools close over the user-scoped `supabaseContext.supabase` and inject `userClaims.id` — never take `user_id` from the model.
- Flow: `POST /ai` runs the triage agent; a write tool interrupts the run and the serialized `RunState` + proposed calls are stored in `chat_message`. The response carries `X-Chat-Session-Id` (create a session when the client omits one). The client then calls `GET /ai/approvals?sessionId=` to render confirm/reject, and `POST /ai/approvals {sessionId, callId, approve}` to resume. Approval args come from the stored state, never the client.
- Pending approvals expire after 10 minutes and are single-use. Deleting the chat session cascades to `chat_message`, cancelling the pending action (`POST /ai/approvals` then returns `410 Gone`).

## Conventions

- `@/` path alias maps to `src/` (defined only in `tsconfig.json`; wrangler's esbuild bundle honors it).
- Return responses via helpers in `src/libs/response.ts`: `successResponse(c, {...})` for 2xx (204 returns empty body) and `errorResponse(c, {...})` for RFC 9457 `application/problem+json` errors. Don't hand-roll `c.json` payloads.
- Use status codes from `src/constants/error.ts` (e.g. `HTTP_STATUS.NOT_FOUND`, `HTTP_STATUS.GONE`) instead of literals.
- Status fields are typed with Hono's `StatusCode`/`ContentfulStatusCode` (from `hono/utils/http-status`). `HTTP_STATUS` is `satisfies Record<string, StatusCode>` — note `NO_CONTENT` (204) is *not* a `ContentfulStatusCode`, so success-response status params use `StatusCode` while error/problem responses use `ContentfulStatusCode`.
