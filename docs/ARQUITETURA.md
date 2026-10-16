# Arquitetura e registro de decisões

Este documento reúne as decisões de arquitetura do **barbearia-app**. Elas são numeradas porque o código-fonte as cita nos comentários: um "decisão 47" em `src/lib/db.ts` remete à seção 47 abaixo. As decisões são registradas no formato ADR (*Architecture Decision Record*): o que foi decidido e por quê. Uma decisão substituída continua listada, com a indicação de quem a substituiu.

## Sumário

- [Visão geral](#visão-geral)
- [Registro de decisões](#registro-de-decisões)
  - [Fundação (1–18)](#fundação-118)
  - [Horários e agendamento online (19–27)](#horários-e-agendamento-online-1927)
  - [Agenda, OS e números (28–37)](#agenda-os-e-números-2837)
  - [Mensagens, experiência e interface (38–46)](#mensagens-experiência-e-interface-3846)
  - [Infraestrutura e fluxo automático (47–49)](#infraestrutura-e-fluxo-automático-4749)
- [Motor de disponibilidade](#motor-de-disponibilidade)
- [Status do agendamento](#status-do-agendamento)
- [Permissões](#permissões)
- [Contingência](#contingência)
- [Implantação em VPS](#implantação-em-vps)
- [Aprendizados técnicos](#aprendizados-técnicos)

---

## Visão geral

```
Cliente final (celular)          Equipe (celular/desktop, PWA)
        │                                 │
        ▼                                 ▼
  /  (site + agendamento)          /painel/**  (login)
        └──────────────┬──────────────────┘
                       ▼
     Next.js 16 (App Router, React 19, TypeScript, Tailwind 4)
     Server Components + Server Actions · Route Handlers · proxy de sessão
                       │   (transação com papel: authenticated | anon | service_role)
                       ▼
     PostgreSQL 17 — um banco por barbearia, no mesmo servidor
     login próprio (auth.users + auth.sessoes) · RLS · funções PL/pgSQL ·
     exclusion constraint · LISTEN/NOTIFY · fotos em volume no disco
```

O projeto foi desenvolvido em **fases incrementais**: base, cadastros, site e agendamento, agenda e clientes, OS, números, fechamento e, por fim, a migração para PostgreSQL próprio em cinco etapas (M0–M5). Cada fase só foi concluída depois de testada rodando em Docker, com uma bateria de testes própria que continua no repositório (`scripts/testes/faseN.mjs`, `mN-*.mjs`).

---

## Registro de decisões

### Fundação (1–18)

1. **Site público e painel no mesmo app Next.js.** A raiz é o site da barbearia e `/painel/**` é a área da equipe. Público sem conta: `/`, `/agendar/**` e `/login`.
2. **Agendamento público sem conta de cliente.** Roda no servidor, com validação completa. O horário é **recalculado no momento de confirmar**, e o banco impede sobreposição por barbeiro (à prova de dois clientes confirmando ao mesmo tempo).
3. **Anti-abuso no público:** limite de agendamentos futuros ativos por telefone e limite de tentativas por IP (detalhe na decisão 25).
4. **Fuso fixo `America/Sao_Paulo`** para todo cálculo de data e horário. O servidor roda em UTC e o banco guarda `timestamptz`.
5. **Agenda em tempo real:** um agendamento feito no site aparece no painel sem recarregar. A implementação atual é a da decisão 47 (`LISTEN/NOTIFY` + SSE).
6. **Marca por estabelecimento.** Nome, logo, contatos, mapa e Instagram vêm da tabela `estabelecimento`. Nenhuma marca fica fixa no código, e o mesmo build atende qualquer barbearia.
7. **Banco novo e limpo**, reaproveitando blocos já testados de um sistema anterior do mesmo autor (gestão de estúdio de tatuagem): `profiles` + `handle_new_user` (o 1º usuário vira admin) + `is_admin()`, o padrão de RLS *own-or-admin*, telefone único normalizado e trava de conflito de horário. A instalação num banco vazio funciona aplicando todas as migrations em sequência.
8. **Preço e duração são copiados (snapshot)** para o agendamento e para a OS. Mudar o preço de um serviço nunca altera o histórico nem os relatórios.
9. **Agendamento ≠ OS.** O agendamento é o que foi marcado. A OS é o que aconteceu (serviços realizados, adicionais, desconto, pagamentos). Toda OS nasce de um agendamento: o atendimento de balcão é um agendamento criado pelo painel "agora".
10. **Fichas digitais, assinatura e documentos ficam fora** deste modelo. Barbearia raramente usa termo assinado. O módulo existe no sistema de estúdio e pode ser trazido se houver demanda.
11. **Comissão: só a estrutura preparada.** Colunas para modo (`nenhuma | percentual | fixo`) e valor por barbeiro (e opcionalmente por serviço), mais snapshot nos itens da OS. Ainda sem telas e sem cálculo.
12. **O barbeiro também pode aplicar desconto** nas próprias OS, sempre com tipo, valor e motivo, e sempre visível nos relatórios.
13. **"Não tenho preferência" de barbeiro: adiado.** O motor foi escrito para que essa opção seja fácil de adicionar.
14. **Menu enxuto.** Admin: Início · Agenda · Atendimentos (OS) · Clientes · Financeiro (com os relatórios dentro) · Configurações. Barbeiro: Início · Agenda · Atendimentos · Clientes.
15. **Papéis:** `admin` e `colaborador`, mais a marcação "atende como barbeiro" (o dono pode ser admin e barbeiro). O barbeiro vê a ocupação da equipe, gerencia só as **próprias** OS e vê só o **próprio** faturamento.
16. **Simplificações em relação ao sistema anterior:** tipos de atendimento fixos viraram Serviços. O sinal fixo virou um pagamento comum. O percentual global de comissão saiu.
17. **Logo e fotos em armazenamento público** (são exibidos no site sem login). Nada sensível vai para esse armazenamento.
18. **A equipe enxerga a equipe:** `profiles` é legível por qualquer usuário logado (nomes na agenda, seletor de barbeiro). Isso é seguro porque este modelo não guarda documentos de colaborador. O visitante só lê `estabelecimento` e o catálogo público.

### Horários e agendamento online (19–27)

19. **Horários como faixas semanais mais bloqueios pontuais.** O funcionamento e a jornada de cada barbeiro são faixas por dia da semana: várias faixas num dia formam um intervalo, e um dia sem faixa é fechado ou folga. As faixas são sempre **trocadas de uma vez** por funções que validam início < fim e ausência de sobreposição (tudo ou nada). As ausências pontuais ficam em `bloqueios`: `feriado` (barbearia inteira), `folga` ou `bloqueio` (um barbeiro). Horas de parede ficam em `time` e instantes em `timestamptz`, com conversão só por `src/lib/datas.ts`.
20. Na v1, **só o admin configura** horários, serviços, jornadas e bloqueios.
21. **Serviço novo pode nascer atribuído a todos os barbeiros** (atalho marcado por padrão). Sem isso, ele não apareceria para agendamento.
22. **Imagens sempre com caminho novo (UUID).** O formulário guarda só o caminho e a troca apaga o arquivo anterior. Server Actions não recebem arquivo.
23. **Um único motor de disponibilidade no servidor** (`src/lib/agendamento/motor.ts`, puro e testado). Na confirmação, o servidor recalcula e só aceita um horário que esteja na lista. A gravação é feita por `criar_agendamento()` (cliente + agendamento + serviços, tudo ou nada), que confere barbeiro, serviços, preço e duração no próprio banco. Essa função **não pode ser executada por visitante nem por usuário logado**, só pelo servidor.
24. **O site fala com rotas `/api/agendamento/*`** (datas, barbeiros, horários, confirmar), e não com Server Actions. São públicas, sem cache e testáveis de ponta a ponta por script. Nenhuma devolve dado de cliente.
25. **Anti-abuso:** no máximo 3 agendamentos futuros ativos por telefone (no banco, serializado por telefone com *advisory lock*) e 10 confirmações por IP por hora (em memória). O IP vem de `X-Real-IP`, que o Nginx sobrescreve, e nunca do primeiro item do `X-Forwarded-For`, que o visitante pode falsificar.
26. **O cliente do site é deduplicado pelo telefone**, e o site **nunca renomeia** um cadastro existente: alguém digitando o telefone de outra pessoa não troca o nome dela. Um cliente arquivado que agenda de novo volta a ficar ativo.
27. **O site só mostra serviços agendáveis:** ativos e feitos por pelo menos um barbeiro ativo. A parte sobre dias sem horário foi alterada pela decisão 41.

### Agenda, OS e números (28–37)

28. **Visão de equipe da agenda:** todo usuário logado vê todos os agendamentos (horário, barbeiro, serviço, status). Cliente, telefone, valor, observação e motivo aparecem **só nos próprios** (o admin vê tudo). A implementação é a view `agenda_equipe`, com mascaramento por coluna.
29. **O agendamento só muda por funções do banco** (`alterar_status_agendamento`, `reagendar_agendamento`, `criar_agendamento_painel`). Não existe policy de INSERT/UPDATE direto, nem para o admin. Cada função confere dono ou admin e a transição de estado.
30. **O encaixe pelo painel é flexível:** não passa pelo motor (a equipe pode marcar fora da jornada), mas a trava de sobreposição vale sempre. O motor só **sugere** horários livres, no modo "painel".
31. **"Atendimento" = agendamento concluído.** O primeiro e o último atendimento e a quantidade (view `clientes_resumo`) contam só os concluídos.
32. **Agenda ao vivo com rede de segurança:** um evento faz a tela recarregar e, além disso, há uma checagem a cada 30 s.
33. **A OS pode ser concluída com pagamento pendente ou parcial.** O valor em aberto aparece como pendente, e pagamentos podem ser registrados depois.
34. **Regras da Ordem de Serviço.** Uma OS por agendamento. Subtotal, desconto calculado, total, total pago e status do pagamento são **calculados pelo banco**. Pagamento nunca acima do restante. Total nunca abaixo do já pago (estornar antes). O estorno é lógico. Depois de concluída, só o admin estorna ou reabre. A OS só muda por funções do banco. A numeração foi ajustada pela decisão 49.
35. **Comissão continua só estrutural:** cada serviço realizado guarda quem o realizou e colunas de comissão vazias.
36. **Fórmulas dos números**, todas em `relatorio_financeiro(de, ate, barbeiro)` com `SECURITY INVOKER`. A RLS limita o barbeiro aos próprios números sem regra duplicada.
    - **Data do atendimento** = início da OS.
    - **Faturamento** = soma do total (já com desconto) das OS concluídas. **Atendimentos** = quantidade delas. **Ticket médio** = faturamento ÷ atendimentos.
    - **Recebido** = pagamentos não estornados lançados no período (visão de caixa).
    - **Pendente** = total − pago das OS concluídas no período, além do total em aberto de todas as datas.
    - **Previsto** = agendamentos do período fora de cancelado e não compareceu. Usa o total da OS quando ela já existe e conta pelo dia do atendimento.
    - **Serviços** = pelo preço copiado, antes do desconto (que é da OS), por isso a soma por serviço pode passar do faturamento, e a tela avisa.
37. **Financeiro em uma tela só,** com os relatórios dentro: filtros Hoje · Semana · Mês · Mês passado · Período (até ~400 dias) e por barbeiro. Só o admin acessa. O barbeiro vê o próprio desempenho no Início.

### Mensagens, experiência e interface (38–46)

38. **WhatsApp: 6 modelos fixos, sem envio automático.** Só o texto é editável, e o padrão fica guardado no banco para "Restaurar". Os botões `wa.me` saem com a mensagem pronta. Variável desconhecida é recusada ao salvar. Dado não cadastrado some do texto enviado.
39. **Agenda "Dia" como grade horária:** uma coluna por barbeiro e blocos na posição e altura exatas da duração (1 h = 96 px). O hachurado marca o que está fora do expediente. Tocar num horário livre abre o encaixe com a hora arredondada a 15 min. A posição inicial é inteligente: com a barbearia aberta, abre em agora − 1 h; fora do expediente, abre 30 min antes do 1º atendimento.
40. **Métricas na ficha do cliente**, só com atendimentos concluídos: ticket médio, tempo médio de retorno ((último − primeiro) ÷ (visitas − 1)), dias sem voltar e o alerta "X dias além do habitual" (retorno médio + 25%, com mínimo de 7 dias), mostrado quando não há horário marcado.
41. **Agendamento numa página só** (substitui o fluxo de 6 passos). Mostra o status "Aberto/Fechado" calculado no navegador e serviços com foto. As seções Data → Profissional → Horários aparecem conforme a escolha, com resumo fixo no rodapé. Dias e barbeiros sem horário livre **somem**. Respostas fora de ordem são ignoradas, e uma escolha que deixou de valer é descartada.
42. **Visual "barbearia premium"** no site: paleta escura própria, Montserrat, títulos editoriais, cards com miniatura ou ícone por tipo de serviço, animações curtas que respeitam "reduzir movimento" e WhatsApp flutuante.
43. **Painel na mesma linguagem visual**, aplicada pelo tema (tokens do Tailwind em `globals.css`) e não tela por tela. O site do cliente não tem link para a equipe: o painel é acessado por `/login`.
44. **Rolagem contínua na grade da agenda:** no limite de cima ou de baixo, o mesmo gesto (dedo ou roda) passa a rolar a página, com inércia. Navegadores "prendem" o gesto no primeiro elemento que rolou. A regra pura está em `src/lib/rolagem-continua.ts`, com testes.
45. **Pagamento dividido numa tela só**, com uma linha por forma e soma ao vivo, gravado por `registrar_pagamentos(os, jsonb)` (tudo ou nada). Inclui também a **ordem dos barbeiros no site**, editável só pelo admin.
46. **Números sem barras de progresso.** Há um padrão visual único (`src/components/numeros.tsx`): verde para valor positivo ou confirmado, vermelho discreto para o que pede atenção, e o resto neutro.

### Infraestrutura e fluxo automático (47–49)

47. **PostgreSQL próprio em vez de Supabase.** O modelo de custo de um projeto gerenciado por cliente inviabilizava a mensalidade baixa planejada.
    - **Um banco por barbearia** num único servidor PostgreSQL, com isolamento total entre clientes.
    - **As migrations e as regras de segurança continuam iguais.** A camada `db/compat.sql` cria no Postgres puro o mínimo que elas esperam: papéis `anon`, `authenticated` e `service_role` (este com `BYPASSRLS`), permissões padrão equivalentes, `auth.users` e `auth.uid()` lendo o usuário da transação.
    - **Acesso pelo servidor** (`postgres.js`), sempre numa transação com o papel certo: `comoUsuario(id)`, `comoVisitante()` e `comoSistema()`. Consultas sempre parametrizadas.
    - **Login próprio:** bcrypt conferido pelo `pgcrypto` (as senhas existentes continuaram válidas na migração) e sessão como token aleatório em cookie `httpOnly`, com só o hash no banco. Inclui "permanecer conectado" (90 dias; sem ele, 12 h), derrubada de sessões ao desativar o usuário e limite de tentativas.
    - **Fotos** em pasta no disco (volume Docker), enviadas pelo servidor (só admin, só imagem, até 5 MB) e lidas por uma rota pública com cache longo.
    - **Ao vivo:** `NOTIFY` sem dados e uma rota SSE que só avisa "mudou". A tela recarrega pelo caminho normal, então a RLS continua decidindo o que cada um vê.
    - Execução em etapas (M0 banco → M1 login → M2 camada de dados → M3 fotos → M4 ao vivo → M5 testes e limpeza), num branch próprio, até a bateria completa passar no banco novo.
48. **O atendimento começa sozinho no horário.** Fluxo: **Agendado → (no horário) Em atendimento com OS aberta → Concluído**. Os status "confirmado" e "chegou" deixaram de existir.
    - `iniciar_atendimentos_do_horario()` roda a cada minuto (`src/instrumentation.ts`) e também ao abrir as telas da equipe.
    - Na OS: **Concluir**, **Não compareceu** ou **Reagendou**. Os dois últimos tiram a OS: ela é apagada se nunca teve pagamento, cancelada se teve pagamento estornado, e a ação é recusada se houver pagamento ativo.
    - **Começar agora** (cliente adiantado): o início passa a ser agora e o fim é recalculado pela duração. A ação é recusada se o barbeiro tiver outro cliente no intervalo.
    - **Concluir antes do previsto encurta o bloco** na agenda (mínimo de 5 min) e libera o resto.
    - **Reagendar mostra os horários livres** (motor em modo painel, sem contar o próprio horário como ocupado), com opção de encaixe manual.
49. **O número da OS só sai na conclusão, sem buracos.** Com a abertura automática, numerar na abertura gastava números com "não compareceu". O número agora sai de `contador_os`, atualizado na mesma transação da conclusão: se a conclusão falhar, nenhum número é gasto (a `sequence` do Postgres deixava buracos). Uma OS reaberta mantém o número, e uma cancelada nunca recebe.

---

## Motor de disponibilidade

Um horário de início é oferecido **somente se** o intervalo `[início, início + duração total)` couber inteiro:

- dentro do horário de funcionamento da barbearia naquele dia, respeitando intervalos;
- dentro da jornada do barbeiro naquele dia, respeitando intervalos;
- sem bloqueio, folga ou feriado que o toque;
- sem agendamento ativo do barbeiro que o sobreponha;
- respeitando a antecedência mínima e a janela máxima de dias;
- com um barbeiro que realiza **todos** os serviços escolhidos.

Os inícios candidatos andam na granularidade configurada (ex.: 15 min). Intervalos são meio-abertos, então encostar não conflita. Exemplo: barbeiro ocupado das 14:00 às 14:45 e serviço de 1 h, então 14:30 **não** é oferecido.

Implementação: `faixasDoDia` (faixas semanais → instantes absolutos no fuso de São Paulo) → `intersectar(funcionamento, jornada)` → `subtrair(…, bloqueios + agendamentos)` → candidatos na granularidade que caibam inteiros a partir do instante mínimo.

---

## Status do agendamento

```
Agendado → (no horário, sozinho: abre a OS) → Em atendimento → [Concluir] → Concluído
Antes do horário: Reagendar · Cancelar · Começar agora
Durante o atendimento (na OS): Concluir · Não compareceu · Reagendou
```

Cancelado e Não compareceu liberam o horário e podem ser reabertos. Se o horário já passou, a próxima checagem reabre a OS.

---

## Permissões

| Ação | Barbeiro | Admin |
|---|---|---|
| Ver agenda da equipe (ocupação) | sim | sim |
| Gerenciar agendamentos e OS | só os próprios | todos |
| Adicionar serviço, registrar pagamento, aplicar desconto | só nas próprias OS | todas |
| Estornar ou reabrir OS concluída | — | sim |
| Clientes | ver, criar e editar (compartilhado) | idem |
| Financeiro e relatórios | só o próprio desempenho (Início) | tudo |
| Configurações, serviços, equipe, mensagens | — | sim |

---

## Contingência

Motivação: uma queda de rede do provedor deixou o sistema fora do ar. O desenho prevê **duas VPS em provedores diferentes**:

- **Réplica em tempo real** do PostgreSQL da principal na secundária, pela VPN.
- **Vigia na secundária:** checa o `/api/saude` de cada app da principal. Se só um app cair, só os domínios dele passam para a secundária. Se a principal inteira cair, a secundária promove o banco e aponta o DNS para si pela API do Cloudflare.
- **No app** (`src/lib/db.ts`): com `DATABASE_URL_PRINCIPAL` definida (só na secundária), o app usa o banco da principal enquanto o local for réplica, checando `pg_is_in_recovery()` a cada 5 s. Quando o local é promovido, o app **fica preso nele** até reiniciar, porque a principal pode voltar com dados velhos. Com o banco local fora do ar, o app não tenta a principal às cegas. A lista de hosts do driver foi evitada de propósito: ela alterna entre hosts a cada reconexão.
- **Relógio de atendimentos** não grava em réplica e é seguro rodando nas duas pontas (`FOR UPDATE SKIP LOCKED`).
- **`GET /api/saude`:** `200 {ok, banco: "principal" | "replica"}` ou `503 {ok: false}` se o banco estiver fora ou demorar mais de 5 s. Sem login, `no-store`.
- O retorno para a principal é **manual e guiado**, depois de um período de estabilidade.

Os ensaios foram feitos em containers simulando as duas VPS: a secundária assumiu em ~13 s com o primário derrubado, e um app isolado trocou sozinho e voltou sozinho.

---

## Implantação em VPS

1. **Na VPS:** Docker com Compose e Node 22 (só para os scripts). Copiar o repositório.
2. **`.env.local` com senhas novas** (`openssl rand -hex 24`): `PG_SUPERUSER_PASSWORD`, `DATABASE_ADMIN_URL`, `DATABASE_URL`, `DATABASE_URL_DOCKER`.
3. **Banco:** `docker compose --env-file .env.local up -d db`, `npm ci`, `npm run db:migrar`. A porta do Postgres fica só em `127.0.0.1`.
4. **Dados** (opcional, a partir de outro ambiente, com túnel SSH para o Postgres da VPS): `ORIGEM_DATABASE_URL=… DATABASE_URL=… DATABASE_ADMIN_URL=… node scripts/copiar-banco.mjs`. As senhas dos usuários se mantêm.
5. **Fotos:** copiar `dados/arquivos` e dar a posse ao usuário do container (`chown -R 1001:1001 dados/arquivos`).
6. **App:** `docker compose --env-file .env.local up -d --build app`, com Nginx e HTTPS na frente repassando `X-Real-IP`, `X-Forwarded-For` e `X-Forwarded-Proto` (o cookie só vira `secure` sob HTTPS). A rota `/api/ao-vivo` já envia `X-Accel-Buffering: no` para o Nginx não segurar o SSE.
7. **Backup:** `pg_dump` diário (`docker exec barbearia-db pg_dump -U postgres -Fc barbearia > backup.dump`) mais cópia de `dados/arquivos`, guardados fora da VPS.
8. **Mais barbearias no mesmo servidor:** um banco e um usuário por cliente (outro `DATABASE_URL`). O `db:migrar` cria e isola, retirando o `CONNECT` público do banco.

---

## Aprendizados técnicos

- **Deadlock em *exclusion constraint* sob concorrência.** Duas inserções sobrepostas simultâneas podem abortar com `40P01` em vez do `23P01` esperado. A solução foi serializar por barbeiro com `pg_advisory_xact_lock`, travando os dois barbeiros em ordem fixa quando o agendamento troca de barbeiro.
- **`proxy.ts` fica dentro de `src/`.** No Next.js 16, `middleware` virou `proxy`. Com pasta `src/`, o arquivo na raiz é **ignorado em silêncio**. Confira a linha "ƒ Proxy (Middleware)" no output do build.
- **Redirecionamento dentro do container é sempre relativo.** Montar uma URL absoluta a partir do request no Docker dá o endereço interno (`localhost:3000`).
- **`(await db())\`...\`` é compilado errado** (a consulta é chamada antes do `await`, e o `tsc` não acusa). Separe em duas linhas.
- **`instanceof` falha entre cópias de uma biblioteca no bundle.** Leia `erro.code`.
- **`jsonb` como parâmetro:** use `tx.json(objeto)`. Texto com `::jsonb` chega como *string* JSON.
- **Cópia de dados:** trafegue datas como texto. O `Date` do JavaScript corta os microssegundos do Postgres.
- **`session_replication_role = replica` desliga as cascatas** das chaves estrangeiras. Apagar um usuário assim deixa sessões órfãs.
- **Build sem segredos:** páginas que leem dados sem cookies seriam pré-renderizadas no build. Use `await connection()`.
- **CSS:** com uma variável de fonte aplicada fora da raiz, use `@theme inline`. `mix-blend-mode` dentro de `isolate` só mistura com o que está no grupo, então o grupo precisa de fundo próprio.
- **SSE atrás de túneis rápidos** (Cloudflare Quick Tunnel) não é repassado. Por isso a checagem periódica de 30 s existe como degradação suave.
- **React separa texto fixo de valor inserido com `<!-- -->`** no HTML. Testes que procuram texto devem remover o marcador.
