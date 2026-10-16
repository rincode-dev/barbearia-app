-- Fase 2 — Agendamentos (base do site com agendamento online). A OS (Fase 4) nasce a
-- partir daqui; a agenda do painel (Fase 3) lê esta tabela.
--
-- Regras garantidas no banco:
-- - Um barbeiro nunca tem dois agendamentos ativos sobrepostos (exclusion constraint,
--   à prova de dois clientes confirmando ao mesmo tempo). Cancelado e não compareceu
--   liberam o horário.
-- - Serviços do agendamento guardam cópia de nome/preço/duração (decisão 8).
-- - O agendamento online só entra pela função criar_agendamento(), que só o servidor do
--   app (service_role) pode executar — ela confere barbeiro, serviços, preço e duração no
--   próprio banco, nunca confiando no que veio do navegador.

create extension if not exists btree_gist;

create table public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  barbeiro_id uuid not null references public.profiles (id),
  inicio timestamptz not null,
  fim timestamptz not null,
  status text not null default 'agendado' check (
    status in ('agendado', 'confirmado', 'chegou', 'em_atendimento', 'concluido', 'cancelado', 'nao_compareceu')
  ),
  origem text not null check (origem in ('site', 'painel')),
  -- Cópias do momento do agendamento (a OS registra o que de fato aconteceu).
  valor_total numeric(10, 2) not null check (valor_total >= 0),
  duracao_total_minutos integer not null check (duracao_total_minutos > 0),
  observacao text,
  motivo_cancelamento text,
  criado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agendamentos_intervalo_valido check (inicio < fim),
  constraint agendamentos_sem_sobreposicao_por_barbeiro exclude using gist (
    barbeiro_id with =,
    tstzrange(inicio, fim, '[)') with &&
  ) where (status not in ('cancelado', 'nao_compareceu'))
);

comment on table public.agendamentos is 'O que foi marcado (site ou painel). Nunca apagado: cancelar/não compareceu. Um barbeiro não tem dois agendamentos ativos sobrepostos.';

create index agendamentos_barbeiro_inicio_idx on public.agendamentos (barbeiro_id, inicio);
create index agendamentos_inicio_idx on public.agendamentos (inicio);
create index agendamentos_cliente_idx on public.agendamentos (cliente_id, inicio desc);

create trigger trg_agendamentos_updated_at
before update on public.agendamentos
for each row execute function public.set_updated_at();

create table public.agendamento_servicos (
  id uuid primary key default gen_random_uuid(),
  agendamento_id uuid not null references public.agendamentos (id) on delete cascade,
  servico_id uuid not null references public.servicos (id),
  nome text not null,
  preco numeric(10, 2) not null check (preco >= 0),
  duracao_minutos integer not null check (duracao_minutos > 0),
  ordem smallint not null default 0
);

comment on table public.agendamento_servicos is 'Serviços agendados, com cópia de nome/preço/duração do momento do agendamento.';

create index agendamento_servicos_agendamento_idx on public.agendamento_servicos (agendamento_id, ordem);

-- ---------------------------------------------------------------------------
-- RLS. Nesta fase o painel só lê; a visão de equipe da agenda (ocupação de todos com
-- dados mascarados) e as ações de status/encaixe vêm na Fase 3.
-- ---------------------------------------------------------------------------
alter table public.agendamentos enable row level security;
alter table public.agendamento_servicos enable row level security;

create policy agendamentos_select_proprio_ou_admin
on public.agendamentos for select
to authenticated
using (barbeiro_id = auth.uid() or public.is_admin());

create policy agendamento_servicos_select_proprio_ou_admin
on public.agendamento_servicos for select
to authenticated
using (
  exists (
    select 1 from public.agendamentos a
    where a.id = agendamento_id and (a.barbeiro_id = auth.uid() or public.is_admin())
  )
);

-- ---------------------------------------------------------------------------
-- Criação atômica do agendamento (cliente + agendamento + serviços, tudo ou nada).
-- A disponibilidade (jornada, funcionamento, bloqueios, antecedência) é calculada antes,
-- no servidor (src/lib/agendamento/); aqui ficam as garantias que não podem depender do
-- navegador: barbeiro válido, serviços válidos e feitos por ele, preço/duração do banco,
-- limite de agendamentos por telefone e a trava de sobreposição.
-- ---------------------------------------------------------------------------
create function public.criar_agendamento(
  p_cliente_nome text,
  p_cliente_telefone text,
  p_barbeiro_id uuid,
  p_inicio timestamptz,
  p_servico_ids uuid[],
  p_origem text,
  p_max_ativos_por_telefone integer default 3
)
returns uuid
language plpgsql
as $$
declare
  v_nome text := trim(coalesce(p_cliente_nome, ''));
  v_telefone text := regexp_replace(coalesce(p_cliente_telefone, ''), '\D', '', 'g');
  v_qtd_pedidos integer;
  v_qtd_validos integer;
  v_duracao integer;
  v_valor numeric(10, 2);
  v_cliente_id uuid;
  v_agendamento_id uuid;
