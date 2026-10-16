-- Compatibilidade com o Supabase num PostgreSQL puro (docs/ARQUITETURA.md, decisão 47).
--
-- As migrations até 2026-09-25 (db/migrations) foram escritas para o Supabase: usam os papéis
-- anon/authenticated/service_role, auth.users, auth.uid(), storage.* e a publicação
-- supabase_realtime. Este arquivo cria só esse mínimo, para que elas rodem sem mudança
-- de lógica e a RLS continue valendo igual. Roda antes de todas as migrations.

-- ---------------------------------------------------------------------------
-- Papéis. São do servidor inteiro (não do banco): criados só se ainda não existem.
-- noinherit: quem é membro não herda permissões sem um SET ROLE explícito.
-- service_role ignora a RLS, como no Supabase (é o "admin client" do servidor).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Permissões padrão iguais às do Supabase: tudo o que for criado em public fica acessível
-- aos três papéis, e quem decide o que cada um vê/altera é a RLS (e os revoke explícitos
-- das migrations).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth: usuários do painel. Mesmas colunas do Supabase que o sistema usa; a senha é
-- bcrypt (formato do Supabase), conferida com extensions.crypt().
-- ---------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  -- Desativar usuário = banir (igual ao Supabase): impede novos logins.
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_key on auth.users (email);

-- Só o servidor (service_role) lê e altera usuários; nunca a equipe nem o visitante.
revoke all on auth.users from anon, authenticated;
grant select, insert, update, delete on auth.users to service_role;

-- Usuário da transação atual: o app define request.jwt.claim.sub (set_config local) ao
-- abrir uma transação como "authenticated". Mesmo nome e mesma leitura do Supabase.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage: só para as migrations antigas rodarem (bucket + policies). As fotos agora
-- ficam em pasta no disco; estas tabelas não são usadas pelo app.
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text
);
alter table storage.objects enable row level security;

-- ---------------------------------------------------------------------------
-- Realtime: a publicação existe só para as migrations antigas; o "ao vivo" agora usa
-- LISTEN/NOTIFY.
-- ---------------------------------------------------------------------------
create publication supabase_realtime;
