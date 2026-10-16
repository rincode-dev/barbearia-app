// Teste da Fase 4 (atendimento / ordem de serviço) contra o container de dev.
// Rodar da raiz do projeto, com o container no ar. Variáveis:
//   TESTE_BASE_URL (padrão http://127.0.0.1:3002), TESTE_ADMIN_EMAIL (padrão admin de dev),
//   TESTE_ADMIN_SENHA (opcional — sem ela, o teste usa um admin temporário).
// Monta um cenário próprio e desfaz tudo no final.
import { randomBytes } from "node:crypto";
// Banco próprio (decisão 47 — M5): cliente no estilo do Supabase em cima do Postgres.
import { BASE, service, anon, sessao, adminDoTeste, encerrarTestes } from "./_banco.mjs";
// Admin de dev (TESTE_ADMIN_EMAIL/TESTE_ADMIN_SENHA) ou um admin temporário.
const { email: ADMIN_EMAIL, senha: ADMIN_SENHA } = await adminDoTeste();



let falhas = 0;
function ok(cond, descricao, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}


async function pagina(caminho, cookie) {
  const r = await fetch(BASE + caminho, { headers: { cookie }, redirect: "manual" });
  // O React separa texto fixo de valores inseridos com "<!-- -->" no HTML; remove para
  // comparar o texto como o usuário vê.
  return { status: r.status, html: r.status === 200 ? (await r.text()).replaceAll("<!-- -->", "") : "" };
}
function hojeSP() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function somarDias(data, n) {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
let ipSeq = 1;
async function agendarPeloSite(pedido) {
  const r = await fetch(`${BASE}/api/agendamento/confirmar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": `10.4.0.${ipSeq++}` },
    body: JSON.stringify(pedido),
  });
  return { status: r.status, corpo: await r.json() };
}
const os = async (id) => (await service.from("ordens_servico").select("*").eq("id", id).single()).data;
const num = (v) => Number(v);

const DIA = somarDias(hojeSP(), 2);
const sufixo = Date.now();
const TELS = [`1181${String(sufixo).slice(-7)}`, `1182${String(sufixo).slice(-7)}`];
const criado = { servicos: [], barbeiro: null };

const { data: estOriginal } = await service.from("estabelecimento").select("*").single();
const { data: funcOriginal } = await service.from("horarios_funcionamento").select("dia_semana, inicio, fim");
const { data: adminProfile } = await service.from("profiles").select("id").eq("email", ADMIN_EMAIL).single();
const A = adminProfile.id;
const { data: jornadaAdminOriginal } = await service.from("jornadas").select("dia_semana, inicio, fim").eq("profile_id", A);
const { data: servAdminOriginal } = await service.from("barbeiro_servicos").select("servico_id").eq("profile_id", A);

// O admin atende durante o teste (os dados de exemplo — scripts/dados-exemplo.mjs — podem
// deixá-lo como "não atende"); a configuração original volta no final.
const { data: atendeAdmin } = await service.from("profiles").select("id, atende_como_barbeiro").eq("email", ADMIN_EMAIL).single();
await service.from("profiles").update({ atende_como_barbeiro: true }).eq("id", atendeAdmin.id);

try {
  // ---------------- Cenário ----------------
  await service.from("estabelecimento").update({ antecedencia_minima_minutos: 60, janela_agendamento_dias: 14, granularidade_minutos: 15 }).eq("id", 1);
  const dias = [0, 1, 2, 3, 4, 5, 6];
  await service.from("horarios_funcionamento").delete().not("id", "is", null);
  await service.from("horarios_funcionamento").insert(dias.map((d) => ({ dia_semana: d, inicio: "09:00", fim: "19:00" })));
  const mk = async (nome, preco, dur) => {
    const { data } = await service.from("servicos").insert({ nome: `${nome} ${sufixo}`, preco, duracao_minutos: dur }).select("id").single();
    criado.servicos.push(data.id);
    return data.id;
  };
  const CORTE = await mk("Corte", 40, 30);
  const BARBA = await mk("Barba", 30, 30);
  const SOBRANCELHA = await mk("Sobrancelha", 15, 15);
  const senhaB = randomBytes(12).toString("base64url");
  const emailB = `barbeiro.fase4.${sufixo}@example.com`;
  const { data: userB } = await service.auth.admin.createUser({ email: emailB, password: senhaB, email_confirm: true, user_metadata: { nome: "Rafael OS" } });
  const B = userB.user.id;
  criado.barbeiro = B;
  await service.from("jornadas").delete().in("profile_id", [A, B]);
  await service.from("jornadas").insert([A, B].flatMap((p) => dias.map((d) => ({ profile_id: p, dia_semana: d, inicio: "09:00", fim: "19:00" }))));
  await service.from("barbeiro_servicos").delete().in("profile_id", [A, B]);
  await service.from("barbeiro_servicos").insert([A, B].flatMap((p) => [CORTE, BARBA, SOBRANCELHA].map((s) => ({ profile_id: p, servico_id: s }))));

  const admin = await sessao(ADMIN_EMAIL, ADMIN_SENHA);
  const barb = await sessao(emailB, senhaB);

  ok((await agendarPeloSite({ servicos: [CORTE, BARBA], data: DIA, barbeiro: B, hora: "10:00", nome: "Cliente OS B", telefone: TELS[0] })).status === 200
    && (await agendarPeloSite({ servicos: [CORTE], data: DIA, barbeiro: A, hora: "10:00", nome: "Cliente OS A", telefone: TELS[1] })).status === 200,
    "cenário: agendamento Corte+Barba (Rafael) e Corte (admin) pelo site");
  const agId = async (barbeiro) => (await service.from("agendamentos").select("id").eq("barbeiro_id", barbeiro).eq("status", "agendado").single()).data.id;
  const AG_B = await agId(B);
  const AG_A = await agId(A);

  // ---------------- Iniciar ----------------
  ok((await barb.sb.rpc("iniciar_atendimento", { p_agendamento_id: AG_A })).error?.message === "SEM_PERMISSAO",
    "barbeiro NÃO inicia atendimento de colega");
  const ini = await barb.sb.rpc("iniciar_atendimento", { p_agendamento_id: AG_B });
  const OS_B = ini.data;
  ok(!ini.error && OS_B, "barbeiro inicia o próprio atendimento (direto do 'agendado')", ini.error?.message);
  let o = await os(OS_B);
  const { data: agB } = await service.from("agendamentos").select("status").eq("id", AG_B).single();
  ok(agB.status === "em_atendimento" && o.status === "aberta", "agendamento vira 'em atendimento', OS aberta");
  const { data: itens } = await service.from("os_servicos").select("nome, preco, origem").eq("os_id", OS_B);
  ok(itens.length === 2 && itens.every((i) => i.origem === "agendado") && num(o.subtotal) === 70,
    "serviços agendados copiados como realizados, subtotal R$70");
  ok((await barb.sb.rpc("iniciar_atendimento", { p_agendamento_id: AG_B })).data === OS_B, "iniciar de novo devolve a mesma OS");

  const pOS = await pagina(`/painel/atendimentos/${OS_B}`, barb.cookie);
  // Decisão 49: o número só sai na conclusão.
  ok(pOS.status === 200 && o.numero === null && pOS.html.includes("OS em andamento"), "OS aberta: 'OS em andamento', ainda sem número", `numero ${o.numero}`);

  const iniA = await admin.sb.rpc("iniciar_atendimento", { p_agendamento_id: AG_A });
  const OS_A = iniA.data;
  const oA = await os(OS_A);
  ok((await pagina(`/painel/atendimentos/${OS_A}`, barb.cookie)).status === 404, "barbeiro NÃO abre OS de colega");
  ok((await pagina(`/painel/atendimentos/${OS_B}`, admin.cookie)).status === 200, "admin abre qualquer OS");

  // ---------------- Serviço adicional ----------------
  const add = await barb.sb.rpc("adicionar_servico_os", { p_os_id: OS_B, p_servico_id: SOBRANCELHA });
  o = await os(OS_B);
  ok(!add.error && num(o.subtotal) === 85, "adiciona Sobrancelha: subtotal 70 → 85", add.error?.message);
  ok((await pagina(`/painel/atendimentos/${OS_B}`, barb.cookie)).html.includes("adicional"), "tela diferencia serviço adicional");

  // ---------------- Desconto ----------------
  const d1 = await barb.sb.rpc("aplicar_desconto_os", { p_os_id: OS_B, p_tipo: "percentual", p_valor: 10, p_motivo: "fidelidade", p_observacao: null });
  o = await os(OS_B);
  ok(!d1.error && num(o.desconto_calculado) === 8.5 && num(o.total) === 76.5, "barbeiro aplica 10% (fidelidade): 85 → 76,50", d1.error?.message);
  ok((await barb.sb.rpc("aplicar_desconto_os", { p_os_id: OS_B, p_tipo: "percentual", p_valor: 150, p_motivo: "promocao", p_observacao: null })).error?.message === "DESCONTO_INVALIDO",
    "desconto de 150% é recusado");
  ok((await barb.sb.rpc("aplicar_desconto_os", { p_os_id: OS_B, p_tipo: "fixo", p_valor: 10, p_motivo: null, p_observacao: null })).error?.message === "MOTIVO_DESCONTO_INVALIDO",
    "desconto sem motivo é recusado");
  const d2 = await barb.sb.rpc("aplicar_desconto_os", { p_os_id: OS_B, p_tipo: "fixo", p_valor: 10, p_motivo: "cupom", p_observacao: "CUPOM10" });
  o = await os(OS_B);
  ok(!d2.error && num(o.total) === 75 && o.desconto_motivo === "cupom" && o.desconto_aplicado_por === B, "troca para R$10 fixo (cupom): total 75, registra quem deu");

  // ---------------- Pagamentos ----------------
  const pg = (cli, forma, valor) => cli.rpc("registrar_pagamento", { p_os_id: OS_B, p_forma: forma, p_valor: valor });
  ok(!(await pg(barb.sb, "dinheiro", 40)).error, "pagamento R$40 em dinheiro");
  o = await os(OS_B);
  ok(num(o.total_pago) === 40 && o.status_pagamento === "parcial", "status: pagamento parcial (restante 35)");
  ok((await pg(barb.sb, "pix", 50)).error?.message === "PAGAMENTO_ACIMA_DO_RESTANTE", "pagar acima do restante é recusado");
  ok((await pg(barb.sb, "pix", 0)).error?.message === "VALOR_INVALIDO", "pagamento zero é recusado");
  const { data: pix } = await barb.sb.rpc("registrar_pagamento", { p_os_id: OS_B, p_forma: "pix", p_valor: 35 });
  o = await os(OS_B);
  ok(num(o.total_pago) === 75 && o.status_pagamento === "pago", "R$35 no Pix completa: 40 dinheiro + 35 Pix = pago");

  // Total nunca abaixo do pago
  const { data: itemSobr } = await service.from("os_servicos").select("id").eq("os_id", OS_B).eq("origem", "adicional").single();
  const rem = await barb.sb.rpc("remover_servico_os", { p_item_id: itemSobr.id });
  o = await os(OS_B);
  ok(rem.error?.code === "23514" && num(o.subtotal) === 85, "remover serviço com tudo pago é recusado (total ficaria < pago)", rem.error?.code);
  ok(!(await barb.sb.rpc("estornar_pagamento", { p_pagamento_id: pix })).error, "barbeiro estorna o Pix com a OS aberta");
  o = await os(OS_B);
  ok(num(o.total_pago) === 40 && o.status_pagamento === "parcial", "estorno volta para parcial");
  const { data: linhaPix } = await service.from("pagamentos").select("estornado_em, estornado_por").eq("id", pix).single();
  ok(linhaPix.estornado_em && linhaPix.estornado_por === B, "estorno fica registrado (não apaga o pagamento)");
  ok(!(await barb.sb.rpc("remover_servico_os", { p_item_id: itemSobr.id })).error, "agora remove a Sobrancelha");
  o = await os(OS_B);
  ok(num(o.subtotal) === 70 && num(o.total) === 60 && num(o.total_pago) === 40, "subtotal 70, total 60 (−10), pago 40");

  // ---------------- Concluir com pendência ----------------
  ok(!(await barb.sb.rpc("concluir_atendimento", { p_os_id: OS_B })).error, "conclui com R$20 pendente (decisão 33)");
  o = await os(OS_B);
  const { data: contador } = await service.from("contador_os").select("ultimo").single();
  ok(o.numero !== null && Number(o.numero) === Number(contador.ultimo), "ao concluir recebe o próximo número do contador", `OS ${o.numero}`);
  const pConc = await pagina(`/painel/atendimentos/${OS_B}`, barb.cookie);
  ok(pConc.html.includes(`OS Nº ${String(o.numero).padStart(6, "0")}`), "tela da OS concluída com número de 6 dígitos");
  const { data: agB2 } = await service.from("agendamentos").select("status").eq("id", AG_B).single();
  ok(o.status === "concluida" && o.concluida_em && agB2.status === "concluido" && o.status_pagamento === "parcial",
    "OS concluída (pagamento parcial), agendamento concluído");
  const { data: resumo } = await admin.sb.from("clientes_resumo").select("quantidade_atendimentos").eq("cliente_id", o.cliente_id).single();
  ok(Number(resumo.quantidade_atendimentos) === 1, "conta como atendimento do cliente");
  ok((await barb.sb.rpc("adicionar_servico_os", { p_os_id: OS_B, p_servico_id: BARBA })).error?.message === "OS_FECHADA", "OS concluída não aceita novo serviço");
  const { data: pagDepois } = await barb.sb.rpc("registrar_pagamento", { p_os_id: OS_B, p_forma: "credito", p_valor: 20 });
  o = await os(OS_B);
  ok(pagDepois && o.status_pagamento === "pago", "cliente paga depois: R$20 no crédito quita a OS concluída");
  ok((await barb.sb.rpc("estornar_pagamento", { p_pagamento_id: pagDepois })).error?.message === "SEM_PERMISSAO",
    "barbeiro NÃO estorna depois de concluída");
  ok(!(await admin.sb.rpc("estornar_pagamento", { p_pagamento_id: pagDepois })).error, "admin estorna depois de concluída");
  await admin.sb.rpc("registrar_pagamento", { p_os_id: OS_B, p_forma: "credito", p_valor: 20 });

  // ---------------- Reabrir ----------------
  ok((await barb.sb.rpc("reabrir_atendimento", { p_os_id: OS_B })).error?.message === "SEM_PERMISSAO", "barbeiro NÃO reabre OS concluída");
  ok(!(await admin.sb.rpc("reabrir_atendimento", { p_os_id: OS_B })).error, "admin reabre para correção");
  const { data: agB3 } = await service.from("agendamentos").select("status").eq("id", AG_B).single();
  ok((await os(OS_B)).status === "aberta" && agB3.status === "em_atendimento", "OS volta a aberta, agendamento a em atendimento");
  const numeroAntes = o.numero;
  await admin.sb.rpc("concluir_atendimento", { p_os_id: OS_B });
  o = await os(OS_B);
  ok(o.numero === numeroAntes, "reaberta e concluída de novo: mantém o número");

  // ---------------- Cancelar atendimento ----------------
  await admin.sb.rpc("registrar_pagamento", { p_os_id: OS_A, p_forma: "pix", p_valor: 10 });
  ok((await admin.sb.rpc("cancelar_atendimento", { p_os_id: OS_A, p_motivo: "Desistiu" })).error?.message === "OS_COM_PAGAMENTO",
    "não cancela atendimento com pagamento ativo");
  const { data: pagA } = await service.from("pagamentos").select("id").eq("os_id", OS_A).single();
  await admin.sb.rpc("estornar_pagamento", { p_pagamento_id: pagA.id });
  ok(!(await admin.sb.rpc("cancelar_atendimento", { p_os_id: OS_A, p_motivo: "Desistiu" })).error, "cancela depois de estornar");
  const { data: agA } = await service.from("agendamentos").select("status, motivo_cancelamento").eq("id", AG_A).single();
  ok((await os(OS_A)).status === "cancelada" && agA.status === "cancelado" && agA.motivo_cancelamento === "Desistiu", "OS e agendamento cancelados, com motivo");
  await admin.sb.rpc("alterar_status_agendamento", { p_id: AG_A, p_novo: "agendado", p_motivo: null });
  const reini = await admin.sb.rpc("iniciar_atendimento", { p_agendamento_id: AG_A });
  ok(reini.data === OS_A && (await os(OS_A)).status === "aberta", "agendamento reaberto: iniciar reativa a mesma OS (caso de borda)");

  // ---------------- Proteções ----------------
  const { data: direto } = await admin.sb.from("ordens_servico").update({ total_pago: 9999 }).eq("id", OS_A).select();
  ok((direto ?? []).length === 0 && num((await os(OS_A)).total_pago) === 0, "nem o admin altera OS 'por fora' das funções");
  const { error: errInsPag } = await admin.sb.from("pagamentos").insert({ os_id: OS_A, forma: "pix", valor: 1 });
  ok(!!errInsPag, "pagamento não entra por insert direto");
  const { data: osAnon } = await anon.from("ordens_servico").select("id");
  const { data: pagAnon } = await anon.from("pagamentos").select("id");
  ok((osAnon ?? []).length === 0 && (pagAnon ?? []).length === 0, "visitante NÃO lê OS nem pagamentos");
  ok(!!(await anon.rpc("registrar_pagamento", { p_os_id: OS_A, p_forma: "pix", p_valor: 1 })).error, "visitante NÃO registra pagamento");
  const { data: osVisB } = await barb.sb.from("ordens_servico").select("id");
  ok(osVisB.every((x) => x.id === OS_B), "barbeiro só lê as próprias OS");

  // ---------------- Telas ----------------
  const lista = await pagina(`/painel/atendimentos`, admin.cookie);
  ok(lista.html.includes("Em atendimento agora") && lista.html.includes("Cliente OS A") && lista.html.includes("Cliente OS B"),
    "lista: OS em andamento e concluídas");
  const detAg = await pagina(`/painel/agenda/${AG_B}`, barb.cookie);
  ok(detAg.html.includes(`Abrir OS Nº ${String(o.numero).padStart(6, "0")}`), "agendamento concluído mostra 'Abrir OS Nº'");
  const ficha = await pagina(`/painel/clientes/${o.cliente_id}`, barb.cookie);
  ok(ficha.html.includes(`OS ${String(o.numero).padStart(6, "0")}`), "ficha do cliente mostra a OS");
} catch (e) {
  falhas++;
  console.log("ERRO no teste:", e.message);
} finally {
  await service.from("profiles").update({ atende_como_barbeiro: atendeAdmin.atende_como_barbeiro }).eq("id", atendeAdmin.id);
  const { data: clis } = await service.from("clientes").select("id").in("telefone", TELS);
  const ids = (clis ?? []).map((c) => c.id);
  if (ids.length) {
    await service.from("ordens_servico").delete().in("cliente_id", ids);
    await service.from("agendamentos").delete().in("cliente_id", ids);
    await service.from("clientes").delete().in("id", ids);
  }
  await service.from("jornadas").delete().eq("profile_id", A);
  if (jornadaAdminOriginal?.length) await service.from("jornadas").insert(jornadaAdminOriginal.map((j) => ({ ...j, profile_id: A })));
  await service.from("barbeiro_servicos").delete().eq("profile_id", A);
  if (servAdminOriginal?.length) await service.from("barbeiro_servicos").insert(servAdminOriginal.map((s) => ({ ...s, profile_id: A })));
  if (criado.servicos.length) {
    await service.from("barbeiro_servicos").delete().in("servico_id", criado.servicos);
    await service.from("servicos").delete().in("id", criado.servicos);
  }
  if (criado.barbeiro) await service.auth.admin.deleteUser(criado.barbeiro);
  await service.from("horarios_funcionamento").delete().not("id", "is", null);
  if (funcOriginal?.length) await service.from("horarios_funcionamento").insert(funcOriginal);
  const estRestaurar = { ...estOriginal };
  delete estRestaurar.id;
  delete estRestaurar.updated_at;
  await service.from("estabelecimento").update(estRestaurar).eq("id", 1);
  const { count: n } = await service.from("ordens_servico").select("*", { count: "exact", head: true });
  const { count: ag } = await service.from("agendamentos").select("*", { count: "exact", head: true });
  console.log(`\nLimpeza feita (OS: ${n}, agendamentos: ${ag}).`);
  console.log(falhas === 0 ? "RESULTADO: tudo passou." : `RESULTADO: ${falhas} falha(s).`);
  await encerrarTestes();
  process.exit(falhas === 0 ? 0 : 1);
}
