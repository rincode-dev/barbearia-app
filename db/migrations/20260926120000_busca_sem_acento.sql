-- Busca ignorando acentos (pedido do dono, 2026-09-26): "Joao" acha "João" nas buscas de
-- Clientes e de OS. Extensão unaccent do próprio Postgres + uma função imutável (o
-- unaccent puro não é, por depender do dicionário configurado).

create extension if not exists unaccent with schema extensions;

create function public.sem_acento(texto text)
returns text
language sql
immutable
parallel safe
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, texto)
$$;

comment on function public.sem_acento(text) is 'Texto sem acentos, para buscas (ex.: public.sem_acento(nome) ilike public.sem_acento(termo)).';
