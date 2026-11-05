-- Catalog privileges, internal functions, object visibility lifecycle, upsert/undelete guards,
-- created_by pinning and length checks.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm1@test.local', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e1@test.local', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2@test.local', '{}', now(), now());
update public.profiles set role = 'manager' where id = '00000000-0000-0000-0000-0000000000a1';

-- ===== Catalog: anon / PUBLIC hold nothing in schema public ================
select is_empty($$select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'PUBLIC')$$, 'anon/PUBLIC: no table grants (information_schema)');
select is_empty($$select 1 from information_schema.routine_privileges where routine_schema = 'public' and grantee in ('anon', 'PUBLIC')$$, 'anon/PUBLIC: no routine grants (information_schema)');
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'S') and a.grantee in (0, 'anon'::regrole::oid)$$,
  'anon/PUBLIC: no relation ACL entries');
select is_empty($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public' and a.grantee in (0, 'anon'::regrole::oid)$$,
  'anon/PUBLIC: no function ACL entries');
select is_empty($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('_check_status_transition', '_assert_assignee_is_executor', 'tasks_before_insert', 'tasks_after_insert', 'tasks_before_update', 'handle_new_user', 'set_updated_at', 'objects_pin_created_by')
    and has_function_privilege('authenticated', p.oid, 'execute')$$,
  'authenticated cannot execute internal/trigger functions');

-- ===== Fixtures ============================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
insert into public.objects (id, name, created_by) values ('00000000-0000-0000-0000-00000000f001', 'Object 1', '00000000-0000-0000-0000-0000000000b1');
insert into public.tasks (id, object_id, title, assignee_id) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000f001', 'T1', '00000000-0000-0000-0000-0000000000b1');

-- ===== created_by pinning and length checks ================================
select is((select created_by from public.objects where id = '00000000-0000-0000-0000-00000000f001'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'objects.created_by forced to auth.uid()');
select throws_ok($$update public.objects set created_by = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-00000000f001'$$, '42501', null, 'objects.created_by immutable');
select throws_ok($$insert into public.objects (name) values (repeat('x', 201))$$, '23514', null, 'object name > 200 rejected');
select throws_ok($$insert into public.objects (name, address) values ('ok', repeat('x', 501))$$, '23514', null, 'address > 500 rejected');
select throws_ok($$insert into public.tasks (object_id, title, assignee_id) values ('00000000-0000-0000-0000-00000000f001', repeat('x', 201), '00000000-0000-0000-0000-0000000000b1')$$, '23514', null, 'title > 200 rejected');
select throws_ok($$insert into public.tasks (object_id, title, description, assignee_id) values ('00000000-0000-0000-0000-00000000f001', 't', repeat('x', 5001), '00000000-0000-0000-0000-0000000000b1')$$, '23514', null, 'description > 5000 rejected');

-- ===== Internal functions are not callable by authenticated ================
select throws_ok($$select public._check_status_transition('new'::public.task_status, 'in_progress'::public.task_status, 'executor'::public.user_role, true, null)$$, '42501', null, '_check_status_transition not callable');
select throws_ok($$select public._assert_assignee_is_executor('00000000-0000-0000-0000-0000000000b1')$$, '42501', null, '_assert_assignee_is_executor not callable');

-- ===== Object visibility follows the executor's live tasks =================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.objects where id = '00000000-0000-0000-0000-00000000f001'), 1::bigint, 'e1 sees the object via own task');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update public.tasks set assignee_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-00000000c001';
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$select 1 from public.objects where id = '00000000-0000-0000-0000-00000000f001'$$, 'object hidden from e1 after reassignment');
select is_empty($$select 1 from public.task_status_history where task_id = '00000000-0000-0000-0000-00000000c001'$$, 'history hidden from e1 after reassignment');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.objects where id = '00000000-0000-0000-0000-00000000f001'), 1::bigint, 'e2 sees the object after reassignment');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ===== Manager upsert cannot change protected fields =======================
select throws_ok($$insert into public.tasks (id, object_id, title, assignee_id) values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000f001', 'T1', '00000000-0000-0000-0000-0000000000b2') on conflict (id) do update set status = 'accepted'$$, '42501', null, 'upsert cannot change status');
select throws_ok($$insert into public.tasks (id, object_id, title, assignee_id) values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000f001', 'T1', '00000000-0000-0000-0000-0000000000b2') on conflict (id) do update set author_id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 'upsert cannot change author_id');
select is((select status from public.tasks where id = '00000000-0000-0000-0000-00000000c001'), 'new'::public.task_status, 'status unchanged after upserts');

-- ===== Soft delete hides objects; undelete is impossible ===================
select lives_ok($$select public.delete_task('00000000-0000-0000-0000-00000000c001')$$, 'manager deletes task');
select is_empty($$update public.tasks set deleted_at = null, deleted_by = null where id = '00000000-0000-0000-0000-00000000c001' returning 1$$, 'manager cannot undelete (row invisible, 0 rows)');
reset role;
select ok((select deleted_at is not null from public.tasks where id = '00000000-0000-0000-0000-00000000c001'), 'task is still deleted');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$select 1 from public.objects where id = '00000000-0000-0000-0000-00000000f001'$$, 'object hidden from e2 after the only task is soft-deleted');

select * from finish();
rollback;
