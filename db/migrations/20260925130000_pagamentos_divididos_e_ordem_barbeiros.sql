-- Pedidos do dono (2026-09-25):
-- 1) OS: registrar o pagamento dividido de uma vez (ex.: R$ 40 dinheiro + R$ 32 Pix),
--    tudo ou nada — nunca fica "meio registrado" se uma das partes for recusada.
-- 2) Ordem dos barbeiros no site definida pelo admin (o dono aparece primeiro).

-- ---------------------------------------------------------------------------
-- 1) registrar_pagamentos: várias formas numa transação só. Cada parte passa pela
--    mesma registrar_pagamento() (mesmas regras: permissão, OS não cancelada, valor > 0,
--    nunca acima do restante — o restante diminui a cada parte, então a soma também não
--    passa). Qualquer erro desfaz todas as partes.
-- ---------------------------------------------------------------------------
create function public.registrar_pagamentos(p_os_id uuid, p_pagamentos jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_qtd integer := 0;
begin
  if p_pagamentos is null or jsonb_typeof(p_pagamentos) <> 'array'
     or jsonb_array_length(p_pagamentos) = 0 or jsonb_array_length(p_pagamentos) > 10 then
    raise exception 'VALOR_INVALIDO' using errcode = 'P0001';
  end if;
  for v_item in select * from jsonb_array_elements(p_pagamentos) loop
    perform public.registrar_pagamento(p_os_id, v_item->>'forma', (v_item->>'valor')::numeric);
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;

revoke execute on function public.registrar_pagamentos(uuid, jsonb) from public, anon;
grant execute on function public.registrar_pagamentos(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Ordem dos barbeiros no site (menor primeiro; empate = nome). Só o admin muda:
--    o barbeiro continua podendo editar os próprios dados básicos, mas não a ordem.
-- ---------------------------------------------------------------------------
alter table public.profiles add column ordem_site integer not null default 100;
comment on column public.profiles.ordem_site is 'Posição do barbeiro na escolha de profissional do site (menor primeiro). Só o admin altera.';

drop policy profiles_update_own_limited on public.profiles;
create policy profiles_update_own_limited
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role = (select p.role from public.profiles p where p.id = auth.uid())
  and ativo = (select p.ativo from public.profiles p where p.id = auth.uid())
  and atende_como_barbeiro = (select p.atende_como_barbeiro from public.profiles p where p.id = auth.uid())
  and comissao_modo = (select p.comissao_modo from public.profiles p where p.id = auth.uid())
  and comissao_valor = (select p.comissao_valor from public.profiles p where p.id = auth.uid())
  and email is not distinct from (select p.email from public.profiles p where p.id = auth.uid())
  and ordem_site = (select p.ordem_site from public.profiles p where p.id = auth.uid())
);
