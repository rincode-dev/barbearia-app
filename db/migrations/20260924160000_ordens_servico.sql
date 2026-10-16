-- Fase 4 — Atendimento / Ordem de Serviço (OS).
--
-- A OS registra o que REALMENTE aconteceu (serviços realizados, desconto, pagamentos),
-- separado do que foi agendado (agendamento_servicos). Uma OS por agendamento.
--
-- Valores sempre calculados pelo banco, nunca digitados:
--   subtotal (soma dos serviços realizados) e total_pago (soma dos pagamentos não
--   estornados) mantidos por trigger; desconto_calculado, total e status_pagamento são
--   colunas geradas. Trava: o total nunca fica abaixo do que já foi pago.
--
-- Mudanças só por funções (sem policy de INSERT/UPDATE/DELETE direto), cada uma
-- conferindo dono (barbeiro da OS) ou admin. Concluir com pagamento pendente/parcial é
-- permitido (docs/ARQUITETURA.md, decisão 33); pagamentos podem entrar depois de concluída.

create table public.ordens_servico (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  agendamento_id uuid not null unique references public.agendamentos (id),
  cliente_id uuid not null references public.clientes (id),
  barbeiro_id uuid not null references public.profiles (id),
  status text not null default 'aberta' check (status in ('aberta', 'concluida', 'cancelada')),

  subtotal numeric(10, 2) not null default 0 check (subtotal >= 0),

  desconto_tipo text check (desconto_tipo in ('fixo', 'percentual')),
  desconto_valor numeric(10, 2) not null default 0 check (desconto_valor >= 0),
  desconto_motivo text check (desconto_motivo in ('fidelidade', 'promocao', 'cortesia', 'cupom', 'personalizado')),
  desconto_observacao text,
  desconto_aplicado_por uuid references public.profiles (id),

  desconto_calculado numeric(10, 2) generated always as (
    case desconto_tipo
      when 'fixo' then least(desconto_valor, subtotal)
      when 'percentual' then round(subtotal * least(desconto_valor, 100) / 100, 2)
      else 0
    end
  ) stored,
  total numeric(10, 2) generated always as (
    subtotal - case desconto_tipo
      when 'fixo' then least(desconto_valor, subtotal)
      when 'percentual' then round(subtotal * least(desconto_valor, 100) / 100, 2)
      else 0
    end
  ) stored,

  total_pago numeric(10, 2) not null default 0 check (total_pago >= 0),

  status_pagamento text generated always as (
    case
      when total_pago >= subtotal - case desconto_tipo
        when 'fixo' then least(desconto_valor, subtotal)
        when 'percentual' then round(subtotal * least(desconto_valor, 100) / 100, 2)
        else 0
      end then 'pago'
      when total_pago > 0 then 'parcial'
      else 'pendente'
    end
  ) stored,

  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz,
  cancelada_em timestamptz,
  motivo_cancelamento text,
  criada_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ordens_servico_percentual_valido check (desconto_tipo <> 'percentual' or desconto_valor <= 100),
  constraint ordens_servico_desconto_coerente check ((desconto_tipo is null) = (desconto_motivo is null)),
  -- Nunca cobrar menos do que já foi pago (estornar antes de reduzir o total).
  constraint ordens_servico_pago_ate_o_total check (
    total_pago <= subtotal - case desconto_tipo
      when 'fixo' then least(desconto_valor, subtotal)
      when 'percentual' then round(subtotal * least(desconto_valor, 100) / 100, 2)
      else 0
    end
  )
);

comment on table public.ordens_servico is 'OS: o que realmente aconteceu no atendimento. Totais calculados pelo banco. Alterada só por funções.';

create index ordens_servico_barbeiro_idx on public.ordens_servico (barbeiro_id, iniciada_em desc);
create index ordens_servico_cliente_idx on public.ordens_servico (cliente_id, iniciada_em desc);
create index ordens_servico_status_idx on public.ordens_servico (status, iniciada_em desc);

create trigger trg_ordens_servico_updated_at
before update on public.ordens_servico
for each row execute function public.set_updated_at();

