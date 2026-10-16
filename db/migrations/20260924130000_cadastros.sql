-- Fase 1 — Cadastros: horário de funcionamento, bloqueios (feriados/folgas), serviços,
-- serviços por barbeiro, jornada semanal dos barbeiros, foto do barbeiro e bucket público
-- de imagens (logo + fotos). Base do motor de disponibilidade da Fase 2.
--
-- Convenções:
-- - dia_semana: 0 = domingo … 6 = sábado (mesmo padrão de Date.getDay() e
--   extract(dow) do Postgres).
-- - Horas "de parede" (time) valem no fuso da barbearia (America/Sao_Paulo); instantes
--   (timestamptz) guardam o momento absoluto.
-- - Escrita só admin; leitura pela equipe logada. O site público lê serviços ativos e o
--   horário de funcionamento direto (anon); jornadas/bloqueios/serviços por barbeiro são
--   lidos no servidor pelo motor de disponibilidade (Fase 2).

-- ---------------------------------------------------------------------------
-- Horário de funcionamento (várias faixas por dia = intervalo de almoço)
-- ---------------------------------------------------------------------------
create table public.horarios_funcionamento (
  id uuid primary key default gen_random_uuid(),
  dia_semana smallint not null check (dia_semana between 0 and 6),
  inicio time not null,
  fim time not null,
  constraint horarios_funcionamento_faixa_valida check (inicio < fim)
);

comment on table public.horarios_funcionamento is 'Faixas de funcionamento da barbearia por dia da semana (0=domingo). Dia sem faixa = fechado. Alterado só via substituir_horarios_funcionamento().';

create index horarios_funcionamento_dia_idx on public.horarios_funcionamento (dia_semana, inicio);

alter table public.horarios_funcionamento enable row level security;

create policy horarios_funcionamento_select_todos
on public.horarios_funcionamento for select
to anon, authenticated
using (true);

create policy horarios_funcionamento_escrita_admin
on public.horarios_funcionamento for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Serviços
-- ---------------------------------------------------------------------------
create table public.servicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  descricao text,
  preco numeric(10, 2) not null check (preco >= 0),
  duracao_minutos integer not null check (duracao_minutos between 5 and 600),
  ativo boolean not null default true,
  ordem integer not null default 0,
  -- Estrutura de comissão por serviço (decisão 11): nulo = usa a regra do barbeiro.
  -- Sem tela nem cálculo nesta etapa.
  comissao_modo text check (comissao_modo in ('nenhuma', 'percentual', 'fixo')),
  comissao_valor numeric(10, 2) check (comissao_valor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint servicos_nome_unico unique (nome)
);

comment on table public.servicos is 'Catálogo de serviços (preço e duração usados pelo agendamento). Desativar em vez de apagar — agendamentos/OS guardam cópia de nome e preço.';

create trigger trg_servicos_updated_at
before update on public.servicos
for each row execute function public.set_updated_at();

alter table public.servicos enable row level security;

-- Site público: só serviços ativos.
create policy servicos_select_publico
on public.servicos for select
to anon
using (ativo);

create policy servicos_select_equipe
on public.servicos for select
to authenticated
using (true);

create policy servicos_insert_admin
on public.servicos for insert
to authenticated
with check (public.is_admin());

create policy servicos_update_admin
on public.servicos for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Sem delete: serviço é desativado (histórico de agendamentos/OS aponta pra ele).

-- ---------------------------------------------------------------------------
-- Barbeiro: foto, serviços que realiza, jornada semanal
-- ---------------------------------------------------------------------------
alter table public.profiles add column foto_path text;
comment on column public.profiles.foto_path is 'Caminho da foto no bucket público "publico" (exibida no site).';

create table public.barbeiro_servicos (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  servico_id uuid not null references public.servicos (id) on delete cascade,
  primary key (profile_id, servico_id)
);

comment on table public.barbeiro_servicos is 'Quais serviços cada barbeiro realiza. Alterado só via definir_servicos_barbeiro() / atribuir_servico_a_todos().';

create index barbeiro_servicos_servico_idx on public.barbeiro_servicos (servico_id);

alter table public.barbeiro_servicos enable row level security;

create policy barbeiro_servicos_select_equipe
on public.barbeiro_servicos for select
to authenticated
using (true);

create policy barbeiro_servicos_escrita_admin
on public.barbeiro_servicos for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create table public.jornadas (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  inicio time not null,
  fim time not null,
  constraint jornadas_faixa_valida check (inicio < fim)
);

comment on table public.jornadas is 'Jornada semanal de cada barbeiro (várias faixas por dia = intervalo). Dia sem faixa = folga fixa. Alterado só via substituir_jornada().';

create index jornadas_profile_dia_idx on public.jornadas (profile_id, dia_semana, inicio);

alter table public.jornadas enable row level security;

create policy jornadas_select_equipe
on public.jornadas for select
to authenticated
using (true);

create policy jornadas_escrita_admin
on public.jornadas for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Bloqueios: feriado da barbearia (profile_id nulo) ou folga/bloqueio de um barbeiro
-- ---------------------------------------------------------------------------
create table public.bloqueios (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete cascade,
  tipo text not null check (tipo in ('feriado', 'folga', 'bloqueio')),
  inicio timestamptz not null,
  fim timestamptz not null,
  motivo text,
  criado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint bloqueios_intervalo_valido check (inicio < fim),
  -- Feriado vale pra barbearia inteira; folga/bloqueio é sempre de um barbeiro.
  constraint bloqueios_tipo_coerente check ((tipo = 'feriado') = (profile_id is null))
);

