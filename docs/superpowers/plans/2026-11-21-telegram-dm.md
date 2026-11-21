# Telegram DM (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A linked user chats with the expense agent in a Telegram DM, with the same tools, quota and approve/reject flow as `POST /ai/chat`, including receipt photos.

**Architecture:** `POST /webhooks/telegram` authenticates Telegram (IP range + secret header), hands the update to a per-chat `TelegramInbox` Durable Object and returns 200. The inbox stores updates in SQLite and processes one at a time from an alarm. Turns reuse the chat services; all agent data access goes through a new ledger module that filters by `user_id`, so the service-role client never reads or writes another user's rows.

**Tech Stack:** Cloudflare Workers + Durable Objects (SQLite), Hono, Supabase (`@supabase/server`), Vercel AI SDK v7 (`createAgentUIStream`, `readUIMessageStream`), zod 4, Telegram Bot API, Vitest (new, unit tests for pure modules).

**Spec:** `docs/superpowers/specs/2026-11-21-telegram-bot-design.md` (slice 1 = §4.1, §5.1–5.6, §6, rollout steps 1–4). Groups (§4.2, §5.7–5.8) are a separate plan.

## Global Constraints

- Follow AGENTS.md "Code rules": no casts, types only in `src/types/` (derived from zod), `T`-prefixed `type` aliases, named exports, `@/` alias, files ≤ 300 lines (aim 200), functions ≤ 50 lines, every promise awaited/returned/`waitUntil`'d.
- `npm run typecheck` and `npm run lint` must add no errors at the end of every task.
- Work on branch `feat/telegram-dm`, not `main`.
- Never take `user_id` from the model, the request body or `callback_data`; resolve it from the database.
- Every service-role insert into `expense` or `chat_session` sets `user_id` explicitly (column defaults are `auth.uid()`, null under the service role).
- The bot token never appears in stored data, logs or anything sent to a model.
- `chatInstructions({ channel: "app" })` must return the current prompt byte for byte (prompt-cache and replay stability).
- Telegram copy, verbatim:
  - unlinked DM: `Link your account: open the app → Settings → Telegram.`
  - 402: `AI chat needs a Plus or Pro plan.`
  - 429: `You've used this month's {quota} messages.`
  - unsupported media: `I can read text and photos for now.`
  - poison update: `Something went wrong with that message, please send it again.`
  - link ok: `Linked. Send me an expense any time.`
  - link bad token: `That link expired. Open Settings → Telegram in the app again.`
  - link taken: `This Telegram account is linked to another user.`
  - approval expired toast: `Expired after 10 minutes.` · already answered toast: `Already answered.`
- Values: `TELEGRAM_MESSAGE_MAX = 4096`, `SESSION_IDLE_ROTATE_MS = 3 * 60 * 60 * 1000`, `TELEGRAM_IP_RANGES = ["149.154.160.0/20", "91.108.4.0/22"]`, `PHOTO_MAX_SIDE = 1280`, `TELEGRAM_FILE_PREFIX = "telegram-file:"`, `CALLBACK_PREFIX = "apv"`, `INBOX_MAX_ATTEMPTS = 3`, `INBOX_RUN_BUDGET_MS = 10 * 60 * 1000`, `TYPING_INTERVAL_MS = 4000`, link token 32 chars base64url valid 10 minutes.

## Review Focus

1. **Bot added to a group before slice 2 exists** → group messages, `/start@bot` and `my_chat_member` must be acked and ignored, never crash the inbox. Test in Task 1 (`classifyUpdate` returns `"ignore"` for group chats).
2. **Text over 4,096 characters, or empty model text** (only tool calls) → split into several messages; send nothing for empty text rather than an empty message (Telegram rejects it). Test in Task 1 (`splitMessage`).
3. **Photo with no size ≤ 1,280 px, or a document that isn't an image / is over 8 MB** → fall back to the smallest photo; non-image or oversized documents get the unsupported-media reply. Test in Task 1 (`pickPhotoSize`) and Task 7.
4. **Callback tap on a message from an older, rotated session** → still resolves by `chat_message.id`, checks it belongs to this chat and this user; an expired one answers `Expired after 10 minutes.` Test in Task 8 (`parseCallbackData`, ownership check) and manual check 8.
5. **Telegram redelivers an update after the turn already finished** → dropped by the inbox's `update_id` key; after a mid-turn crash, the stored `tg-<chat>-<message>` id resumes without charging quota twice. Test in Task 1 (`telegramMessageId`) and Task 6 (`turnResumeState`).

---

### Task 1: Test runner and pure Telegram helpers

