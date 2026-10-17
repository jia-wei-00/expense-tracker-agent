-- `addExpense` now takes `{ expenses: [...] }` and returns `data: [record]`.
-- Stored history is validated against the current tool schemas on load, so
-- rewrite old single-record calls: input `{ name, ... }` -> `{ expenses: [{ name, ... }] }`,
-- and output `data: { id, ... }` -> `data: [{ id, ... }]`.
update public.chat_message m
set data = jsonb_set(
  m.data,
  '{parts}',
  (
    select jsonb_agg(
      case
        when p ->> 'type' = 'tool-addExpense'
          and jsonb_typeof(p -> 'input') = 'object'
          and not (p -> 'input' ? 'expenses') then
          p
          || jsonb_build_object(
               'input', jsonb_build_object('expenses', jsonb_build_array(p -> 'input'))
             )
          || case
               when jsonb_typeof(p -> 'output' -> 'data') = 'object' then
                 jsonb_build_object(
                   'output',
                   (p -> 'output') || jsonb_build_object('data', jsonb_build_array(p -> 'output' -> 'data'))
                 )
               else '{}'::jsonb
             end
        else p
      end
      order by ord
    )
    from jsonb_array_elements(m.data -> 'parts') with ordinality as t(p, ord)
  )
)
where exists (
  select 1 from jsonb_array_elements(m.data -> 'parts') p
  where p ->> 'type' = 'tool-addExpense'
    and jsonb_typeof(p -> 'input') = 'object'
    and not (p -> 'input' ? 'expenses')
)
returning m.id, m.session_id;
