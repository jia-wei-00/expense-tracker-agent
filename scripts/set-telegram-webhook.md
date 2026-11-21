# Telegram webhook runbook

Not an executable script: the steps to run by hand, in order, the first time
and whenever the secret or the Worker URL changes. Use placeholders below;
never commit real values.

Spec: `docs/superpowers/specs/2026-11-21-telegram-bot-design.md` (section 8).

## 1. Create the bot (BotFather)

In Telegram, talk to `@BotFather`:

1. `/newbot` -> name and username. Keep the token it returns (`<BOT_TOKEN>`).
2. `/setprivacy` -> pick the bot -> **Enable** (privacy mode on). The bot is
   DM-only and must not see group traffic.
3. Never add the bot to a group or channel, and never make it an admin anywhere.
4. `/setcommands` -> pick the bot -> send:

   ```
   start - Link your account
   new - Start a new conversation
   help - How to use this bot
   ```

## 2. Generate the webhook secret

Telegram's `secret_token` must be 1-256 characters of `A-Za-z0-9_-`:

```sh
openssl rand -hex 32
```

Call the result `<WEBHOOK_SECRET>`.

## 3. Configure the Worker

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN        # paste <BOT_TOKEN>
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # paste <WEBHOOK_SECRET>
```

Set `TELEGRAM_BOT_USERNAME` in `wrangler.jsonc` `vars` to the bot's username
without the `@` (it ships as `""` with a TODO). The app builds the
`https://t.me/<bot>?start=<token>` link from it, so the link is broken until it
is set. Then deploy; the first deploy also creates the `TelegramInbox` Durable
Object (migration `v1`):

```sh
npm run deploy
```

Apply `migrations/20261122000000_telegram_link.sql` to the Supabase project
before the app release (it is additive and safe to apply first).

Local development uses `.dev.vars` instead (`TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_SKIP_IP_CHECK=true` so a tunnel works).
Never set `TELEGRAM_SKIP_IP_CHECK` in production.

## 4. Register the webhook

```sh
curl -sS "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<WORKER_HOST>/webhooks/telegram",
    "secret_token": "<WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query", "my_chat_member"],
    "drop_pending_updates": true
  }'
```

`drop_pending_updates` discards anything queued while the bot had no webhook.
Expect `{"ok":true,"result":true,"description":"Webhook was set"}`.

## 5. Verify

```sh
curl -sS "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

Check `url` is the Worker URL, `pending_update_count` is near 0,
`allowed_updates` matches, and there is no `last_error_message`. A `401` in
`last_error_message` means the secret in Telegram and the Worker differ.

## Rotating the secret

1. Generate a new `<WEBHOOK_SECRET>` (step 2).
2. `npx wrangler secret put TELEGRAM_WEBHOOK_SECRET` with the new value.
3. Re-run `setWebhook` (step 4) with the same `url` and the new `secret_token`.
   Omit `drop_pending_updates` so queued updates are kept.

Between 2 and 3 Telegram's deliveries are rejected with `401` and retried, so do
them back to back. To rotate the bot token, revoke it in BotFather (`/revoke`),
`wrangler secret put TELEGRAM_BOT_TOKEN`, then re-run step 4 with the new token.
