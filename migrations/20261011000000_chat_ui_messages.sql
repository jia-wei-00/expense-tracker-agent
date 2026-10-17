-- Chat history is stored as AI SDK `UIMessage` rows, one per message.
-- The client reads `chat_session` / `chat_message` directly (RLS select);
-- only the backend writes `chat_message`, via the service-role client.

-- Drop pre-AI-SDK (LangChain-format) history; it cannot be replayed.
-- Every `UIMessage` has `parts`; legacy rows do not.
delete from public.chat_session s
where exists (
  select 1 from public.chat_message m
  where m.session_id = s.id and not (m.data ? 'parts')
);

-- AI SDK message id, derived from `data` so the two can never disagree.
-- Unique within a session: the upsert target for approval continuations.
alter table public.chat_message
  add column ui_id text not null generated always as (data ->> 'id') stored;

create unique index chat_message_session_ui_id_key
  on public.chat_message (session_id, ui_id);

-- Users may no longer insert messages directly; a stored approval request
-- must not be editable by the client before it is approved.
drop policy "users insert own messages" on public.chat_message;

-- Approval continuations update the assistant row in place; bump the session too.
drop trigger chat_message_touch_session_after_insert on public.chat_message;

create trigger chat_message_touch_session_after_write
  after insert or update on public.chat_message
  for each row execute function public.touch_chat_session_updated_at();