create table public.os_servicos (
  id uuid primary key default gen_random_uuid(),
  os_id uuid not null references public.ordens_servico (id) on delete cascade,
  servico_id uuid not null references public.servicos (id),
  nome text not null,
  preco numeric(10, 2) not null check (preco >= 0),
  duracao_minutos integer not null check (duracao_minutos > 0),
  origem text not null check (origem in ('agendado', 'adicional')),
  -- Quem realizou (base da comissão futura).
  barbeiro_id uuid not null references public.profiles (id),
  -- Estrutura de comissão (decisão 11): cópia da regra no momento, sem cálculo por ora.
  comissao_modo text check (comissao_modo in ('nenhuma', 'percentual', 'fixo')),
  comissao_valor numeric(10, 2) check (comissao_valor >= 0),
  adicionado_por uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

comment on table public.os_servicos is 'Serviços realizados na OS (agendados + adicionais), com cópia de nome/preço. Campos de comissão só estruturais.';

create index os_servicos_os_idx on public.os_servicos (os_id);

create table public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  os_id uuid not null references public.ordens_servico (id) on delete cascade,
  forma text not null check (forma in ('dinheiro', 'pix', 'debito', 'credito', 'outros')),
  valor numeric(10, 2) not null check (valor > 0),
  registrado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  -- Estorno é lógico (dado financeiro): a linha fica, deixa de contar no total pago.
  estornado_em timestamptz,
  estornado_por uuid references public.profiles (id)
);

comment on table public.pagamentos is 'Pagamentos da OS (vários por OS, formas diferentes). Estorno lógico (estornado_em), nunca apagado.';

create index pagamentos_os_idx on public.pagamentos (os_id);
create index pagamentos_data_idx on public.pagamentos (created_at) where estornado_em is null;

-- ---------------------------------------------------------------------------
-- Totais mantidos por trigger
-- ---------------------------------------------------------------------------
create function public.recalcular_subtotal_os()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_os uuid := coalesce(new.os_id, old.os_id);
begin
  update public.ordens_servico
  set subtotal = (select coalesce(sum(preco), 0) from public.os_servicos where os_id = v_os)
  where id = v_os;
  return null;
end;
$$;

create trigger trg_os_servicos_subtotal
after insert or update or delete on public.os_servicos
for each row execute function public.recalcular_subtotal_os();

create function public.recalcular_total_pago_os()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_os uuid := coalesce(new.os_id, old.os_id);
begin
  update public.ordens_servico
  set total_pago = (select coalesce(sum(valor), 0) from public.pagamentos where os_id = v_os and estornado_em is null)
  where id = v_os;
  return null;
end;
$$;

create trigger trg_pagamentos_total_pago
after insert or update or delete on public.pagamentos
for each row execute function public.recalcular_total_pago_os();

-- ---------------------------------------------------------------------------
-- RLS: leitura pelo dono (barbeiro da OS) ou admin; nenhuma escrita direta.
-- ---------------------------------------------------------------------------
alter table public.ordens_servico enable row level security;
alter table public.os_servicos enable row level security;
alter table public.pagamentos enable row level security;

create policy ordens_servico_select_proprio_ou_admin
on public.ordens_servico for select
to authenticated
using (barbeiro_id = auth.uid() or public.is_admin());

create policy os_servicos_select_proprio_ou_admin
on public.os_servicos for select
to authenticated
using (exists (select 1 from public.ordens_servico o where o.id = os_id and (o.barbeiro_id = auth.uid() or public.is_admin())));

create policy pagamentos_select_proprio_ou_admin
on public.pagamentos for select
to authenticated
using (exists (select 1 from public.ordens_servico o where o.id = os_id and (o.barbeiro_id = auth.uid() or public.is_admin())));

-- ---------------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------------

-- OS travada para alteração + checagem de permissão. p_exige_aberta: só OS aberta.
create function public.os_para_alterar(p_os_id uuid, p_exige_aberta boolean)
returns public.ordens_servico
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ordens_servico%rowtype;
begin
  select * into v from public.ordens_servico where id = p_os_id for update;
  if not found then
    raise exception 'OS_NAO_ENCONTRADA' using errcode = 'P0001';
  end if;
  if not public.pode_gerenciar_agendamento(v.barbeiro_id) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if p_exige_aberta and v.status <> 'aberta' then
    raise exception 'OS_FECHADA' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Iniciar atendimento: cria a OS (serviços agendados viram realizados) e põe o
