# Telegram bot and group expenses — design

Date: 2026-11-21 · Worker: `expense-tracker-agent` (this repo) · DB: shared Supabase project

Supersedes the technical design in the "Telegram Group Expenses" TSD (2026-11-15). Its goals stand; its
mechanics are replaced where noted in **Approaches**.

## 1. Intent

WhatsApp is the current chat channel (served by the separate `expense-tracker-ai-worker`). It cannot put a
bot in a group chat, identifies people only by phone number, and costs money per conversation. Telegram
can do all three for free.

What the person wants:

1. **Telegram replaces WhatsApp.** A user links their Telegram account once and then chats with the same
   agent, tools, quota and approve/reject flow they get in the app (`POST /ai/chat`).
2. **Shared group expenses.** A Pro user binds a Telegram group of up to 3 other people. Anyone in it
   records spending by tagging the bot. Every row lands in the owner's ledger, tagged with who added it,
   so the owner sees who spent what.

### Goals

- Telegram DM chat with parity to the app chat: same tools, same monthly quota, same approval rules,
  receipts by photo.
- Telegram group chat bound to one owner, with per-person attribution and a per-person breakdown.
- No public endpoint ever accepts a user id or group id from the caller (see §6).

### Non-goals (this build)

- Members seeing the group in the app (the TSD's phase 3). Members only need Telegram.
- Settle-up / who-owes-whom.
- Voice notes and albums as one turn (see §5.6).
- Running WhatsApp and Telegram side by side long-term. WhatsApp is retired at the end of the rollout.

### Anti-goals (would be a failure even if it works)

- A group member can read the owner's **personal** (non-group) expenses through the bot.
- A request that names a user or group id is trusted.
- A slow agent run is cut off and the user gets no reply, or the same Telegram message is recorded twice.
- Replayed history differs from the live run (breaks Anthropic thinking blocks; see
  `project-chat-history-prefix-stability`).

## 2. Constraints found in the code and platform

| Constraint | Consequence |
|---|---|
| `ctx.waitUntil()` work is cancelled 30 s after the response ([docs](https://developers.cloudflare.com/workers/runtime-apis/context/)) | Agent runs cannot happen after acking Telegram in the same request. |
| JWTs are signed with Supabase's asymmetric keys (`SUPABASE_JWKS_URL`); the Worker has no private key | The bot cannot act as the owner under RLS. It must use the service-role client. |
| Tools rely on RLS: no `user_id` filter on list/get/update/delete; `addExpense` relies on `expense.user_id default auth.uid()` | Under the service-role client, reads would see every user and inserts would write `user_id = null` (the column is nullable). |
| `chat_session.user_id default auth.uid()` | Same: Worker-created sessions must set `user_id` explicitly. |
| `webhooks.use("*", revenuecatAuth)` | A new `/webhooks/telegram` route would require the RevenueCat secret. Scope that middleware to `/revenuecat`. |
| Writes to `expense` / chat tables are plan-gated by RLS (`20261102000000`) | The service-role client bypasses that gate, so the bot must check the plan itself (§5.4). |
| `CHAT_HISTORY_LIMIT` is disabled on purpose; the whole session is replayed each turn | A Telegram DM that never ends grows without bound. Sessions must rotate (§5.2). |
| `purge_lapsed_user_data()` deletes by `user_id`; it never deletes `auth.users` | `on delete cascade` from `owner_id` never fires. The purge must delete groups explicitly. |
| `chat-images` bucket is public, 8 MB, jpeg/png/webp/heic | Telegram photos can be re-hosted there; the Telegram file URL contains the bot token and must never be stored or sent to a model. |
| Tool output schemas validate stored history on load | Any output-shape change must stay backward compatible (new fields optional). |

## 3. Approaches

Chosen by Claude after the person handed over the "how" ("create your version").

### 3.1 Where the agent runs

| Option | Trade-off | |
|---|---|---|
| Ack, then run in `waitUntil` (TSD) | Cut off after 30 s; Anthropic runs with thinking and tool calls can exceed it. | rejected |
| Hold Telegram's request open until done | Simple, but Telegram may redeliver while it waits and connections pile up. | rejected |
| Cloudflare Queue | Up to 15 min per message and retries, but no ordering and concurrent consumers: two quick messages in one chat run at once, interleave their history and can lose a reply. | rejected (builder check) |
| **Durable Object inbox per chat** | Webhook validates, hands the update to the chat's inbox (`TELEGRAM_INBOX`, keyed by chat id), returns 200. The inbox stores it in its SQLite storage and processes that chat's updates one at a time, in order, from an alarm (15 min per run, automatic retries). Different chats run in parallel. | **picked** |

Assumes the account is on Workers Paid (the free plan's 50 subrequests per invocation would not fit an
agent run).

### 3.2 How tools reach data without a user JWT

| Option | Trade-off | |
|---|---|---|
| Explicit `.eq("user_id")` in every tool (TSD) | One missed filter leaks another user's data, and every future tool reopens the risk. | rejected |
| Mint a user JWT | Impossible: asymmetric signing keys. | ruled out |
| **One ledger module** | All expense/category queries go through `ledger({ db, userId, groupId? })`, which applies owner and group filters in one file. Tools never see a raw client. The app path passes the user-scoped client, so RLS and the plan gate still apply there too. | **picked** |

### 3.3 Duplicate deliveries

| Option | Trade-off | |
|---|---|---|
| KV marker per `update_id` (TSD) | KV is eventually consistent; AGENTS.md reserves it for stable data. | rejected |
| **Inbox + database uniqueness** | The inbox's SQLite table is keyed by `update_id`, so a redelivered update is ignored on arrival (strongly consistent, unlike KV). For a retry after a crash mid-turn, the stored user message has `id = "tg-<chat_id>-<message_id>"`; finding it as the last stored message resumes the run without charging quota (§5.3). Approval taps are already single-use (conditional update). | **picked** |

### 3.4 Group membership

| Option | Trade-off | |
|---|---|---|
| Track `new_chat_members` events (TSD) | Misses people who were in the group before the bot joined; a bot cannot list members. | rejected |
| **Register on first mention** | The first time a person tags the bot, they take a free slot (up to `member_limit`). `left_chat_member` frees the slot. The owner can remove a member in the app. | **picked** |

### 3.5 Binding a group to its owner

The TSD auto-linked whoever sent the `startgroup` token as the owner's Telegram account; a leaked token
would hand over the account link. **Picked:** the owner must link Telegram by DM first (slice 1), and a
group binds only when the sender's `from.id` equals the owner's linked `telegram_user_id`.

## 4. Data model

One additive migration for each slice, then a separately confirmed destructive migration (§8).

### 4.1 Slice 1 — linking and DM sessions

```sql
alter table public.user_profile
  add column telegram_user_id bigint unique,
  add column telegram_linked_at timestamptz,
  add column telegram_link_token text unique,
  add column telegram_link_expires_at timestamptz;

alter table public.chat_session
  add column telegram_chat_id bigint,          -- not unique: sessions rotate (§5.2)
  add column telegram_user_id bigint;          -- who the conversation is with (DM: = chat id)
create index chat_session_telegram_idx
  on public.chat_session (telegram_chat_id, telegram_user_id, created_at desc)
  where telegram_chat_id is not null;
```

RPCs (SECURITY DEFINER; nullable params trailing `default null`):

| Function | Caller | Behaviour |
|---|---|---|
| `create_telegram_link_token()` | app (`auth.uid()`) | Upserts the profile row, sets a 32-char base64url token with a 10-min expiry, returns it. |
| `link_telegram(p_token text, p_telegram_user_id bigint)` | Worker (service role) | Valid unexpired token → sets `telegram_user_id`, `telegram_linked_at`, clears the token, returns `user_id`. Raises `token_invalid` or `telegram_already_linked` (that Telegram id is on another account). |
| `unlink_telegram()` | app (`auth.uid()`) | Clears the link. Existing sessions stay readable. |

`execute` revoked from `public, anon`; `link_telegram` revoked from `authenticated` too.

### 4.2 Slice 2 — groups

```sql
create table public.expense_group (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null check (length(name) between 1 and 60),
  telegram_chat_id bigint unique,               -- null until bound
  link_token text not null unique
    default encode(extensions.gen_random_bytes(24), 'base64url'),
  member_limit int not null default 3 check (member_limit between 1 and 20),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.expense_group_member (
  group_id uuid not null references public.expense_group on delete cascade,
  telegram_user_id bigint not null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (group_id, telegram_user_id)
);

alter table public.expense
  add column group_id uuid references public.expense_group on delete set null,
  add column added_by_telegram_user_id bigint;
create index expense_group_spend_idx
  on public.expense (group_id, spend_date desc) where group_id is not null;

alter table public.chat_session
  add column group_id uuid references public.expense_group on delete cascade;
```

- `member_limit` counts members other than the owner. The owner is never a row in
  `expense_group_member`; the owner is identified by `user_profile.telegram_user_id`.
- `expense.group_id ... on delete set null`: deleting a group never deletes the owner's spending.
- `get_group_expense_stats(p_group_id uuid, p_year int default null, p_month int default null)` returns
  one row per `added_by_telegram_user_id` with income, expenses and balance (invoker rights, called by the
  Worker with the service role).

RLS (owner only; members have no app access in this build):

- `expense_group`: select/update/delete `owner_id = auth.uid()`. Insert `with check (owner_id = auth.uid()
  and exists (active Pro entitlement))` — "active" is `user_entitlement.entitled_until > now()` and
  `tier = 'pro'`. Clients may update only `name` and `archived_at` (column grants).
- `expense_group_member`: select/delete by the group's owner. No client insert/update.
- `expense`: unchanged (owner sees their group rows as their own rows).

### 4.3 Retention

`purge_lapsed_user_data()` gains, before the `expense` delete (slice 2):
`delete from public.expense_group where owner_id in (select user_id from lapsed);` (members and group
sessions cascade). Telegram photos are not stored by us (§5.6), so there is no storage cleanup.

### 4.4 Size estimate (per the cost rule)

For 1,000 Pro users with 2 groups of 4 people each and DM sessions rotating about daily:

| Table | Rows / year | ≈ Size |
|---|---|---|
| `expense_group` | 2,000 | 0.4 MB |
| `expense_group_member` | 6,000 | 1 MB |
| `expense` new columns | +24 B/row | +2.4 MB per 100k rows |
| `chat_session` (rotation) | ~365k | ~55 MB |

Under 60 MB a year. Telegram photos cost no storage: only Telegram's `file_id` is kept (§5.6).

## 5. Behaviour

### 5.1 Request path

```
Telegram ──POST /webhooks/telegram──▶ telegramAuth (IP range + secret header, constant time)
                                     ▶ zod: telegramUpdateSchema (loose; unknown kinds ack + drop)
                                     ▶ TELEGRAM_INBOX.getByName(chat id).enqueue(update) ──▶ 200
TelegramInbox Durable Object (one per chat, SQLite-backed; exported from src/index.ts)
   enqueue: insert-or-ignore by update_id, set an alarm if none
   alarm:   take the oldest update, process it, delete it, repeat; stop and re-arm after 10 min
            a throw retries the alarm; an update that failed 3 times is dropped, logged,
            and the chat gets "Something went wrong with that message, please send it again."
   └─ per update: route by update kind
        private message  "/start <token>" → link      | anything else → DM turn
        group message    "/start@bot <token>" → bind  | mentions/replies to bot → group turn
                         left_chat_member → free slot | migrate_to_chat_id → rebind
        callback_query   → approval
        my_chat_member   left/kicked in a group → archive group
```

- `allowed_updates` at `setWebhook`: `message`, `callback_query`, `my_chat_member`.
- Group Privacy stays **on** in BotFather; the bot is never made admin (admins receive every message).
- Telegram source ranges: `149.154.160.0/20`, `91.108.4.0/22`, checked on `cf-connecting-ip`. A
  `TELEGRAM_SKIP_IP_CHECK = "true"` var (in `.dev.vars` only) disables it for local testing.

### 5.2 Sessions

- A Telegram conversation is a `chat_session` with `telegram_chat_id` and `telegram_user_id` set. DM:
  both are the user's id. Group: the group chat id and **the sender's** Telegram id, plus `group_id` —
  **one conversation per person inside a group**, so one member's message never cancels another
  member's pending approval. `user_id` is always the ledger owner, set explicitly.
- **Rotation:** a new session starts when that person's latest session in that chat has no message in
  the last 3 hours, or on `/new`. This bounds replayed history and therefore cost.
- Title: from the first message, as today.
- The app lists these sessions read-only. `POST /ai/chat` returns `409` for a session with
  `telegram_chat_id` set, so a Telegram conversation is never continued without its group scope.

### 5.3 A turn (DM or group)

1. Resolve the scope from the database (never from the payload):
   - DM: `user_profile where telegram_user_id = from.id` → `userId`. Not linked → reply how to link.
   - Group: `expense_group where telegram_chat_id = chat.id and archived_at is null` → owner and group.
     The sender must be the owner or an active member; else register them if a slot is free; else reply
     "This group is full".
   - Group only: owner's entitlement must be active `pro`; else reply "paused".
2. Current session (rotate per §5.2); load history.
3. **Idempotency:** message id `tg-<chat_id>-<message_id>`. If it is already the last stored message, the
   previous attempt stored it but did not finish — resume at step 6 without charging quota. If it is
   stored earlier, drop the update.
4. `consume_ai_usage(owner, "chat")` → 402/429 becomes one plain reply, nothing stored.
5. `supersedeApprovals`, then `appendMessage` with `metadata.telegram = { chatId, messageId, fromId,
   fromName }`.
6. Send "typing" (repeat every 4 s while running), run the agent with the SDK's non-HTTP UI-message stream
   path, keep the final `UIMessage`, `saveMessage` it.
7. Render (§5.5) as a reply to the user's Telegram message.

Unexpected errors throw out of the inbox alarm, which retries it (§5.1); step 3 makes retries safe.
The inbox runs one update per chat at a time, so turns in one chat never overlap.

### 5.4 Approval

- Each approval card carries `callback_data = "apv:<0|1>:<chat_message.id>"` (fits Telegram's 64 bytes).
  The decision applies to **all** pending calls on that message (one card per assistant message).
- Checks, in order: the message's session belongs to this Telegram chat; the tapper is allowed (DM: the
  linked user; group: the requester — `metadata.telegram.fromId` of the preceding user message — or the
  owner); the owner's plan is active (the service role bypasses the RLS plan gate, so check
  `user_entitlement` here); then `applyApprovals` (single-use, 10-min expiry → "expired" toast).
- `answerCallbackQuery` first, always. After a decision, remove the buttons and append "Approved by X" /
  "Rejected by X".
- Approve → run the continuation (no quota). Reject → stored as `output-denied`, no model call.
- In a group, rows are stamped with the **requester** as `added_by`, not the tapper.

### 5.5 What the bot says

- Model text is sent as plain text (no `parse_mode`), split at 4,096 chars. The Telegram prompt variants
  tell the model not to use Markdown.
- Approval cards are built from the stored tool input, not from model text, e.g.
  `Add 2 expenses for Aisyah:\n• Lunch at Hinz — RM 48.50 (Food)\n• Grab — RM 12.00 (Transport)`
  with buttons [Approve] [Reject]. Category names come from the cached category list.
- 402: "AI chat needs a Plus or Pro plan." 429: "You've used this month's N messages." Group paused:
  "This group is paused because the owner's Pro plan ended." Unlinked DM: "Link your account: open the
  app → Settings → Telegram."

### 5.6 Receipts and media

- Photo (or image document up to 8 MB): take the largest photo size with both sides ≤ 1,280 px and store
  a `file` part with `url: "telegram-file:<file_id>"` and its `mediaType` (`image/jpeg` for photos). No
  bytes are stored by us.
- Before every model call, `resolveTelegramFiles(messages)` replaces each `telegram-file:` URL with a
  `data:` URL: `getFile` → download → base64. Same file id → same bytes → replay matches the live run.
  The download URL (contains the bot token) is never stored, logged or sent to a model.
- The app shows these parts as "Photo sent in Telegram" (contract in `docs/telegram-api.md`); `/ai/chat`
  never loads Telegram sessions (§5.2), so it never sees the scheme.
- Caption becomes the text part.
- Voice notes, video, stickers: reply "I can read text and photos for now." No quota charged.
- Albums arrive as separate messages and become separate turns (known limitation).

### 5.7 Group mode in the ledger and tools

The ledger is the only place that queries `expense` / `expense_category` for the agent.

| Scope | Reads | Inserts | Updates / deletes |
|---|---|---|---|
| App (`/ai/chat`) | `user_id = userId` (plus RLS) | `user_id = userId` | `user_id = userId` |
| Telegram DM | `user_id = userId` | `user_id = userId` | `user_id = userId` |
| Telegram group | `user_id = owner and group_id = group` | adds `group_id`, `added_by_telegram_user_id = requester` | `user_id = owner and group_id = group` |

- Group members can never read or change the owner's personal rows: every group-scope query filters on
  `group_id`.
- `getExpenseSummary` in group scope uses `get_group_expense_stats` and adds an optional `byPerson` array
  (name resolved from `expense_group_member`, owner from the profile). Optional, so stored outputs stay
  valid.
- Categories are the owner's, through the existing KV cache (`cacheKey("categories", userId)`).
- Prompt: `chatInstructions({ channel })` with `"app"` (unchanged text, byte for byte), `"telegram-dm"`,
  `"telegram-group"` ("shared group owned by one account; each message says who sent it; record for the
  sender; break totals down by person unless told otherwise; keep replies short; no Markdown").
- `toModelHistory` prefixes group user messages with `[Sent <time> by <fromName>]`, from stored metadata
  only, so replays match.

### 5.8 Group lifecycle

- **Create (app):** insert `expense_group { name }` → open `https://t.me/<bot>?startgroup=<link_token>`.
- **Bind:** `/start@<bot> <token>` in a group, sender = owner's linked Telegram id, group unbound and not
  archived → set `telegram_chat_id`, reply "Linked to <name>. Up to 3 people can tag me." Otherwise reply
  "Open the group link from the app (and link Telegram first)."
- **Leave:** `left_chat_member` → set `left_at`. Re-mentioning later re-registers if a slot is free.
- **Supergroup migration:** `migrate_to_chat_id` → update `expense_group` and its sessions' chat id.
- **Bot removed:** `my_chat_member` status `left`/`kicked` → `archived_at = now()`.
- **Owner lapses:** paused (derived at request time, no job); purge after 90 days (§4.3).

## 6. Security

- **No caller-supplied ids.** App path: the user id comes from the verified JWT. Telegram path: the
  request is authenticated by the webhook secret plus Telegram's IP ranges; `chat.id` / `from.id` are
  looked up in the database to get `userId` / `groupId`. Queue messages can only be produced by this
  Worker. The ledger is an internal function, not an endpoint.
- Tool inputs on approval come from the stored message; buttons carry only a pointer.
- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (`wrangler secret put` / `.dev.vars`). Var:
  `TELEGRAM_BOT_USERNAME`. Run `npm run cf-typegen` after editing `wrangler.jsonc`.
- Logs: update id, chat id, kind, outcome, duration. Never message text, captions or file URLs.
- Residual risk: a leaked webhook secret **and** a request from Telegram's IP ranges would be needed to
  forge an update. Rotate by calling `setWebhook` with a new secret.

## 7. Module layout

Follows the repo layers. Files over 200 lines split by responsibility.

| File | Responsibility |
|---|---|
| `src/index.ts` | `export default app` plus `export { TelegramInbox }` |
| `src/durable-objects/telegram-inbox.durable-object.ts` | The per-chat inbox (§5.1): SQLite table, `enqueue`, `alarm`, retry/poison handling; calls `handleUpdate` |
| `src/routes/webhooks.route.ts` | `revenuecatAuth` scoped to `/revenuecat`; add `/telegram` with `telegramAuth` + validator + handler |
| `src/middlewares/telegram-auth.middleware.ts` | IP range + secret header check (same shape as `revenuecatAuth`) |
| `src/schemas/telegram.schema.ts` | Update, callback data, Bot API response schemas |
| `src/handlers/telegram.handler.ts` | Hand the update to its chat's inbox and ack |
| `src/services/telegram/*.service.ts` | `update` (routing), `link`, `group`, `turn`, `approval`, `render`, `media` |
| `src/services/ledger/*.ts` | The scoped ledger (§3.2, §5.7) |
| `src/libs/telegram.ts` | Typed Bot API client (`sendMessage`, `sendChatAction`, `answerCallbackQuery`, `editMessageReplyMarkup`, `getFile`) |
| `src/services/ai/agents/chat.agent.ts` | `chatAgent({ env, ledger, channel })` — no Hono context, so the queue can build it |
| `src/services/ai/tools/*.tools.ts` | Tools take the ledger; split to stay under 300 lines |
| `src/utils/model.ts` | `getModel({ env, ... })` instead of `{ c }` |
| `src/schemas/ai.ts` | `chatMetadataSchema.telegram` (optional) |
| `src/services/ai/chat/*` | Accept either client where the Telegram path needs the admin one; `/ai/chat` keeps its ownership checks |
| `src/types/telegram.ts`, `src/constants/telegram.ts` | Types from schemas; limits, prefixes, IP ranges, rotation gap |
| `wrangler.jsonc` | `durable_objects` binding `TELEGRAM_INBOX` → `TelegramInbox`, `migrations` `new_sqlite_classes`, var |
| `docs/telegram-api.md` | App contract: link, create group, read-only sessions |

## 8. Rollout

1. BotFather: create bot, privacy on, commands `/start`, `/new`, `/help`.
2. Migration A (additive): §4.1 + purge update. Apply.
3. Worker: slice 1 code, queue, secrets; deploy; `setWebhook` with `secret_token`, `allowed_updates`,
   `drop_pending_updates`.
4. App release: "Link Telegram" replaces the WhatsApp screen.
5. Migration B (additive): §4.2. Worker slice 2; app group screens.
6. **Separately confirmed** destructive migration: drop `user_profile.whatsapp_*`, `link_whatsapp`,
   `unlink_whatsapp`, `whatsapp_pending_actions`; retire `expense-tracker-ai-worker`. Only after the
   Kotlin app and the ai-worker no longer read them; dry-run count and a yes/no first.

## 9. Verification

`npm run typecheck` and `npm run lint` add no errors. With a test bot pointed at a deployed preview:

1. Missing or wrong secret, or a non-Telegram IP → 401, nothing enqueued.
2. Same update delivered twice → one stored message, one reply.
3. Link: fresh token / expired token / Telegram id already on another account.
4. DM: add → approve → row with `user_id` set and no `group_id`. Reject → nothing saved, next turn loads.
5. DM photo receipt → stored part is `telegram-file:<file_id>`, approval card shown; the next turn in
   the same session still loads and replays it.
5a. Two messages sent within a second in one chat → answered in order, each gets its own reply.
6. Agent run longer than 30 s completes and replies.
7. Quota exhausted → one plain reply, nothing stored.
8. Free user DM → plan message; approval tapped after the plan lapses → refused.
9. Group bind by the owner works; bind by anyone else is refused.
10. 4th person in a 3-member group → "full"; after someone leaves, they can join.
11. Member adds; another member taps Approve → refused; requester approves → row has owner, group,
    `added_by`. Member A's pending card survives member B tagging the bot.
12. In a group, "list my expenses" / "total this month" never include the owner's personal rows.
13. Supergroup migration keeps working; bot removed → group archived.
14. 3-hour gap → new session; `/new` → new session.
15. `POST /ai/chat` on a Telegram session → 409.

## 10. Left to the builder

- Exact zod shapes, file splits, helper names, Telegram copy wording.
- How Braintrust tracing is initialised on the queue path (match `braintrust.middleware.ts`).
- Whether the "typing" loop uses a timer or re-sends between agent steps.
- Local testing setup (tunnel vs preview deploy).
