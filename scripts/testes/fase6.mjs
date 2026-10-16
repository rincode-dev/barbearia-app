// Teste da Fase 6 — mensagens de WhatsApp — contra o container de dev.
// Rodar da raiz do projeto, com o container no ar. Variável opcional:
//   TESTE_BASE_URL (padrão http://127.0.0.1:3002).
// Não usa senha de ninguém: cria admin e barbeiro TEMPORÁRIOS (chave de serviço) e
// desfaz tudo no final (textos das mensagens e endereço da barbearia restaurados).
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
  const html = r.status === 200 ? (await r.text()).replaceAll("<!-- -->", "").replaceAll(" ", " ") : "";
  return { status: r.status, html };
}
// Links wa.me da página: [{ tipo, numero, texto }] na ordem em que aparecem.
function mensagens(html) {
  return [...html.matchAll(/<a href="https:\/\/wa\.me\/(\d+)\?text=([^"]*)"[^>]*data-mensagem="(\w+)"/g)].map((m) => ({
    numero: m[1],
    texto: decodeURIComponent(m[2].replaceAll("&amp;", "&")).replaceAll(" ", " "),
    tipo: m[3],
  }));
}
function hojeSP() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function somarDias(data, n) {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
const instante = (data, hora) => new Date(`${data}T${hora}:00-03:00`).toISOString();

const DIA = somarDias(hojeSP(), 1);
const DDMM = `${DIA.slice(8, 10)}/${DIA.slice(5, 7)}`;
const DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][new Date(`${DIA}T12:00:00Z`).getUTCDay()];
const sufixo = Date.now();
const TELS = [1, 2, 3, 4].map((i) => `119${i}${String(sufixo).slice(-7)}`);
const criado = { usuarios: [], servicos: [] };
const TIPOS = ["confirmar_agendamento", "lembrete", "agendamento_confirmado", "atendimento_concluido", "reagendamento", "cancelamento"];

const { data: textosOriginais } = await service.from("mensagens_templates").select("tipo, conteudo");
const { data: estOriginal } = await service.from("estabelecimento").select("nome, endereco").eq("id", 1).single();

async function usuario(nome, admin) {
  const email = `fase6.${nome.toLowerCase().replace(/\W/g, "")}.${sufixo}@example.com`;
  const senha = randomBytes(12).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
  if (error) throw new Error(`criar ${email}: ${error.message}`);
  criado.usuarios.push(data.user.id);
  await service.from("profiles").update({ role: admin ? "admin" : "colaborador", atende_como_barbeiro: !admin, ativo: true }).eq("id", data.user.id);
  return { id: data.user.id, ...(await sessao(email, senha)) };
}

