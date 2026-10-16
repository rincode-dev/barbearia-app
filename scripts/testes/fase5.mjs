// Teste da Fase 5 (Início, Financeiro e Relatórios) contra o container de dev.
// Rodar da raiz do projeto, com o container no ar. Variável opcional:
//   TESTE_BASE_URL (padrão http://127.0.0.1:3002).
// Não usa a senha de ninguém: cria um admin e dois barbeiros TEMPORÁRIOS (chave de
// serviço), monta um cenário conhecido hoje e confere cada fórmula da decisão 36 do
// docs/ARQUITETURA.md. Desfaz tudo no final — os dados de exemplo ficam intactos.
import { randomBytes } from "node:crypto";
// Banco próprio (decisão 47 — M5): cliente no estilo do Supabase em cima do Postgres.
import { BASE, service, anon, sessao, encerrarTestes } from "./_banco.mjs";



let falhas = 0;
function ok(cond, descricao, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}


async function pagina(caminho, cookie) {
  const r = await fetch(BASE + caminho, { headers: { cookie }, redirect: "manual" });
  // "<!-- -->" separa texto fixo de valor inserido; o real usa espaço não separável.
  const html = r.status === 200 ? (await r.text()).replaceAll("<!-- -->", "").replaceAll(" ", " ").replaceAll("&nbsp;", " ") : "";
  return { status: r.status, html, location: r.headers.get("location") };
}
function hojeSP() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function somarDias(data, n) {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
// São Paulo está em UTC-3 o ano todo (sem horário de verão desde 2019).
const instante = (data, hora) => new Date(`${data}T${hora}:00-03:00`).toISOString();
const rel = async (sb, de, ate, barbeiro = null) => {
  const { data, error } = await sb.rpc("relatorio_financeiro", { p_de: de, p_ate: ate, p_barbeiro: barbeiro });
  if (error) throw new Error(`relatorio_financeiro: ${error.message}`);
  return data;
};
const reais = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const HOJE = hojeSP();
const ONTEM = somarDias(HOJE, -1);
const sufixo = Date.now();
const TELS = [1, 2, 3, 4, 5, 6].map((i) => `119${i}${String(sufixo).slice(-7)}`);
const criado = { usuarios: [], servicos: [] };

async function usuario(nome, admin) {
  const email = `fase5.${nome.toLowerCase()}.${sufixo}@example.com`;
  const senha = randomBytes(12).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
  if (error) throw new Error(`criar ${email}: ${error.message}`);
  criado.usuarios.push(data.user.id);
  await service.from("profiles").update({ role: admin ? "admin" : "colaborador", atende_como_barbeiro: !admin, ativo: true }).eq("id", data.user.id);
  return { id: data.user.id, ...(await sessao(email, senha)) };
}

try {
  // Linha de base da barbearia inteira hoje (os dados de exemplo podem ter movimento).
  const base = await rel(service, HOJE, HOJE);

  // ---------------- Cenário ----------------
  const mk = async (nome, preco, dur) => {
    const { data } = await service.from("servicos").insert({ nome: `${nome} ${sufixo}`, preco, duracao_minutos: dur }).select("id").single();
    criado.servicos.push(data.id);
    return data.id;
  };
  const CORTE = await mk("Corte F5", 40, 30);
  const BARBA = await mk("Barba F5", 30, 30);
  const SOBR = await mk("Sobrancelha F5", 15, 15);

  const adm = await usuario("AdminF5", true);
  const b1 = await usuario("RafaelF5", false);
  const b2 = await usuario("JoaoF5", false);
  await service.from("barbeiro_servicos").insert([b1.id, b2.id].flatMap((p) => [CORTE, BARBA, SOBR].map((s) => ({ profile_id: p, servico_id: s }))));

  const agendar = async (quem, barbeiro, hora, servicos, tel) => {
    const { data, error } = await quem.sb.rpc("criar_agendamento_painel", {
      p_cliente_id: null, p_cliente_nome: `Cliente F5 ${tel.slice(-4)}`, p_cliente_telefone: tel,
      p_barbeiro_id: barbeiro, p_inicio: instante(HOJE, hora), p_servico_ids: servicos,
    });
    if (error) throw new Error(`agendar ${hora}: ${error.message}`);
    return data;
  };
  const rpc = async (quem, fn, args) => {
    const { data, error } = await quem.sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };

  // Rafael (b1): dois concluídos, um cancelado, um não compareceu, um ainda agendado.
  const ag1 = await agendar(b1, b1.id, "00:30", [CORTE, BARBA], TELS[0]);
  const ag2 = await agendar(b1, b1.id, "01:30", [CORTE], TELS[1]);
  const ag3 = await agendar(b1, b1.id, "02:00", [BARBA], TELS[2]);
  const ag4 = await agendar(b1, b1.id, "02:30", [CORTE], TELS[3]);
  const ag5 = await agendar(b1, b1.id, "23:30", [SOBR], TELS[4]);
  // João (b2): um concluído, pago no Pix; a OS é "de ontem 23:30" (testa o fuso).
  const ag6 = await agendar(b2, b2.id, "00:30", [CORTE], TELS[5]);

  // ag1: 70 − 10% (fidelidade) = 63; crédito 10 estornado; 40 dinheiro + 23 Pix.
  const os1 = await rpc(b1, "iniciar_atendimento", { p_agendamento_id: ag1 });
  await rpc(b1, "aplicar_desconto_os", { p_os_id: os1, p_tipo: "percentual", p_valor: 10, p_motivo: "fidelidade" });
  const estornado = await rpc(b1, "registrar_pagamento", { p_os_id: os1, p_forma: "credito", p_valor: 10 });
  await rpc(b1, "estornar_pagamento", { p_pagamento_id: estornado });
  await rpc(b1, "registrar_pagamento", { p_os_id: os1, p_forma: "dinheiro", p_valor: 40 });
  await rpc(b1, "registrar_pagamento", { p_os_id: os1, p_forma: "pix", p_valor: 23 });
  await rpc(b1, "concluir_atendimento", { p_os_id: os1 });
  // ag2: 40 + Sobrancelha adicional 15 = 55 − R$5 (promoção) = 50; paga 20 no débito → 30 pendente.
  const os2 = await rpc(b1, "iniciar_atendimento", { p_agendamento_id: ag2 });
  await rpc(b1, "adicionar_servico_os", { p_os_id: os2, p_servico_id: SOBR });
  await rpc(b1, "aplicar_desconto_os", { p_os_id: os2, p_tipo: "fixo", p_valor: 5, p_motivo: "promocao" });
  await rpc(b1, "registrar_pagamento", { p_os_id: os2, p_forma: "debito", p_valor: 20 });
  await rpc(b1, "concluir_atendimento", { p_os_id: os2 });
  await rpc(b1, "alterar_status_agendamento", { p_id: ag3, p_novo: "cancelado", p_motivo: "teste" });
  await rpc(b1, "alterar_status_agendamento", { p_id: ag4, p_novo: "nao_compareceu" });
  // ag6 (João): 40 pago no Pix; depois a OS é movida para ontem 23:30 (hora de SP).
  const os6 = await rpc(b2, "iniciar_atendimento", { p_agendamento_id: ag6 });
  await rpc(b2, "registrar_pagamento", { p_os_id: os6, p_forma: "pix", p_valor: 40 });
  await rpc(b2, "concluir_atendimento", { p_os_id: os6 });
  await service.from("ordens_servico").update({ iniciada_em: instante(ONTEM, "23:30") }).eq("id", os6);
  ok(true, "cenário montado: 6 agendamentos, 3 OS concluídas, desconto, estorno, pendência");

  // ---------------- Fórmulas (Rafael, visto pelo admin com filtro) ----------------
  const r1 = await rel(adm.sb, HOJE, HOJE, b1.id);
  ok(r1.faturamento === 113 && r1.atendimentos === 2, "faturamento = total das OS concluídas (63 + 50 = 113), 2 atendimentos", `${r1.faturamento}/${r1.atendimentos}`);
  ok(r1.ticket_medio === 56.5, "ticket médio = 113 / 2 = 56,50", r1.ticket_medio);
  ok(r1.recebido === 83, "recebido = pagamentos não estornados (40 + 23 + 20 = 83; crédito estornado não conta)", r1.recebido);
  ok(r1.pendente === 30 && r1.pendente_total === 30, "pendente = total − pago das concluídas (30)", `${r1.pendente}/${r1.pendente_total}`);
  ok(r1.previsto === 128 && r1.agendados === 3, "previsto = OS 63 + OS 50 + agendado 15 = 128 (cancelado e não compareceu fora)", `${r1.previsto}/${r1.agendados}`);
  ok(r1.cancelamentos === 1 && r1.nao_comparecimentos === 1, "1 cancelamento e 1 não comparecimento");
  ok(r1.descontos.total === 12 && r1.descontos.quantidade === 2 && r1.descontos.media === 6,
    "descontos: total 12 (7 + 5), 2 atendimentos, média 6", JSON.stringify(r1.descontos));
  const motivos = Object.fromEntries(r1.descontos.por_motivo.map((m) => [m.motivo, m.total]));
  ok(motivos.fidelidade === 7 && motivos.promocao === 5, "descontos por motivo: fidelidade 7, promoção 5");
  const formas = Object.fromEntries(r1.formas.map((f) => [f.forma, f.total]));
  ok(formas.dinheiro === 40 && formas.pix === 23 && formas.debito === 20 && !("credito" in formas), "formas de pagamento: dinheiro 40, Pix 23, débito 20, sem o crédito estornado");
  const sv = Object.fromEntries(r1.servicos.map((s) => [s.servico_id, s]));
  ok(sv[CORTE]?.quantidade === 2 && sv[CORTE]?.total === 80 && sv[BARBA]?.quantidade === 1 && sv[SOBR]?.quantidade === 1 && r1.servicos[0].servico_id === CORTE,
    "serviços realizados: Corte 2× (80, primeiro), Barba 1×, Sobrancelha adicional 1×");
  ok(r1.barbeiros.length === 1 && r1.barbeiros[0].barbeiro_id === b1.id && r1.barbeiros[0].faturamento === 113, "por barbeiro: só Rafael, 113");
  ok(r1.por_dia.length === 1 && r1.por_dia[0].faturamento === 113 && r1.por_dia[0].recebido === 83, "por dia: hoje 113 faturado, 83 recebido");

  // ---------------- Fuso: OS de ontem 23:30 (SP) = hoje 02:30 UTC ----------------
  const r2hoje = await rel(adm.sb, HOJE, HOJE, b2.id);
  const r2ontem = await rel(adm.sb, ONTEM, ONTEM, b2.id);
  ok(r2hoje.faturamento === 0 && r2ontem.faturamento === 40 && r2ontem.atendimentos === 1,
    "OS iniciada ontem 23:30 (SP) conta em ONTEM, não hoje", `hoje ${r2hoje.faturamento}, ontem ${r2ontem.faturamento}`);
  ok(r2hoje.recebido === 40 && r2ontem.recebido === 0, "recebido segue a data do pagamento (hoje)");
  ok(r2ontem.agendados === 1 && r2ontem.previsto === 40 && r2hoje.agendados === 0 && r2hoje.previsto === 0,
    "agendamento que virou OS conta no dia do atendimento também no previsto/agendados (sem '1 de 0')",
    `ontem ${r2ontem.agendados}/${r2ontem.previsto}, hoje ${r2hoje.agendados}/${r2hoje.previsto}`);
  const r2dois = await rel(adm.sb, ONTEM, HOJE, b2.id);
  ok(r2dois.por_dia.length === 2 && r2dois.por_dia[0].faturamento === 40 && r2dois.por_dia[1].recebido === 40, "série por dia com os dois dias");

  // ---------------- Barbearia inteira ----------------
  const tudo = await rel(adm.sb, HOJE, HOJE);
  ok(Math.abs(tudo.faturamento - base.faturamento - 113) < 0.001 && Math.abs(tudo.recebido - base.recebido - 123) < 0.001,
    "admin sem filtro soma a equipe (faturamento +113, recebido +123 sobre a linha de base)");
  const nomes = tudo.barbeiros.map((b) => b.barbeiro_id);
  ok(nomes.includes(b1.id) && !nomes.includes(b2.id), "por barbeiro hoje: Rafael aparece, João (OS de ontem) não");

  // ---------------- Permissões ----------------
  const proprio = await rel(b1.sb, HOJE, HOJE);
  ok(proprio.faturamento === 113 && proprio.recebido === 83 && proprio.previsto === 128 && proprio.cancelamentos === 1,
    "barbeiro sem filtro vê só os próprios números (RLS)");
  const alheio = await rel(b1.sb, ONTEM, HOJE, b2.id);
  ok(alheio.faturamento === 0 && alheio.recebido === 0 && alheio.agendados === 0, "barbeiro pedindo números do colega recebe zero");
  const { error: eAnon } = await anon.rpc("relatorio_financeiro", { p_de: HOJE, p_ate: HOJE });
  ok(!!eAnon, "visitante não executa relatorio_financeiro", eAnon?.message);
  const { error: ePer } = await adm.sb.rpc("relatorio_financeiro", { p_de: HOJE, p_ate: ONTEM });
  const { error: eLongo } = await adm.sb.rpc("relatorio_financeiro", { p_de: "2025-01-01", p_ate: "2026-12-31" });
  ok(ePer?.message === "PERIODO_INVALIDO" && eLongo?.message === "PERIODO_INVALIDO", "período invertido ou longo demais recusado");

  // ---------------- Telas ----------------
  const fin = await pagina(`/painel/financeiro?periodo=hoje&barbeiro=${b1.id}`, adm.cookie);
  ok(fin.status === 200 && fin.html.includes(reais(113)) && fin.html.includes(reais(83)) && fin.html.includes(reais(30)),
    "Financeiro (hoje, Rafael): faturamento, recebido e pendente na tela");
  ok(["Formas de pagamento", "Dinheiro", "Pix", "Débito", "Serviços mais realizados", `Corte F5 ${sufixo}`, "Descontos concedidos", "Cliente fidelidade", "Promoção", reais(12), reais(56.5)].every((t) => fin.html.includes(t)),
    "Financeiro: formas, serviços, descontos por motivo e ticket médio");
  ok(!fin.html.includes("Faturamento por barbeiro"), "Financeiro filtrado por barbeiro esconde o 'por barbeiro'");
  // Filtros: datas só em "Período"; barbeiro sempre, mantendo o período escolhido.
  ok(!fin.html.includes('type="date"') && fin.html.includes("Todos os barbeiros") && fin.html.includes('name="periodo" value="hoje"'),
    "filtro rápido (Hoje): sem datas, com barbeiro, e trocar o barbeiro mantém 'hoje'");
  const finMes = await pagina("/painel/financeiro", adm.cookie);
  ok(finMes.status === 200 && finMes.html.includes("Faturamento por barbeiro") && finMes.html.includes("Faturamento por dia") && finMes.html.includes("RafaelF5"),
    "Financeiro (mês, padrão): por barbeiro e por dia");
  ok(!finMes.html.includes('type="date"') && finMes.html.includes("Todos os barbeiros"), "filtro rápido (Mês): sem datas, com barbeiro");
  // Só dentro da seção: o nome também aparece antes, no seletor de barbeiros.
  const descontoRafael = finMes.html.split("Faturamento por barbeiro")[1]?.match(/RafaelF5[\s\S]*?<p class="([^"]*)">Descontos: (R\$[^<]+)<\/p>/);
  ok(descontoRafael && descontoRafael[2].trim() === reais(12) && descontoRafael[1].includes("text-accent"),
    "por barbeiro: 'Descontos: R$ 12,00' em vermelho", descontoRafael?.slice(1).join(" | "));
  const finPer = await pagina(`/painel/financeiro?periodo=personalizado&de=${ONTEM}&ate=${HOJE}&barbeiro=${b2.id}`, adm.cookie);
  ok(finPer.status === 200 && finPer.html.includes(reais(40)), "Financeiro: período personalizado");
  ok((finPer.html.match(/type="date"/g) ?? []).length === 2 && finPer.html.includes("Aplicar período") && finPer.html.includes("Todos os barbeiros"),
    "Período: data inicial, data final e barbeiro");
  const finAno = await pagina(`/painel/financeiro?periodo=personalizado&de=${somarDias(HOJE, -120)}&ate=${HOJE}`, adm.cookie);
  ok(finAno.status === 200 && finAno.html.includes("Faturamento por mês"), "período longo agrupa por mês");
  const finB = await pagina("/painel/financeiro", b1.cookie);
  ok(finB.status === 307 || finB.status === 303 || finB.status === 302, "barbeiro não abre o Financeiro (redireciona)", `${finB.status} → ${finB.location}`);

  const iniB = await pagina("/painel", b1.cookie);
  ok(iniB.status === 200 && iniB.html.includes("seu desempenho") && iniB.html.includes("2 de 3") && iniB.html.includes(reais(83)) && iniB.html.includes(reais(128)),
    "Início do barbeiro: hoje com 2 de 3 atendimentos, previsto 128, recebido 83");
  ok(!iniB.html.includes("Ver Financeiro"), "Início do barbeiro não oferece o Financeiro");
  const aindaHoje = new Date() < new Date(instante(HOJE, "23:30"));
  if (aindaHoje) ok(iniB.html.includes("Cliente F5 " + TELS[4].slice(-4)) && iniB.html.includes(`/painel/agenda/${ag5}`), "próximos atendimentos: agendamento das 23:30 com link");
  ok(!iniB.html.includes(`/painel/agenda/${ag3}`) && !iniB.html.includes(`/painel/agenda/${ag1}`), "próximos não mostram cancelado nem já concluído");
  const iniB2 = await pagina("/painel", b2.cookie);
  ok(iniB2.status === 200 && !iniB2.html.includes("Cliente F5 " + TELS[4].slice(-4)), "barbeiro não vê próximos atendimentos do colega no Início");
  const iniA = await pagina("/painel", adm.cookie);
  ok(iniA.status === 200 && iniA.html.includes("Próximos atendimentos") && iniA.html.includes("Ver Financeiro") && iniA.html.includes("Mais realizados no mês"),
    "Início do admin: próximos, mês e link do Financeiro");
  if (aindaHoje) ok(iniA.html.includes("RafaelF5"), "admin vê o barbeiro nos próximos atendimentos");
} catch (e) {
  ok(false, "execução sem erro inesperado", e.message);
} finally {
  const { data: clis } = await service.from("clientes").select("id").in("telefone", TELS);
  const ids = (clis ?? []).map((c) => c.id);
  if (ids.length) {
    await service.from("ordens_servico").delete().in("cliente_id", ids);
    await service.from("agendamentos").delete().in("cliente_id", ids);
    await service.from("clientes").delete().in("id", ids);
  }
  if (criado.servicos.length) {
    await service.from("barbeiro_servicos").delete().in("servico_id", criado.servicos);
    await service.from("servicos").delete().in("id", criado.servicos);
  }
  for (const id of criado.usuarios) {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) console.log(`AVISO  não apagou usuário ${id}: ${error.message}`);
  }
  const { count: restos } = await service.from("clientes").select("*", { count: "exact", head: true }).in("telefone", TELS);
  ok(restos === 0, "limpeza: nada do teste ficou no banco");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
await encerrarTestes();
process.exit(falhas === 0 ? 0 : 1);
