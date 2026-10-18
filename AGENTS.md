# AGENTS.md

Cloudflare Workers API built with Hono + TypeScript. Package manager is Bun (`bun.lock`); npm scripts also work.

## Commands

- `npm run dev` — `wrangler dev` (local dev; Miniflare state in `.wrangler/`)
- `npm run deploy` — `wrangler deploy --minify`
- `npm run cf-typegen` — regenerates root `worker-configuration.d.ts` exposing the `CloudflareBindings` interface. Run it after editing `wrangler.jsonc` bindings/vars.

- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — ESLint (typescript-eslint `strictTypeChecked` + the repo rules in `eslint.config.js`).

No test script is configured. Existing code still has known lint/typecheck failures, listed in `docs/coding-rules.md`; don't add new ones.

## Structure

- `src/index.ts` — entrypoint; the Hono app is mounted here. Add routes via `app.route(path, router)`.
- `src/routes/*.route.ts` — route modules. `ai.route.ts` exposes `POST /ai/chat` and `POST /ai/scan`.
- `src/services/ai/` — agent orchestration (Vercel AI SDK `ToolLoopAgent`, wrapped with Braintrust's `wrapAISDK`):
  - `agents/chat.agent.ts` — the chat agent, wired with `tools/expense.tools.ts`; caps runs at `AGENT_MAX_STEPS`.
  - `prompts/*.prompt.ts` — agent instructions as typed functions (e.g. `chatInstructions({ now })`). Keep rules here, not in the agent wiring.
  - `tools/expense.tools.ts` — zod-parameterized tools. Reads auto-execute; writes use `needsApproval: true`. Input and output schemas live in `src/schemas/expense.ts`. Every tool declares an `outputSchema` and returns the uniform `{ ok, data | error }` envelope; every `execute` return/catch path must return that envelope too (a bare string fails output validation and crashes the run). `getCategories(c)` is the shared KV-cached category loader.
  - `chat-history.ts` — chat persistence: sessions, message load/save, approval resolution. Throws `ChatError` for request-level failures (mapped to problem+json).
  - `index.ts` — `aiChat` / `aiScan`.
- `src/utils/model.ts` — `getModel({ c, provider, fallback? })` returns an AI SDK language model (Gemini via `@ai-sdk/google`, Groq via `@ai-sdk/groq`, Mercury/NVIDIA via `@ai-sdk/openai-compatible`). With `fallback`, a call that fails before responding is retried on the fallback provider (mid-stream errors are not). Omitting `provider` reads `AI_PROVIDER` / `AI_FALLBACK_PROVIDER` from `wrangler.jsonc` vars — the chat agent does this; `aiScan` pins Gemini (image input).
- `src/libs/cache.ts` — KV read-through helper. KV is eventually consistent: only cache stable data (currently the per-user category list). Never cache HITL state or balances.
- `src/constants/` — shared values: `ai.ts` (history limit, agent step limit, approval TTL, title length, role → `chat_message.type`), `cache.ts` (KV TTLs), `error.ts`, `model-config.ts`.
- `src/types/` — shared types. `src/types/database.ts` is generated from the Supabase schema; `TSupabaseClient` is the user-scoped client type, `TSupabaseAdminClient` the service-role one.
- `migrations/` — SQL migrations for the shared Supabase project (applied via the Supabase MCP/dashboard; there is no local Supabase CLI project here).
- `docs/chat-api.md` — client contract for the chat endpoints.

## Chat sessions & human-in-the-loop

- The backend owns chat history. Each `chat_message` row is one AI SDK `UIMessage` (`data`), keyed by `ui_id` (unique per session); `type` is derived from the role. `metadata.savedAt` is stamped on every write.
- Clients read `chat_session` / `chat_message` directly (RLS select) and may rename/delete sessions directly. Only the backend writes `chat_message`, via `supabaseContext.supabaseAdmin` — always after a user-scoped ownership check of the session. Users have no insert/update policy on `chat_message`, so a stored approval request cannot be edited by the client.
- `POST /ai/chat {sessionId, message}`: the client generates the session UUID; the session is created (titled from the first message) on first use. Only `role: "user"` messages with text/file parts are accepted. History (last `CHAT_HISTORY_LIMIT`) is loaded server-side, the reply is streamed as a UI message stream and upserted in `onEnd` via `waitUntil`; `consumeSseStream` keeps the run going if the client disconnects. `finish` attaches `metadata.usage`.
- A write tool stops the run with tool parts in `state: "approval-requested"`. `POST /ai/chat {sessionId, approvals: [{callId, approve}]}` resolves them on the stored message and resumes the agent; tool args always come from the stored message, never the client. Every pending call must be answered (`422`), unknown/answered calls are `409`, and approvals older than `PENDING_TTL_MS` (10 min) are `410`. Resolution is a conditional update, so each approval is single-use under concurrency.
- Stored history is validated against the current tool `inputSchema`/`outputSchema` on load (`validateUIMessages`). Changing a tool's input or output shape is therefore a data migration: add a `migrations/` script that rewrites the stored `tool-<name>` parts, or affected sessions fail to load.
- Sending a new user message while approvals are pending marks them `output-denied`. Deleting the session cascades to `chat_message`, cancelling pending actions.
- Tools close over the user-scoped `supabaseContext.supabase` and inject `userClaims.id` — never take `user_id` from the model.
- `POST /ai/scan {url, mediaType}` is stateless: it returns a proposed expense (`addExpenseSchema` shape) for the client's form and writes nothing.

## Conventions

- `@/` path alias maps to `src/` (defined only in `tsconfig.json`; wrangler's esbuild bundle honors it).
- Return responses via helpers in `src/libs/response.ts`: `successResponse(c, {...})` for 2xx (204 returns empty body) and `errorResponse(c, {...})` for RFC 9457 `application/problem+json` errors. Don't hand-roll `c.json` payloads.
- Use status codes from `src/constants/error.ts` (e.g. `HTTP_STATUS.NOT_FOUND`, `HTTP_STATUS.GONE`) instead of literals.
- Status fields are typed with Hono's `StatusCode`/`ContentfulStatusCode` (from `hono/utils/http-status`). `HTTP_STATUS` is `satisfies Record<string, StatusCode>` — note `NO_CONTENT` (204) is *not* a `ContentfulStatusCode`, so success-response status params use `StatusCode` while error/problem responses use `ContentfulStatusCode`.

## Code rules

Rationale, cast-free recipes and the list of existing violations: `docs/coding-rules.md`. Don't copy a pattern from the violations list; fix it when you touch that code.

**Readability first.** Write the clearest version. Optimize only for clear waste (N+1 queries, independent `await`s run one after another instead of `Promise.all`, reloading cached data) or a measured hot path. If the faster version is harder to read, keep the readable one unless the gain is significant, and comment why.

**No casts.** A cast means the design is wrong; fix the design.
- Banned: `as T`, `as unknown as T`, `<T>x`, `x!`, `any`, `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`. Allowed: `as const`, `satisfies`.
- Implicit `any` counts too: `JSON.parse`, `res.json()`, an untyped `new Hono()`, an unresolved import.
- Instead: narrow (`typeof`, `instanceof`, `in`, discriminants, `Array.isArray`), parse with zod, let generics infer, or pass a schema so the type follows.
- Data whose type is a guess is `unknown` until a zod schema parses it: request bodies, KV values, `JSON.parse`, `Json` columns, enum-like env vars. SDK parsers count (`zValidator`, tool `inputSchema`/`outputSchema`, `validateUIMessages`); typed Supabase selects are trusted.
- A type argument that claims a shape without checking it is a cast: `kv.get<T>()`, `.returns<T>()`, `.overrideTypes<T>()`. Exception: a call that validates at runtime against the same schemas the type comes from (`validateUIMessages<TChatMessage>`).
- `switch` over a union has no `default`; end it with `value satisfies never`.
- Only escape hatch, at a library boundary that can't be typed: `// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- cast-reason: <library, why>`.

**Types**
- Every named type lives in `src/types/` in a `.ts` file (not `.d.ts`, which `skipLibCheck` never checks): `types/<domain>.ts` by default, `types/<mirrored source path>.ts` when only one module uses it. `common.ts` and `database.ts` stay at the root.
- Type files use only `import type` and export no values. Derive types from schemas (`z.infer`, `z.enum`) instead of writing the shape twice.
- Never annotate a value with a type derived from itself (e.g. `TChatTools` on `expenseTools`): it's a circular type (TS7022).
- Names are `T` + PascalCase. Use `type`, not `interface`.

**Structure**
- Layers: `routes/` only wires middleware, validator and handler → `handlers/<domain>.handler.ts` reads the request, calls services and builds the response → `services/` holds business logic and never imports `libs/response` → `schemas/` (zod), `libs/` (app helpers tied to Hono/infra), `utils/` (pure helpers; import only constants, schemas, types), `constants/` (literal values only), `types/`.
- Every Hono app declares its env: `new Hono<TAppEnv>()`.
- File names: `<name>.<kind>.ts` in routes, handlers, middlewares, schemas and services (`ai.route.ts`, `chat.agent.ts`); plain `<name>.ts` in types, constants, utils and libs.
- Named exports only (except `src/index.ts`). No barrel files, no circular imports, no empty files or folders. Use the `@/` alias across folders.

**Size.** Aim for ≤ 200 lines per file; 300 is the hard limit. Functions ≤ 50 lines. Generated files and migrations are exempt. Over the limit, split by responsibility into a folder, one concern per file.

**Workers.** Every promise is awaited, returned, or passed to `c.executionCtx.waitUntil(...)`. Secrets come only from `c.env` (wrangler secrets / `.dev.vars`), never code or `wrangler.jsonc` vars.

**Before finishing:** run `npm run typecheck` and `npm run lint`; your change must not add errors.