begin
  if length(v_nome) < 2 then
    raise exception 'NOME_INVALIDO' using errcode = 'P0001';
  end if;
  if v_telefone !~ '^(55)?[1-9][0-9][0-9]{8,9}$' then
    raise exception 'TELEFONE_INVALIDO' using errcode = 'P0001';
  end if;
  if p_origem not in ('site', 'painel') then
    raise exception 'ORIGEM_INVALIDA' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_barbeiro_id and ativo and atende_como_barbeiro
  ) then
    raise exception 'BARBEIRO_INDISPONIVEL' using errcode = 'P0001';
  end if;

  v_qtd_pedidos := coalesce(array_length(p_servico_ids, 1), 0);
  select count(*), coalesce(sum(s.duracao_minutos), 0), coalesce(sum(s.preco), 0)
    into v_qtd_validos, v_duracao, v_valor
  from public.servicos s
  join public.barbeiro_servicos bs on bs.servico_id = s.id and bs.profile_id = p_barbeiro_id
  where s.id = any (p_servico_ids) and s.ativo;

  if v_qtd_pedidos = 0
     or v_qtd_validos <> v_qtd_pedidos
     or v_qtd_pedidos <> (select count(distinct x) from unnest(p_servico_ids) x) then
    raise exception 'SERVICOS_INVALIDOS' using errcode = 'P0001';
  end if;

  -- Cliente: reaproveita pelo telefone (chave de deduplicação). Não troca o nome de um
  -- cadastro existente (evita alguém renomear o cadastro de outra pessoa pelo site);
  -- se estava arquivado, volta a ficar ativo.
  -- Serializa por telefone: dois agendamentos simultâneos do mesmo número não furam o
  -- limite nem criam cliente duplicado.
  perform pg_advisory_xact_lock(hashtext('agendamento_tel_' || v_telefone));

  select id into v_cliente_id from public.clientes where telefone = v_telefone;

  if v_cliente_id is not null and (
    select count(*) from public.agendamentos
    where cliente_id = v_cliente_id
      and fim > now()
      and status in ('agendado', 'confirmado')
  ) >= p_max_ativos_por_telefone then
    raise exception 'LIMITE_AGENDAMENTOS' using errcode = 'P0001';
  end if;

  if v_cliente_id is null then
    insert into public.clientes (nome, telefone, origem, criado_por)
    values (v_nome, v_telefone, p_origem, case when p_origem = 'painel' then auth.uid() end)
    returning id into v_cliente_id;
  else
    update public.clientes set deleted_at = null where id = v_cliente_id and deleted_at is not null;
  end if;

  insert into public.agendamentos (
    cliente_id, barbeiro_id, inicio, fim, origem, valor_total, duracao_total_minutos, criado_por
  )
  values (
    v_cliente_id, p_barbeiro_id, p_inicio, p_inicio + make_interval(mins => v_duracao), p_origem,
    v_valor, v_duracao, case when p_origem = 'painel' then auth.uid() end
  )
  returning id into v_agendamento_id;

  insert into public.agendamento_servicos (agendamento_id, servico_id, nome, preco, duracao_minutos, ordem)
  select v_agendamento_id, s.id, s.nome, s.preco, s.duracao_minutos, pedido.ordem
  from unnest(p_servico_ids) with ordinality as pedido(servico_id, ordem)
  join public.servicos s on s.id = pedido.servico_id;

  return v_agendamento_id;
end;
$$;

comment on function public.criar_agendamento is 'Cria cliente (ou reaproveita pelo telefone) + agendamento + serviços, atomicamente. Só o servidor do app (service_role) executa.';

-- Funções em public são executáveis por anon/authenticated por padrão no Supabase: esta
-- NÃO pode ser (pularia o cálculo de disponibilidade feito no servidor).
revoke execute on function public.criar_agendamento(text, text, uuid, timestamptz, uuid[], text, integer)
  from public, anon, authenticated;
grant execute on function public.criar_agendamento(text, text, uuid, timestamptz, uuid[], text, integer)
  to service_role;
