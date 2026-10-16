-- Número da OS só na conclusão (pedido do dono, 2026-09-26; docs/ARQUITETURA.md decisão 49).
-- Com o atendimento abrindo sozinho no horário (decisão 48), numerar na abertura gastava
-- número com "não compareceu" e "reagendou" — buracos na sequência. Agora:
--   * OS em andamento não tem número ("OS em andamento" na tela);
--   * ao concluir, recebe o próximo de um contador próprio, atualizado na mesma transação
--     (se a conclusão falhar, nada é gasto: sequência sem buracos, ao contrário da
--     sequence do Postgres);
--   * reabrir para correção mantém o número; OS cancelada nunca recebe.
-- Todas as OS existentes eram de teste (dono, 2026-09-26): as concluídas são renumeradas
-- 1, 2, 3... pela ordem de conclusão.

create table public.contador_os (
  id boolean primary key default true check (id),
  ultimo bigint not null default 0
);
alter table public.contador_os enable row level security; -- só as funções do banco mexem
revoke all on public.contador_os from anon, authenticated;

alter table public.ordens_servico alter column numero drop identity if exists;
alter table public.ordens_servico alter column numero drop not null;

update public.ordens_servico set numero = null;
update public.ordens_servico o
set numero = n.rn
from (
  select id, row_number() over (order by concluida_em, iniciada_em, id) as rn
  from public.ordens_servico
  where status = 'concluida'
) n
where o.id = n.id;

insert into public.contador_os (ultimo)
select coalesce(max(numero), 0) from public.ordens_servico;

create or replace function public.concluir_atendimento(p_os_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ordens_servico%rowtype;
  v_numero bigint;
begin
  o := public.os_para_alterar(p_os_id, true);
  if not exists (select 1 from public.os_servicos where os_id = o.id) then
    raise exception 'OS_SEM_SERVICOS' using errcode = 'P0001';
  end if;
  -- Reaberta para correção já tem número: mantém.
  v_numero := o.numero;
  if v_numero is null then
    update public.contador_os set ultimo = ultimo + 1 where id returning ultimo into v_numero;
  end if;
  update public.ordens_servico set status = 'concluida', concluida_em = now(), numero = v_numero where id = o.id;
  -- Terminou antes do previsto: libera o resto do horário. Nunca estica (concluir tarde
  -- não empurra ninguém) e nunca fica com menos de 5 min (concluído logo ao abrir).
  update public.agendamentos
  set status = 'concluido',
      fim = greatest(inicio + interval '5 minutes', least(fim, date_trunc('minute', now())))
  where id = o.agendamento_id;
end;
$$;