**Files:**
- Modify: `package.json` (devDependency `vitest`, script `"test": "vitest run"`)
- Create: `vitest.config.ts` (alias `@` → `./src`, `include: ["src/**/*.test.ts"]`, `environment: "node"`)
- Create: `src/constants/telegram.ts` (the Global Constraints values and copy)
- Create: `src/schemas/telegram.schema.ts`
- Create: `src/types/telegram.ts`
- Create: `src/utils/telegram.ts`
- Test: `src/utils/telegram.test.ts`

**Interfaces:**
- Produces:
  - `telegramUpdateSchema` (`z.looseObject`): `update_id`, optional `message` (`message_id`, `chat {id, type}`, `from {id, is_bot, first_name, username?}`, `text?`, `caption?`, `photo?[] {file_id, width, height, file_size?}`, `document? {file_id, mime_type?, file_size?}`, `voice?`, `video?`, `sticker?` as `z.unknown()`), optional `callback_query` (`id`, `from`, `data?`, `message? {message_id, chat}`), optional `my_chat_member` (`chat`, `new_chat_member {status}`).
  - Types: `TTelegramUpdate`, `TTelegramMessage`, `TTelegramCallbackQuery`, `TTelegramPhotoSize`, `TUpdateKind = "start" | "help" | "new" | "message" | "callback" | "ignore"`, `TCallbackData = { approve: boolean; messageId: number }`.
  - `chatIdOf(update: TTelegramUpdate): number | undefined`
  - `classifyUpdate(update: TTelegramUpdate): TUpdateKind`
  - `parseStartToken(text: string): string | undefined`
  - `isTelegramIp(ip: string): boolean`
  - `formatCallbackData(data: TCallbackData): string` / `parseCallbackData(raw: string): TCallbackData | undefined`
  - `telegramMessageId(chatId: number, messageId: number): string`
  - `splitMessage(text: string): string[]`
  - `pickPhotoSize(sizes: TTelegramPhotoSize[]): TTelegramPhotoSize | undefined`
  - `toTelegramFileUrl(fileId: string): string` / `fileIdFromUrl(url: string): string | undefined`
  - `shouldRotate(lastMessageAt: Date | undefined, now: Date): boolean`

- [ ] **Step 1: Write the failing tests** in `src/utils/telegram.test.ts`

```ts
describe("classifyUpdate", () => {
  it("routes private /start, /help, /new, text and callbacks", () => {
    expect(classifyUpdate(privateText("/start abc"))).toBe("start");
    expect(classifyUpdate(privateText("/help"))).toBe("help");
    expect(classifyUpdate(privateText("/new"))).toBe("new");
    expect(classifyUpdate(privateText("lunch 12"))).toBe("message");
    expect(classifyUpdate(callback("apv:1:42"))).toBe("callback");
  });
  it("ignores group chats and membership updates in slice 1", () => {
    expect(classifyUpdate(groupText("@bot lunch 12"))).toBe("ignore");
    expect(classifyUpdate(myChatMember("kicked"))).toBe("ignore");
  });
});
it("parseStartToken", () => {
  expect(parseStartToken("/start abc_DEF-123")).toBe("abc_DEF-123");
  expect(parseStartToken("/start")).toBeUndefined();
});
it("isTelegramIp", () => {
  expect(isTelegramIp("149.154.167.220")).toBe(true);
  expect(isTelegramIp("91.108.6.1")).toBe(true);
  expect(isTelegramIp("8.8.8.8")).toBe(false);
  expect(isTelegramIp("not-an-ip")).toBe(false);
});
it("callback data round-trips and rejects junk", () => {
  expect(formatCallbackData({ approve: true, messageId: 881 })).toBe("apv:1:881");
  expect(parseCallbackData("apv:0:881")).toEqual({ approve: false, messageId: 881 });
  expect(parseCallbackData("apv:2:881")).toBeUndefined();
  expect(parseCallbackData("xyz:1:881")).toBeUndefined();
  expect(formatCallbackData({ approve: true, messageId: Number.MAX_SAFE_INTEGER }).length).toBeLessThanOrEqual(64);
});
it("telegramMessageId", () => {
  expect(telegramMessageId(12345, 67)).toBe("tg-12345-67");
});
it("splitMessage", () => {
  expect(splitMessage("")).toEqual([]);
  expect(splitMessage("hi")).toEqual(["hi"]);
  const parts = splitMessage("a".repeat(4096 * 2 + 10));
  expect(parts).toHaveLength(3);
  expect(parts.every((p) => p.length <= 4096)).toBe(true);
});
it("pickPhotoSize", () => {
  expect(pickPhotoSize([size(90, 90), size(800, 600), size(1280, 960), size(2560, 1920)])?.width).toBe(1280);
  expect(pickPhotoSize([size(2000, 1500), size(4000, 3000)])?.width).toBe(2000);
  expect(pickPhotoSize([])).toBeUndefined();
});
it("telegram file urls", () => {
  expect(toTelegramFileUrl("AgAC")).toBe("telegram-file:AgAC");
  expect(fileIdFromUrl("telegram-file:AgAC")).toBe("AgAC");
  expect(fileIdFromUrl("https://x/y.jpg")).toBeUndefined();
});
it("shouldRotate", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  expect(shouldRotate(undefined, now)).toBe(true);
  expect(shouldRotate(new Date("2026-11-21T09:00:01Z"), now)).toBe(false);
  expect(shouldRotate(new Date("2026-11-21T08:59:59Z"), now)).toBe(true);
});
```

