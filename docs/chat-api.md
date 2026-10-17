# Chat API — client contract

The backend owns chat history. The client sends only the new user message (or
approval decisions); history is loaded and persisted server-side.

All requests need `Authorization: Bearer <supabase access_token>`.

## Sessions and history: read directly from Supabase

RLS limits both tables to the signed-in user. The client may **read**
`chat_session` / `chat_message` and **rename/delete** `chat_session`. It cannot
write `chat_message`.

```ts
// Session list (newest first)
supabase.from("chat_session").select("id, title, updated_at").order("updated_at", { ascending: false });

// History for useChat({ id: sessionId, messages })
const { data } = await supabase.from("chat_message").select("data").eq("session_id", sessionId).order("id");
// `data` is untyped jsonb: validate instead of casting.
const messages = await validateUIMessages({ messages: (data ?? []).map((row) => row.data) });

// Rename / delete (delete cascades to messages and cancels pending approvals)
supabase.from("chat_session").update({ title }).eq("id", sessionId);
supabase.from("chat_session").delete().eq("id", sessionId);
```

A new chat needs no request: generate a UUID client-side (`crypto.randomUUID()`)
and send the first message. The session is created and titled from that message.

## `POST /ai/chat`

Response: an AI SDK UI message stream (`useChat` / `DefaultChatTransport`).

**New message**

```json
{
  "sessionId": "uuid",
  "message": {
    "id": "client-generated id",
    "role": "user",
    "parts": [
      { "type": "text", "text": "52.11 pants yesterday" },
      { "type": "file", "mediaType": "image/jpeg", "url": "https://… or data:…" }
    ]
  }
}
```

Only `role: "user"` with `text` / `file` parts (`image/*`, `audio/*`) is accepted.

**Answer pending approvals**

Write tools (`addExpense`, `updateExpense`, `deleteExpense`) stop with tool parts
in `state: "approval-requested"`; render `part.input` as a confirm card.
`addExpense` takes `{ expenses: [...] }` and `deleteExpense` takes `{ ids: [...] }`,
so one call (one approval) can cover several records; their outputs return
`data` as an array. Every
pending call in the last assistant message must be answered in one request:

```json
{ "sessionId": "uuid", "approvals": [{ "callId": "<part.toolCallId>", "approve": true }] }
```

The server executes approved calls with the **stored** arguments and streams the
continuation of the same assistant message. Sending a new message instead
cancels the pending calls (`state: "output-denied"`).

**Errors** (`application/problem+json`, returned before streaming starts)

| Status | When |
|---|---|
| 404 | Session not found / not yours |
| 409 | No pending approval, unknown or already answered `callId`, reused message id |
| 410 | Approval older than 10 minutes — send a new message instead |
| 422 | Invalid body, or not every pending call was answered |

**Metadata**: the assistant message's `metadata.usage` (`inputTokens`,
`outputTokens`, `totalTokens`) arrives on `finish`, for the context meter.

### React Native wiring

```ts
import { fetch as expoFetch } from "expo/fetch";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";

const chat = useChat({
  id: sessionId,
  messages: initialMessages, // from chat_message
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  transport: new DefaultChatTransport({
    api: `${AI_BASE_URL}/ai/chat`,
    // expo/fetch's signature differs from the global fetch type (AI SDK Expo guide).
    fetch: expoFetch as unknown as typeof fetch,
    headers: async () => ({ Authorization: `Bearer ${await getAccessToken()}` }),
    prepareSendMessagesRequest: ({ id, messages }) => {
      const last = messages.at(-1)!;
      if (last.role === "assistant") {
        const approvals = last.parts.flatMap((p) =>
          isToolUIPart(p) && p.state === "approval-responded"
            ? [{ callId: p.toolCallId, approve: p.approval.approved }]
            : [],
        );
        return { body: { sessionId: id, approvals } };
      }
      return { body: { sessionId: id, message: last } };
    },
  }),
});

// Confirm / reject card
chat.addToolApprovalResponse({ id: part.approval.id, approved: true });
```

The client must not write `expense` itself for chat-proposed actions; the
approved tool call does the write.

## `POST /ai/scan`

Stateless receipt extraction; nothing is stored.

```json
{ "url": "https://… or data:image/jpeg;base64,…", "mediaType": "image/jpeg" }
```

Response:

```json
{
  "success": true,
  "data": { "name": "pants", "amount": 52.11, "category": 3, "is_expense": true, "spend_date": "2026-10-10T00:00:00" }
}
```

`422` when no expense could be read from the image.
