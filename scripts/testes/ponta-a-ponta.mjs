// Teste de ponta a ponta do fluxo principal (requisitos do produto, item 27) contra o
// container de dev: cliente agenda pelo SITE → aparece na agenda → WhatsApp →
// no horário vira atendimento (OS) → serviço adicional → desconto → pagamento dividido → conclui
// → histórico do cliente → Atendimentos → Financeiro/Início.
// Reproduz o exemplo da especificação: serviços R$ 80, desconto 10% → R$ 72,
// pago R$ 40 dinheiro + R$ 32 Pix → "Pago".
// Rodar da raiz com o container no ar (TESTE_BASE_URL, padrão http://127.0.0.1:3002).
// Usa o horário de funcionamento JÁ cadastrado (não mexe na configuração); cria um
// admin e um barbeiro temporários e desfaz tudo no final.
import { randomBytes } from "node:crypto";
// Banco próprio (decisão 47 — M5): cliente no estilo do Supabase em cima do Postgres.
import { BASE, service, sessao, encerrarTestes } from "./_banco.mjs";



let falhas = 0;
function ok(cond, descricao, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}


async function pagina(caminho, cookie = "") {
  const r = await fetch(BASE + caminho, { headers: { cookie }, redirect: "manual" });
  const html = r.status === 200 ? (await r.text()).replaceAll("<!-- -->", "").replaceAll(" ", " ") : "";
  return { status: r.status, html };
}
async function api(caminho, corpo) {
  const r = await fetch(BASE + caminho, corpo
    ? { method: "POST", headers: { "Content-Type": "application/json", "X-Real-IP": "10.27.0.1" }, body: JSON.stringify(corpo) }
    : {});
  return { status: r.status, corpo: await r.json() };
}
const reais = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function hojeSP() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

const HOJE = hojeSP();
const sufixo = Date.now();
const TEL = `119${String(sufixo).slice(-8)}`;
const NOME_CLIENTE = `Marcos Ponta ${String(sufixo).slice(-4)}`;
const criado = { usuarios: [], servicos: [] };

async function usuario(nome, admin) {
  const email = `e2e.${nome.toLowerCase().replace(/\W/g, "")}.${sufixo}@example.com`;
  const senha = randomBytes(12).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
  if (error) throw new Error(`criar ${email}: ${error.message}`);
  criado.usuarios.push(data.user.id);
  await service.from("profiles").update({ role: admin ? "admin" : "colaborador", atende_como_barbeiro: !admin, ativo: true }).eq("id", data.user.id);
  return { id: data.user.id, ...(await sessao(email, senha)) };
}

