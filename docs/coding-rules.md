# Coding rules — rationale, recipes, known violations

The rules themselves live in `AGENTS.md` › **Code rules** and are enforced by `npm run typecheck` (`tsconfig.json`) and `npm run lint` (`eslint.config.js`). This file explains why each rule exists, shows the cast-free way to handle the common cases in this stack, and lists the code that doesn't follow the rules yet.

## Why

| Rule | Reason |
|---|---|
| Readability first | Code is read far more often than it runs. In a Worker the expensive work is network I/O (Supabase, model calls), so clear code rarely costs measurable time; repeated round-trips do. |
| No casts | A cast tells the compiler to stop checking. It hides the real mismatch, which then shows up at runtime. Same as typescript-eslint `consistent-type-assertions: never` plus the `strictTypeChecked` preset. |
| Implicit `any` counts | `JSON.parse` and untyped contexts produce `any` without an `as`, which is a cast nobody can see. Caught by the `no-unsafe-*` rules. |
| Parse unknown data with zod | "Parse, don't validate": after one parse the value has a trustworthy type, and the check and the type can't drift apart. |
| Types in `src/types/*.ts` | One place to find every shape. `.ts` rather than `.d.ts`, because `skipLibCheck: true` skips type-checking every `.d.ts`, including ours. |
| `import type` | Enforced by lint (`consistent-type-imports`). Type-only imports are erased from the bundle, which also makes type files safe to import from anywhere. |
| `T` prefix, `type` over `interface` | Matches most of the repo. Consistency beats either convention. |
| Layers (routes → handlers → services) | Each file has one job: HTTP wiring, request/response translation, or business logic. Services stay reusable outside HTTP (e.g. WhatsApp, cron). |
| Named exports, no barrels | Names stay the same at every import site; barrels hide where code lives and invite import cycles. |
| File ≤ 300 / function ≤ 50 lines | ESLint's `max-lines` / `max-lines-per-function` defaults. Past that, a unit almost always does more than one thing. |
| Promises awaited or `waitUntil` | A Worker can stop as soon as the response is sent; a floating promise may never finish. Caught by `no-floating-promises`. |

## Cast-free recipes

| Situation | Do this |
|---|---|
| KV read | Have `getOrSet` take a zod schema: `const parsed = schema.safeParse(await kv.get(key, "json"))`. A failed parse is a cache miss, so corrupt or outdated entries reload instead of crashing. |
| Enum-like env var (`AI_PROVIDER`) | `export const providerSchema = z.enum(["gemini", "mercury", "nvidia", "groq"])`, `type TProvider = z.infer<typeof providerSchema>`, then `providerSchema.safeParse(env.AI_PROVIDER).data ?? "gemini"`. |
| Checking membership in a const list | Parse with the `z.enum` above, or `new Set<unknown>(LIST).has(value)`. Widening the set's type isn't a cast. |
| Writing a `Json` column | `z.json().parse(JSON.parse(JSON.stringify(value)))`. The round-trip drops non-JSON values; the parse turns `any` into `Json`. |
| Validation error message | `z.prettifyError(result.error)` gives a string. Don't `JSON.parse` the error message. |
| Hono env typing | `new Hono<TAppEnv>()` on every app, or `createFactory<TAppEnv>().createHandlers(zValidator(...), handler)`, so `c.req.valid()` and `c.env` are typed by the validator, not by a hand-written annotation. |
| Supabase selects | Trust the generated `Database` types. Keep select strings as literal `const`s so supabase-js can infer the row type. Never `.returns<T>()`. |
| `catch (error)` | It's `unknown`. Narrow it with `error instanceof Error ? error.message : String(error)`. |
| Tool results | Return the `{ ok, data \| error }` envelope from `outputSchema`; use `satisfies` or `as const` on literals when the union needs help. |
| Index access with `noUncheckedIndexedAccess` | `const first = rows[0]; if (!first) return ...`. Narrow it; don't use `!`. |

## Splitting a long file

1. Group the functions by responsibility. Each group becomes a file in a folder named after the old module.
2. Move file-local types to `src/types/` and file-local literals to `src/constants/`.
3. Keep public names and behaviour the same. **Tool map keys must not change**: stored `tool-<name>` message parts are validated against them when history loads.
4. Check that no new import cycle appears, then run `npm run typecheck && npm run lint`.

## Known violations

These are what `typecheck` / `lint` report today (2026-10-18). Fix each one when you work on that file; don't copy them.

### Casts and `any`
- `src/utils/model.ts:28`: `value as TProvider` inside `isProvider`. Use the `z.enum` recipe.
- `src/libs/cache.ts:34`: `kv.get<T>(key, "json")`. Use the schema-taking `getOrSet` recipe (with `categoriesSchema` from `schemas/expense`).
- `src/middlewares/zod.validator.ts:16`: `JSON.parse(result.error.message)` puts `any` into `message: string`. Use `z.prettifyError`.
- `src/routes/ai.route.ts:16`: the `cors({ origin })` callback's context is untyped by Hono, so `c.env.CORS_ORIGIN` is `any`. Read the origin from a typed middleware instead.
- `src/types/utils/model.d.ts:32`: `RunState<any, any>`.

### Types
- `src/types/*.d.ts` (`validation`, `utils/model`) should be `.ts` files.
- `src/types/utils/model.d.ts:1-6` imports `@openai/agents`, which isn't installed, so everything built on it is `any`. Its agent types (`TInputType`, `TBuildAgent`, `TCreateAgent`, `TRunAgent`, `TResumeAgent`) are unused; delete them and rewrite `TSwitchProvider` as `{ c; provider?; fallback? }`.
- `src/utils/model.ts:7-14`: value imports used only as types. Use `import type`. Once `utils/model.ts` is fixed, add `"verbatimModuleSyntax": true` to `tsconfig.json`. Turning it on now breaks `wrangler deploy`: esbuild then keeps the import of `@/types/utils/model`, a `.d.ts` with no runtime file.
- `src/types/validation.d.ts:1`: `ValidationErrorItem` is unused and lacks the `T` prefix.
- `src/constants/model-config.ts:7-41`: wrangler types each var as its literal value, so every `env.X || "default"` fallback is dead code to the compiler. Read optional config through a schema or drop the fallback.

### Size
- `src/services/ai/tools/expense.tools.ts`: 242 lines; `expenseTools` is 184. Use one factory file per tool (`list-categories.tool.ts`, `list-expenses.tool.ts`, `get-expense.tool.ts`, `get-expense-summary.tool.ts`, `add-expense.tool.ts`, `update-expense.tool.ts`, `delete-expense.tool.ts`). `expense.tools.ts` keeps only the map, with the same keys. `getCategories` moves to `src/services/expense/category.service.ts`; `toMessage` moves to `src/utils/error.ts`.

### Layers and naming
- `src/constants/model-config.ts` holds functions that read env, not literal values. Move it to `src/libs/model-config.ts`.
- Files missing their kind suffix: `schemas/ai.ts` → `ai.schema.ts`, `schemas/expense.ts` → `expense.schema.ts`, `middlewares/zod.validator.ts` → `zod-validator.middleware.ts`.
- Default export: `src/middlewares/zod.validator.ts:7`.
- Empty: `src/services/supabase.ts`, `src/middlewares/trace.middleware.ts`, and the folder `src/services/supabase/`.

### Other lint findings
- `src/services/ai/tools/expense.tools.ts:92` (`limit ?? 10`) and `:145` (`data?.[0]`): guards on values that can't be nullish.
- `src/constants/model-config.ts:39`: Groq falls back to Google's base URL (copy-paste slip; unused today).
