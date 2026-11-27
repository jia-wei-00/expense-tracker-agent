# Telegram bot — client contract

Users can chat with the expense agent in a Telegram direct message. The backend
owns the bot: Telegram calls `POST /webhooks/telegram`, the Worker runs the same
agent as `/ai/chat`, and the app only links the account and shows the
conversations. Same plans and AI quota as the app (see `docs/subscription-api.md`).
Telegram is DM-only: messages from groups and channels are ignored.

## Linking an account

1. The app calls the RPC (signed in; `auth.uid()`):

   ```ts
   const { data: token } = await supabase.rpc("create_telegram_link_token");
   ```

   The token is single-use, 32 characters of `A-Za-z0-9_-`, and valid for 10
   minutes. Calling it again replaces the previous token.

2. Open the deep link (`<bot>` is the bot's username without the `@`; the app
   keeps it in its own config, the Worker does not expose it):

   ```
   https://t.me/<bot>?start=<token>
   ```

   Telegram shows a Start button; tapping it sends `/start <token>` to the bot.

3. The Worker links the Telegram account to the user and replies in the chat.
   Watch for the result by re-reading (or subscribing to) `user_profile`:

   ```ts
   supabase.from("user_profile").select("telegram_user_id, telegram_linked_at").maybeSingle();
   ```

   `telegram_user_id` set means linked. Failures are shown to the user in
   Telegram (expired token, or the Telegram account already belongs to another
   user); the app sees no change, so offer a "get a new link" action.

4. To unlink, call `supabase.rpc("unlink_telegram")`. It clears the link and any
   pending token. Existing Telegram sessions stay readable in the app. The bot
   answers an unlinked account with a prompt to link again.

`telegram_user_id` is unique: one Telegram account links to at most one user.
Linking does not require a plan, but chatting does (Plus or Pro, with quota
left); otherwise the bot replies with the reason instead of running the agent.

## Telegram conversations in the app

Telegram conversations are ordinary `chat_session` / `chat_message` rows that
the app reads under RLS, like in-app chats. They are told apart by
`chat_session.telegram_chat_id` (not null).

- Show them **read-only**. `POST /ai/chat` for such a session returns
  `409` `This conversation belongs to Telegram`. Renaming and deleting the
  session directly is still allowed; deleting cascades to its messages and
  cancels any pending approval.
- `chat_session.user_id` is always the linked user. A new session starts after
  3 idle hours or when the user sends `/new`, so a user can have many Telegram
  sessions.
- Approvals happen in Telegram with inline buttons. Stored tool parts follow the
  same states as `docs/chat-api.md` (`approval-requested`, `output-denied`, ...);
  the app must not offer approve/reject for a Telegram session.
- Receipt photos are stored as `file` parts with
  `url: "telegram-file:<file_id>"`. That URL is not loadable: never fetch it.
  Render such a part as the text "Photo sent in Telegram" (the original stays on
  Telegram; the Worker re-downloads it for the model on every turn).

## Bot commands

| Command | Behavior |
|---|---|
| `/start <token>` | Links the account (above). A bare `/start` gets the link prompt, or the help text once linked. |
| `/new [text]` | Starts a fresh conversation; any text after the command is its first message. Unanswered approvals in the previous conversation are cancelled. |
| `/help` | Short usage text. |
| any text / photo | One agent turn. Other media types get an "unsupported" reply. |

Write tools (add, update, delete expenses) ask for approval with Approve /
Reject buttons on the reply; the tap resolves it and the agent continues.
Approvals expire after 10 minutes, and a new message cancels them. Photos are
accepted as JPEG, PNG or WebP (sent as a photo or as an image file up to 8 MB).

## Webhook (server side, for reference)

`POST /webhooks/telegram` is called only by Telegram: the request must come from
Telegram's IP ranges and carry `X-Telegram-Bot-Api-Secret-Token`, otherwise
`401`. The update is stored in the chat's inbox Durable Object and acknowledged
with `200`; the agent runs afterwards, one update at a time per chat. Setup and
rollout: `scripts/set-telegram-webhook.md`.