try {
  // ---------------- Preparação (painel): serviços e barbeiro ----------------
  const adm = await usuario("AdminE2E", true);
  const b = await usuario("BarbeiroE2E", false);
  const mk = async (nome, preco, dur) => {
    const { data } = await service.from("servicos").insert({ nome: `${nome} ${sufixo}`, preco, duracao_minutos: dur }).select("id").single();
    criado.servicos.push(data.id);
    return data.id;
  };
  const CORTE = await mk("Corte E2E", 45, 30);
  const BARBA = await mk("Barba E2E", 35, 30);
  await service.from("barbeiro_servicos").insert([CORTE, BARBA].map((s) => ({ profile_id: b.id, servico_id: s })));
  // Jornada ampla: quem limita é o funcionamento já cadastrado da barbearia.
  await service.from("jornadas").insert([0, 1, 2, 3, 4, 5, 6].map((d) => ({ profile_id: b.id, dia_semana: d, inicio: "06:00", fim: "22:00" })));

  // Foto do serviço (decisão 41): só o caminho importa aqui, o arquivo não precisa existir.
  const FOTO = `servicos/e2e-${sufixo}.jpg`;
  await service.from("servicos").update({ foto_path: FOTO }).eq("id", CORTE);

  // ---------------- 1. Cliente agenda pelo site ----------------
  const site = await pagina("/");
  ok(site.status === 200 && site.html.includes(`Corte E2E ${sufixo}`), "site mostra o serviço novo");
  // Fotos agora saem da pasta do app (decisão 47, M3), não do Storage do Supabase.
  ok(site.html.includes(`/arquivos/publico/${FOTO}`), "site mostra a foto do serviço");
  const telaServico = await pagina(`/painel/configuracoes/servicos/${CORTE}`, adm.cookie);
  ok(telaServico.html.includes("Foto (opcional") && telaServico.html.includes(FOTO), "admin vê o campo de foto com a foto atual do serviço");
  ok(/>(Aberto|Fechado)</.test(site.html), "site mostra o status de funcionamento");
  const antigo = await fetch(`${BASE}/agendar?servico=${CORTE}`, { redirect: "manual" });
  ok(antigo.status === 307 && (antigo.headers.get("location") ?? "").includes(`/?servico=${CORTE}`),
    "/agendar antigo leva à página inicial com o serviço marcado", `${antigo.status} ${antigo.headers.get("location")}`);
  const datas = await api(`/api/agendamento/datas?servicos=${CORTE}`);
  const data = datas.corpo.datas?.find((d) => d.disponivel)?.data;
  ok(!!data, "site oferece pelo menos um dia com horário", data ?? "nenhum dia — cadastre o horário de funcionamento");
  if (!data) throw new Error("sem dia disponível");
  const barbeiros = await api(`/api/agendamento/barbeiros?servicos=${CORTE}&data=${data}`);
  ok(barbeiros.corpo.barbeiros?.some((x) => x.id === b.id), "barbeiro novo aparece para o serviço");
  // Ordem do site (decisão 45): o barbeiro novo (ordem padrão 100) vem depois dos que têm
  // ordem definida; e o próprio barbeiro não consegue se mover na fila.
  const ordens = (await service.from("profiles").select("id, ordem_site").in("id", barbeiros.corpo.barbeiros.map((x) => x.id))).data;
  const ordemDe = (id) => ordens.find((o) => o.id === id)?.ordem_site ?? 100;
  const naOrdem = barbeiros.corpo.barbeiros.every((x, i, l) => i === 0 || ordemDe(l[i - 1].id) <= ordemDe(x.id));
  ok(naOrdem, "barbeiros do site na ordem definida pelo admin", barbeiros.corpo.barbeiros.map((x) => `${x.nome}(${ordemDe(x.id)})`).join(", "));
  await b.sb.from("profiles").update({ ordem_site: 0 }).eq("id", b.id);
  ok(ordemDe(b.id) === 100 && (await service.from("profiles").select("ordem_site").eq("id", b.id).single()).data.ordem_site === 100,
    "barbeiro não muda a própria ordem no site");
  const horarios = (await api(`/api/agendamento/horarios?servicos=${CORTE}&data=${data}&barbeiro=${b.id}`)).corpo.horarios ?? [];
  const hora = horarios[0];
  ok(!!hora, "horários livres calculados", `${horarios.length} horários, primeiro ${hora}`);
  const conf = await api("/api/agendamento/confirmar", { servicos: [CORTE], data, barbeiro: b.id, hora, nome: NOME_CLIENTE, telefone: `(11) 9${TEL.slice(3, 7)}-${TEL.slice(7)}` });
  ok(conf.status === 200 && conf.corpo.agendamento?.valorTotal === 45, "cliente confirma pelo site (Corte R$ 45)", `${conf.status} ${conf.corpo.erro ?? ""}`);
  const horarios2 = (await api(`/api/agendamento/horarios?servicos=${CORTE}&data=${data}&barbeiro=${b.id}`)).corpo.horarios ?? [];
  ok(!horarios2.includes(hora), "o horário tomado some do site");

  // ---------------- 2. Aparece no painel ----------------
  const { data: ag } = await service.from("agendamentos").select("id, status, origem, cliente_id").eq("barbeiro_id", b.id).single();
  ok(ag?.status === "agendado" && ag.origem === "site", "agendamento gravado: agendado, origem site");
  const agenda = await pagina(`/painel/agenda?data=${data}`, b.cookie);
  ok(agenda.html.includes(NOME_CLIENTE) && agenda.html.includes(`/painel/agenda/${ag.id}`), "aparece na agenda do barbeiro");
  const agendaAdm = await pagina(`/painel/agenda?data=${data}&barbeiro=${b.id}`, adm.cookie);
  ok(agendaAdm.html.includes(NOME_CLIENTE), "aparece na agenda do admin");
  const detalhe = await pagina(`/painel/agenda/${ag.id}`, b.cookie);
  ok(/href="https:\/\/wa\.me\/55\d+\?text=[^"]+"[^>]*data-mensagem="confirmar_agendamento"/.test(detalhe.html), "botão WhatsApp 'Confirmar agendamento' pronto");

  // ---------------- 3. Status até o atendimento ----------------
  const rpc = async (quem, fn, args) => {
    const { data: r, error } = await quem.sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return r;
  };
  // O horário marcado é no futuro: a OS é aberta antes pelo banco (o fluxo automático
  // no horário tem teste próprio em m5-fluxo-automatico.mjs).
  const osId = await rpc(b, "iniciar_atendimento", { p_agendamento_id: ag.id });
  ok(!!osId, "agendado → em atendimento (OS criada)");

  // ---------------- 4. OS: adicional, desconto, pagamentos, conclusão ----------------
  await rpc(b, "adicionar_servico_os", { p_os_id: osId, p_servico_id: BARBA });
  await rpc(b, "aplicar_desconto_os", { p_os_id: osId, p_tipo: "percentual", p_valor: 10, p_motivo: "fidelidade" });
  let { data: os } = await service.from("ordens_servico").select("*").eq("id", osId).single();
  ok(Number(os.subtotal) === 80 && Number(os.total) === 72, "serviços R$ 80 (Corte + Barba adicional), 10% → total R$ 72");
  const telaAberta = await pagina(`/painel/atendimentos/${osId}`, b.cookie);
  ok(telaAberta.html.includes("+ Adicionar outra forma"), "tela da OS permite dividir o pagamento em várias formas");
  // Dividido de uma vez (decisão 45): somando acima do restante, nada é gravado.
  const { error: errAcima } = await b.sb.rpc("registrar_pagamentos", { p_os_id: osId, p_pagamentos: [{ forma: "dinheiro", valor: 40 }, { forma: "pix", valor: 40 }] });
  ({ data: os } = await service.from("ordens_servico").select("*").eq("id", osId).single());
  ok(!!errAcima && Number(os.total_pago) === 0, "R$ 40 + R$ 40 numa OS de R$ 72: recusado e nenhuma parte gravada", errAcima?.message);
  await rpc(b, "registrar_pagamentos", { p_os_id: osId, p_pagamentos: [{ forma: "dinheiro", valor: 40 }, { forma: "pix", valor: 32 }] });
  const { count: qtdPag } = await service.from("pagamentos").select("id", { count: "exact", head: true }).eq("os_id", osId);
  ok(qtdPag === 2, "R$ 40 dinheiro + R$ 32 Pix registrados de uma vez (2 pagamentos)");
  await rpc(b, "concluir_atendimento", { p_os_id: osId });
  ({ data: os } = await service.from("ordens_servico").select("*").eq("id", osId).single());
  const { data: agFim } = await service.from("agendamentos").select("status").eq("id", ag.id).single();
  ok(os.status === "concluida" && os.status_pagamento === "pago" && Number(os.total_pago) === 72 && agFim.status === "concluido",
    "dividido quita a OS → Pago; OS concluída e agendamento concluído");
  const telaOS = await pagina(`/painel/atendimentos/${osId}`, b.cookie);
  ok(telaOS.html.includes(`OS Nº ${String(os.numero).padStart(6, "0")}`) && telaOS.html.includes("Pago") && telaOS.html.includes('data-mensagem="atendimento_concluido"'),
    "tela da OS: número, 'Pago' e WhatsApp 'Atendimento concluído'");

  // ---------------- 5. Histórico, Atendimentos, Financeiro, Início ----------------
  const ficha = await pagina(`/painel/clientes/${ag.cliente_id}`, b.cookie);
  ok(ficha.html.includes(`OS ${String(os.numero).padStart(6, "0")}`), "histórico do cliente mostra o atendimento com a OS");
  ok(ficha.html.includes("Comportamento") && ficha.html.includes(reais(72)) && ficha.html.includes("1 concluído")
    && ficha.html.includes("Precisa de pelo menos 2 atendimentos") && ficha.html.includes("Atendido hoje"),
    "ficha: ticket médio R$ 72 (total da OS, com desconto), retorno ainda sem média, atendido hoje");
  const { data: resumo } = await b.sb.from("clientes_resumo").select("quantidade_atendimentos").eq("cliente_id", ag.cliente_id).single();
  ok(resumo?.quantidade_atendimentos === 1, "cliente com 1 atendimento");
  const lista = await pagina("/painel/atendimentos", b.cookie);
  ok(lista.html.includes(`/painel/atendimentos/${osId}`), "OS na aba Atendimentos");
  const fin = await pagina(`/painel/financeiro?periodo=hoje&barbeiro=${b.id}`, adm.cookie);
  ok(fin.html.includes(reais(72)) && fin.html.includes(reais(40)) && fin.html.includes(reais(32)) && fin.html.includes(reais(8)),
    "Financeiro de hoje: faturamento/recebido R$ 72, dinheiro R$ 40, Pix R$ 32, desconto R$ 8");
  const { data: rel } = await adm.sb.rpc("relatorio_financeiro", { p_de: HOJE, p_ate: HOJE, p_barbeiro: b.id });
  ok(rel.faturamento === 72 && rel.recebido === 72 && rel.pendente === 0 && rel.atendimentos === 1 && rel.servicos.length === 2,
    "números do relatório batem com a OS (72 faturado, 72 recebido, nada pendente, 2 serviços)");
  const inicio = await pagina("/painel", b.cookie);
  ok(inicio.html.includes(reais(72)), "Início do barbeiro reflete o atendimento");
} catch (e) {
  ok(false, "execução sem erro inesperado", e.message);
} finally {
  const { data: clis } = await service.from("clientes").select("id").eq("telefone", TEL);
  const ids = (clis ?? []).map((c) => c.id);
  if (ids.length) {
    await service.from("ordens_servico").delete().in("cliente_id", ids);
    await service.from("agendamentos").delete().in("cliente_id", ids);
    await service.from("clientes").delete().in("id", ids);
  }
  for (const id of criado.usuarios) await service.from("jornadas").delete().eq("profile_id", id);
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
