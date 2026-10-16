-- Corrida de dois agendamentos no mesmo horário (pedido do dono, 2026-09-27).
-- Duas gravações simultâneas que se sobrepõem na trava de exclusão
-- (agendamentos_sem_sobreposicao_por_barbeiro) às vezes se esperam mutuamente e o
-- Postgres aborta uma com deadlock (40P01) — o cliente recebia erro 500 em vez de
-- "horário ocupado". Comportamento conhecido das exclusion constraints.
-- Correção: antes de gravar horário/barbeiro/status, cada transação entra na fila do
-- barbeiro (trava consultiva até o fim da transação). A segunda espera a primeira
-- terminar e então esbarra na trava de sobreposição normalmente (23P01).
-- Vale para todos os caminhos: site, encaixe, reagendar, começar agora, concluir.

create or replace function public.agendamentos_fila_por_barbeiro()
returns trigger
language plpgsql
as $$
begin
  -- Reagendar trocando de barbeiro entra nas duas filas, sempre na mesma ordem
  -- (senão duas trocas cruzadas poderiam se travar).
  if tg_op = 'UPDATE' and old.barbeiro_id is distinct from new.barbeiro_id then
    perform pg_advisory_xact_lock(hashtext('agenda_barbeiro_' || least(old.barbeiro_id, new.barbeiro_id)::text));
    perform pg_advisory_xact_lock(hashtext('agenda_barbeiro_' || greatest(old.barbeiro_id, new.barbeiro_id)::text));
  else
    perform pg_advisory_xact_lock(hashtext('agenda_barbeiro_' || new.barbeiro_id::text));
  end if;
  return new;
end;
$$;

comment on function public.agendamentos_fila_por_barbeiro is 'Serializa por barbeiro as gravações que a trava de sobreposição confere — evita deadlock (40P01) na corrida pelo mesmo horário.';

create trigger agendamentos_fila_por_barbeiro
  before insert or update of barbeiro_id, inicio, fim, status on public.agendamentos
  for each row execute function public.agendamentos_fila_por_barbeiro();
