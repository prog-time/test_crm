-- Schema, profiles, RLS visibility, task creation trigger, soft delete, FK, anon lockout.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm1@test.local', '{"full_name":"Manager One","role":"manager"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm2@test.local', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e1@test.local', '{"full_name":"Executor One"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2@test.local', '{"full_name":"Executor Two"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e3@test.local', jsonb_build_object('full_name', repeat('x', 150), 'role', 'manager'), now(), now());
update public.profiles set role = 'manager'
 where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');

-- ===== Criterion 1: enums and tables exist ================================
select enum_has_labels('public', 'user_role', array['manager', 'executor'], 'user_role enum');
select enum_has_labels('public', 'task_status', array['new', 'in_progress', 'review', 'accepted', 'rework'], 'task_status enum');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'objects', 'objects exists');
select has_table('public', 'tasks', 'tasks exists');
select has_table('public', 'task_status_history', 'task_status_history exists');
select is(rls_enabled, true, 'RLS enabled on ' || tbl) from (
  select c.relname as tbl, c.relrowsecurity as rls_enabled from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('profiles', 'objects', 'tasks', 'task_status_history')
) s;

-- ===== Profile bootstrap trigger (open question 1) ========================
select is((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'executor'::public.user_role, 'new user is an executor');
select is((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'Executor One', 'full_name from metadata');
select is((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'), 'Пользователь', 'full_name falls back to a neutral placeholder');
select is((select count(*) from public.profiles where full_name like '%@%' and id::text like '00000000-0000-0000-0000-0000000000%'), 0::bigint, 'email never copied into profiles');
select is((select length(full_name) from public.profiles where id = '00000000-0000-0000-0000-0000000000b3'), 100, 'full_name truncated to 100');
select is((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000b3'), 'executor'::public.user_role, 'role in metadata is ignored');

-- Fixtures: objects (as manager) and tasks (via the insert trigger).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
insert into public.objects (id, name) values
  ('00000000-0000-0000-0000-00000000f001', 'Object 1'),
  ('00000000-0000-0000-0000-00000000f002', 'Object 2'),
  ('00000000-0000-0000-0000-00000000f003', 'Object 3 (no tasks)');
insert into public.tasks (id, object_id, title, assignee_id) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000f001', 'T1 for e1', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000f002', 'T2 for e2', '00000000-0000-0000-0000-0000000000b2');

-- ===== Criterion 2: profiles are read-only ================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.profiles where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1')), 3::bigint, 'executor sees self and managers');
select is_empty($$select 1 from public.profiles where id in ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3')$$, 'executor cannot enumerate other executors');
select throws_ok($$update public.profiles set role = 'manager' where id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 'executor cannot promote self');
select throws_ok($$update public.profiles set full_name = 'x' where id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 'executor cannot update own profile');
select throws_ok($$insert into public.profiles (id, full_name, role) values (gen_random_uuid(), 'x', 'manager')$$, '42501', null, 'executor cannot insert profile');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$update public.profiles set full_name = 'x' where id = '00000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'manager cannot update profiles either');
select throws_ok($$delete from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 'nobody can delete profiles');

-- ===== Criterion 3: executor visibility ===================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$select id from public.tasks where id::text like '00000000-0000-0000-0000-00000000c%'$$, $$values ('00000000-0000-0000-0000-00000000c001'::uuid)$$, 'executor sees only own tasks');
select results_eq($$select id from public.objects where id::text like '00000000-0000-0000-0000-00000000f%'$$, $$values ('00000000-0000-0000-0000-00000000f001'::uuid)$$, 'executor sees only objects with own tasks');
select is((select count(*) from public.task_status_history where task_id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002')), 1::bigint, 'executor sees history only of own task');
select throws_ok($$insert into public.objects (name) values ('x')$$, '42501', null, 'executor cannot insert objects');
select throws_ok($$insert into public.tasks (object_id, title, assignee_id) values ('00000000-0000-0000-0000-00000000f001', 'x', '00000000-0000-0000-0000-0000000000b1')$$, '42501', null, 'executor cannot create tasks');
select is_empty($$update public.tasks set title = 'hacked' where id = '00000000-0000-0000-0000-00000000c002' returning 1$$, 'executor update on foreign task touches 0 rows');
select is_empty($$update public.tasks set title = 'hacked' where id = '00000000-0000-0000-0000-00000000c001' returning 1$$, 'executor cannot update even own task directly (0 rows)');
select is_empty($$update public.objects set name = 'hacked' returning 1$$, 'executor cannot update objects');

-- ===== Manager visibility =================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.tasks where id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002')), 2::bigint, 'manager sees all tasks (also of other manager)');
select is((select count(*) from public.objects where id in ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000f003')), 3::bigint, 'manager sees all objects');
select is((select count(*) from public.profiles where id::text like '00000000-0000-0000-0000-0000000000%'), 5::bigint, 'manager sees all profiles');

-- ===== Criterion 7: insert trigger forces server fields ===================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
insert into public.tasks (id, object_id, title, assignee_id, status, author_id, created_at)
values ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-00000000f001', 'forged', '00000000-0000-0000-0000-0000000000b1',
        'accepted', '00000000-0000-0000-0000-0000000000a2', '2000-01-01');
select is((select status from public.tasks where id = '00000000-0000-0000-0000-00000000c003'), 'new'::public.task_status, 'status forced to new');
select is((select author_id from public.tasks where id = '00000000-0000-0000-0000-00000000c003'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'author forced to auth.uid()');
select ok((select created_at from public.tasks where id = '00000000-0000-0000-0000-00000000c003') > now() - interval '1 minute', 'created_at forced to now()');
select results_eq(
  $$select from_status::text, to_status::text, changed_by from public.task_status_history where task_id = '00000000-0000-0000-0000-00000000c003'$$,
  $$values (null::text, 'new'::text, '00000000-0000-0000-0000-0000000000a1'::uuid)$$, 'history row null -> new');

-- ===== Criterion 10: assignee must be an executor =========================
select throws_ok($$insert into public.tasks (object_id, title, assignee_id) values ('00000000-0000-0000-0000-00000000f001', 'x', '00000000-0000-0000-0000-0000000000a2')$$, 'CR004', null, 'insert with manager assignee rejected');
select throws_ok($$insert into public.tasks (object_id, title, assignee_id) values ('00000000-0000-0000-0000-00000000f001', 'x', null)$$, 'CR004', null, 'insert with NULL assignee rejected');
select throws_ok($$update public.tasks set assignee_id = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-00000000c001'$$, 'CR004', null, 'update to manager assignee rejected');
select throws_ok($$update public.tasks set assignee_id = null where id = '00000000-0000-0000-0000-00000000c001'$$, 'CR004', null, 'update to NULL assignee rejected');

-- Manager edits (open questions 2 and 3): object, title, reassign keep status.
select lives_ok($$update public.tasks set title = 'T1 renamed', description = 'd', object_id = '00000000-0000-0000-0000-00000000f003', assignee_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-00000000c001'$$, 'manager can change title/description/object/assignee');
select is((select status from public.tasks where id = '00000000-0000-0000-0000-00000000c001'), 'new'::public.task_status, 'reassignment keeps status');
select lives_ok($$update public.tasks set object_id = '00000000-0000-0000-0000-00000000f001', assignee_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-00000000c001'$$, 'manager moves task back');

-- ===== Criterion 11: delete_task / direct DELETE ==========================
select throws_ok($$delete from public.tasks where id = '00000000-0000-0000-0000-00000000c003'$$, '42501', null, 'direct DELETE on tasks denied');
select throws_ok($$update public.tasks set deleted_at = now(), deleted_by = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-00000000c003'$$, '42501', null, 'direct soft-delete via UPDATE denied');
select lives_ok($$select public.delete_task('00000000-0000-0000-0000-00000000c003')$$, 'manager delete_task works');
select is_empty($$select 1 from public.tasks where id = '00000000-0000-0000-0000-00000000c003'$$, 'deleted task disappears from selects');
select is_empty($$select 1 from public.task_status_history where task_id = '00000000-0000-0000-0000-00000000c003'$$, 'history of deleted task hidden from API');
reset role;
select is((select count(*) from public.task_status_history where task_id = '00000000-0000-0000-0000-00000000c003'), 1::bigint, 'history preserved in DB');
select ok((select deleted_at is not null and deleted_by = '00000000-0000-0000-0000-0000000000a1' from public.tasks where id = '00000000-0000-0000-0000-00000000c003'), 'deleted_at / deleted_by set');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.delete_task('00000000-0000-0000-0000-00000000c001')$$, '42501', null, 'executor cannot call delete_task');
select throws_ok($$select public.delete_task('00000000-0000-0000-0000-00000000c002')$$, '42501', null, 'executor cannot delete foreign task');

-- ===== Criterion 12: object with tasks cannot be deleted ==================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$delete from public.objects where id = '00000000-0000-0000-0000-00000000f001'$$, '23503', null, 'object with live tasks cannot be deleted');
select lives_ok($$select public.delete_task('00000000-0000-0000-0000-00000000c002')$$, 'delete the last task of object 2');
select throws_ok($$delete from public.objects where id = '00000000-0000-0000-0000-00000000f002'$$, '23503', null, 'object with only soft-deleted tasks cannot be deleted');
select lives_ok($$delete from public.objects where id = '00000000-0000-0000-0000-00000000f003'$$, 'object without tasks can be deleted');

-- ===== Criterion 6: history is read-only ==================================
select throws_ok($$insert into public.task_status_history (task_id, to_status, changed_by) values ('00000000-0000-0000-0000-00000000c001', 'new', '00000000-0000-0000-0000-0000000000a1')$$, '42501', null, 'manager cannot insert history');
select throws_ok($$update public.task_status_history set comment = 'x'$$, '42501', null, 'manager cannot update history');
select throws_ok($$delete from public.task_status_history$$, '42501', null, 'manager cannot delete history');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$insert into public.task_status_history (task_id, to_status, changed_by) values ('00000000-0000-0000-0000-00000000c001', 'new', '00000000-0000-0000-0000-0000000000b1')$$, '42501', null, 'executor cannot insert history');
select throws_ok($$update public.task_status_history set comment = 'x'$$, '42501', null, 'executor cannot update history');
select throws_ok($$delete from public.task_status_history$$, '42501', null, 'executor cannot delete history');

-- ===== Criterion 13: anon has no access ===========================================
reset role;
set local role anon;
select throws_ok($$select 1 from public.profiles$$, '42501', null, 'anon cannot read profiles');
select throws_ok($$select 1 from public.objects$$, '42501', null, 'anon cannot read objects');
select throws_ok($$select 1 from public.tasks$$, '42501', null, 'anon cannot read tasks');
select throws_ok($$select 1 from public.task_status_history$$, '42501', null, 'anon cannot read history');
select throws_ok($$insert into public.tasks (object_id, title, assignee_id) values (gen_random_uuid(), 'x', gen_random_uuid())$$, '42501', null, 'anon cannot insert tasks');
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'in_progress', null)$$, '42501', null, 'anon cannot call change_task_status');
select throws_ok($$select public.delete_task('00000000-0000-0000-0000-00000000c001')$$, '42501', null, 'anon cannot call delete_task');
select throws_ok($$select public.is_manager()$$, '42501', null, 'anon cannot call is_manager');
select throws_ok($$select public.app_role()$$, '42501', null, 'anon cannot call app_role');

select * from finish();
rollback;
