-- Caso de borda da Fase 4: atendimento cancelado no meio (OS cancelada) e agendamento
-- reaberto depois. iniciar_atendimento() devolvia a OS cancelada; agora a reativa (volta a
-- "aberta", mantendo os serviços realizados e o histórico de pagamentos estornados).
create or replace function public.iniciar_atendimento(p_agendamento_id uuid)
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
  if not public.pode_gerenciar_agendamento(a.barbeiro_id) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;

  select id, status into v_os, v_status_os from public.ordens_servico where agendamento_id = a.id;

  -- Já em atendimento/concluída: só devolve a OS (idempotente).
  if v_os is not null and v_status_os <> 'cancelada' then
    return v_os;
  end if;

  if a.status not in ('agendado', 'confirmado', 'chegou') then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;

  if v_os is not null then
    update public.ordens_servico
    set status = 'aberta', cancelada_em = null, motivo_cancelamento = null
    where id = v_os;
  else
    insert into public.ordens_servico (agendamento_id, cliente_id, barbeiro_id, criada_por)
    values (a.id, a.cliente_id, a.barbeiro_id, auth.uid())
    returning id into v_os;

    insert into public.os_servicos (os_id, servico_id, nome, preco, duracao_minutos, origem, barbeiro_id, adicionado_por)
    select v_os, s.servico_id, s.nome, s.preco, s.duracao_minutos, 'agendado', a.barbeiro_id, auth.uid()
    from public.agendamento_servicos s
    where s.agendamento_id = a.id
    order by s.ordem;
  end if;

  update public.agendamentos set status = 'em_atendimento' where id = a.id;
  return v_os;
end;
$$;

revoke execute on function public.iniciar_atendimento(uuid) from public, anon;
grant execute on function public.iniciar_atendimento(uuid) to authenticated;
