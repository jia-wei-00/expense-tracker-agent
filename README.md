# Expense Tracker API

A Cloudflare Workers API (Hono + TypeScript) that powers an AI expense assistant. Users chat in natural language ("52.11 pants yesterday"), scan receipts, and the agent reads or changes their expenses in Supabase. Any action that writes data must be approved by the user first (human-in-the-loop).

- **Runtime:** Cloudflare Workers, with KV for caching
- **Framework:** Hono
- **AI:** Vercel AI SDK `ToolLoopAgent`, traced with Braintrust
- **Models:** Groq (chat agent), Gemini (receipt scan). Mercury and NVIDIA are also supported in `src/utils/model.ts`.
- **Data and auth:** Supabase (Postgres with RLS, JWT auth)

## Getting started

```txt
npm install
npm run dev          # wrangler dev (local state in .wrangler/)
npm run deploy       # wrangler deploy --minify
npm run cf-typegen   # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

Secrets live in `.dev.vars` locally. They include the Supabase settings, `GROQ_API_KEY`, `GEMINI_API_KEY`, `BRAINTRUST_API_KEY` and an optional `CORS_ORIGIN`. The model names and base URLs can be overridden in `src/constants/model-config.ts`.

Typecheck with `bunx --package typescript@5 tsc --noEmit`.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /ai/chat` | Send a message, or approve/reject pending actions. Streams the reply as an AI SDK UI message stream. |
| `POST /ai/scan` | Stateless receipt OCR. Returns a proposed expense for the client's form and writes nothing. |

The full client contract is in [`docs/chat-api.md`](docs/chat-api.md).

## How the system works

### 1. Architecture

```mermaid
flowchart LR
    Client["Mobile / Web client<br/>(useChat)"]

    subgraph Worker["Cloudflare Worker (Hono)"]
        direction TB
        MW["Middleware<br/>CORS → withSupabase (JWT) → Braintrust"]
        Val["zod validator"]
        Chat["aiChat"]
        Scan["aiScan"]
        Hist["chat-history.ts<br/>(sessions, approvals)"]
        Agent["triageAgent<br/>(ToolLoopAgent)"]
        Tools["expense tools"]
        MW --> Val --> Chat
        Val --> Scan
        Chat --> Hist
        Chat --> Agent --> Tools
    end

    KV[("Cloudflare KV<br/>category cache")]
    SB[("Supabase Postgres<br/>chat_session, chat_message,<br/>expense, expense_category")]
    LLM["LLM providers<br/>Groq / Gemini"]
    BT["Braintrust<br/>tracing"]

    Client -- "Bearer JWT" --> MW
    Client -. "direct read via RLS<br/>(history, rename, delete)" .-> SB
    Hist -- "user client: read, ownership check<br/>admin client: write chat_message" --> SB
    Tools -- "user client (RLS)" --> SB
    Tools --> KV
    Scan --> KV
    Agent --> LLM
    Scan --> LLM
    Agent -.-> BT
```

**Two Supabase clients, on purpose**

| Client | Used for | Why |
|---|---|---|
| `supabase` (user-scoped) | Reads, expense tools, session ownership checks | RLS enforces that users only see their own rows. |
| `supabaseAdmin` (service role) | Writing `chat_message` | Users have no insert/update policy on `chat_message`, so a stored approval request cannot be tampered with. Every admin write is preceded by a user-scoped ownership check. |

### 2. Request flow for `POST /ai/chat`

```mermaid
flowchart TD
    A["POST /ai/chat"] --> B{"Auth + body valid?"}
    B -- "no" --> E1["401 / 422 problem+json"]
    B -- "yes" --> C{"Body has<br/>approvals?"}

    C -- "new message" --> D["ensureSession<br/>(create + title on first use)"]
    D --> D2["Load last 40 messages<br/>and validate them"]
    D2 --> D3["Supersede pending approvals<br/>(set output-denied)"]
    D3 --> D4["Insert user message<br/>(409 if id reused)"]
    D4 --> R

    C -- "approvals" --> F["Check session exists<br/>(404)"]
    F --> F2["Load and validate history"]
    F2 --> F3{"Pending calls exist (409),<br/>all answered (422),<br/>younger than 10 min (410)?"}
    F3 -- "no" --> E2["Error before streaming"]
    F3 -- "yes" --> F4["Conditional update:<br/>approval-responded<br/>(single use)"]
    F4 --> R

    R["Run triageAgent with the history"] --> S["Stream UI messages to the client"]
    S --> G{"Agent step result"}
    G -- "read tool" --> H["Execute immediately<br/>and loop back to the model"]
    H --> G
    G -- "write tool" --> I["Stop with state<br/>approval-requested"]
    G -- "final text" --> J["Done"]
    I --> K["onEnd: upsert assistant message<br/>(waitUntil)"]
    J --> K
```

### 3. Sequence: a normal message that reads data

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client (useChat)
    participant W as Worker (Hono)
    participant DB as Supabase
    participant KV as KV cache
    participant M as LLM (Groq)

    U->>C: "How much did I spend this month?"
    C->>W: POST /ai/chat {sessionId, message} + JWT
    W->>W: Verify JWT, validate body
    W->>DB: Session exists? (user client)
    alt first message
        W->>DB: INSERT chat_session (title from message)
    end
    W->>DB: SELECT last 40 chat_message (user client)
    W->>DB: INSERT user message (admin client)
    W->>M: history + tool definitions
    M-->>W: tool call get_expense_summary
    W->>DB: rpc get_expense_stats (user client, RLS)
    DB-->>W: balance, income, expenses
    W->>M: tool result
    M-->>W: final answer (streamed)
    W-->>C: UI message stream
    C-->>U: render reply
    W->>DB: UPSERT assistant message with usage (waitUntil, admin client)
