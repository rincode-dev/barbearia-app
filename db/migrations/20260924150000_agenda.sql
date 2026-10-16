-- Fase 3 — Agenda + clientes no painel.
--
-- - agenda_equipe: todos os agendamentos para a equipe logada (decisão 15: barbeiro vê a
--   ocupação de todos), com cliente/valor/observação só nos próprios (admin vê tudo).
-- - clientes_resumo: primeiro/último atendimento, quantidade e próximo agendamento.
-- - Mudanças em agendamentos só por funções (não há policy de UPDATE/INSERT direto):
--   alterar_status_agendamento, reagendar_agendamento, criar_agendamento_painel. Cada uma
--   confere quem pode (dono do agendamento ou admin) e o que pode (transições válidas).
-- - Realtime: agendamentos entram na publicação do Supabase Realtime (agenda ao vivo).

-- ---------------------------------------------------------------------------
-- Visão de equipe da agenda
-- ---------------------------------------------------------------------------
-- Dono da view = dono da migration (ignora o RLS de agendamentos de propósito, pra
-- mostrar a ocupação de todos); a máscara por linha é feita aqui dentro. Por isso:
-- (1) só usuário logado e ativo vê linhas; (2) anon não tem nem permissão de SELECT.
create view public.agenda_equipe as
select
  a.id,
  a.barbeiro_id,
  p.nome as barbeiro_nome,
  a.inicio,
  a.fim,
  a.status,
  a.origem,
  a.duracao_total_minutos,
  coalesce(
    (select string_agg(s.nome, ' + ' order by s.ordem) from public.agendamento_servicos s where s.agendamento_id = a.id),
    ''
  ) as servicos,
  coalesce(
    (select array_agg(s.servico_id order by s.ordem) from public.agendamento_servicos s where s.agendamento_id = a.id),
    '{}'
  ) as servico_ids,
  (a.barbeiro_id = auth.uid() or public.is_admin()) as pode_ver_detalhes,
  case when a.barbeiro_id = auth.uid() or public.is_admin() then a.cliente_id end as cliente_id,
  case when a.barbeiro_id = auth.uid() or public.is_admin() then c.nome end as cliente_nome,
  case when a.barbeiro_id = auth.uid() or public.is_admin() then c.telefone end as cliente_telefone,
  case when a.barbeiro_id = auth.uid() or public.is_admin() then a.valor_total end as valor_total,
  case when a.barbeiro_id = auth.uid() or public.is_admin() then a.observacao end as observacao,
  case when a.barbeiro_id = auth.uid() or public.is_admin() then a.motivo_cancelamento end as motivo_cancelamento
from public.agendamentos a
join public.profiles p on p.id = a.barbeiro_id
join public.clientes c on c.id = a.cliente_id
where exists (select 1 from public.profiles eu where eu.id = auth.uid() and eu.ativo);

comment on view public.agenda_equipe is 'Agenda da equipe: todos os agendamentos; cliente/valor/observação só para o barbeiro responsável ou admin. Só usuário logado e ativo.';

revoke all on public.agenda_equipe from anon, public;
grant select on public.agenda_equipe to authenticated;

-- ---------------------------------------------------------------------------
-- Resumo por cliente (lista e ficha do cliente). "Atendimento" = agendamento concluído
-- (a conclusão vem com a OS, Fase 4).
-- ---------------------------------------------------------------------------
create view public.clientes_resumo as
select
  c.id as cliente_id,
  min(a.inicio) filter (where a.status = 'concluido') as primeiro_atendimento,
  max(a.inicio) filter (where a.status = 'concluido') as ultimo_atendimento,
  count(*) filter (where a.status = 'concluido') as quantidade_atendimentos,
  min(a.inicio) filter (where a.status in ('agendado', 'confirmado') and a.fim > now()) as proximo_agendamento
from public.clientes c
left join public.agendamentos a on a.cliente_id = c.id
where exists (select 1 from public.profiles eu where eu.id = auth.uid() and eu.ativo)
group by c.id;

comment on view public.clientes_resumo is 'Por cliente: primeiro/último atendimento concluído, quantidade e próximo agendamento. Só usuário logado e ativo.';

revoke all on public.clientes_resumo from anon, public;
grant select on public.clientes_resumo to authenticated;

