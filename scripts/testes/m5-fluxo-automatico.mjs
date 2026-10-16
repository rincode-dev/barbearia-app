// Fluxo automático do atendimento (decisão 48): Agendado → (no horário, sozinho) Em
// atendimento = OS aberta → Concluído; durante o atendimento só concluir, não compareceu
// ou reagendou; "Começar agora" para cliente adiantado; concluir cedo libera o horário. Rodar da raiz com o container no ar (TESTE_BASE_URL, padrão
// http://127.0.0.1:3002). Cria admin, 2 barbeiros, serviço e cliente temporários e
// apaga tudo no fim. Inclui ~1 min de espera para ver o relógio do servidor agir sozinho.
import { randomBytes } from "node:crypto";
import { BASE, service, sessao, encerrarTestes } from "./_banco.mjs";

let falhas = 0;
function ok(cond, descricao, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}
async function pagina(caminho, cookie) {
  const r = await fetch(BASE + caminho, { headers: { cookie }, redirect: "manual" });
  const html = r.status === 200 ? (await r.text()).replaceAll("<!-- -->", "") : "";
  return { status: r.status, html, location: r.headers.get("location") ?? "" };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const diaSP = (desloc) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + desloc * 86400000));
const instante = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`).toISOString();

const sufixo = Date.now();
const TEL = `119${String(sufixo).slice(-8)}`;
const criado = { usuarios: [], servicos: [] };

async function usuario(nome, admin) {
  const email = `m5.${nome.toLowerCase()}.${sufixo}@example.com`;
  const senha = randomBytes(12).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
  if (error) throw new Error(`criar ${email}: ${error.message}`);
  criado.usuarios.push(data.user.id);
  await service.from("profiles").update({ role: admin ? "admin" : "colaborador", atende_como_barbeiro: !admin, ativo: true }).eq("id", data.user.id);
  return { id: data.user.id, ...(await sessao(email, senha)) };
}
async function rpc(quem, fn, args) {
  const { data, error } = await quem.rpc(fn, args);
  return { data, erro: error?.message ?? null, codigo: error?.code ?? null };
}
const statusDe = async (id) => (await service.from("agendamentos").select("status, inicio").eq("id", id).single()).data;
const osDe = async (id) => (await service.from("ordens_servico").select("id, status, iniciada_em, criada_por").eq("agendamento_id", id).maybeSingle()).data;
// Leva o agendamento para "já começou" (o painel não deixa marcar no passado).
async function paraOPassado(id, minutos) {
  const inicio = new Date(Date.now() - minutos * 60000);
  inicio.setSeconds(0, 0);
  const { error } = await service.from("agendamentos").update({ inicio: inicio.toISOString(), fim: new Date(inicio.getTime() + 30 * 60000).toISOString() }).eq("id", id);
  if (error) throw new Error(`mover para o passado: ${error.message}`);
  return inicio.toISOString();
}

try {
  const adm = await usuario("Admin", true);
  const b = await usuario("Barbeiro", false);
  const outro = await usuario("Colega", false);
  const { data: serv } = await service.from("servicos").insert({ nome: `Corte M5 ${sufixo}`, preco: 50, duracao_minutos: 30 }).select("id").single();
  criado.servicos.push(serv.id);
  await service.from("barbeiro_servicos").insert([b.id, outro.id].map((p) => ({ profile_id: p, servico_id: serv.id })));

  const AMANHA = diaSP(1);
  const criar = async (hora, barbeiro = b.id) => {
    const r = await rpc(adm.sb, "criar_agendamento_painel", {
      p_cliente_id: null, p_cliente_nome: `Cliente M5 ${sufixo}`, p_cliente_telefone: TEL, p_barbeiro_id: barbeiro,
      p_inicio: instante(AMANHA, hora), p_servico_ids: [serv.id], p_observacao: null,
    });
    if (r.erro) throw new Error(`criar_agendamento_painel: ${r.erro}`);
    return r.data;
  };

  // ---------------- Status que deixaram de existir ----------------
  const ag = await criar("10:00");
  ok((await statusDe(ag)).status === "agendado", "novo agendamento começa como agendado");
  for (const velho of ["confirmado", "chegou"]) {
    ok((await rpc(b.sb, "alterar_status_agendamento", { p_id: ag, p_novo: velho })).erro === "TRANSICAO_INVALIDA", `'${velho}' é recusado`);
  }
  const { error: erroCheck } = await service.from("agendamentos").update({ status: "confirmado" }).eq("id", ag);
  ok(erroCheck?.code === "23514", "o banco não aceita mais 'confirmado' nem por fora", erroCheck?.code);

  // ---------------- Antes do horário nada muda ----------------
  await service.rpc("iniciar_atendimentos_do_horario");
  ok((await statusDe(ag)).status === "agendado" && !(await osDe(ag)), "antes do horário: continua agendado, sem OS");
  const det = await pagina(`/painel/agenda/${ag}`, b.cookie);
  ok(det.status === 200 && det.html.includes("começa sozinho") && !det.html.includes("Iniciar atendimento") && !det.html.includes("Confirmar</button>"),
    "tela do agendamento: aviso do início automático, sem confirmar/chegou/iniciar");
  ok((await rpc(b.sb, "iniciar_atendimentos_do_horario", {})).erro !== null, "barbeiro não chama a checagem direto (só o sistema)");

  // ---------------- No horário vira atendimento (OS) ----------------
  const inicio = await paraOPassado(ag, 5);
  const abertos = await service.rpc("iniciar_atendimentos_do_horario");
  let os = await osDe(ag);
  ok((await statusDe(ag)).status === "em_atendimento" && os?.status === "aberta" && abertos.data >= 1, "no horário: em atendimento com OS aberta");
  ok(os && new Date(os.iniciada_em).getTime() === new Date(inicio).getTime() && os.criada_por === null,
    "OS datada pelo horário marcado e aberta pelo sistema", os?.iniciada_em);
  const { data: itens } = await service.from("os_servicos").select("nome, origem").eq("os_id", os.id);
  ok(itens?.length === 1 && itens[0].origem === "agendado", "serviços agendados já na OS");
  ok((await service.rpc("iniciar_atendimentos_do_horario")).data === 0, "rodar de novo não abre outra OS");

  const vaiParaOS = await pagina(`/painel/agenda/${ag}`, b.cookie);
  ok(vaiParaOS.status === 307 && vaiParaOS.location.endsWith(`/painel/atendimentos/${os.id}`), "abrir o agendamento leva direto à OS", `${vaiParaOS.status} ${vaiParaOS.location}`);
  const telaOS = await pagina(`/painel/atendimentos/${os.id}`, b.cookie);
  ok(telaOS.status === 200 && ["Concluir atendimento", "Não compareceu", "Reagendou"].every((t) => telaOS.html.includes(t)) && !telaOS.html.includes("Cancelar atendimento"),
    "OS: só Concluir, Não compareceu e Reagendou");

  // ---------------- Não compareceu ----------------
  ok((await rpc(outro.sb, "alterar_status_agendamento", { p_id: ag, p_novo: "nao_compareceu" })).erro === "SEM_PERMISSAO", "colega não marca não compareceu");
  ok(!(await rpc(b.sb, "alterar_status_agendamento", { p_id: ag, p_novo: "nao_compareceu" })).erro, "barbeiro marca não compareceu");
  ok((await statusDe(ag)).status === "nao_compareceu" && !(await osDe(ag)), "não compareceu: OS sem uso é apagada");

  // Reabrir com o horário já passado: a próxima checagem abre a OS de novo.
  ok(!(await rpc(b.sb, "alterar_status_agendamento", { p_id: ag, p_novo: "agendado" })).erro, "reabrir agendamento");
  await pagina(`/painel/atendimentos`, b.cookie); // abrir uma tela também dispara a checagem
  os = await osDe(ag);
  ok((await statusDe(ag)).status === "em_atendimento" && os?.status === "aberta", "reaberto no passado: volta a ser atendimento ao abrir a tela");

  // Com pagamento ativo não dá; estornado, a OS fica cancelada (histórico do estorno).
  const pg = await rpc(b.sb, "registrar_pagamento", { p_os_id: os.id, p_forma: "dinheiro", p_valor: 20 });
  ok(!pg.erro, "pagamento registrado", pg.erro ?? "");
  ok((await rpc(b.sb, "alterar_status_agendamento", { p_id: ag, p_novo: "nao_compareceu" })).erro === "OS_COM_PAGAMENTO", "com pagamento ativo: não compareceu recusado");
  const { data: pgs } = await service.from("pagamentos").select("id").eq("os_id", os.id);
  await rpc(b.sb, "estornar_pagamento", { p_pagamento_id: pgs[0].id });
  ok(!(await rpc(b.sb, "alterar_status_agendamento", { p_id: ag, p_novo: "nao_compareceu" })).erro, "depois do estorno: não compareceu");
  ok((await osDe(ag))?.status === "cancelada", "OS com estorno fica cancelada (não é apagada)");

  // ---------------- Reagendou ----------------
  await rpc(b.sb, "alterar_status_agendamento", { p_id: ag, p_novo: "agendado" });
  await service.rpc("iniciar_atendimentos_do_horario");
  os = await osDe(ag);
  ok(os?.status === "aberta" && new Date(os.iniciada_em).getTime() === new Date(inicio).getTime(), "OS cancelada é reativada no horário (com a data do horário)");
  const novo = instante(AMANHA, "15:00");
  ok(!(await rpc(b.sb, "reagendar_agendamento", { p_id: ag, p_novo_inicio: novo, p_novo_barbeiro_id: null })).erro, "reagendou durante o atendimento");
  const depois = await statusDe(ag);
  ok(depois.status === "agendado" && new Date(depois.inicio).getTime() === new Date(novo).getTime(), "reagendou: volta a agendado no novo horário");
  ok((await osDe(ag))?.status === "cancelada", "reagendou: a OS sai do atendimento");
  await service.rpc("iniciar_atendimentos_do_horario");
  ok((await statusDe(ag)).status === "agendado", "novo horário no futuro: continua agendado");

  // Reagendou sem pagamento nenhum: OS apagada.
  const ag2 = await criar("11:00");
  await paraOPassado(ag2, 2);
  await service.rpc("iniciar_atendimentos_do_horario");
  ok((await statusDe(ag2)).status === "em_atendimento", "segundo agendamento em atendimento");
  ok(!(await rpc(adm.sb, "reagendar_agendamento", { p_id: ag2, p_novo_inicio: instante(AMANHA, "16:00"), p_novo_barbeiro_id: outro.id })).erro,
    "admin reagenda para outro barbeiro");
  ok((await statusDe(ag2)).status === "agendado" && !(await osDe(ag2)), "OS sem uso apagada ao reagendar");

  // ---------------- Concluir ----------------
  const ag3 = await criar("12:00");
  await paraOPassado(ag3, 1);
  await service.rpc("iniciar_atendimentos_do_horario");
  const os3 = await osDe(ag3);
  ok(!(await rpc(b.sb, "concluir_atendimento", { p_os_id: os3.id })).erro && (await statusDe(ag3)).status === "concluido", "concluir: agendamento concluído");
  ok((await rpc(b.sb, "alterar_status_agendamento", { p_id: ag3, p_novo: "nao_compareceu" })).erro === "TRANSICAO_INVALIDA", "concluído não vira não compareceu");

  // ---------------- Começar agora (cliente adiantado) ----------------
  // Barbeiro novo, sem nada marcado agora (o de b das 12:00 já foi para o passado).
  const c = await usuario("Adiantado", false);
  await service.from("barbeiro_servicos").insert({ profile_id: c.id, servico_id: serv.id });
  const agC = await criar("14:00", c.id);
  ok((await rpc(outro.sb, "comecar_agora", { p_agendamento_id: agC })).erro === "SEM_PERMISSAO", "colega não usa 'começar agora' no cliente dos outros");
  const antes = Date.now();
  const r = await rpc(c.sb, "comecar_agora", { p_agendamento_id: agC });
  const agCDepois = (await service.from("agendamentos").select("status, inicio, fim").eq("id", agC).single()).data;
  const minutoAgora = Math.floor(antes / 60000) * 60000;
  ok(!r.erro && agCDepois.status === "em_atendimento", "começar agora: vira atendimento na hora", r.erro ?? "");
  ok(Math.abs(new Date(agCDepois.inicio).getTime() - minutoAgora) <= 60000, "começar agora: início passa a ser agora (minuto cheio)", agCDepois.inicio);
  ok(new Date(agCDepois.fim).getTime() - new Date(agCDepois.inicio).getTime() === 30 * 60000, "fim recalculado pela duração dos serviços (30 min)");
  const osC = await osDe(agC);
  ok(osC?.status === "aberta" && osC.iniciada_em === agCDepois.inicio, "OS aberta com a data de agora");
  ok((await rpc(c.sb, "comecar_agora", { p_agendamento_id: agC })).erro === "TRANSICAO_INVALIDA", "começar agora de novo é recusado (já em atendimento)");

  // Outro cliente do mesmo barbeiro, adiantado enquanto o primeiro ainda está na cadeira.
  const agD = await criar("15:00", c.id);
  const choque = await rpc(c.sb, "comecar_agora", { p_agendamento_id: agD });
  ok(choque.codigo === "23P01" && (await statusDe(agD)).status === "agendado", "com outro atendimento no intervalo: recusado, nada muda", choque.codigo);

  // Concluir antes do fim previsto libera o resto do horário — aí o próximo pode começar.
  await rpc(c.sb, "concluir_atendimento", { p_os_id: osC.id });
  const agCFim = (await service.from("agendamentos").select("inicio, fim").eq("id", agC).single()).data;
  ok(new Date(agCFim.fim).getTime() === new Date(agCFim.inicio).getTime() + 5 * 60000 || new Date(agCFim.fim).getTime() <= Date.now(),
    "concluído antes do previsto: fim encurtado até a conclusão", `${agCFim.inicio} → ${agCFim.fim}`);
  // Mínimo de 5 min: o próximo "agora" pode esbarrar nesses 5 min; recua o concluído para testar.
  await service.from("agendamentos").update({ inicio: new Date(minutoAgora - 20 * 60000).toISOString(), fim: new Date(minutoAgora - 10 * 60000).toISOString() }).eq("id", agC);
  const liberado = await rpc(c.sb, "comecar_agora", { p_agendamento_id: agD });
  ok(!liberado.erro && (await statusDe(agD)).status === "em_atendimento", "depois de concluir, o próximo começa agora", liberado.erro ?? "");
  // Concluir tarde não estica o horário.
  const osD = await osDe(agD);
  const fimD = (await service.from("agendamentos").select("fim").eq("id", agD).single()).data.fim;
  await service.from("agendamentos").update({ inicio: new Date(minutoAgora - 90 * 60000).toISOString(), fim: new Date(minutoAgora - 60 * 60000).toISOString() }).eq("id", agD);
  await rpc(c.sb, "concluir_atendimento", { p_os_id: osD.id });
  ok((await service.from("agendamentos").select("fim").eq("id", agD).single()).data.fim === new Date(minutoAgora - 60 * 60000).toISOString(),
    "concluído depois do previsto: o fim não muda", fimD);

  // ---------------- O relógio do servidor, sem ninguém abrir tela ----------------
  const ag4 = await criar("13:00", outro.id); // o de b das 12:00 (concluído) ocupa este minuto
  await paraOPassado(ag4, 0);
  let virou = false;
  for (let i = 0; i < 16 && !virou; i++) {
    await esperar(5000);
    virou = (await statusDe(ag4)).status === "em_atendimento";
  }
  ok(virou, "relógio do servidor abre o atendimento sozinho (em até ~80 s)");
} catch (e) {
  falhas++;
  console.log("FALHOU  erro inesperado:", e.message);
} finally {
  const { data: clis } = await service.from("clientes").select("id").eq("telefone", TEL);
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
  for (const id of criado.usuarios) await service.auth.admin.deleteUser(id);
  const { count } = await service.from("clientes").select("*", { count: "exact", head: true }).eq("telefone", TEL);
  ok(count === 0, "limpeza: nada do teste ficou no banco");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
await encerrarTestes();
process.exit(falhas === 0 ? 0 : 1);
