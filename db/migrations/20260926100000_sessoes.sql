-- Login próprio (docs/ARQUITETURA.md, decisão 47 — M1). Só existe no PostgreSQL próprio: o
-- Supabase tinha o Auth dele.
--
-- Sessão = token aleatório no cookie do navegador; aqui fica só o hash (SHA-256) do token,
-- então quem ler o banco não consegue entrar com ele. Só o servidor (service_role) lê ou
-- altera estas tabelas.

create table auth.sessoes (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- "Permanecer conectado": cookie com validade longa; senão, cookie some ao fechar o
  -- navegador e a sessão vence em poucas horas.
  permanente boolean not null,
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null,
  ultimo_uso_em timestamptz not null default now(),
  user_agent text
);
create index sessoes_user_id_idx on auth.sessoes (user_id);
create index sessoes_expira_em_idx on auth.sessoes (expira_em);

-- Tentativas de login que falharam, para o limite de tentativas (por e-mail e por IP).
create table auth.tentativas_login (
  id bigint generated always as identity primary key,
  chave text not null,
  em timestamptz not null default now()
);
create index tentativas_login_chave_em_idx on auth.tentativas_login (chave, em);

revoke all on auth.sessoes, auth.tentativas_login from anon, authenticated;
grant select, insert, update, delete on auth.sessoes, auth.tentativas_login to service_role;