```

### 4. Sequence: human-in-the-loop write (add, update, delete)

Write tools are declared with `needsApproval: true`. The agent never writes data by itself. The run stops, the client shows a confirm card, and the write happens only after the user approves.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant W as Worker
    participant DB as Supabase
    participant M as LLM

    U->>C: "52.11 pants yesterday"
    C->>W: POST /ai/chat {sessionId, message}
    W->>M: history + tools
    M-->>W: tool call add_expense({expenses: [...]})
    Note over W: needsApproval = true, so the tool is NOT executed
    W-->>C: stream tool part, state = approval-requested
    W->>DB: UPSERT assistant message with the pending part (waitUntil)
    C-->>U: confirm card showing part.input

    alt user approves
        U->>C: Approve
        C->>W: POST /ai/chat {sessionId, approvals: [{callId, approve: true}]}
        W->>DB: load history, validate approvals (404 / 409 / 410 / 422)
        W->>DB: conditional UPDATE: approval-requested to approval-responded
        Note over W,DB: Args come from the STORED message, never from the client.<br/>The conditional update makes each approval single-use.
        W->>DB: INSERT expense rows in one batch (user client, RLS)
        W->>M: tool result
        M-->>W: confirmation text
        W-->>C: stream continuation of the same assistant message
        W->>DB: UPSERT assistant message (same ui_id)
    else user rejects
        C->>W: POST /ai/chat {approvals: [{callId, approve: false}]}
        W->>M: denied result + reason "Nothing was saved"
        M-->>W: acknowledgement
        W-->>C: stream
    else user types a new message instead
        C->>W: POST /ai/chat {message}
        W->>DB: pending parts set to output-denied
    end
```

**Approval state machine**

```mermaid
stateDiagram-v2
    [*] --> approval_requested: write tool called
    approval_requested --> approval_responded: client approves or rejects
    approval_requested --> output_denied: user sends a new message
    approval_requested --> expired: older than 10 min (410)
    approval_responded --> output_available: approved, tool executed
    approval_responded --> output_denied: rejected
    output_available --> [*]
    output_denied --> [*]
    expired --> [*]
```

### 5. Sequence: receipt scan

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant W as Worker
    participant KV as KV cache
    participant DB as Supabase
    participant G as Gemini

    U->>C: Take or upload a receipt photo
    C->>W: POST /ai/scan {url, mediaType}
    W->>KV: categories:{userId}
    alt cache miss
        W->>DB: SELECT expense_category
        W->>KV: store (TTL 300s)
    end
    W->>G: image + categories, structured output (addExpenseSchema)
    G-->>W: {name, amount, category, is_expense, spend_date}
    W-->>C: 200 {data}
    C-->>U: prefilled add-expense form
    Note over C,DB: Nothing is written. The client saves the expense after the user reviews it.
    opt unreadable receipt
        W-->>C: 422 "Could not read receipt"
    end
```

## Key design decisions

- **The backend owns chat history.** The client sends only the new message or approval decisions. History is replayed from `chat_message` (last 40 rows), so a client cannot forge past turns or tool arguments.
- **One `UIMessage` per row.** Rows are keyed by `ui_id` (unique per session). An approval continuation updates the same assistant row in place via upsert.
- **Replies survive disconnects.** `consumeSseStream` drains a copy of the stream and `onEnd` saves the reply through `waitUntil`, so a client that goes away mid-stream does not lose the reply.
- **Stored history is validated on load** against the current tool `inputSchema` and `outputSchema`. Changing a tool's shape is a data migration, so add a script in `migrations/` that rewrites the stored `tool-<name>` parts.
- **Tools never take `user_id` from the model.** They close over the user-scoped client and inject the authenticated id.
- **Uniform tool output.** Every tool returns `{ ok, data | error }`. Error handlers must return that envelope too, because a bare string fails output validation and crashes the run.
- **KV is only for stable data.** Only the per-user category list is cached (5 min). KV is eventually consistent, so HITL state and balances stay in Supabase.
- **Errors are RFC 9457.** Responses use `application/problem+json` via `errorResponse`. Status codes come from `HTTP_STATUS`.

## Tools available to the agent

| Tool | Type | What it does |
|---|---|---|
| `list_expense_categories` | read | The user's categories |
| `list_expenses` | read | Filtered list of expenses and income |
| `get_expense` | read | One record by id |
| `get_expense_summary` | read | Balance, income and expenses for an optional year or month |
| `add_expense` | **write, needs approval** | Create one or more records (`{ expenses: [...] }`, one approval for all) |
| `update_expense` | **write, needs approval** | Edit a record |
| `delete_expense` | **write, needs approval** | Delete one or more records (`{ ids: [...] }`, one approval for all) |

## Project structure

```txt
src/
├── index.ts                     Hono app entry; mounts /ai
├── routes/ai.route.ts           CORS → withSupabase → braintrust → validators → handlers
├── middlewares/                 braintrust (tracing + waitUntil bridge), zod validator
├── services/ai/
│   ├── index.ts                 aiChat / aiScan handlers
│   ├── chat-history.ts          sessions, load/save messages, approval resolution
│   ├── agents/                  triage.agent.ts (used), expense.agent.ts (unused)
│   └── tools/expense.tools.ts   zod-typed tools + getCategories
├── schemas/                     zod schemas for requests and tools
├── constants/                   AI limits, cache TTLs, HTTP status, model config
├── libs/                        KV cache helper, response helpers
├── utils/                       model factory, date, json
└── types/                       shared types; database.ts is generated from Supabase
migrations/                      SQL for the shared Supabase project
docs/chat-api.md                 client contract
```

Contributor notes are in [`AGENTS.md`](AGENTS.md).
