-- LOCAL-ONLY: creates the four accounts used by `npm run security-check`.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/local/check-users.sql
--
-- NEVER run this against a hosted/shared project: the passwords below are public dev values.
-- This file is deliberately outside supabase/migrations and is not supabase/seed.sql, so neither
-- `supabase db reset` nor a deploy picks it up.
--
-- Users are written straight into auth.users + auth.identities (public sign-up is disabled).
-- The profile rows appear via the on_auth_user_created trigger with role 'executor'; the two
-- managers are then promoted. Idempotent: re-running resets the passwords and roles.

do $$
declare
  v_user record;
  v_id uuid;
begin
  for v_user in
    select * from (values
      ('check-manager@example.test',    'check-manager-pass',    'Check Manager 1',  'manager'),
      ('check-manager2@example.test',   'check-manager2-pass',   'Check Manager 2',  'manager'),
      ('check-executor-a@example.test', 'check-executor-a-pass', 'Check Executor A', 'executor'),
      ('check-executor-b@example.test', 'check-executor-b-pass', 'Check Executor B', 'executor')
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

    -- Profile exists thanks to the trigger (role 'executor'); set the intended role.
    update public.profiles set role = v_user.role::public.user_role where id = v_id;
  end loop;
end
$$;
