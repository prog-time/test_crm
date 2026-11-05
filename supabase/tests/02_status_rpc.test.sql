-- change_task_status RPC, transition matrix, direct-update guards, accepted lock.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm1@test.local', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e1@test.local', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2@test.local', '{}', now(), now());
update public.profiles set role = 'manager' where id = '00000000-0000-0000-0000-0000000000a1';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
insert into public.objects (id, name) values ('00000000-0000-0000-0000-00000000f001', 'Object 1');
insert into public.tasks (id, object_id, title, assignee_id) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000f001', 'main', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000f001', 'second', '00000000-0000-0000-0000-0000000000b1');

-- ===== Criterion 4: new -> in_progress ====================================
-- Other executor: rejected with the same generic error as for a missing task.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'in_progress', null)$$, '42501', 'Task not found or access denied', 'unassigned executor rejected');
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000dead', 'in_progress', null)$$, '42501', 'Task not found or access denied', 'missing task gives identical error (no leak)');
-- Manager: not allowed to take the executor step.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'in_progress', null)$$, '42501', null, 'manager cannot start a task');
-- Assigned executor: ok.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select (public.change_task_status('00000000-0000-0000-0000-00000000c001', 'in_progress', null)).status), 'in_progress'::public.task_status, 'assigned executor starts task');
select results_eq(
  $$select from_status::text, to_status::text, changed_by from public.task_status_history where task_id = '00000000-0000-0000-0000-00000000c001' order by from_status nulls first$$,
  $$values (null::text, 'new'::text, '00000000-0000-0000-0000-0000000000a1'::uuid), ('new'::text, 'in_progress'::text, '00000000-0000-0000-0000-0000000000b1'::uuid)$$,
  'history has new -> in_progress');

-- ===== Matrix violations ==================================================
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c002', 'accepted', null)$$, 'CR001', null, 'executor: new -> accepted rejected');
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c002', 'review', null)$$, 'CR001', null, 'executor: new -> review rejected');
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c002', 'new', null)$$, 'CR001', null, 'same status rejected');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c002', 'accepted', null)$$, 'CR001', null, 'manager: new -> accepted rejected');
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'review', null)$$, '42501', null, 'manager cannot do in_progress -> review');
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'accepted', null)$$, 'CR001', null, 'manager: in_progress -> accepted rejected');

-- ===== Criterion 5: review step, mandatory comment ========================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'review', null)$$, 'executor: in_progress -> review');
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'accepted', null)$$, '42501', null, 'executor cannot accept');
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'rework', 'because')$$, '42501', null, 'executor cannot send to rework');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'rework', null)$$, 'CR002', null, 'rework with NULL comment rejected');
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'rework', '   ')$$, 'CR002', null, 'rework with blank comment rejected');
select is((select status from public.tasks where id = '00000000-0000-0000-0000-00000000c001'), 'review'::public.task_status, 'status unchanged after rejected rework');
select lives_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'rework', 'Fix the photos')$$, 'rework with comment ok');
select is((select comment from public.task_status_history where task_id = '00000000-0000-0000-0000-00000000c001' and to_status = 'rework'), 'Fix the photos', 'comment stored in history');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'in_progress', null)$$, 'executor: rework -> in_progress');
select lives_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'review', null)$$, 'executor: in_progress -> review again');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'accepted', null)$$, 'manager: review -> accepted');

-- ===== Criterion 9: accepted is frozen ====================================
select throws_ok($$select public.change_task_status('00000000-0000-0000-0000-00000000c001', 'rework', 'again')$$, 'CR003', null, 'accepted: no status change');
select throws_ok($$update public.tasks set title = 'x' where id = '00000000-0000-0000-0000-00000000c001'$$, 'CR003', null, 'accepted: no direct edit');
select throws_ok($$select public.delete_task('00000000-0000-0000-0000-00000000c001')$$, 'CR003', null, 'accepted: delete_task rejected');
select throws_ok($$delete from public.tasks where id = '00000000-0000-0000-0000-00000000c001'$$, '42501', null, 'accepted: direct delete rejected');
select is((select count(*) from public.tasks where id = '00000000-0000-0000-0000-00000000c001' and deleted_at is null), 1::bigint, 'accepted task still live');

-- ===== Criterion 8: direct UPDATE of protected columns ====================
select throws_ok($$update public.tasks set status = 'in_progress' where id = '00000000-0000-0000-0000-00000000c002'$$, '42501', null, 'direct status update rejected');
select throws_ok($$update public.tasks set status = 'accepted' where id = '00000000-0000-0000-0000-00000000c002'$$, '42501', null, 'direct status -> accepted rejected');
select throws_ok($$update public.tasks set author_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-00000000c002'$$, '42501', null, 'direct author_id update rejected');
select throws_ok($$update public.tasks set created_at = '2000-01-01' where id = '00000000-0000-0000-0000-00000000c002'$$, '42501', null, 'direct created_at update rejected');
select throws_ok($$update public.tasks set id = gen_random_uuid() where id = '00000000-0000-0000-0000-00000000c002'$$, '42501', null, 'id is immutable');
-- A forged flag must not bypass the checks (trigger re-validates the matrix).
select set_config('app.status_change', 'on', true);
select throws_ok($$update public.tasks set status = 'accepted' where id = '00000000-0000-0000-0000-00000000c002'$$, 'CR001', null, 'forged flag: new -> accepted still rejected');
select throws_ok($$update public.tasks set status = 'in_progress' where id = '00000000-0000-0000-0000-00000000c002'$$, '42501', null, 'forged flag: manager still cannot start task');
select set_config('app.status_change', 'off', true);
reset role;
select is((select status from public.tasks where id = '00000000-0000-0000-0000-00000000c002'), 'new'::public.task_status, 'task 2 untouched');

-- Executor with forged flag + direct update: RLS blocks the UPDATE entirely.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select set_config('app.status_change', 'on', true);
select is_empty($$update public.tasks set status = 'in_progress' where id = '00000000-0000-0000-0000-00000000c002' returning 1$$, 'executor direct update with forged flag touches 0 rows (RLS)');
select set_config('app.status_change', 'off', true);

select * from finish();
rollback;
