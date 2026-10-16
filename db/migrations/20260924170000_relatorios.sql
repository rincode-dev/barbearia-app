-- Fase 5 — Números (Início, Financeiro e Relatórios).
--
-- Uma única função de leitura, relatorio_financeiro(de, ate, barbeiro), devolve tudo o
-- que o Início e o Financeiro mostram para um período (datas no fuso da barbearia).
-- Roda com os direitos de QUEM CHAMA (security invoker): o RLS já existente faz o
-- barbeiro enxergar só os próprios números (OS, pagamentos e agendamentos dele) e o
-- admin tudo — sem regra de permissão duplicada aqui.
--
-- Fórmulas (docs/ARQUITETURA.md, decisão 36):
--   data do atendimento  = ordens_servico.iniciada_em (não muda ao reabrir a OS)
--   faturamento          = soma do total das OS CONCLUÍDAS com atendimento no período
--   atendimentos         = quantidade dessas OS
--   ticket médio         = faturamento / atendimentos
--   recebido             = soma dos pagamentos NÃO estornados lançados no período (caixa)
--   pendente             = total - pago das OS concluídas no período (hoje)
--   pendente_total       = total - pago de TODAS as OS concluídas (qualquer data)
--   previsto             = agendamentos do período que não foram cancelados/não
--                          compareceu: total da OS se já existe, senão o valor agendado
--   descontos            = desconto calculado das OS concluídas no período
--   cancelamentos / não comparecimentos = agendamentos com horário no período
--   serviços             = serviços realizados nas OS concluídas (preço de tabela copiado,
--                          antes do desconto — o desconto é da OS, não do serviço)

create function public.relatorio_financeiro(p_de date, p_ate date, p_barbeiro uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ini timestamptz;
  v_fim timestamptz;
  r jsonb;
begin
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 400 then
    raise exception 'PERIODO_INVALIDO' using errcode = 'P0001';
  end if;
  v_ini := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';

  with
  os as (
    select o.*, (o.iniciada_em at time zone 'America/Sao_Paulo')::date as dia
    from public.ordens_servico o
    where o.status = 'concluida'
      and o.iniciada_em >= v_ini and o.iniciada_em < v_fim
      and (p_barbeiro is null or o.barbeiro_id = p_barbeiro)
  ),
  pg as (
    select p.forma, p.valor, (p.created_at at time zone 'America/Sao_Paulo')::date as dia
    from public.pagamentos p
    join public.ordens_servico o on o.id = p.os_id
    where p.estornado_em is null
      and p.created_at >= v_ini and p.created_at < v_fim
      and (p_barbeiro is null or o.barbeiro_id = p_barbeiro)
  ),
  ag as (
    select a.status, a.valor_total, o.status as os_status, o.total as os_total
    from public.agendamentos a
    left join public.ordens_servico o on o.agendamento_id = a.id
    where a.inicio >= v_ini and a.inicio < v_fim
      and (p_barbeiro is null or a.barbeiro_id = p_barbeiro)
  ),
  dias as (
    select d::date as dia from generate_series(p_de, p_ate, interval '1 day') d
  )
  select jsonb_build_object(
    'de', p_de,
    'ate', p_ate,
    'faturamento', (select coalesce(sum(total), 0) from os),
    'atendimentos', (select count(*) from os),
    'ticket_medio', (select coalesce(round(avg(total), 2), 0) from os),
    'recebido', (select coalesce(sum(valor), 0) from pg),
    'pendente', (select coalesce(sum(total - total_pago), 0) from os),
    'pendente_total', (
      select coalesce(sum(o.total - o.total_pago), 0)
      from public.ordens_servico o
      where o.status = 'concluida' and o.total_pago < o.total
        and (p_barbeiro is null or o.barbeiro_id = p_barbeiro)
    ),
    'previsto', (
      select coalesce(sum(case when os_status is not null and os_status <> 'cancelada' then os_total else valor_total end), 0)
      from ag where status not in ('cancelado', 'nao_compareceu')
    ),
    'agendados', (select count(*) from ag where status not in ('cancelado', 'nao_compareceu')),
    'cancelamentos', (select count(*) from ag where status = 'cancelado'),
    'nao_comparecimentos', (select count(*) from ag where status = 'nao_compareceu'),
    'descontos', jsonb_build_object(
      'total', (select coalesce(sum(desconto_calculado), 0) from os where desconto_calculado > 0),
      'quantidade', (select count(*) from os where desconto_calculado > 0),
      'media', (select coalesce(round(avg(desconto_calculado), 2), 0) from os where desconto_calculado > 0),
      'por_motivo', coalesce((
        select jsonb_agg(jsonb_build_object('motivo', motivo, 'quantidade', qtd, 'total', tot) order by tot desc)
        from (
          select desconto_motivo as motivo, count(*) as qtd, sum(desconto_calculado) as tot
          from os where desconto_calculado > 0 group by desconto_motivo
        ) m
      ), '[]'::jsonb)
    ),
    'formas', coalesce((
      select jsonb_agg(jsonb_build_object('forma', forma, 'quantidade', qtd, 'total', tot) order by tot desc)
      from (select forma, count(*) as qtd, sum(valor) as tot from pg group by forma) f
    ), '[]'::jsonb),
    'servicos', coalesce((
      select jsonb_agg(jsonb_build_object('servico_id', servico_id, 'nome', nome, 'quantidade', qtd, 'total', tot)
                       order by qtd desc, tot desc, nome)
      from (
        select i.servico_id, coalesce(s.nome, min(i.nome)) as nome, count(*) as qtd, sum(i.preco) as tot
        from public.os_servicos i
        join os on os.id = i.os_id
        left join public.servicos s on s.id = i.servico_id
        group by i.servico_id, s.nome
      ) sv
    ), '[]'::jsonb),
    'barbeiros', coalesce((
      select jsonb_agg(jsonb_build_object('barbeiro_id', barbeiro_id, 'nome', nome, 'atendimentos', qtd,
                                          'faturamento', tot, 'ticket_medio', tm, 'descontos', dsc)
                       order by tot desc, nome)
      from (
        select os.barbeiro_id, coalesce(p.nome, '') as nome, count(*) as qtd, sum(os.total) as tot,
               round(avg(os.total), 2) as tm, sum(os.desconto_calculado) as dsc
        from os
        left join public.profiles p on p.id = os.barbeiro_id
        group by os.barbeiro_id, p.nome
      ) b
    ), '[]'::jsonb),
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dia', d.dia,
        'atendimentos', (select count(*) from os where os.dia = d.dia),
        'faturamento', (select coalesce(sum(total), 0) from os where os.dia = d.dia),
        'recebido', (select coalesce(sum(valor), 0) from pg where pg.dia = d.dia)
      ) order by d.dia)
      from dias d
    ), '[]'::jsonb)
  ) into r;

  return r;
end;
$$;

comment on function public.relatorio_financeiro(date, date, uuid) is
  'Números do Início/Financeiro para um período (fuso de São Paulo). Security invoker: o RLS limita o barbeiro aos próprios dados. Fórmulas no cabeçalho da migration 20260924170000_relatorios.sql.';

revoke execute on function public.relatorio_financeiro(date, date, uuid) from public, anon;
grant execute on function public.relatorio_financeiro(date, date, uuid) to authenticated;

-- Filtros do Financeiro por data do atendimento e status de pagamento.
create index ordens_servico_concluidas_idx on public.ordens_servico (iniciada_em) where status = 'concluida';
