// Teste da Fase 3 (agenda + clientes no painel) contra o container de dev.
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
  return { status: r.status, html: r.status === 200 ? await r.text() : "" };
}

function hojeSP() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function somarDias(data, n) {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
const instante = (data, hora) => new Date(`${data}T${hora}:00-03:00`).toISOString();

let ipSeq = 100;
async function agendarPeloSite(pedido) {
  const r = await fetch(`${BASE}/api/agendamento/confirmar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": `10.1.0.${ipSeq++}` },
    body: JSON.stringify(pedido),
  });
  return { status: r.status, corpo: await r.json() };
}
async function horariosSite(servicos, data, barbeiro) {
  const r = await fetch(`${BASE}/api/agendamento/horarios?servicos=${servicos.join(",")}&data=${data}&barbeiro=${barbeiro}`);
  return (await r.json()).horarios ?? [];
}
// Só o agendamento ATIVO no horário (um cancelado no mesmo horário não conta).
const idPorHorario = async (barbeiroId, data, hora) =>
  (
    await service.from("agendamentos").select("id").eq("barbeiro_id", barbeiroId).eq("inicio", instante(data, hora))
      .not("status", "in", "(cancelado,nao_compareceu)").single()
  ).data?.id;

const DIA = somarDias(hojeSP(), 2);
const sufixo = Date.now();
const tel = (p) => `11${p}${String(sufixo).slice(-7)}`;
const TELS = [tel("91"), tel("92"), tel("93"), tel("94"), tel("95")];
const criado = { servicos: [], barbeiro: null };

const { data: estOriginal } = await service.from("estabelecimento").select("*").single();
const { data: funcOriginal } = await service.from("horarios_funcionamento").select("dia_semana, inicio, fim");
const { data: adminProfile } = await service.from("profiles").select("id").eq("email", ADMIN_EMAIL).single();
const A = adminProfile.id;
const { data: jornadaAdminOriginal } = await service.from("jornadas").select("dia_semana, inicio, fim").eq("profile_id", A);
const { data: servAdminOriginal } = await service.from("barbeiro_servicos").select("servico_id").eq("profile_id", A);
let canais = [];

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
  const senhaB = randomBytes(12).toString("base64url");
  const emailB = `barbeiro.fase3.${sufixo}@example.com`;
  const { data: userB } = await service.auth.admin.createUser({ email: emailB, password: senhaB, email_confirm: true, user_metadata: { nome: "Joao Teste" } });
  const B = userB.user.id;
  criado.barbeiro = B;
  await service.from("jornadas").delete().in("profile_id", [A, B]);
  await service.from("jornadas").insert([...dias.map((d) => ({ profile_id: A, dia_semana: d, inicio: "09:00", fim: "19:00" })), ...dias.map((d) => ({ profile_id: B, dia_semana: d, inicio: "09:00", fim: "19:00" }))]);
  await service.from("barbeiro_servicos").delete().in("profile_id", [A, B]);
  await service.from("barbeiro_servicos").insert([A, B].flatMap((p) => [{ profile_id: p, servico_id: CORTE }, { profile_id: p, servico_id: BARBA }]));

  const admin = await sessao(ADMIN_EMAIL, ADMIN_SENHA);
  const barb = await sessao(emailB, senhaB);

  // ---------------- Ao vivo: escuta antes de agendar ----------------
  // Banco próprio (decisão 47, M4): /api/ao-vivo avisa "mudou" sem mandar dado; quem decide
  // o que cada um vê é a recarga, que passa pela RLS (conferido logo abaixo).
  const eventos = { admin: [], barbeiro: [] };
  const conexao = {};
  const escutar = async (cookie, chave) => {
    const controle = new AbortController();
    canais.push(controle);
    const r = await fetch(`${BASE}/api/ao-vivo`, { headers: { cookie }, signal: controle.signal });
    conexao[chave] = String(r.status);
    const leitor = r.body.getReader();
    const decodificador = new TextDecoder();
    await new Promise((resolve) => {
      let resto = "";
      (async () => {
        try {
          for (;;) {
            const { value, done } = await leitor.read();
            if (done) break;
            resto += decodificador.decode(value, { stream: true });
            let fim;
            while ((fim = resto.indexOf("\n\n")) >= 0) {
              const nome = resto.slice(0, fim).match(/^event: (.+)$/m)?.[1];
              resto = resto.slice(fim + 2);
              if (nome === "pronto") resolve();
              if (nome === "mudou") eventos[chave].push(nome);
            }
          }
        } catch {
          // encerrado no fim do teste
        }
      })();
      setTimeout(resolve, 10_000);
    });
  };
  await escutar(admin.cookie, "admin");
  await escutar(barb.cookie, "barbeiro");

  // ---------------- Agendamentos pelo site ----------------
  const s1 = await agendarPeloSite({ servicos: [CORTE], data: DIA, barbeiro: A, hora: "10:00", nome: "Cliente do Admin", telefone: TELS[0] });
  const s2 = await agendarPeloSite({ servicos: [CORTE, BARBA], data: DIA, barbeiro: B, hora: "10:00", nome: "Cliente do Joao", telefone: TELS[1] });
  ok(s1.status === 200 && s2.status === 200, "cenário: 1 agendamento do admin e 1 do barbeiro, pelo site");
  const AG_A = await idPorHorario(A, DIA, "10:00");
  const AG_B = await idPorHorario(B, DIA, "10:00");

  await new Promise((r) => setTimeout(r, 4000));
  const { data: recargaAdmin } = await admin.sb.from("agenda_equipe").select("id, pode_ver_detalhes").in("id", [AG_A, AG_B]);
  ok(eventos.admin.length > 0 && recargaAdmin?.length === 2 && recargaAdmin.every((x) => x.pode_ver_detalhes),
    "TEMPO REAL: admin recebe o aviso na hora e, ao recarregar, vê os agendamentos feitos pelo site", `${eventos.admin.length} avisos, conexão ${conexao.admin}`);
  const { data: recargaBarb } = await barb.sb.from("agenda_equipe").select("id, pode_ver_detalhes").in("id", [AG_A, AG_B]);
  ok(eventos.barbeiro.length > 0 &&
    recargaBarb?.find((x) => x.id === AG_B)?.pode_ver_detalhes === true &&
    recargaBarb?.find((x) => x.id === AG_A)?.pode_ver_detalhes === false,
    "TEMPO REAL: barbeiro recebe o aviso e, ao recarregar, vê só os detalhes dos dele (RLS)");

  // ---------------- Visão de equipe ----------------
  const { data: vistoB } = await barb.sb.from("agenda_equipe").select("id, pode_ver_detalhes, cliente_nome, valor_total, servicos").in("id", [AG_A, AG_B]);
  const outro = vistoB.find((x) => x.id === AG_A);
  const meu = vistoB.find((x) => x.id === AG_B);
  ok(vistoB.length === 2, "barbeiro vê a ocupação dos colegas na agenda");
  ok(outro && outro.cliente_nome === null && outro.valor_total === null && outro.pode_ver_detalhes === false && outro.servicos.startsWith("Corte"),
    "agendamento do colega: cliente e valor ocultos, serviço visível");
  ok(meu && meu.cliente_nome === "Cliente do Joao" && Number(meu.valor_total) === 70, "próprio agendamento: tudo visível");
  const { data: vistoAnon, error: errAnon } = await anon.from("agenda_equipe").select("id");
  ok(!!errAnon || (vistoAnon ?? []).length === 0, "visitante NÃO acessa a agenda da equipe", errAnon?.message);
  const { data: resumoAnon, error: errResAnon } = await anon.from("clientes_resumo").select("cliente_id");
  ok(!!errResAnon || (resumoAnon ?? []).length === 0, "visitante NÃO acessa o resumo de clientes");

  // ---------------- Páginas ----------------
  const diaAdmin = await pagina(`/painel/agenda?data=${DIA}`, admin.cookie);
  ok(diaAdmin.status === 200 && diaAdmin.html.includes("Cliente do Admin") && diaAdmin.html.includes("Cliente do Joao"), "agenda do dia (admin) mostra os dois clientes");
  const diaB = await pagina(`/painel/agenda?data=${DIA}`, barb.cookie);
  ok(diaB.html.includes("Cliente do Joao") && !diaB.html.includes("Cliente do Admin") && diaB.html.includes("Horário ocupado"),
    "agenda do dia (barbeiro): o colega aparece como 'Horário ocupado'");
  ok((await pagina(`/painel/agenda?visao=semana&data=${DIA}`, admin.cookie)).html.includes("Cliente do Admin"), "visão semana");
  const mes = await pagina(`/painel/agenda?visao=mes&data=${DIA}`, admin.cookie);
  ok(mes.status === 200 && mes.html.includes("agend."), "visão mês com contagem por dia");
  const filtroB = await pagina(`/painel/agenda?data=${DIA}&barbeiro=${B}`, admin.cookie);
  ok(filtroB.html.includes("Cliente do Joao") && !filtroB.html.includes("Cliente do Admin"), "filtro por barbeiro");
  const filtroBarba = await pagina(`/painel/agenda?data=${DIA}&servico=${BARBA}`, admin.cookie);
  ok(filtroBarba.html.includes("Cliente do Joao") && !filtroBarba.html.includes("Cliente do Admin"), "filtro por serviço");
  ok((await pagina(`/painel/agenda/${AG_A}`, barb.cookie)).status === 404, "barbeiro NÃO abre o detalhe do agendamento do colega");
  const det = await pagina(`/painel/agenda/${AG_A}`, admin.cookie);
  ok(det.status === 200 && det.html.includes("começa sozinho") && det.html.includes("Reagendar") && !det.html.includes("Cliente chegou"),
    "detalhe: aviso do início automático e 'Reagendar' (sem confirmar/chegou — decisão 48)");
  ok((await pagina(`/painel/agenda/novo`, barb.cookie)).status === 200, "tela de novo agendamento abre");

  // ---------------- Status ----------------
  const st = (cli, id, novo, motivo = null) => cli.rpc("alterar_status_agendamento", { p_id: id, p_novo: novo, p_motivo: motivo });
  ok((await st(barb.sb, AG_B, "confirmado")).error?.message === "TRANSICAO_INVALIDA", "'confirmado' não existe mais (decisão 48)");
  ok((await st(barb.sb, AG_B, "chegou")).error?.message === "TRANSICAO_INVALIDA", "'cliente chegou' não existe mais (decisão 48)");
  const semPerm = await st(barb.sb, AG_A, "cancelado");
  ok(semPerm.error?.message === "SEM_PERMISSAO", "barbeiro NÃO mexe no agendamento do colega");
  ok((await st(barb.sb, AG_B, "concluido")).error?.message === "TRANSICAO_INVALIDA", "pular para 'concluído' é recusado (vem com a OS)");
  const { data: direto } = await admin.sb.from("agendamentos").update({ status: "concluido" }).eq("id", AG_A).select();
  const { data: aposDireto } = await service.from("agendamentos").select("status").eq("id", AG_A).single();
  ok((direto ?? []).length === 0 && aposDireto.status === "agendado", "nem o admin altera agendamento 'por fora' das funções");

  ok(!(await st(admin.sb, AG_A, "cancelado", "Cliente desmarcou")).error, "admin cancela com motivo");
  const { data: cancelado } = await service.from("agendamentos").select("status, motivo_cancelamento").eq("id", AG_A).single();
  ok(cancelado.status === "cancelado" && cancelado.motivo_cancelamento === "Cliente desmarcou", "motivo do cancelamento salvo");
  ok((await horariosSite([CORTE], DIA, A)).includes("10:00"), "cancelar libera o horário no site");
  const ocupa = await agendarPeloSite({ servicos: [CORTE], data: DIA, barbeiro: A, hora: "10:00", nome: "Pegou a Vaga", telefone: TELS[2] });
  ok(ocupa.status === 200, "outro cliente agenda no horário liberado");
  const reabre = await st(admin.sb, AG_A, "agendado");
  ok(reabre.error?.code === "23P01", "reabrir o cancelado é recusado se o horário já foi ocupado", reabre.error?.code);
  const AG_VAGA = await idPorHorario(A, DIA, "10:00");
  ok(!(await st(admin.sb, AG_VAGA, "nao_compareceu")).error, "não compareceu");
  ok((await horariosSite([CORTE], DIA, A)).includes("10:00"), "'não compareceu' também libera o horário");

  // ---------------- Reagendar ----------------
  const re = (cli, id, data, hora, barbeiro = null) =>
    cli.rpc("reagendar_agendamento", { p_id: id, p_novo_inicio: instante(data, hora), p_novo_barbeiro_id: barbeiro });
  ok(!(await re(barb.sb, AG_B, DIA, "15:00")).error, "barbeiro reagenda o próprio agendamento");
  const { data: movido } = await service.from("agendamentos").select("inicio, fim").eq("id", AG_B).single();
  ok(new Date(movido.inicio).toISOString() === instante(DIA, "15:00") && new Date(movido.fim).toISOString() === instante(DIA, "16:00"),
    "reagendado para 15:00–16:00 (duração mantida)");
  ok((await re(barb.sb, AG_B, DIA, "15:00", A)).error?.message === "SEM_PERMISSAO", "barbeiro NÃO passa o cliente para outro barbeiro");
  const s3 = await agendarPeloSite({ servicos: [CORTE], data: DIA, barbeiro: A, hora: "15:00", nome: "Terceiro", telefone: TELS[3] });
  ok(s3.status === 200, "admin tem cliente às 15:00");
  const conflito = await re(admin.sb, AG_B, DIA, "15:00", A);
  ok(conflito.error?.code === "23P01", "reagendar para horário ocupado é recusado", conflito.error?.code);
  ok(!(await re(admin.sb, AG_B, DIA, "17:00", A)).error, "admin passa o agendamento para outro barbeiro");

  // ---------------- Encaixe pelo painel ----------------
  const encaixe = (cli, args) => cli.rpc("criar_agendamento_painel", {
    p_cliente_id: null, p_cliente_nome: "", p_cliente_telefone: "", p_barbeiro_id: B, p_inicio: instante(DIA, "12:00"),
    p_servico_ids: [CORTE], p_observacao: null, ...args,
  });
  const e1 = await encaixe(admin.sb, { p_cliente_nome: "Balcao Novo", p_cliente_telefone: TELS[4], p_observacao: "Chegou sem marcar" });
  ok(!e1.error && e1.data, "admin encaixa cliente novo para o barbeiro", e1.error?.message);
  const { data: cliBalcao } = await service.from("clientes").select("origem, criado_por").eq("telefone", TELS[4]).single();
  ok(cliBalcao.origem === "painel" && cliBalcao.criado_por === A, "cliente do balcão: origem painel, criado por quem agendou");
  const { data: agBalcao } = await service.from("agendamentos").select("origem, observacao, criado_por").eq("id", e1.data).single();
  ok(agBalcao.origem === "painel" && agBalcao.observacao === "Chegou sem marcar" && agBalcao.criado_por === A, "agendamento do painel com observação");
  const { data: cliExistente } = await service.from("clientes").select("id").eq("telefone", TELS[0]).single();
  const e2 = await encaixe(barb.sb, { p_cliente_id: cliExistente.id, p_inicio: instante(DIA, "22:00") });
  ok(!e2.error, "barbeiro encaixa cliente já cadastrado fora da jornada (22:00)", e2.error?.message);
  ok((await encaixe(barb.sb, { p_cliente_id: cliExistente.id, p_barbeiro_id: A, p_inicio: instante(DIA, "13:00") })).error?.message === "SEM_PERMISSAO",
    "barbeiro NÃO agenda para outro barbeiro");
  ok((await encaixe(admin.sb, { p_cliente_id: cliExistente.id, p_inicio: instante(DIA, "12:15") })).error?.code === "23P01",
    "encaixe sobreposto é recusado");
  const anonEnc = await anon.rpc("criar_agendamento_painel", {
    p_cliente_id: cliExistente.id, p_cliente_nome: "", p_cliente_telefone: "", p_barbeiro_id: B,
    p_inicio: instante(DIA, "08:00"), p_servico_ids: [CORTE], p_observacao: null,
  });
  ok(!!anonEnc.error, "visitante NÃO chama o encaixe");

  // ---------------- Clientes: resumo e histórico ----------------
  await service.from("agendamentos").update({ status: "concluido" }).eq("id", e2.data);
  const { data: res } = await admin.sb.from("clientes_resumo").select("*").eq("cliente_id", cliExistente.id).single();
  ok(Number(res.quantidade_atendimentos) === 1 && res.ultimo_atendimento, "resumo: 1 atendimento concluído e data do último");
  const lista = await pagina(`/painel/clientes?q=${TELS[0]}`, admin.cookie);
  ok(lista.html.includes("Cliente do Admin") && lista.html.includes("Último atendimento"), "lista de clientes com último atendimento");
  const ficha = await pagina(`/painel/clientes/${cliExistente.id}`, admin.cookie);
  ok(ficha.html.includes("Histórico") && ficha.html.includes("Cancelado") && ficha.html.includes("Concluído"),
    "ficha do cliente mostra o histórico com status");
  const fichaB = await pagina(`/painel/clientes/${cliExistente.id}`, barb.cookie);
  ok(fichaB.html.includes("Concluído") && !fichaB.html.includes("Cancelado"), "barbeiro vê no histórico só os atendimentos dele com o cliente");
} catch (e) {
  falhas++;
  console.log("ERRO no teste:", e.message);
} finally {
  await service.from("profiles").update({ atende_como_barbeiro: atendeAdmin.atende_como_barbeiro }).eq("id", atendeAdmin.id);
  for (const controle of canais) controle.abort();
  const { data: clis } = await service.from("clientes").select("id").in("telefone", TELS);
  const ids = (clis ?? []).map((c) => c.id);
  if (ids.length) {
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
  const { count: ag } = await service.from("agendamentos").select("*", { count: "exact", head: true });
  const { count: cl } = await service.from("clientes").select("*", { count: "exact", head: true });
  console.log(`\nLimpeza feita (agendamentos: ${ag}, clientes: ${cl}).`);
  console.log(falhas === 0 ? "RESULTADO: tudo passou." : `RESULTADO: ${falhas} falha(s).`);
  await encerrarTestes();
  process.exit(falhas === 0 ? 0 : 1);
}
