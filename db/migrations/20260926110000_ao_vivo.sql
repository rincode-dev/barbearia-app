-- Agenda ao vivo (docs/ARQUITETURA.md, decisão 47 — M4). Substitui o Supabase Realtime.
--
-- Qualquer mudança em agendamentos ou OS (inclusive pagamento, que atualiza o total pago
-- da OS) manda um aviso no canal "agenda". O aviso não leva dado nenhum: o app só recarrega
-- a tela pelo caminho normal, e a RLS continua decidindo o que cada um vê.
-- Um aviso por comando (for each statement), não por linha; avisos iguais na mesma
-- transação o Postgres já junta num só.

create function public.avisar_mudanca_agenda()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify('agenda', '');
  return null;
end;
$$;

create trigger agendamentos_aviso_ao_vivo
after insert or update or delete on public.agendamentos
for each statement execute function public.avisar_mudanca_agenda();

create trigger ordens_servico_aviso_ao_vivo
after insert or update or delete on public.ordens_servico
for each statement execute function public.avisar_mudanca_agenda();
