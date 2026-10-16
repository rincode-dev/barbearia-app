-- Fase 6 — Mensagens de WhatsApp (requisitos do produto, item 24).
--
-- Seis tipos FIXOS (nunca criados/apagados pelo app — só o texto é editável pelo admin
-- em Configurações → Mensagens), mesmo padrão testado no demo. Sem integração automática:
-- a equipe clica, o WhatsApp abre (wa.me) com a mensagem já preenchida.
-- `conteudo_padrao` guarda o texto original, para "Restaurar texto padrão" sem duplicar
-- o texto no código.
--
-- Variáveis aceitas no texto (preenchidas pelo app, src/lib/mensagens/preencher.ts):
--   {cliente} {barbearia} {data} {hora} {barbeiro} {servicos} {valor} {endereco} {site}

create table public.mensagens_templates (
  tipo text primary key check (
    tipo in ('confirmar_agendamento', 'lembrete', 'agendamento_confirmado', 'atendimento_concluido', 'reagendamento', 'cancelamento')
  ),
  conteudo text not null check (length(trim(conteudo)) between 1 and 1000),
  conteudo_padrao text not null,
  updated_at timestamptz not null default now()
);

comment on table public.mensagens_templates is 'Textos de WhatsApp (6 tipos fixos). Só o conteúdo é editável, pelo admin. Lido por qualquer membro ativo da equipe para montar o link wa.me.';

create trigger trg_mensagens_templates_updated_at
before update on public.mensagens_templates
for each row execute function public.set_updated_at();

insert into public.mensagens_templates (tipo, conteudo, conteudo_padrao)
select tipo, texto, texto
from (values
  ('confirmar_agendamento',
   'Olá, {cliente}! Aqui é da {barbearia}. Você tem horário marcado {data} às {hora} com {barbeiro} ({servicos}). Pode confirmar sua presença?'),
  ('lembrete',
   'Olá, {cliente}! Passando para lembrar do seu horário {data} às {hora} com {barbeiro} na {barbearia}. Endereço: {endereco}. Até lá!'),
  ('agendamento_confirmado',
   'Tudo certo, {cliente}! Seu horário está confirmado: {data} às {hora} com {barbeiro} ({servicos}). Te esperamos na {barbearia}!'),
  ('atendimento_concluido',
   'Obrigado pela visita, {cliente}! Foi um prazer te atender na {barbearia}. Para marcar o próximo horário: {site}'),
  ('reagendamento',
   'Olá, {cliente}! Seu horário na {barbearia} foi remarcado para {data} às {hora} com {barbeiro}. Qualquer dúvida, é só responder esta mensagem.'),
  ('cancelamento',
   'Olá, {cliente}. Seu horário de {data} às {hora} na {barbearia} foi cancelado. Quando quiser marcar de novo: {site}')
) as t (tipo, texto);

alter table public.mensagens_templates enable row level security;

-- Leitura: membro ativo da equipe (monta a mensagem na agenda/OS). Visitante não lê.
create policy mensagens_templates_select_equipe
on public.mensagens_templates for select
to authenticated
using (exists (select 1 from public.profiles eu where eu.id = auth.uid() and eu.ativo));

-- Edição do texto: só admin. Sem policy de insert/delete (tipos fixos).
create policy mensagens_templates_update_admin
on public.mensagens_templates for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.mensagens_templates from anon;
revoke insert, delete, truncate on public.mensagens_templates from authenticated;
-- O padrão nunca muda pelo app.
revoke update on public.mensagens_templates from authenticated;
grant update (conteudo) on public.mensagens_templates to authenticated;