comment on table public.bloqueios is 'Períodos sem atendimento: feriado/fechamento da barbearia (profile_id nulo) ou folga/bloqueio de um barbeiro. Intervalo [inicio, fim).';

create index bloqueios_periodo_idx on public.bloqueios (inicio, fim);
create index bloqueios_profile_idx on public.bloqueios (profile_id, inicio);

alter table public.bloqueios enable row level security;

create policy bloqueios_select_equipe
on public.bloqueios for select
to authenticated
using (true);

create policy bloqueios_insert_admin
on public.bloqueios for insert
to authenticated
with check (public.is_admin() and criado_por = auth.uid());

create policy bloqueios_delete_admin
on public.bloqueios for delete
to authenticated
using (public.is_admin());

-- Sem update: bloqueio errado é removido e cadastrado de novo.

-- ---------------------------------------------------------------------------
-- Funções de substituição atômica (tudo ou nada; rodam com a permissão de quem chama,
-- então as policies de admin acima continuam valendo).
-- p_faixas: [{"dia_semana": 1, "inicio": "09:00", "fim": "12:00"}, ...]
-- ---------------------------------------------------------------------------
create function public.validar_faixas_semana(p_faixas jsonb)
returns void
language plpgsql
immutable
as $$
begin
  if jsonb_typeof(p_faixas) is distinct from 'array' then
    raise exception 'Formato inválido de horários.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_faixas) as f(dia_semana smallint, inicio time, fim time)
    where f.dia_semana is null or f.inicio is null or f.fim is null
       or f.dia_semana not between 0 and 6 or f.inicio >= f.fim
  ) then
    raise exception 'Cada faixa precisa de início antes do fim.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_faixas) as a(dia_semana smallint, inicio time, fim time)
    join jsonb_to_recordset(p_faixas) as b(dia_semana smallint, inicio time, fim time)
      on a.dia_semana = b.dia_semana
     and (a.inicio, a.fim) <> (b.inicio, b.fim)
     and a.inicio < b.fim and b.inicio < a.fim
  ) or exists (
    -- faixas idênticas repetidas no mesmo dia também contam como sobreposição
    select 1
    from jsonb_to_recordset(p_faixas) as f(dia_semana smallint, inicio time, fim time)
    group by f.dia_semana, f.inicio, f.fim
    having count(*) > 1
  ) then
    raise exception 'Há faixas de horário sobrepostas no mesmo dia.';
  end if;
end;
$$;

create function public.substituir_horarios_funcionamento(p_faixas jsonb)
returns void
language plpgsql
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores alteram o horário de funcionamento.';
  end if;
  perform public.validar_faixas_semana(p_faixas);

  delete from public.horarios_funcionamento where true;
  insert into public.horarios_funcionamento (dia_semana, inicio, fim)
  select f.dia_semana, f.inicio, f.fim
  from jsonb_to_recordset(p_faixas) as f(dia_semana smallint, inicio time, fim time);
end;
$$;

create function public.substituir_jornada(p_profile_id uuid, p_faixas jsonb)
returns void
language plpgsql
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores alteram jornadas.';
  end if;
  perform public.validar_faixas_semana(p_faixas);

  delete from public.jornadas where profile_id = p_profile_id;
  insert into public.jornadas (profile_id, dia_semana, inicio, fim)
  select p_profile_id, f.dia_semana, f.inicio, f.fim
  from jsonb_to_recordset(p_faixas) as f(dia_semana smallint, inicio time, fim time);
end;
$$;

create function public.definir_servicos_barbeiro(p_profile_id uuid, p_servico_ids uuid[])
returns void
language plpgsql
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores definem os serviços dos barbeiros.';
  end if;

  delete from public.barbeiro_servicos where profile_id = p_profile_id;
  insert into public.barbeiro_servicos (profile_id, servico_id)
  select p_profile_id, unnest(coalesce(p_servico_ids, '{}'));
end;
$$;

-- Serviço novo: atalho pra já sair realizado por todos que atendem (senão ninguém o
-- oferece no site até alguém marcar barbeiro por barbeiro).
create function public.atribuir_servico_a_todos(p_servico_id uuid)
returns void
language plpgsql
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores definem os serviços dos barbeiros.';
  end if;

  insert into public.barbeiro_servicos (profile_id, servico_id)
  select p.id, p_servico_id
  from public.profiles p
  where p.atende_como_barbeiro and p.ativo
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: bucket PÚBLICO de imagens (decisão 17) — logo e fotos dos barbeiros.
-- Leitura pública pela URL; escrita só admin. Nada sensível vai aqui.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('publico', 'publico', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- A leitura pela URL pública não passa por RLS; esta policy só existe porque a API do
-- Storage exige SELECT para remover/substituir objetos (troca de logo/foto).
create policy publico_select_admin
on storage.objects for select
to authenticated
using (bucket_id = 'publico' and public.is_admin());

create policy publico_insert_admin
on storage.objects for insert
to authenticated
with check (bucket_id = 'publico' and public.is_admin());

create policy publico_update_admin
on storage.objects for update
to authenticated
using (bucket_id = 'publico' and public.is_admin())
with check (bucket_id = 'publico' and public.is_admin());

create policy publico_delete_admin
on storage.objects for delete
to authenticated
using (bucket_id = 'publico' and public.is_admin());
