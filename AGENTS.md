# AGENTS.md

Cloudflare Workers API built with Hono + TypeScript. Package manager is Bun (`bun.lock`); npm scripts also work.

## Commands

- `npm run dev` — `wrangler dev` (local dev; Miniflare state in `.wrangler/`)
- `npm run deploy` — `wrangler deploy --minify`
- `npm run cf-typegen` — regenerates root `worker-configuration.d.ts` exposing the `CloudflareBindings` interface. Run it after editing `wrangler.jsonc` bindings/vars. This file does NOT currently exist — the README's `new Hono<{ Bindings: CloudflareBindings }>()` example only works after running it.

No lint, typecheck, or test scripts are configured.

## Structure

- `src/index.ts` — entrypoint; the Hono app is mounted here. Add routes via `app.route(path, router)`.
- `src/routes/*.route.ts` — route modules.
- `src/libs/` — shared helpers.
- `src/constants/`, `src/types/` — shared values and types.

**WIP state:** `src/routes/agent.route.ts` is an empty stub, but `src/index.ts` imports `{ agent }` from it — so `npm run dev` currently fails to bundle. Implement the `agent` router to fix the build.

## Conventions

- `@/` path alias maps to `src/` (defined only in `tsconfig.json`; wrangler's esbuild bundle honors it).
- Return responses via helpers in `src/libs/response.ts`: `successResponse(c, {...})` for 2xx (204 returns empty body) and `errorResponse(c, {...})` for RFC 9457 `application/problem+json` errors. Don't hand-roll `c.json` payloads.
- Use status codes and error type strings from `src/constants/error.ts` (e.g. `HTTP_STATUS.NOT_FOUND`, `ERROR_TYPE.NOT_FOUND`) instead of literals.
- Status fields are typed with Hono's `StatusCode`/`ContentfulStatusCode` (from `hono/utils/http-status`). `HTTP_STATUS` is `satisfies Record<string, StatusCode>` — note `NO_CONTENT` (204) is *not* a `ContentfulStatusCode`, so success-response status params use `StatusCode` while error/problem responses use `ContentfulStatusCode`.