-- agendamento "em atendimento". Aceita a partir de agendado/confirmado/chegou (o cliente
-- pode chegar sem ninguém marcar "chegou"). Idempotente: se a OS já existe, devolve ela.
create function public.iniciar_atendimento(p_agendamento_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.agendamentos%rowtype;
  v_os uuid;
begin
  select * into a from public.agendamentos where id = p_agendamento_id for update;
  if not found then
    raise exception 'AGENDAMENTO_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if not public.pode_gerenciar_agendamento(a.barbeiro_id) then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;

  select id into v_os from public.ordens_servico where agendamento_id = a.id;
  if v_os is not null then
    return v_os;
  end if;
  if a.status not in ('agendado', 'confirmado', 'chegou') then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;

  insert into public.ordens_servico (agendamento_id, cliente_id, barbeiro_id, criada_por)
  values (a.id, a.cliente_id, a.barbeiro_id, auth.uid())
  returning id into v_os;

  insert into public.os_servicos (os_id, servico_id, nome, preco, duracao_minutos, origem, barbeiro_id, adicionado_por)
  select v_os, s.servico_id, s.nome, s.preco, s.duracao_minutos, 'agendado', a.barbeiro_id, auth.uid()
  from public.agendamento_servicos s
  where s.agendamento_id = a.id
  order by s.ordem;

  update public.agendamentos set status = 'em_atendimento' where id = a.id;
  return v_os;
end;
$$;

create function public.adicionar_servico_os(p_os_id uuid, p_servico_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ordens_servico%rowtype;
  v_item uuid;
begin
  o := public.os_para_alterar(p_os_id, true);
  insert into public.os_servicos (os_id, servico_id, nome, preco, duracao_minutos, origem, barbeiro_id, adicionado_por)
  select o.id, s.id, s.nome, s.preco, s.duracao_minutos, 'adicional', o.barbeiro_id, auth.uid()
  from public.servicos s
  where s.id = p_servico_id and s.ativo
  returning id into v_item;
  if v_item is null then
    raise exception 'SERVICOS_INVALIDOS' using errcode = 'P0001';
  end if;
  return v_item;
end;
$$;

create function public.remover_servico_os(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_os uuid;
begin
  select os_id into v_os from public.os_servicos where id = p_item_id;
  if v_os is null then
    raise exception 'ITEM_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;
  perform public.os_para_alterar(v_os, true);
  -- Se o total ficar abaixo do já pago, a constraint ordens_servico_pago_ate_o_total
  -- recusa (23514) e nada é removido.
  delete from public.os_servicos where id = p_item_id;
end;
$$;

-- Desconto: p_tipo nulo remove o desconto.
create function public.aplicar_desconto_os(
  p_os_id uuid,
  p_tipo text,
  p_valor numeric,
  p_motivo text,
  p_observacao text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.os_para_alterar(p_os_id, true);
  if p_tipo is null then
    update public.ordens_servico
    set desconto_tipo = null, desconto_valor = 0, desconto_motivo = null, desconto_observacao = null, desconto_aplicado_por = null
    where id = p_os_id;
    return;
  end if;
  if p_tipo not in ('fixo', 'percentual') or p_valor is null or p_valor <= 0 then
    raise exception 'DESCONTO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_tipo = 'percentual' and p_valor > 100 then
    raise exception 'DESCONTO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_motivo is null or p_motivo not in ('fidelidade', 'promocao', 'cortesia', 'cupom', 'personalizado') then
    raise exception 'MOTIVO_DESCONTO_INVALIDO' using errcode = 'P0001';
  end if;
  update public.ordens_servico
  set desconto_tipo = p_tipo,
      desconto_valor = p_valor,
      desconto_motivo = p_motivo,
      desconto_observacao = nullif(trim(coalesce(p_observacao, '')), ''),
      desconto_aplicado_por = auth.uid()
  where id = p_os_id;
end;
$$;

-- Pagamento: vale em OS aberta ou concluída (pagar depois), nunca cancelada; nunca acima
-- do que falta.
create function public.registrar_pagamento(p_os_id uuid, p_forma text, p_valor numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ordens_servico%rowtype;
  v_id uuid;
begin
  o := public.os_para_alterar(p_os_id, false);
  if o.status = 'cancelada' then
    raise exception 'OS_FECHADA' using errcode = 'P0001';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'VALOR_INVALIDO' using errcode = 'P0001';
  end if;
  if p_valor > o.total - o.total_pago then
    raise exception 'PAGAMENTO_ACIMA_DO_RESTANTE' using errcode = 'P0001';
  end if;
  insert into public.pagamentos (os_id, forma, valor, registrado_por)
  values (o.id, p_forma, round(p_valor, 2), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Estorno: com a OS aberta, dono ou admin; depois de concluída, só admin.
create function public.estornar_pagamento(p_pagamento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pagamentos%rowtype;
  o public.ordens_servico%rowtype;
begin
  select * into p from public.pagamentos where id = p_pagamento_id for update;
  if not found or p.estornado_em is not null then
    raise exception 'PAGAMENTO_NAO_ENCONTRADO' using errcode = 'P0001';
  end if;
  o := public.os_para_alterar(p.os_id, false);
  if o.status <> 'aberta' and not public.is_admin() then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  update public.pagamentos set estornado_em = now(), estornado_por = auth.uid() where id = p.id;
end;
$$;

-- Concluir: precisa de pelo menos um serviço realizado. Pagamento pendente/parcial é
-- permitido (decisão 33).
create function public.concluir_atendimento(p_os_id uuid)
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
  update public.agendamentos set status = 'concluido' where id = o.agendamento_id;
end;
$$;

-- Cancelar o atendimento já iniciado (desistiu no meio etc.): só sem pagamento ativo.
create function public.cancelar_atendimento(p_os_id uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ordens_servico%rowtype;
begin
  o := public.os_para_alterar(p_os_id, true);
  if o.total_pago > 0 then
    raise exception 'OS_COM_PAGAMENTO' using errcode = 'P0001';
  end if;
  update public.ordens_servico
  set status = 'cancelada', cancelada_em = now(), motivo_cancelamento = nullif(trim(coalesce(p_motivo, '')), '')
  where id = o.id;
  update public.agendamentos
  set status = 'cancelado', motivo_cancelamento = nullif(trim(coalesce(p_motivo, '')), '')
  where id = o.agendamento_id;
end;
$$;

-- Reabrir OS concluída (correção): só admin.
create function public.reabrir_atendimento(p_os_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ordens_servico%rowtype;
begin
  o := public.os_para_alterar(p_os_id, false);
  if not public.is_admin() then
    raise exception 'SEM_PERMISSAO' using errcode = 'P0001';
  end if;
  if o.status <> 'concluida' then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;
  update public.ordens_servico set status = 'aberta', concluida_em = null where id = o.id;
  update public.agendamentos set status = 'em_atendimento' where id = o.agendamento_id;
end;
$$;

revoke execute on function public.os_para_alterar(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.recalcular_subtotal_os() from public, anon, authenticated;
revoke execute on function public.recalcular_total_pago_os() from public, anon, authenticated;
revoke execute on function public.iniciar_atendimento(uuid) from public, anon;
revoke execute on function public.adicionar_servico_os(uuid, uuid) from public, anon;
revoke execute on function public.remover_servico_os(uuid) from public, anon;
revoke execute on function public.aplicar_desconto_os(uuid, text, numeric, text, text) from public, anon;
revoke execute on function public.registrar_pagamento(uuid, text, numeric) from public, anon;
revoke execute on function public.estornar_pagamento(uuid) from public, anon;
revoke execute on function public.concluir_atendimento(uuid) from public, anon;
revoke execute on function public.cancelar_atendimento(uuid, text) from public, anon;
revoke execute on function public.reabrir_atendimento(uuid) from public, anon;
grant execute on function public.iniciar_atendimento(uuid) to authenticated;
grant execute on function public.adicionar_servico_os(uuid, uuid) to authenticated;
grant execute on function public.remover_servico_os(uuid) to authenticated;
grant execute on function public.aplicar_desconto_os(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.registrar_pagamento(uuid, text, numeric) to authenticated;
grant execute on function public.estornar_pagamento(uuid) to authenticated;
grant execute on function public.concluir_atendimento(uuid) to authenticated;
grant execute on function public.cancelar_atendimento(uuid, text) to authenticated;
grant execute on function public.reabrir_atendimento(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Agenda: expõe a OS de cada agendamento (só pra quem vê os detalhes) — colunas novas no
-- FINAL da view (create or replace view só aceita acrescentar no fim).
-- ---------------------------------------------------------------------------
create or replace view public.agenda_equipe as
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
  case when a.barbeiro_id = auth.uid() or public.is_admin() then a.motivo_cancelamento end as motivo_cancelamento,
  case when a.barbeiro_id = auth.uid() or public.is_admin() then os.id end as os_id,
  case when a.barbeiro_id = auth.uid() or public.is_admin() then os.numero end as os_numero
from public.agendamentos a
join public.profiles p on p.id = a.barbeiro_id
join public.clientes c on c.id = a.cliente_id
left join public.ordens_servico os on os.agendamento_id = a.id
where exists (select 1 from public.profiles eu where eu.id = auth.uid() and eu.ativo);

revoke all on public.agenda_equipe from anon, public;
grant select on public.agenda_equipe to authenticated;

-- A tela da OS também fica ao vivo (pagamento lançado de outro aparelho etc.).
alter publication supabase_realtime add table public.ordens_servico;
