-- "Começar agora" (pedido do dono, 2026-09-26; docs/ARQUITETURA.md decisão 48): cliente
-- adiantado. O agendamento passa a começar agora (minuto cheio), o fim é recalculado
-- pela duração dos serviços contratados e a OS é aberta. A trava de sobreposição recusa
-- (23P01) se o barbeiro tiver outro cliente nesse intervalo.
--
-- Concluir antes do fim previsto encurta o agendamento até a hora da conclusão: o resto
-- do horário fica livre na agenda (e no site) — senão o "Começar agora" do próximo
-- cliente seria recusado por um atendimento que já acabou.

create function public.comecar_agora(p_agendamento_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agendamentos%rowtype;
  v_inicio timestamptz := date_trunc('minute', now());
begin
  select * into a from public.agendamentos where id = p_agendamento_id for update;
  if not found then
    raise exception 'AGENDAMENTO_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if not public.pode_gerenciar_agendamento(a.barbeiro_id) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if a.status <> 'agendado' then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;

  -- Só antecipa: se o horário já chegou, só abre a OS (a checagem faria o mesmo).
  if a.inicio > v_inicio then
    update public.agendamentos
    set inicio = v_inicio,
        fim = v_inicio + make_interval(mins => a.duracao_total_minutos)
    where id = a.id;
    return public.abrir_os(a.id, auth.uid(), v_inicio);
  end if;
  return public.abrir_os(a.id, auth.uid(), a.inicio);
end;
$$;

revoke execute on function public.comecar_agora(uuid) from public, anon;
grant execute on function public.comecar_agora(uuid) to authenticated;

create or replace function public.concluir_atendimento(p_os_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ordens_servico%rowtype;
begin
  o := public.os_para_alterar(p_os_id, true);
  if not exists (select 1 from public.os_servicos where os_id = o.id) then
    raise exception 'OS_SEM_SERVICOS' using errcode = 'P0001';
  end if;
  update public.ordens_servico set status = 'concluida', concluida_em = now() where id = o.id;
  -- Terminou antes do previsto: libera o resto do horário. Nunca estica (concluir tarde
  -- não empurra ninguém) e nunca fica com menos de 5 min (concluído logo ao abrir).
  update public.agendamentos
  set status = 'concluido',
      fim = greatest(inicio + interval '5 minutes', least(fim, date_trunc('minute', now())))
  where id = o.agendamento_id;
end;
$$;