-- ---------------------------------------------------------------------------
-- Permissão comum: dono do agendamento (barbeiro) ou admin, sempre usuário ativo.
-- ---------------------------------------------------------------------------
create function public.pode_gerenciar_agendamento(p_barbeiro_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles eu
    where eu.id = auth.uid() and eu.ativo
      and (eu.role = 'admin' or eu.id = p_barbeiro_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Status: um passo por vez (docs/ARQUITETURA.md, "Status do agendamento").
-- em_atendimento e concluido NÃO entram por aqui: nascem com a OS (Fase 4), que vai
-- substituir esta função.
-- ---------------------------------------------------------------------------
create function public.alterar_status_agendamento(p_id uuid, p_novo text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.agendamentos%rowtype;
  v_permitido boolean;
begin
  select * into v from public.agendamentos where id = p_id for update;
  if not found then
    raise exception 'AGENDAMENTO_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if not public.pode_gerenciar_agendamento(v.barbeiro_id) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;

  v_permitido := case v.status
    when 'agendado' then p_novo in ('confirmado', 'chegou', 'cancelado', 'nao_compareceu')
    when 'confirmado' then p_novo in ('agendado', 'chegou', 'cancelado', 'nao_compareceu')
    when 'chegou' then p_novo in ('confirmado', 'cancelado')
    when 'cancelado' then p_novo = 'agendado'
    when 'nao_compareceu' then p_novo = 'agendado'
    else false
  end;
  if not v_permitido then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;

  -- Reabrir volta a ocupar o horário: a trava de sobreposição pode recusar (23P01) se
  -- alguém já foi marcado ali nesse meio-tempo.
  update public.agendamentos
  set status = p_novo,
      motivo_cancelamento = case
        when p_novo = 'cancelado' then nullif(trim(coalesce(p_motivo, '')), '')
        when p_novo = 'agendado' then null
        else motivo_cancelamento
      end
  where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reagendar: nova data/hora e, se for admin, outro barbeiro. Mantém serviços, valor e
-- duração. Barbeiro só reagenda os próprios e só para si mesmo.
-- ---------------------------------------------------------------------------
create function public.reagendar_agendamento(p_id uuid, p_novo_inicio timestamptz, p_novo_barbeiro_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.agendamentos%rowtype;
  v_destino uuid := coalesce(p_novo_barbeiro_id, (select barbeiro_id from public.agendamentos where id = p_id));
begin
  select * into v from public.agendamentos where id = p_id for update;
  if not found then
    raise exception 'AGENDAMENTO_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if not public.pode_gerenciar_agendamento(v.barbeiro_id) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if v_destino <> v.barbeiro_id and not public.is_admin() then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if v.status not in ('agendado', 'confirmado') then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = v_destino and ativo and atende_como_barbeiro) then
    raise exception 'BARBEIRO_INDISPONIVEL' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.agendamento_servicos s
    where s.agendamento_id = p_id
      and not exists (
        select 1 from public.barbeiro_servicos bs where bs.profile_id = v_destino and bs.servico_id = s.servico_id
      )
  ) then
    raise exception 'SERVICOS_INVALIDOS' using errcode = 'P0001';
  end if;

  update public.agendamentos
  set inicio = p_novo_inicio,
      fim = p_novo_inicio + make_interval(mins => v.duracao_total_minutos),
      barbeiro_id = v_destino
  where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Encaixe / agendamento pelo painel (balcão, telefone). Flexível de propósito: não passa
-- pelo motor de disponibilidade (a equipe pode encaixar fora do horário do site), mas a
-- trava de sobreposição vale sempre. Cliente: existente (p_cliente_id) ou novo/por
-- telefone (dedupe igual ao site). Sem limite de agendamentos por telefone.
-- ---------------------------------------------------------------------------
create function public.criar_agendamento_painel(
  p_cliente_id uuid,
  p_cliente_nome text,
  p_cliente_telefone text,
  p_barbeiro_id uuid,
  p_inicio timestamptz,
  p_servico_ids uuid[],
  p_observacao text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := p_cliente_nome;
  v_telefone text := p_cliente_telefone;
  v_id uuid;
begin
  if not public.pode_gerenciar_agendamento(p_barbeiro_id) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;

  if p_cliente_id is not null then
    select nome, telefone into v_nome, v_telefone from public.clientes where id = p_cliente_id;
    if not found then
      raise exception 'CLIENTE_NAO_ENCONTRADO' using errcode = 'P0001';
    end if;
  end if;

  v_id := public.criar_agendamento(v_nome, v_telefone, p_barbeiro_id, p_inicio, p_servico_ids, 'painel', 1000000);

  if nullif(trim(coalesce(p_observacao, '')), '') is not null then
    update public.agendamentos set observacao = trim(p_observacao) where id = v_id;
  end if;
  return v_id;
end;
$$;

-- Funções de escrita: só usuário logado (as checagens de dono/admin estão dentro).
revoke execute on function public.alterar_status_agendamento(uuid, text, text) from public, anon;
revoke execute on function public.reagendar_agendamento(uuid, timestamptz, uuid) from public, anon;
revoke execute on function public.criar_agendamento_painel(uuid, text, text, uuid, timestamptz, uuid[], text) from public, anon;
revoke execute on function public.pode_gerenciar_agendamento(uuid) from public, anon;
grant execute on function public.alterar_status_agendamento(uuid, text, text) to authenticated;
grant execute on function public.reagendar_agendamento(uuid, timestamptz, uuid) to authenticated;
grant execute on function public.criar_agendamento_painel(uuid, text, text, uuid, timestamptz, uuid[], text) to authenticated;
grant execute on function public.pode_gerenciar_agendamento(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: a agenda do painel escuta mudanças em agendamentos (o Realtime respeita o
-- RLS de SELECT de cada usuário: admin recebe tudo, barbeiro os próprios; o resto da
-- ocupação da equipe chega pela checagem periódica da tela).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.agendamentos;
