-- Solo para PostgreSQL aislado de pruebas: interfaz mínima de Supabase Auth.
-- NO ejecutar en Supabase ni en producción.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
 id uuid primary key, email text, encrypted_password text,
 email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz,
 role text, raw_app_meta_data jsonb, raw_user_meta_data jsonb, aud text
);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