try {
  // ---------------- Banco ----------------
  ok(textosOriginais?.length === 6 && TIPOS.every((t) => textosOriginais.some((x) => x.tipo === t)), "6 tipos de mensagem cadastrados");
  const { data: vAnon } = await anon.from("mensagens_templates").select("tipo");
  ok((vAnon ?? []).length === 0, "visitante não lê as mensagens");

  const adm = await usuario("AdminF6", true);
  const b = await usuario("Rafael Seis", false);
  const { data: vB } = await b.sb.from("mensagens_templates").select("tipo, conteudo");
  ok(vB?.length === 6, "barbeiro lê as mensagens (monta o WhatsApp)");
  await b.sb.from("mensagens_templates").update({ conteudo: "invadido" }).eq("tipo", "lembrete");
  const { data: lemb } = await service.from("mensagens_templates").select("conteudo").eq("tipo", "lembrete").single();
  ok(lemb.conteudo !== "invadido", "barbeiro NÃO altera texto");
  const { error: ePadrao } = await adm.sb.from("mensagens_templates").update({ conteudo_padrao: "x" }).eq("tipo", "lembrete");
  ok(!!ePadrao, "nem o admin altera o texto padrão", ePadrao?.message);
  const { error: eIns } = await adm.sb.from("mensagens_templates").insert({ tipo: "lembrete", conteudo: "x", conteudo_padrao: "x" });
  await adm.sb.from("mensagens_templates").delete().eq("tipo", "cancelamento");
  const { count: nTipos } = await service.from("mensagens_templates").select("*", { count: "exact", head: true });
  ok(!!eIns && nTipos === 6, "tipos fixos: sem criar nem apagar");
  const { error: eVazio } = await adm.sb.from("mensagens_templates").update({ conteudo: "   " }).eq("tipo", "lembrete");
  ok(!!eVazio, "texto vazio recusado pelo banco");

  // Texto personalizado com todas as variáveis.
  const PERSONALIZADO = "Oi {cliente}! {barbearia}: {data} às {hora} com {barbeiro} — {servicos} por {valor}. {endereco} {site}";
  const { error: eAdm } = await adm.sb.from("mensagens_templates").update({ conteudo: PERSONALIZADO }).eq("tipo", "confirmar_agendamento");
  ok(!eAdm, "admin altera o texto", eAdm?.message);

  // ---------------- Cenário ----------------
  await service.from("estabelecimento").update({ endereco: "Rua Teste, 60" }).eq("id", 1);
  const mk = async (nome, preco, dur) => {
    const { data } = await service.from("servicos").insert({ nome: `${nome} ${sufixo}`, preco, duracao_minutos: dur }).select("id").single();
    criado.servicos.push(data.id);
    return data.id;
  };
  const CORTE = await mk("Corte F6", 40, 30);
  const BARBA = await mk("Barba F6", 30, 30);
  await service.from("barbeiro_servicos").insert([CORTE, BARBA].map((s) => ({ profile_id: b.id, servico_id: s })));
  const agendar = async (hora, servicos, tel, nome) => {
    const { data, error } = await b.sb.rpc("criar_agendamento_painel", {
      p_cliente_id: null, p_cliente_nome: nome, p_cliente_telefone: tel,
      p_barbeiro_id: b.id, p_inicio: instante(DIA, hora), p_servico_ids: servicos,
    });
    if (error) throw new Error(`agendar ${hora}: ${error.message}`);
    return data;
  };
  const rpc = async (fn, args) => {
    const { data, error } = await b.sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
  const ag1 = await agendar("10:00", [CORTE, BARBA], TELS[0], "Carlos Alberto Souza");
  const ag2 = await agendar("11:00", [CORTE], TELS[1], "Diego Lima");
  const ag3 = await agendar("12:00", [CORTE], TELS[2], "Eduardo Reis");
  const ag4 = await agendar("13:00", [CORTE], TELS[3], "Fábio Nunes");

  // ---------------- Agendado: "Confirmar agendamento" sugerido, com o texto personalizado ----------------
  const p1 = await pagina(`/painel/agenda/${ag1}`, b.cookie);
  const m1 = mensagens(p1.html);
  ok(p1.status === 200 && m1.map((m) => m.tipo).join() === "confirmar_agendamento,agendamento_confirmado,lembrete,reagendamento,cancelamento",
    "agendado: Confirmar (sugerida), Agendamento confirmado, Lembrete, Reagendamento, Cancelamento", m1.map((m) => m.tipo).join());
  const esperado = `Oi Carlos! ${estOriginal.nome}: ${DIA_SEMANA}, ${DDMM} às 10:00 com Rafael Seis — Corte F6 ${sufixo} + Barba F6 ${sufixo} por R$ 70,00. Rua Teste, 60 http://127.0.0.1:3002`;
  ok(m1[0]?.texto === esperado, "variáveis preenchidas (1º nome, barbearia, dia, hora, barbeiro, serviços, valor, endereço, site)", m1[0]?.texto);
  ok(m1[0]?.numero === `55${TELS[0]}`, "número no formato do wa.me (55 + DDD + número)", m1[0]?.numero);
  const lembrete = m1.find((m) => m.tipo === "lembrete");
  ok(lembrete?.texto.includes("Rua Teste, 60") && lembrete?.texto.includes("Carlos") && !lembrete?.texto.includes("{"),
    "lembrete com o texto padrão preenchido");

  // ---------------- Outros status ----------------
  const m2 = mensagens((await pagina(`/painel/agenda/${ag2}`, b.cookie)).html);
  ok(m2.find((m) => m.tipo === "agendamento_confirmado")?.texto.includes("confirmado"), "agendado: 'Agendamento confirmado' oferecida");
  await rpc("alterar_status_agendamento", { p_id: ag3, p_novo: "cancelado", p_motivo: "teste" });
  const m3 = mensagens((await pagina(`/painel/agenda/${ag3}`, b.cookie)).html);
  ok(m3.length === 1 && m3[0].tipo === "cancelamento" && m3[0].texto.includes("cancelado") && m3[0].texto.includes("http://127.0.0.1:3002"),
    "cancelado: só 'Cancelamento', com o link do site");
  // ---------------- OS concluída ----------------
  const os = await rpc("iniciar_atendimento", { p_agendamento_id: ag4 });
  const emAtend = await fetch(`${BASE}/painel/agenda/${ag4}`, { headers: { cookie: b.cookie }, redirect: "manual" });
  ok(emAtend.status === 307 && (emAtend.headers.get("location") ?? "").endsWith(`/painel/atendimentos/${os}`),
    "em atendimento: abrir o agendamento leva direto à OS", `${emAtend.status} ${emAtend.headers.get("location")}`);
  ok(mensagens((await pagina(`/painel/atendimentos/${os}`, b.cookie)).html).length === 0, "OS aberta: sem mensagem ainda");
  await rpc("aplicar_desconto_os", { p_os_id: os, p_tipo: "fixo", p_valor: 5, p_motivo: "cortesia" });
  await rpc("concluir_atendimento", { p_os_id: os });
  await service.from("mensagens_templates").update({ conteudo: "Valeu {cliente}, total {valor}." }).eq("tipo", "atendimento_concluido");
  const mOS = mensagens((await pagina(`/painel/atendimentos/${os}`, b.cookie)).html);
  ok(mOS.length === 1 && mOS[0].tipo === "atendimento_concluido" && mOS[0].texto === "Valeu Fábio, total R$ 35,00.",
    "OS concluída: 'Atendimento concluído' com o total da OS (40 − 5)", mOS[0]?.texto);
  const mAg4 = mensagens((await pagina(`/painel/agenda/${ag4}`, b.cookie)).html);
  ok(mAg4[0]?.tipo === "atendimento_concluido", "agendamento concluído também oferece 'Atendimento concluído'");

  // ---------------- Dado não cadastrado some da mensagem ----------------
  await service.from("estabelecimento").update({ endereco: null }).eq("id", 1);
  const semEnd = mensagens((await pagina(`/painel/agenda/${ag1}`, b.cookie)).html);
  ok(semEnd[0] && !semEnd[0].texto.includes("{endereco}") && !semEnd[0].texto.includes("Rua Teste"),
    "sem endereço cadastrado: {endereco} some (cliente nunca recebe a variável crua)", semEnd[0]?.texto);

  // ---------------- Tela de Configurações → Mensagens ----------------
  const cfg = await pagina("/painel/configuracoes/mensagens", adm.cookie);
  ok(cfg.status === 200 && ["Confirmar agendamento", "Lembrete", "Agendamento confirmado", "Atendimento concluído", "Reagendamento", "Cancelamento", "{cliente}", "{site}", "Prévia"].every((t) => cfg.html.includes(t)),
    "Configurações → Mensagens: 6 textos, variáveis e prévia");
  ok(cfg.html.includes("Restaurar texto padrão") && cfg.html.includes("ainda não está cadastrado"),
    "texto alterado oferece 'Restaurar'; aviso de endereço não cadastrado");
  const cfgB = await pagina("/painel/configuracoes/mensagens", b.cookie);
  ok(cfgB.status !== 200, "barbeiro não abre Configurações → Mensagens", String(cfgB.status));
  const cfgIdx = await pagina("/painel/configuracoes", adm.cookie);
  ok(cfgIdx.html.includes('href="/painel/configuracoes/mensagens"'), "Configurações lista Mensagens com link");

  // ---------------- Revisão: contagem de barbeiros na lista de serviços ----------------
  const linhaCorte = (html) => html.slice(html.indexOf(`Corte F6 ${sufixo}`), html.indexOf(`Corte F6 ${sufixo}`) + 400);
  ok(linhaCorte((await pagina("/painel/configuracoes/servicos", adm.cookie)).html).includes("1 barbeiro(s)"), "serviços: '1 barbeiro(s)' com o barbeiro ativo");
  await service.from("profiles").update({ ativo: false }).eq("id", b.id);
  ok(linhaCorte((await pagina("/painel/configuracoes/servicos", adm.cookie)).html).includes("nenhum barbeiro realiza"),
    "serviços: barbeiro desativado não conta (antes contava — problema conhecido corrigido)");
} catch (e) {
  ok(false, "execução sem erro inesperado", e.message);
} finally {
  for (const t of textosOriginais ?? []) await service.from("mensagens_templates").update({ conteudo: t.conteudo }).eq("tipo", t.tipo);
  await service.from("estabelecimento").update({ endereco: estOriginal.endereco }).eq("id", 1);
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
  for (const id of criado.usuarios) await service.auth.admin.deleteUser(id);
  const { data: depois } = await service.from("mensagens_templates").select("tipo, conteudo");
  const { data: estDepois } = await service.from("estabelecimento").select("endereco").eq("id", 1).single();
  const iguais = (textosOriginais ?? []).every((t) => depois.find((d) => d.tipo === t.tipo)?.conteudo === t.conteudo);
  ok(iguais && estDepois.endereco === estOriginal.endereco, "limpeza: textos e endereço restaurados, dados do teste removidos");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
await encerrarTestes();
process.exit(falhas === 0 ? 0 : 1);