Builders (`privateText`, `groupText`, `callback`, `myChatMember`, `size`) are local functions returning schema-shaped literals typed as `TTelegramUpdate` / `TTelegramPhotoSize`.

- [ ] **Step 2: Run** `npm install -D vitest` then `npm test` — Expected: FAIL (`Cannot find module '@/utils/telegram'`).
- [ ] **Step 3: Implement** constants, schema, types and `src/utils/telegram.ts`. `splitMessage` prefers the last newline before the limit, else hard-cuts. `pickPhotoSize`: largest with both sides ≤ `PHOTO_MAX_SIDE`, else the smallest. `isTelegramIp`: IPv4 CIDR match on `TELEGRAM_IP_RANGES` (IPv6 → false).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint` — Expected: PASS, no new errors.
- [ ] **Step 5: Commit** `feat(telegram): add update schema and pure helpers with tests`

---

### Task 2: Ledger module and agent without Hono context

**Files:**
- Create: `src/services/ledger/ledger.service.ts` (+ `ledger-read.service.ts` / `ledger-write.service.ts` if over 200 lines)
- Create: `src/types/ledger.ts`
- Modify: `src/services/ai/tools/expense.tools.ts` (take the ledger; split read/write tool files if over 200 lines)
- Modify: `src/services/ai/agents/chat.agent.ts`, `src/utils/model.ts`, `src/types/utils/model.d.ts` (`getModel({ env, provider?, fallback? })`)
- Modify: `src/services/ai/scan/scan.service.ts`, `src/handlers/ai.handler.ts`
- Modify: `src/services/ai/prompts/chat.prompt.ts`
- Test: `src/services/ai/prompts/chat.prompt.test.ts`

**Interfaces:**
- Produces:
  - `type TLedgerDb = TSupabaseClient | TSupabaseAdminClient` (both are `SupabaseClient<Database>`; if TS rejects calls on the union, use `TSupabaseClient` alone — the admin type is assignable).
  - `createLedger({ db, kv, userId }: { db: TLedgerDb; kv: KVNamespace; userId: string }): TLedger` with
    `categories(): Promise<TCategory[]>` (KV-cached as today via `cacheKey("categories", userId)`),
    `listExpenses(input: TListExpensesInput)`, `getExpense(id: number)` (null when missing),
    `summary(input: TGetExpenseSummaryInput)`, `addExpenses(rows: TAddExpenseInput[])`,
    `updateExpense(id: number, patch: TablesUpdate<"expense">)` (null when missing), `deleteExpenses(ids: number[])`.
    Every query on `expense`/`expense_category` adds `.eq("user_id", userId)`; inserts set `user_id: userId`. Methods throw `Error` on a query error.
  - `expenseTools(ledger: TLedger)` — same tool names, schemas, envelopes and `toModelOutput` as today.
  - `type TChatChannel = "app" | "telegram-dm"` (slice 2 adds `"telegram-group"`).
  - `chatAgent({ env, ledger, channel }: { env: TAppBindings; ledger: TLedger; channel: TChatChannel })`.
  - `chatInstructions({ channel }: { channel: TChatChannel })`.
  - `TChatTools` / `TChatMessage` keep deriving from `ReturnType<typeof chatAgent>`.

- [ ] **Step 1: Write the failing test** `chat.prompt.test.ts`

```ts
it("app prompt is unchanged and telegram extends it", () => {
  const app = chatInstructions({ channel: "app" });
  expect(app.startsWith("You are an expense tracking assistant.")).toBe(true);
  expect(app).not.toContain("Telegram");
  const dm = chatInstructions({ channel: "telegram-dm" });
  expect(dm.startsWith(app)).toBe(true);
  expect(dm).toContain("Do not use Markdown");
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL (argument / missing text).
- [ ] **Step 3: Implement** `chatInstructions`: the current string as a constant, plus for `"telegram-dm"` an appended block: "Channel: Telegram chat. Do not use Markdown, tables or headings; plain text only. Keep replies short."
- [ ] **Step 4: Implement the ledger and rewire.** `aiChat` builds `createLedger({ db: supabase, kv: c.env.CACHE, userId: userClaims.id })` and `chatAgent({ env: c.env, ledger, channel: "app" })`; `scanReceipt` uses `ledger.categories()` and `getModel({ env: c.env, provider: "gemini" })`. Delete the old `getCategories(c)`.
- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run lint` — Expected: PASS, no new errors.
- [ ] **Step 6: Smoke** `npm run dev`, then with a real user JWT: `POST /ai/chat` "add lunch 12 today" → approve → row has your `user_id`; "list my expenses" returns only yours; `POST /ai/scan` still works.
- [ ] **Step 7: Commit** `refactor(ai): route agent data access through a user-scoped ledger`

---

### Task 3: Migration A, generated types, app guard

**Files:**
- Create: `migrations/20261122000000_telegram_link.sql` (spec §4.1 DDL + three RPCs)
- Modify: `src/types/database.ts` (regenerate)
- Modify: `src/services/ai/chat/session.service.ts`, `src/services/ai/chat/turn.service.ts`

**Interfaces:**
- Produces (SQL): `create_telegram_link_token() returns text` (`auth.uid()`), `link_telegram(p_token text, p_telegram_user_id bigint) returns uuid` (service role only; raises `token_invalid` / `telegram_already_linked`), `unlink_telegram() returns void`.
- Produces (TS): `getSession(supabase: TSupabaseClient, sessionId: string): Promise<{ telegramChatId: number | null } | null>` replacing `sessionExists`.

- [ ] **Step 1: Write the migration.** Token: `encode(extensions.gen_random_bytes(24), 'base64url')` (32 chars), expiry `now() + interval '10 minutes'`. `link_telegram` matches `telegram_link_token = p_token and telegram_link_expires_at > now()`, catches the unique violation on `telegram_user_id` as `telegram_already_linked`, clears token and expiry. Grants: `create_`/`unlink_` to `authenticated`; revoke all three from `public, anon`; revoke `link_telegram` from `authenticated`.
- [ ] **Step 2: Show the migration to the user and apply it only after their yes** (Supabase MCP `apply_migration`). It is additive.
- [ ] **Step 3: Verify in SQL**: `select column_name from information_schema.columns where table_name in ('user_profile','chat_session') and column_name like 'telegram%'` → 6 rows; `select proname from pg_proc where proname like '%telegram%'` → 3 rows.
- [ ] **Step 4: Regenerate** `src/types/database.ts` (Supabase MCP `generate_typescript_types`).
- [ ] **Step 5: Guard `/ai/chat`.** In `prepareTurn`, a session whose `telegramChatId` is not null throws `ChatError(HTTP_STATUS.CONFLICT, "This conversation belongs to Telegram")` on both message and approval paths; a missing session behaves as today.
- [ ] **Step 6: Run** `npm run typecheck`, `npm run lint` — no new errors. Smoke: `POST /ai/chat` on a normal session still works.
- [ ] **Step 7: Commit** `feat(db): telegram link columns and RPCs; keep app chat off telegram sessions`

---

### Task 4: Telegram Bot API client

**Files:**
- Create: `src/libs/telegram.ts`
- Modify: `src/schemas/telegram.schema.ts` (response schemas), `src/types/telegram.ts`
- Test: `src/libs/telegram.test.ts`

**Interfaces:**
- Produces: `createTelegramClient({ token, fetch = globalThis.fetch }: { token: string; fetch?: typeof globalThis.fetch }): TTelegramClient` with
  `sendMessage({ chatId, text, replyTo?, buttons? }): Promise<{ messageId: number }>` (`buttons: { text: string; data: string }[]` → one inline-keyboard row; no `parse_mode`),
  `sendChatAction(chatId: number): Promise<void>` (`"typing"`),
  `answerCallbackQuery(id: string, text?: string): Promise<void>`,
  `editMessageReplyMarkup(chatId: number, messageId: number): Promise<void>` (removes buttons; Telegram's "message is not modified" error is swallowed),
  `editMessageText(chatId: number, messageId: number, text: string): Promise<void>`,
  `downloadFile(fileId: string): Promise<{ bytes: Uint8Array; mediaType: string }>` (`getFile` then GET the file path; never returns or logs the URL).
  Non-`ok` responses throw `Error("telegram <method>: <description>")` without the token.

- [ ] **Step 1: Write the failing tests** with a fake `fetch` that records `(url, init)` and returns `new Response(JSON.stringify(...))`:

```ts
it("sendMessage posts JSON and returns the message id", async () => {
  const { fetch, calls } = fakeFetch([{ ok: true, result: { message_id: 9 } }]);
  const tg = createTelegramClient({ token: "T0K", fetch });
  await expect(tg.sendMessage({ chatId: 5, text: "hi", buttons: [{ text: "Approve", data: "apv:1:2" }] }))
    .resolves.toEqual({ messageId: 9 });
  expect(calls[0]?.url).toBe("https://api.telegram.org/botT0K/sendMessage");
  expect(JSON.parse(String(calls[0]?.body))).toMatchObject({
    chat_id: 5, text: "hi", reply_markup: { inline_keyboard: [[{ text: "Approve", callback_data: "apv:1:2" }]] },
  });
});
it("errors never contain the token", async () => {
  const { fetch } = fakeFetch([{ ok: false, description: "Bad Request" }]);
  const tg = createTelegramClient({ token: "T0K", fetch });
  await expect(tg.sendChatAction(5)).rejects.toThrow(/^telegram sendChatAction: Bad Request$/);
});
it("downloadFile resolves bytes and media type", async () => {
  const { fetch } = fakeFetch([{ ok: true, result: { file_path: "photos/a.jpg" } }, new Uint8Array([1, 2])]);
  const file = await createTelegramClient({ token: "T0K", fetch }).downloadFile("AgAC");
  expect([...file.bytes]).toEqual([1, 2]);
  expect(file.mediaType).toBe("image/jpeg");
});
```

`JSON.parse` in the test is parsed with a zod schema before use (no implicit `any`).

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** `src/libs/telegram.ts`. Media type from the file path extension (`jpg|jpeg → image/jpeg`, `png`, `webp`), default `application/octet-stream`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint` — PASS.
- [ ] **Step 5: Commit** `feat(telegram): typed Bot API client`

---

### Task 5: Ingress — webhook, inbox Durable Object, linking

**Files:**
- Create: `src/middlewares/telegram-auth.middleware.ts`
- Create: `src/handlers/telegram.handler.ts`
- Create: `src/durable-objects/telegram-inbox.durable-object.ts`
- Create: `src/services/telegram/update.service.ts`, `src/services/telegram/link.service.ts`, `src/services/telegram/deps.service.ts`
- Modify: `src/routes/webhooks.route.ts`, `src/index.ts`, `wrangler.jsonc`, `worker-configuration.d.ts` (via `npm run cf-typegen`), `src/types/telegram.ts`

**Interfaces:**
- Consumes: Task 1 helpers, Task 4 client.
- Produces:
  - `telegramAuth` middleware: 401 problem+json unless `isTelegramIp(c.req.header("cf-connecting-ip") ?? "")` (skipped when `c.env.TELEGRAM_SKIP_IP_CHECK === "true"`) and `X-Telegram-Bot-Api-Secret-Token` equals `TELEGRAM_WEBHOOK_SECRET` (constant time, via `src/utils/crypto.ts`; unset secret rejects).
  - `telegramWebhook(c)`: no chat id or `classifyUpdate === "ignore"` → 200 without enqueueing; else `await c.env.TELEGRAM_INBOX.getByName(String(chatId)).enqueue(update)` → `successResponse` 200.
  - `class TelegramInbox extends DurableObject<TAppBindings>` with `enqueue(update: TTelegramUpdate): Promise<void>` and `alarm(): Promise<void>`; SQLite table `updates(update_id integer primary key, body text not null, attempts integer not null default 0, received_at integer not null)`.
  - `type TTelegramDeps = { env: TAppBindings; admin: TSupabaseAdminClient; telegram: TTelegramClient }`; `createTelegramDeps(env: TAppBindings): TTelegramDeps` (`createAdminClient<Database>` from `@supabase/server/core` with `env` mapped from the bindings as the Hono adapter does).
  - `handleUpdate(deps: TTelegramDeps, update: TTelegramUpdate): Promise<void>` — a `switch` on `classifyUpdate` ending in `satisfies never`; this task implements `start` and `help`, and `message`/`new`/`callback` reply `Coming soon.` until Tasks 6 and 8 replace them.
  - `linkTelegram(deps, message: TTelegramMessage): Promise<void>` — calls `link_telegram`, maps `token_invalid` / `telegram_already_linked` to the copy in Global Constraints; `/start` without a token sends the unlinked copy.

- [ ] **Step 1: Scope RevenueCat auth.** `webhooks.use("/revenuecat", revenuecatAuth)`; add `webhooks.post("/telegram", telegramAuth, zValidator("json", telegramUpdateSchema), telegramWebhook)`. A validation failure still returns 200 (log the `update_id` if present) so Telegram does not retry junk forever.
- [ ] **Step 2: Inbox.** `enqueue`: `insert ... on conflict(update_id) do nothing`; `setAlarm(Date.now())` when `getAlarm()` is null. `alarm`: loop oldest-first while `Date.now() - start < INBOX_RUN_BUDGET_MS`; parse `body` with `telegramUpdateSchema`; increment `attempts` before processing; on success delete the row; when `attempts > INBOX_MAX_ATTEMPTS` delete it, log `{ update_id, chat_id }`, send the poison copy; any other throw re-throws (the runtime retries the alarm). If rows remain, `setAlarm(Date.now())`. Initialise Braintrust as `braintrust.middleware.ts` does, using `this.ctx.waitUntil`.
- [ ] **Step 3: Config.** `wrangler.jsonc`: `durable_objects.bindings: [{ name: "TELEGRAM_INBOX", class_name: "TelegramInbox" }]`, `migrations: [{ tag: "v1", new_sqlite_classes: ["TelegramInbox"] }]`, var `TELEGRAM_BOT_USERNAME`. `.dev.vars`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_SKIP_IP_CHECK=true`. Run `npm run cf-typegen`. `src/index.ts`: `export { TelegramInbox } from "@/durable-objects/telegram-inbox.durable-object";`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint` — no new errors.
- [ ] **Step 5: Manual** (test bot, preview deploy or tunnel; `setWebhook` with `secret_token`, `allowed_updates: ["message","callback_query","my_chat_member"]`):
  1. `curl` without the header → 401; with header from a non-Telegram IP and the skip flag off → 401.
  2. In the app DB, `select create_telegram_link_token()` as your user → open `t.me/<bot>?start=<token>` → `Linked. Send me an expense any time.`; `user_profile.telegram_user_id` set.
  3. Same link again → expired copy. Another account's token from the same Telegram → taken copy.
  4. Add the bot to a group, send messages → no reply, no errors in logs.
- [ ] **Step 6: Commit** `feat(telegram): webhook, per-chat inbox and account linking`

---

### Task 6: DM turn (text)

**Files:**
- Create: `src/services/telegram/turn.service.ts`, `src/services/telegram/session.service.ts`, `src/services/telegram/render.service.ts`
- Create: `src/services/ai/chat/run.service.ts` (shared non-HTTP agent run), move `generateMessageId` / `usageMetadata` there from `ai.handler.ts`
- Modify: `src/schemas/ai.ts` (`chatMetadataSchema.telegram`), `src/services/ai/chat/message.service.ts` / `approval.service.ts` (accept `TLedgerDb`-style client union for reads where the Telegram path passes the admin client), `src/services/telegram/update.service.ts`
- Test: `src/services/telegram/turn.service.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5.
- Produces:
  - `chatMetadataSchema.telegram`: `z.object({ chatId: z.number(), messageId: z.number(), fromId: z.number(), fromName: z.string() }).optional()`.
  - `currentSession(admin, { userId, chatId, telegramUserId, now, forceNew }): Promise<string>` — latest session for `(telegram_chat_id, telegram_user_id)`; new one (explicit `user_id`, title from text) when none, `forceNew`, or `shouldRotate(lastMessageAt, now)`.
  - `turnResumeState(history: TChatMessage[], messageId: string): "new" | "resume" | "duplicate"` — `"resume"` if the last message has this id, `"duplicate"` if an earlier one does.
  - `runAgent({ agent, messages }: { agent: ReturnType<typeof chatAgent>; messages: TChatMessage[] }): Promise<TChatMessage | undefined>` — `createAgentUIStream` with the same options `aiChat` passes (`uiMessages: toModelHistory(...)`, `originalMessages`, `generateMessageId`, `messageMetadata: usageMetadata`), consumed with `readUIMessageStream`; returns the last emitted message.
  - `handleDmMessage(deps, message: TTelegramMessage, opts: { forceNew: boolean }): Promise<void>`.
  - `replyText(message: TChatMessage): string` — joined text parts of the assistant message.

- [ ] **Step 1: Write the failing tests**

```ts
it("turnResumeState", () => {
  const u1 = userMsg("tg-1-10"), a1 = assistantMsg("msg-a"), u2 = userMsg("tg-1-11");
  expect(turnResumeState([u1, a1], "tg-1-11")).toBe("new");
  expect(turnResumeState([u1, a1, u2], "tg-1-11")).toBe("resume");
  expect(turnResumeState([u1, a1, u2], "tg-1-10")).toBe("duplicate");
});
it("replyText joins text parts and skips tool parts", () => {
  expect(replyText(assistantWith([text("Saved."), toolPart(), text("Anything else?")]))).toBe("Saved.\n\nAnything else?");
});
```

- [ ] **Step 2: Run** `npm test` — FAIL.
- [ ] **Step 3: Implement** `handleDmMessage` in this order (spec §5.3): linked user by `telegram_user_id = from.id` (else unlinked copy) → `currentSession` → `loadMessages` → `turnResumeState` (`duplicate` → return) → for `new`: `consumeAiUsage(admin, userId, "chat")` (`ChatError` 402/429 → copy, return), `supersedeApprovals`, `appendMessage` with id `telegramMessageId(chat.id, message_id)`, text part from `text`, metadata `telegram` → `sendChatAction` now and every `TYPING_INTERVAL_MS` until done (clear in `finally`) → `runAgent` → `saveMessage` when it has parts → send `splitMessage(replyText(reply))` with `replyTo` on the first chunk (approval cards come in Task 8). `/new` → `forceNew: true` and reply `Started a new conversation.` when it has no other text.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint` — PASS.
- [ ] **Step 5: Manual**: DM "how much did I spend this month?" → answer; two messages within a second → two replies in order; free user → 402 copy; `/new` → next turn starts a new `chat_session`; an app `POST /ai/chat` against that session id → 409.
- [ ] **Step 6: Commit** `feat(telegram): DM turns with session rotation and idempotent resume`

---

### Task 7: Receipt photos

**Files:**
- Create: `src/services/telegram/media.service.ts`
- Modify: `src/services/telegram/turn.service.ts`, `src/services/ai/chat/run.service.ts`
- Test: `src/services/telegram/media.service.test.ts`

**Interfaces:**
- Produces:
  - `userParts(message: TTelegramMessage): TUserPart[] | "unsupported"` — text/caption → text part; photo → `{ type: "file", mediaType: "image/jpeg", url: toTelegramFileUrl(pickPhotoSize(photo).file_id) }`; image `document` with `file_size ≤ 8 MB` → file part with its `mime_type`; voice/video/sticker/other document → `"unsupported"`.
  - `resolveTelegramFiles(messages: TChatMessage[], download: (fileId: string) => Promise<{ bytes: Uint8Array; mediaType: string }>): Promise<TChatMessage[]>` — replaces each `telegram-file:` URL with `data:<mediaType>;base64,<...>`; leaves every other part untouched; downloads each distinct file id once.
  - `runAgent` gains `download?` and applies `resolveTelegramFiles` to the model input only, never to `originalMessages`.

- [ ] **Step 1: Write the failing tests**

```ts
it("userParts maps photo + caption and rejects voice", () => {
  expect(userParts(photoMsg("lunch", [size(800, 600, "A"), size(1280, 960, "B")]))).toEqual([
    { type: "text", text: "lunch" },
    { type: "file", mediaType: "image/jpeg", url: "telegram-file:B" },
  ]);
  expect(userParts(voiceMsg())).toBe("unsupported");
  expect(userParts(documentMsg("application/pdf", 1000))).toBe("unsupported");
  expect(userParts(documentMsg("image/png", 9 * 1024 * 1024))).toBe("unsupported");
});
it("resolveTelegramFiles inlines bytes once per file id and keeps other urls", async () => {
  const download = vi.fn(async () => ({ bytes: new Uint8Array([255]), mediaType: "image/jpeg" }));
  const out = await resolveTelegramFiles([userWithFiles(["telegram-file:B", "telegram-file:B", "https://x/y.png"])], download);
  expect(download).toHaveBeenCalledTimes(1);
  expect(fileUrls(out)).toEqual(["data:image/jpeg;base64,/w==", "data:image/jpeg;base64,/w==", "https://x/y.png"]);
});
```

- [ ] **Step 2: Run** `npm test` — FAIL.
- [ ] **Step 3: Implement**; in `handleDmMessage`, `"unsupported"` → unsupported copy, no quota. Pass `deps.telegram.downloadFile` as `download`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint` — PASS.
- [ ] **Step 5: Manual**: send a receipt photo with caption → agent proposes rows; stored part URL is `telegram-file:…` (check `chat_message.data`); send "and add 2 more for parking" → next turn loads and replays without error; send a voice note → unsupported copy, `ai_usage` unchanged.
- [ ] **Step 6: Commit** `feat(telegram): receipt photos by Telegram file id`

---

### Task 8: Approvals

**Files:**
- Create: `src/services/telegram/approval.service.ts`
- Modify: `src/services/telegram/render.service.ts`, `src/services/telegram/turn.service.ts`, `src/services/telegram/update.service.ts`
- Test: `src/services/telegram/render.service.test.ts`

**Interfaces:**
- Produces:
  - `approvalCard(message: TChatMessage, categories: TCategory[]): string | undefined` — undefined when no pending tool part; otherwise one line per pending call built from its stored input:
    add → `Add N expense(s):` then `• <name> — RM <amount 2dp> (<category name>)` per row (income rows say `income` after the amount);
    update → `Update expense #<id>:` then `• <field>: <value>` per provided field;
    delete → `Delete expense(s) #<id>, #<id>`.
  - `handleCallback(deps, query: TTelegramCallbackQuery): Promise<void>`.
- Behaviour (spec §5.4): `answerCallbackQuery` first; `parseCallbackData` fails → answer and stop; load `chat_message` by id → its session must have `telegram_chat_id = query.message.chat.id` and `telegram_user_id = query.from.id`, else answer `Not your approval.`; owner's plan active (`user_entitlement.entitled_until > now()`) else answer the 402 copy; `loadMessages` → `applyApprovals` with every pending `toolCallId` and the tapped decision. `ChatError` 410 → `Expired after 10 minutes.`, 409 → `Already answered.`; both remove the buttons. Approve → `editMessageText` appends `\n\nApproved.`, remove buttons, `runAgent` continuation, `saveMessage`, send reply text. Reject → append `\n\nRejected. Nothing saved.`, remove buttons, no model call.
  - Turn rendering (Task 6) now sends `approvalCard(...)` with `[Approve] [Reject]` buttons (`formatCallbackData({ approve, messageId: <chat_message.id of the saved assistant row> })`) after any reply text. `saveMessage` must return the row id (add `.select("id").single()`).

- [ ] **Step 1: Write the failing tests**

```ts
it("approvalCard renders add rows with category names", () => {
  const msg = pendingAdd([{ name: "Lunch at Hinz", amount: 48.5, category: 3, is_expense: true, spend_date: "2026-11-21T12:00:00" }]);
  expect(approvalCard(msg, [{ id: 3, name: "Food", is_expense: true }])).toBe("Add 1 expense:\n• Lunch at Hinz — RM 48.50 (Food)");
});
it("approvalCard renders delete and returns undefined when nothing is pending", () => {
  expect(approvalCard(pendingDelete([12, 13]), [])).toBe("Delete expenses #12, #13");
  expect(approvalCard(assistantWith([text("hi")]), [])).toBeUndefined();
});
```

- [ ] **Step 2: Run** `npm test` — FAIL.
- [ ] **Step 3: Implement** render, callback handler and the turn change.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint` — PASS.
- [ ] **Step 5: Manual**: add → Approve → row inserted with your `user_id`, `Approved.` appended, buttons gone; add → Reject → nothing saved, next turn loads; tap Approve twice quickly → second says `Already answered.`; wait 11 minutes → `Expired after 10 minutes.`; send a new message while a card is pending, then tap it → `Already answered.` (superseded).
- [ ] **Step 6: Commit** `feat(telegram): approve and reject with inline buttons`

---

### Task 9: Docs and rollout runbook

**Files:**
- Create: `docs/telegram-api.md` (app contract: `create_telegram_link_token` → open `https://t.me/<bot>?start=<token>` → watch `user_profile.telegram_user_id`; `unlink_telegram`; Telegram sessions are read-only in the app and `telegram-file:` parts render as "Photo sent in Telegram")
- Modify: `AGENTS.md` (Structure: `durable-objects/`, `services/telegram/`, `services/ledger/`, `libs/telegram.ts`; Commands: `npm test`; a "Telegram" section with the rules from Global Constraints), `README.md` if it lists routes
- Create: `scripts/set-telegram-webhook.md` (the exact `curl` for `setWebhook` with `url`, `secret_token`, `allowed_updates`, `drop_pending_updates: true`, and `getWebhookInfo`)

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run lint` — PASS.
- [ ] **Step 3: Run spec §9 checks 1–8, 5a and 14–15** on the test bot; record results in the PR description.
- [ ] **Step 4: Commit** `docs: telegram contract, agent notes and webhook runbook`

Production rollout (BotFather setup, secrets, deploy, `setWebhook`, app release) and the separately confirmed WhatsApp drop are spec §8 steps 1–4 and 6, run with the user after merge — not part of this plan's tasks.
