-- Site novo (pedido do dono, 2026-09-25): cada serviço pode ter uma foto, exibida como
-- miniatura na lista de serviços do site. Mesmo padrão do logo e das fotos dos barbeiros:
-- a imagem fica no bucket público `publico` (pasta servicos/) e aqui só o caminho.
-- Sem policy nova: a leitura pública de `servicos` já existe (servicos_select_publico) e
-- só o admin altera serviços (servicos_update_admin).

alter table public.servicos add column foto_path text;

comment on column public.servicos.foto_path is 'Caminho da foto do serviço no bucket público "publico" (pasta servicos/). Opcional.';
