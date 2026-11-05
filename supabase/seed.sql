-- Demo data for the mini CRM (3 objects, 9 tasks, every status, one rework cycle).
--
-- Runs as `postgres` (Supabase SQL Editor, psql, or automatically by `supabase db reset`).
-- It contains NO credentials and creates NO users: the three demo users must already exist in
-- auth.users, identified by EMAIL:
--     manager@test-crm.example, executor1@test-crm.example, executor2@test-crm.example
--   * cloud: create them in Dashboard -> Authentication -> Users (Auto Confirm User),
--            then run this file in the SQL Editor
--   * local: psql ... -f supabase/local/demo-users.sql, then psql ... -f supabase/seed.sql
-- If any of them is missing, the script prints a notice and inserts nothing (so `db reset` on an
-- empty local DB is a no-op). If the demo objects already exist (matched by name), it is a no-op
-- as well: safe to run repeatedly.
--
-- Tasks are created and moved through the normal paths as the right user (impersonated via
-- request.jwt.claims + role authenticated): plain INSERT into objects/tasks and
-- change_task_status(). The history therefore comes from the real triggers and obeys the
-- transition matrix; the seed never touches session_replication_role or inserts history itself.
-- Everything runs in one DO block, i.e. one transaction: all or nothing.

do $seed$
declare
  v_manager uuid;
  v_exec1 uuid;
  v_exec2 uuid;
  v_obj1 uuid;
  v_obj2 uuid;
  v_obj3 uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid; v_t5 uuid;
  v_t6 uuid; v_t7 uuid; v_t8 uuid; v_t9 uuid;
  c_obj1 constant text := 'ЖК «Северный квартал», корпус 2';
  c_obj2 constant text := 'Складской комплекс «Логистик-Парк»';
  c_obj3 constant text := 'Реконструкция школы №14';
