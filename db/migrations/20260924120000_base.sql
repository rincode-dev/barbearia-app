-- Baseline do barbearia-app (Fase 0). Banco novo e limpo — não herda as migrations do
-- modelo de tatuagem (ver docs/ARQUITETURA.md, decisão 7), só os blocos já testados lá:
-- profiles + handle_new_user (1º usuário vira admin) + is_admin(), padrão de RLS, clientes
-- com telefone único. Instala num projeto vazio aplicando tudo em sequência, sem nenhum
-- passo manual no meio.

-- ---------------------------------------------------------------------------
-- Utilitário: updated_at automático
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: usuários do painel (admin/colaborador). Nasce só pelo trigger em auth.users.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  email text,
  role text not null default 'colaborador' check (role in ('admin', 'colaborador')),
  ativo boolean not null default true,
  telefone text,
  -- O dono pode ser admin E barbeiro; um gerente pode ser admin sem atender.
  atende_como_barbeiro boolean not null default true,
  -- Estrutura de comissão (docs/ARQUITETURA.md, decisão 11): preparada, sem cálculo/tela ainda.
  comissao_modo text not null default 'nenhuma' check (comissao_modo in ('nenhuma', 'percentual', 'fixo')),
  comissao_valor numeric(10, 2) not null default 0 check (comissao_valor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Usuários do painel. Linha criada só pelo trigger handle_new_user; nunca apagada fisicamente (desativar com ativo=false).';
comment on column public.profiles.comissao_modo is 'Estrutura preparada (decisão 11): nenhuma | percentual | fixo. Ainda sem cálculo nem tela.';

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Único ponto do sistema que checa papel de admin (usado em toda policy).
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and ativo = true
  );
$$;

-- Cria o profile ao criar usuário no Auth. O primeiro usuário do sistema vira admin
-- (bootstrap: o painel da plataforma cria o dono do estabelecimento como 1º usuário).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  -- Serializa cadastros simultâneos pra nunca nascerem dois "primeiros admins".
  perform pg_advisory_xact_lock(hashtext('handle_new_user'));

  if exists (select 1 from public.profiles) then
    v_role := 'colaborador';
  else
    v_role := 'admin';
  end if;

  insert into public.profiles (id, nome, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', ''),
    new.email,
    v_role
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Mantém profiles.email em sincronia se o email mudar no Auth.
create function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.handle_user_email_change();

alter table public.profiles enable row level security;

-- Equipe enxerga a equipe (nomes na agenda, seletor de barbeiro). Sem dado sensível
-- aqui (CPF/documentos do modelo de tatuagem não existem neste modelo).
create policy profiles_select_authenticated
on public.profiles for select
to authenticated
using (true);

-- Cada um edita os próprios dados básicos, mas nunca papel, status, flag de barbeiro
-- nem comissão.
create policy profiles_update_own_limited
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role = (select p.role from public.profiles p where p.id = auth.uid())
  and ativo = (select p.ativo from public.profiles p where p.id = auth.uid())
  and atende_como_barbeiro = (select p.atende_como_barbeiro from public.profiles p where p.id = auth.uid())
  and comissao_modo = (select p.comissao_modo from public.profiles p where p.id = auth.uid())
  and comissao_valor = (select p.comissao_valor from public.profiles p where p.id = auth.uid())
  and email is not distinct from (select p.email from public.profiles p where p.id = auth.uid())
);

create policy profiles_update_admin
on public.profiles for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Sem policy de insert/delete: linha nasce só pelo trigger; nunca há DELETE físico.

-- ---------------------------------------------------------------------------
-- estabelecimento: linha única com a marca e as regras de agendamento.
-- É o que substitui a marca fixa no código (docs/ARQUITETURA.md, decisão 6).
-- ---------------------------------------------------------------------------
create table public.estabelecimento (
  id smallint primary key default 1 check (id = 1),
  nome text not null default 'Minha Barbearia',
  descricao text,
  logo_path text,
  endereco text,
  telefone text,
  whatsapp text,
  instagram text,
  mapa_url text,
  -- Regras do agendamento online (usadas pelo motor de disponibilidade, Fase 2).
  antecedencia_minima_minutos integer not null default 60 check (antecedencia_minima_minutos >= 0),
  janela_agendamento_dias integer not null default 30 check (janela_agendamento_dias between 1 and 365),
  granularidade_minutos integer not null default 15 check (granularidade_minutos in (5, 10, 15, 20, 30, 60)),
  politica_cancelamento text,
  updated_at timestamptz not null default now()
);

comment on table public.estabelecimento is 'Linha única (id=1): nome, logo, contatos e regras de agendamento da barbearia. Lida pelo site público.';

insert into public.estabelecimento (id) values (1);

create trigger trg_estabelecimento_updated_at
before update on public.estabelecimento
for each row execute function public.set_updated_at();

alter table public.estabelecimento enable row level security;

-- Informação pública da barbearia (site sem login).
create policy estabelecimento_select_todos
on public.estabelecimento for select
to anon, authenticated
using (true);

create policy estabelecimento_update_admin
on public.estabelecimento for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Sem insert/delete: a linha única é criada aqui e nunca removida.

-- ---------------------------------------------------------------------------
-- clientes: compartilhados pela equipe, telefone único (só dígitos).
-- ---------------------------------------------------------------------------
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  telefone text not null check (telefone ~ '^[0-9]{8,15}$'),
  observacoes text,
  -- site = criado pelo agendamento online; painel = cadastrado pela equipe.
  origem text not null default 'painel' check (origem in ('site', 'painel')),
  criado_por uuid references public.profiles (id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clientes_telefone_unique unique (telefone)
);

comment on table public.clientes is 'Clientes da barbearia (compartilhados pela equipe). Telefone só dígitos e único — é a chave de deduplicação do agendamento online. Arquivar = deleted_at; nunca DELETE físico.';

create index clientes_nome_idx on public.clientes (lower(nome));

create trigger trg_clientes_updated_at
before update on public.clientes
for each row execute function public.set_updated_at();

alter table public.clientes enable row level security;

create policy clientes_select_authenticated
on public.clientes for select
to authenticated
using (true);

-- Pelo painel, criado_por é sempre quem está logado. O agendamento online grava pelo
-- servidor com service_role (origem='site', criado_por nulo) — não passa por aqui.
create policy clientes_insert_authenticated
on public.clientes for insert
to authenticated
with check (criado_por = auth.uid());

create policy clientes_update_authenticated
on public.clientes for update
to authenticated
using (true)
with check (true);

-- Sem policy de delete: ninguém apaga cliente fisicamente (nem admin).
