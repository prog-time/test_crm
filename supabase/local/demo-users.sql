-- LOCAL-ONLY: creates the three demo accounts that supabase/seed.sql looks up by email.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/local/demo-users.sql
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed.sql
--
-- NEVER run this against a hosted/shared project: the passwords below are public local dev
-- values and are NOT the cloud/demo passwords (those are created in the Dashboard and shared
-- with reviewers separately). This file is deliberately outside supabase/migrations, is not
-- listed in [db.seed] sql_paths, and so is never applied by `supabase db reset` or
-- `supabase db push --include-seed`.
--
-- Users are written straight into auth.users + auth.identities (public sign-up is disabled).
-- The profile rows appear via the on_auth_user_created trigger with role 'executor'; the
-- manager is promoted (seed.sql also does it). Idempotent: re-running resets passwords and roles.

do $$
declare
  v_user record;
  v_id uuid;
begin
  for v_user in
    select * from (values
      ('manager@test-crm.example',   'local-dev-manager',   'Иван Петров (постановщик)', 'manager'),
      ('executor1@test-crm.example', 'local-dev-executor1', 'Алексей Смирнов',           'executor'),
      ('executor2@test-crm.example', 'local-dev-executor2', 'Мария Козлова',             'executor')
    ) as t (email, password, full_name, role)
  loop
    select u.id into v_id from auth.users u where u.email = v_user.email;

    if v_id is null then
      v_id := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, reauthentication_token, phone_change, phone_change_token
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        v_user.email, extensions.crypt(v_user.password, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('full_name', v_user.full_name, 'email_verified', true),
        now(), now(),
        '', '', '', '', '', '', '', ''
      );

      insert into auth.identities (
        id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), v_id::text, v_id,
        jsonb_build_object('sub', v_id::text, 'email', v_user.email,
                           'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
      );
    else
      update auth.users
         set encrypted_password = extensions.crypt(v_user.password, extensions.gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_id;
    end if;

    update public.profiles
       set role = v_user.role::public.user_role, full_name = v_user.full_name
     where id = v_id;
  end loop;
end
$$;