begin
  select u.id into v_manager from auth.users u where u.email = 'manager@test-crm.example';
  select u.id into v_exec1   from auth.users u where u.email = 'executor1@test-crm.example';
  select u.id into v_exec2   from auth.users u where u.email = 'executor2@test-crm.example';

  if v_manager is null or v_exec1 is null or v_exec2 is null then
    raise notice 'seed skipped: demo users are missing (need manager@, executor1@, executor2@test-crm.example in auth.users)';
    return;
  end if;

  if exists (select 1 from public.objects o where o.name in (c_obj1, c_obj2, c_obj3)) then
    raise notice 'seed skipped: demo objects already exist';
    return;
  end if;

  -- Profiles (postgres, before impersonation). Profile rows come from the auth.users trigger.
  update public.profiles set role = 'manager', full_name = 'Иван Петров (постановщик)' where id = v_manager;
  update public.profiles set full_name = 'Алексей Смирнов' where id = v_exec1;
  update public.profiles set full_name = 'Мария Козлова'   where id = v_exec2;

  set local role authenticated;

  -- ---- manager: objects and tasks (history: null -> new, written by the trigger) ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);

  insert into public.objects (name, address) values
    (c_obj1, 'г. Москва, ул. Тихая, д. 12, стр. 2') returning id into v_obj1;
  insert into public.objects (name, address) values
    (c_obj2, 'Московская обл., г. Подольск, Складской проезд, 7') returning id into v_obj2;
  insert into public.objects (name, address) values
    (c_obj3, 'г. Казань, ул. Школьная, д. 14') returning id into v_obj3;

  insert into public.tasks (object_id, title, description, assignee_id) values
    (v_obj1, 'Залить фундаментную плиту секции 3', 'Бетон B25, контроль температуры, уход за бетоном 7 суток.', v_exec1)
    returning id into v_t1;
  insert into public.tasks (object_id, title, description, assignee_id) values
    (v_obj1, 'Монтаж опалубки перекрытия 5 этажа', 'Опалубка по проекту КЖ-14, проверить отметки.', v_exec2)
    returning id into v_t2;
  insert into public.tasks (object_id, title, description, assignee_id) values
    (v_obj1, 'Армирование колонн подвала', 'Шаг хомутов 100 мм в зоне опирания.', v_exec1)
    returning id into v_t3;
  insert into public.tasks (object_id, title, description, assignee_id) values
    (v_obj2, 'Устройство промышленного пола', 'Топпинг, шлифовка, нарезка швов через 6 м.', v_exec2)
    returning id into v_t4;
  insert into public.tasks (object_id, title, description, assignee_id) values
    (v_obj2, 'Монтаж металлического каркаса склада', 'Колонны и фермы по осям А-Д, затяжка болтов с динамометрическим ключом.', v_exec1)
    returning id into v_t5;
  insert into public.tasks (object_id, title, description, assignee_id) values
    (v_obj2, 'Монтаж кровельных сэндвич-панелей', 'Герметизация стыков, крепёж по схеме.', v_exec2)
    returning id into v_t6;
  insert into public.tasks (object_id, title, description, assignee_id) values
    (v_obj3, 'Демонтаж перегородок 2 этажа', 'Вынос мусора, акт скрытых работ.', v_exec1)
    returning id into v_t7;
  insert into public.tasks (object_id, title, description, assignee_id) values
    (v_obj3, 'Замена оконных блоков в южном крыле', '24 окна, пароизоляционная лента по периметру.', v_exec2)
    returning id into v_t8;
  insert into public.tasks (object_id, title, description, assignee_id) values
    (v_obj3, 'Электромонтаж в спортзале', 'Прокладка кабеля, установка светильников, протокол замеров.', v_exec2)
    returning id into v_t9;

  -- ---- executor1 (Смирнов): takes work and sends it for review ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_exec1, 'role', 'authenticated')::text, true);
  perform public.change_task_status(v_t1, 'in_progress');
  perform public.change_task_status(v_t1, 'review');
  perform public.change_task_status(v_t5, 'in_progress');
  perform public.change_task_status(v_t5, 'review');
  perform public.change_task_status(v_t7, 'in_progress');
  perform public.change_task_status(v_t7, 'review');

  -- ---- executor2 (Козлова) ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_exec2, 'role', 'authenticated')::text, true);
  perform public.change_task_status(v_t2, 'in_progress');
  perform public.change_task_status(v_t4, 'in_progress');
  perform public.change_task_status(v_t6, 'in_progress');
  perform public.change_task_status(v_t6, 'review');
  perform public.change_task_status(v_t9, 'in_progress');
  perform public.change_task_status(v_t9, 'review');

  -- ---- manager: accept two, send two to rework (comment is mandatory) ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  perform public.change_task_status(v_t1, 'accepted', 'Принято, протокол испытаний бетона приложен.');
  perform public.change_task_status(v_t7, 'accepted');
  perform public.change_task_status(v_t9, 'accepted', 'Замеры в норме.');
  perform public.change_task_status(v_t5, 'rework', 'Не затянуты болты на узлах ферм по оси В, приложите протокол момента затяжки.');
  perform public.change_task_status(v_t6, 'rework', 'Зазоры в стыках панелей, переделать герметизацию.');

  -- ---- rework cycle on task 5: executor1 fixes it and resubmits ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_exec1, 'role', 'authenticated')::text, true);
  perform public.change_task_status(v_t5, 'in_progress');
  perform public.change_task_status(v_t5, 'review');

  reset role;

  -- Cosmetic only: now() is constant inside a transaction, so every history row got the same
  -- created_at and the timeline order would be arbitrary. Spread the rows by insertion order
  -- (1 ms apart); no status or content is changed.
  update public.task_status_history h
     set created_at = h.created_at + s.rn * interval '1 millisecond'
    from (
      select id, row_number() over (order by ctid) as rn
      from public.task_status_history
      where task_id in (v_t1, v_t2, v_t3, v_t4, v_t5, v_t6, v_t7, v_t8, v_t9)
    ) s
   where h.id = s.id;

  raise notice 'seed done: 3 objects, 9 tasks';
end
$seed$;
