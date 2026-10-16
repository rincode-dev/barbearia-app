-- Fluxo simplificado do atendimento (pedido do dono, 2026-09-26; docs/ARQUITETURA.md decisão 48):
--   Agendado → (no horário, sozinho) Em atendimento = OS aberta → Concluído
-- Sem "Confirmar", "Cliente chegou" nem "Iniciar atendimento". Na hora de início o sistema
-- abre a OS (iniciar_atendimentos_do_horario, chamada a cada minuto pelo app e ao abrir
-- as telas da equipe). Durante o atendimento: concluir, não compareceu ou reagendou — os
-- dois últimos desfazem a OS (apagada; se já teve pagamento estornado, fica cancelada
-- para manter o histórico) e recusam se houver pagamento ativo.

-- Status que deixaram de existir voltam a "agendado" (no horário viram atendimento).
update public.agendamentos set status = 'agendado' where status in ('confirmado', 'chegou');

alter table public.agendamentos drop constraint agendamentos_status_check;
alter table public.agendamentos add constraint agendamentos_status_check
  check (status in ('agendado', 'em_atendimento', 'concluido', 'cancelado', 'nao_compareceu'));

-- Abre (ou reativa) a OS de um agendamento. Interna: quem chama já conferiu permissão.
-- p_inicio = quando o atendimento começou (data usada nos números).
create function public.abrir_os(p_agendamento_id uuid, p_por uuid, p_inicio timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agendamentos%rowtype;
  v_os uuid;
  v_status_os text;
begin
  select * into a from public.agendamentos where id = p_agendamento_id for update;
  if not found then
    raise exception 'AGENDAMENTO_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;

  select id, status into v_os, v_status_os from public.ordens_servico where agendamento_id = a.id;
  -- Já em atendimento/concluída: só devolve a OS (idempotente).
  if v_os is not null and v_status_os <> 'cancelada' then
    return v_os;
  end if;
  if a.status <> 'agendado' then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;

  if v_os is not null then
    update public.ordens_servico
    set status = 'aberta', cancelada_em = null, motivo_cancelamento = null, iniciada_em = p_inicio
    where id = v_os;
  else
    insert into public.ordens_servico (agendamento_id, cliente_id, barbeiro_id, criada_por, iniciada_em)
    values (a.id, a.cliente_id, a.barbeiro_id, p_por, p_inicio)
    returning id into v_os;

    insert into public.os_servicos (os_id, servico_id, nome, preco, duracao_minutos, origem, barbeiro_id, adicionado_por)
    select v_os, s.servico_id, s.nome, s.preco, s.duracao_minutos, 'agendado', a.barbeiro_id, p_por
    from public.agendamento_servicos s
    where s.agendamento_id = a.id
    order by s.ordem;
  end if;

  update public.agendamentos set status = 'em_atendimento' where id = a.id;
  return v_os;
end;
$$;

revoke execute on function public.abrir_os(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Abrir a OS antes do horário continua possível pelo banco (sem botão na tela).
create or replace function public.iniciar_atendimento(p_agendamento_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barbeiro uuid;
begin
  select barbeiro_id into v_barbeiro from public.agendamentos where id = p_agendamento_id;
  if not found then
    raise exception 'AGENDAMENTO_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if not public.pode_gerenciar_agendamento(v_barbeiro) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  return public.abrir_os(p_agendamento_id, auth.uid(), now());
end;
$$;

-- No horário: todo agendamento que já começou vira atendimento. A OS é datada pelo
-- horário marcado (não pelo momento em que a checagem rodou). Devolve quantos abriu.
create function public.iniciar_atendimentos_do_horario()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id, inicio from public.agendamentos
    where status = 'agendado' and inicio <= now()
    order by inicio
    for update skip locked
  loop
    perform public.abrir_os(r.id, null, r.inicio);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.iniciar_atendimentos_do_horario() from public, anon, authenticated;
grant execute on function public.iniciar_atendimentos_do_horario() to service_role;

-- Desfaz a OS aberta de um agendamento (não compareceu / reagendou). Interna.
create function public.desfazer_os(p_agendamento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ordens_servico%rowtype;
begin
  select * into o from public.ordens_servico where agendamento_id = p_agendamento_id for update;
  if not found or o.status = 'cancelada' then
    return;
  end if;
  if o.status <> 'aberta' then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;
  if o.total_pago > 0 then
    raise exception 'OS_COM_PAGAMENTO' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.pagamentos where os_id = o.id) then
    update public.ordens_servico
    set status = 'cancelada', cancelada_em = now(), motivo_cancelamento = p_motivo
    where id = o.id;
  else
    delete from public.ordens_servico where id = o.id;
  end if;
end;
$$;

revoke execute on function public.desfazer_os(uuid, text) from public, anon, authenticated;

create or replace function public.alterar_status_agendamento(p_id uuid, p_novo text, p_motivo text default null)
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
    when 'agendado' then p_novo in ('cancelado', 'nao_compareceu')
    when 'em_atendimento' then p_novo = 'nao_compareceu'
    when 'cancelado' then p_novo = 'agendado'
    when 'nao_compareceu' then p_novo = 'agendado'
    else false
  end;
  if not v_permitido then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;

  if v.status = 'em_atendimento' then
    perform public.desfazer_os(p_id, 'Não compareceu');
  end if;

  -- Reabrir volta a ocupar o horário: a trava de sobreposição pode recusar (23P01) se
  -- alguém já foi marcado ali nesse meio-tempo. Se o horário já passou, a próxima
  -- checagem abre a OS.
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

create or replace function public.reagendar_agendamento(p_id uuid, p_novo_inicio timestamptz, p_novo_barbeiro_id uuid)
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
  if v.status not in ('agendado', 'em_atendimento') then
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

  -- Reagendou durante o atendimento: a OS sai e o agendamento volta a esperar o novo horário.
  if v.status = 'em_atendimento' then
    perform public.desfazer_os(p_id, 'Reagendado');
  end if;

  update public.agendamentos
  set inicio = p_novo_inicio,
      fim = p_novo_inicio + make_interval(mins => v.duracao_total_minutos),
      barbeiro_id = v_destino,
      status = 'agendado'
  where id = p_id;
end;
$$;
