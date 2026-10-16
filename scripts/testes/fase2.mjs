// Teste de ponta a ponta da Fase 2 (site + agendamento online) contra o container de dev.
// Rodar da raiz do projeto, com o container no ar. Variáveis:
//   TESTE_BASE_URL (padrão http://127.0.0.1:3002), TESTE_ADMIN_EMAIL (padrão admin de dev),
//   TESTE_ADMIN_SENHA (opcional — sem ela, o teste usa um admin temporário).
// Monta um cenário próprio (horários, 2 barbeiros, 3 serviços, feriado), percorre o fluxo
// pela API exatamente como o site faz, e desfaz tudo no final.
import { randomBytes } from "node:crypto";
// Banco próprio (decisão 47 — M5): cliente no estilo do Supabase em cima do Postgres.
import { BASE, service, anon, sessao as sessaoApp, adminDoTeste, encerrarTestes } from "./_banco.mjs";
// Admin de dev (TESTE_ADMIN_EMAIL/TESTE_ADMIN_SENHA) ou um admin temporário.
const { email: ADMIN_EMAIL, senha: ADMIN_SENHA } = await adminDoTeste();
// Neste teste a sessão só é usada para o banco (sem páginas): devolve o cliente.
const sessao = async (email, senha) => (await sessaoApp(email, senha)).sb;



let falhas = 0;
function ok(cond, descricao, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}



// Datas no fuso de São Paulo (mesma regra do app).
function hojeSP() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function somarDias(data, n) {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
const instante = (data, hora) => new Date(`${data}T${hora}:00-03:00`).toISOString();

// Cada grupo de testes usa um IP próprio, pra o limite anti-abuso de um não afetar o outro.
let ipSeq = 1;
const novoIp = () => `10.0.0.${ipSeq++}`;

async function api(caminho, ip = novoIp()) {
  const r = await fetch(BASE + caminho, { headers: { "X-Real-IP": ip } });
  return { status: r.status, corpo: await r.json() };
}
async function confirmar(pedido, ip = novoIp()) {
  const r = await fetch(`${BASE}/api/agendamento/confirmar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": ip },
    body: JSON.stringify(pedido),
  });
  return { status: r.status, corpo: await r.json() };
}

const HOJE = hojeSP();
const DIA = somarDias(HOJE, 2); // longe o bastante da antecedência mínima
const DIA_FERIADO = somarDias(HOJE, 3);
const sufixo = Date.now();
const TELS = {
  a: `1198${String(sufixo).slice(-7)}`,
  b: `1197${String(sufixo).slice(-7)}`,
  c: `1196${String(sufixo).slice(-7)}`,
  d: `1195${String(sufixo).slice(-7)}`,
};

const criado = { servicos: [], barbeiro: null, bloqueios: [], telefones: Object.values(TELS) };
const { data: estOriginal } = await service.from("estabelecimento").select("*").single();
const { data: funcOriginal } = await service.from("horarios_funcionamento").select("dia_semana, inicio, fim");
const { data: adminProfile } = await service.from("profiles").select("id, nome").eq("email", ADMIN_EMAIL).single();
const { data: jornadaAdminOriginal } = await service.from("jornadas").select("dia_semana, inicio, fim").eq("profile_id", adminProfile.id);
const { data: servAdminOriginal } = await service.from("barbeiro_servicos").select("servico_id").eq("profile_id", adminProfile.id);

// O admin atende durante o teste (os dados de exemplo — scripts/dados-exemplo.mjs — podem
// deixá-lo como "não atende"); a configuração original volta no final.
const { data: atendeAdmin } = await service.from("profiles").select("id, atende_como_barbeiro").eq("email", ADMIN_EMAIL).single();
await service.from("profiles").update({ atende_como_barbeiro: true }).eq("id", atendeAdmin.id);

try {
  // ---------------- Cenário ----------------
  await service.from("estabelecimento").update({
    nome: "Barbearia Teste Fase2", antecedencia_minima_minutos: 60, janela_agendamento_dias: 14,
    granularidade_minutos: 15, politica_cancelamento: "Cancele com 2h de antecedência.",
  }).eq("id", 1);
  const todosOsDias = [0, 1, 2, 3, 4, 5, 6];
  await service.from("horarios_funcionamento").delete().not("id", "is", null);
  await service.from("horarios_funcionamento").insert(todosOsDias.flatMap((d) => [
    { dia_semana: d, inicio: "09:00", fim: "12:00" },
    { dia_semana: d, inicio: "13:00", fim: "19:00" },
  ]));

  const mk = async (nome, preco, dur, ordem) => {
    const { data } = await service.from("servicos").insert({ nome: `${nome} ${sufixo}`, preco, duracao_minutos: dur, ordem }).select("id").single();
    criado.servicos.push(data.id);
    return data.id;
  };
  const CORTE = await mk("Corte", 40, 30, 1);
  const BARBA = await mk("Barba", 30, 30, 2);
  const SOBRANCELHA = await mk("Sobrancelha", 15, 15, 3);

  const senhaB = randomBytes(12).toString("base64url");
  const { data: userB } = await service.auth.admin.createUser({
    email: `barbeiro.fase2.${sufixo}@example.com`, password: senhaB, email_confirm: true, user_metadata: { nome: "Rafael Teste" },
  });
  const B = userB.user.id;
  criado.barbeiro = B;
  const A = adminProfile.id;

  await service.from("jornadas").delete().in("profile_id", [A, B]);
  await service.from("jornadas").insert([
    ...todosOsDias.map((d) => ({ profile_id: A, dia_semana: d, inicio: "09:00", fim: "19:00" })),
    ...todosOsDias.map((d) => ({ profile_id: B, dia_semana: d, inicio: "13:00", fim: "21:00" })),
  ]);
  await service.from("barbeiro_servicos").delete().in("profile_id", [A, B]);
  await service.from("barbeiro_servicos").insert([
    { profile_id: A, servico_id: CORTE }, { profile_id: A, servico_id: BARBA },
    { profile_id: B, servico_id: CORTE }, { profile_id: B, servico_id: BARBA }, { profile_id: B, servico_id: SOBRANCELHA },
  ]);
  const { data: fer } = await service.from("bloqueios").insert({
    tipo: "feriado", inicio: instante(DIA_FERIADO, "00:00"), fim: instante(somarDias(DIA_FERIADO, 1), "00:00"), criado_por: A,
  }).select("id").single();
  criado.bloqueios.push(fer.id);

  // ---------------- Site público ----------------
  const site = await (await fetch(BASE + "/")).text();
  ok(site.includes("Barbearia Teste Fase2") && site.includes(`Corte ${sufixo}`) && site.includes("R$"),
    "site mostra nome, serviços e preços");
  ok(/>(Aberto|Fechado)</.test(site) && site.includes("09:00–12:00 · 13:00–19:00"), "site mostra status de funcionamento e horário com intervalo");
  ok(site.includes("Cancele com 2h de antecedência."), "site mostra a regra de cancelamento");
  ok((await fetch(`${BASE}/agendar?servico=${CORTE}`)).status === 200, "endereço antigo /agendar continua abrindo (redireciona)");

  // ---------------- Passo DATA ----------------
  const qs = (ids) => `servicos=${ids.join(",")}`;
  const datas = await api(`/api/agendamento/datas?${qs([CORTE, BARBA])}`);
  ok(datas.status === 200 && datas.corpo.datas.length === 15, "datas: janela de hoje + 14 dias", `${datas.corpo.datas?.length}`);
  ok(datas.corpo.valorTotal === 70 && datas.corpo.duracaoTotal === 60, "total e duração calculados (R$70, 60min)");
  const porData = Object.fromEntries(datas.corpo.datas.map((d) => [d.data, d.disponivel]));
  ok(porData[DIA] === true, "dia comum disponível");
  ok(porData[DIA_FERIADO] === false, "feriado indisponível");
  ok((await api(`/api/agendamento/datas?servicos=`)).status === 400, "sem serviço → erro 400");

  // ---------------- Passo BARBEIRO ----------------
  const barbCB = await api(`/api/agendamento/barbeiros?${qs([CORTE, BARBA])}&data=${DIA}`);
  const nomes = barbCB.corpo.barbeiros.map((b) => b.id);
  ok(nomes.includes(A) && nomes.includes(B), "Corte+Barba: os dois barbeiros aparecem");
  const barbCS = await api(`/api/agendamento/barbeiros?${qs([CORTE, SOBRANCELHA])}&data=${DIA}`);
  ok(barbCS.corpo.barbeiros.length === 1 && barbCS.corpo.barbeiros[0].id === B, "Corte+Sobrancelha: só quem faz os dois (Rafael)");
  ok(!JSON.stringify(barbCB.corpo).includes("email"), "API de barbeiros não expõe email");
  ok((await api(`/api/agendamento/barbeiros?${qs([CORTE])}&data=${somarDias(HOJE, 30)}`)).status === 400, "data fora da janela → 400");

  // ---------------- Passo HORÁRIO ----------------
  const hA = (await api(`/api/agendamento/horarios?${qs([CORTE, BARBA])}&data=${DIA}&barbeiro=${A}`)).corpo.horarios;
  ok(hA[0] === "09:00" && hA.includes("11:00") && !hA.includes("11:15") && hA.includes("13:00") && hA.at(-1) === "18:00",
    "admin (09–19), 60min: 09:00…11:00, pula almoço, 13:00…18:00", `${hA[0]}…${hA.at(-1)}`);
  const hB = (await api(`/api/agendamento/horarios?${qs([CORTE, BARBA])}&data=${DIA}&barbeiro=${B}`)).corpo.horarios;
  ok(hB[0] === "13:00" && hB.at(-1) === "18:00", "Rafael (13–21) limitado ao fechamento da barbearia (19:00)", `${hB[0]}…${hB.at(-1)}`);
  const hAsobr = await api(`/api/agendamento/horarios?${qs([CORTE, SOBRANCELHA])}&data=${DIA}&barbeiro=${A}`);
  ok(hAsobr.status === 400, "barbeiro que não faz o serviço → 400");

  // ---------------- CONFIRMAR ----------------
  // Telefone digitado com máscara, como o cliente faria — o app guarda só os dígitos.
  const comMascara = `(${TELS.a.slice(0, 2)}) ${TELS.a.slice(2, 7)}-${TELS.a.slice(7)}`;
  const pedido = { servicos: [CORTE, BARBA], data: DIA, barbeiro: A, hora: "14:00", nome: "Cliente Site Teste", telefone: comMascara };
  const c1 = await confirmar(pedido);
  ok(c1.status === 200 && c1.corpo.agendamento?.horaFim === "15:00" && c1.corpo.agendamento?.valorTotal === 70,
    "confirma Corte+Barba 14:00–15:00, R$70", `${c1.status} ${JSON.stringify(c1.corpo).slice(0, 120)}`);

  const { data: cli } = await service.from("clientes").select("id, nome, origem, criado_por").eq("telefone", TELS.a).single();
  ok(cli?.origem === "site" && cli.criado_por === null, "cliente salvo automaticamente, origem site");
  const { data: ag } = await service.from("agendamentos")
    .select("id, status, origem, valor_total, duracao_total_minutos, inicio, fim, agendamento_servicos(nome, preco, ordem)")
    .eq("cliente_id", cli.id).single();
  ok(ag.status === "agendado" && ag.origem === "site" && Number(ag.valor_total) === 70 && ag.duracao_total_minutos === 60,
    "agendamento gravado: status agendado, R$70, 60min");
  ok(new Date(ag.inicio).toISOString() === instante(DIA, "14:00") && new Date(ag.fim).toISOString() === instante(DIA, "15:00"),
    "horário gravado no instante certo (fuso de São Paulo)");
  ok(ag.agendamento_servicos.length === 2 && ag.agendamento_servicos.some((s) => s.nome.startsWith("Corte") && Number(s.preco) === 40),
    "serviços do agendamento com cópia de nome e preço");

  // Horário reservado some das opções, respeitando a duração
  const hA2 = (await api(`/api/agendamento/horarios?${qs([CORTE, BARBA])}&data=${DIA}&barbeiro=${A}`)).corpo.horarios;
  ok(hA2.includes("13:00") && !hA2.includes("13:15") && !hA2.includes("14:00") && !hA2.includes("14:45") && hA2.includes("15:00"),
    "após reservar 14:00–15:00: 13:00 ok, 13:15–14:45 fora, 15:00 ok");
  const hB2 = (await api(`/api/agendamento/horarios?${qs([CORTE, BARBA])}&data=${DIA}&barbeiro=${B}`)).corpo.horarios;
  ok(hB2.includes("14:00"), "agenda de um barbeiro não bloqueia a do outro");

  // Mesmo horário de novo → 409
  const c2 = await confirmar({ ...pedido, telefone: TELS.b, nome: "Outro Cliente" });
  ok(c2.status === 409 && c2.corpo.horarioIndisponivel === true, "mesmo horário de novo → 409 'não está mais disponível'");

  // Corrida: dois clientes confirmando o mesmo horário ao mesmo tempo
  const [r1, r2] = await Promise.all([
    confirmar({ ...pedido, hora: "16:00", telefone: TELS.b, nome: "Corrida Um" }),
    confirmar({ ...pedido, hora: "16:00", telefone: TELS.c, nome: "Corrida Dois" }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  ok(statuses[0] === 200 && statuses[1] === 409, "corrida no mesmo horário: exatamente um confirma", statuses.join(","));
  const { count: nas16 } = await service.from("agendamentos").select("*", { count: "exact", head: true })
    .eq("barbeiro_id", A).eq("inicio", instante(DIA, "16:00"));
  ok(nas16 === 1, "banco tem só 1 agendamento às 16:00");

  // A corrida falhava de vez em quando (deadlock → 500): repete várias vezes num dia livre.
  const DIA_CORRIDA = somarDias(HOJE, 5);
  const rodadas = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
  const resultados = await Promise.all(rodadas.map(async (hora, i) => {
    const tels = [`1194${String(sufixo + i).slice(-7)}`, `1193${String(sufixo + i).slice(-7)}`];
    criado.telefones.push(...tels);
    const rs = await Promise.all(tels.map((telefone, j) =>
      confirmar({ ...pedido, data: DIA_CORRIDA, hora, telefone, nome: `Corrida ${i}-${j}` })));
    return rs.map((r) => r.status).sort().join(",");
  }));
  const ruins = resultados.filter((s) => s !== "200,409");
  ok(ruins.length === 0, `corrida repetida ${rodadas.length}x (todas ao mesmo tempo): sempre um 200 e um 409, nunca 500`, ruins.join(" | "));
  const { count: naCorrida } = await service.from("agendamentos").select("*", { count: "exact", head: true })
    .eq("barbeiro_id", A).gte("inicio", instante(DIA_CORRIDA, "00:00")).lt("inicio", instante(somarDias(DIA_CORRIDA, 1), "00:00"));
  ok(naCorrida === rodadas.length, "banco tem 1 agendamento por horário disputado", String(naCorrida));

  // Mesmo telefone: reaproveita cliente, sem renomear
  const c3 = await confirmar({ ...pedido, hora: "09:00", nome: "Nome Diferente" });
  const { data: clis } = await service.from("clientes").select("nome").eq("telefone", TELS.a);
  ok(c3.status === 200 && clis.length === 1 && clis[0].nome === "Cliente Site Teste", "telefone já cadastrado: não duplica nem renomeia");

  // Limite de 3 agendamentos ativos por telefone
  const c4 = await confirmar({ ...pedido, hora: "10:00" });
  const c5 = await confirmar({ ...pedido, hora: "11:00" });
  ok(c4.status === 200 && c5.status === 400 && /agendamentos em aberto/.test(c5.corpo.erro), "4º agendamento ativo do mesmo telefone é barrado",
    `${c4.status},${c5.status}`);

  // Tentativas de fraude / dados inválidos
  const f1 = await confirmar({ ...pedido, telefone: TELS.d, hora: "12:15" });
  ok(f1.status === 409, "horário no almoço (fora da lista) → recusado");
  const f2 = await confirmar({ ...pedido, telefone: TELS.d, servicos: [CORTE, SOBRANCELHA], hora: "17:00" });
  ok(f2.status === 400, "serviço que o barbeiro não faz → recusado");
  const f3 = await confirmar({ ...pedido, telefone: "123", hora: "17:00" });
  ok(f3.status === 400 && /Telefone/.test(f3.corpo.erro), "telefone inválido → recusado");
  const f4 = await confirmar({ ...pedido, telefone: TELS.d, data: DIA_FERIADO, hora: "10:00" });
  ok(f4.status === 409, "feriado → recusado");
  const f5 = await confirmar({ ...pedido, telefone: TELS.d, servicos: ["00000000-0000-0000-0000-000000000000"], hora: "17:00" });
  ok(f5.status === 400, "serviço inexistente → recusado");
  const f6 = await fetch(`${BASE}/api/agendamento/confirmar`, { method: "POST", headers: { "X-Real-IP": novoIp() }, body: "não é json" });
  ok(f6.status === 400, "corpo inválido → 400");

  // Segurança no banco
  const rpcAnon = await anon.rpc("criar_agendamento", {
    p_cliente_nome: "Hacker", p_cliente_telefone: TELS.d, p_barbeiro_id: A, p_inicio: instante(DIA, "03:00"),
    p_servico_ids: [CORTE], p_origem: "site",
  });
  ok(!!rpcAnon.error, "visitante NÃO chama criar_agendamento direto (pularia a disponibilidade)", rpcAnon.error?.message);
  const { data: agAnon } = await anon.from("agendamentos").select("id");
  ok((agAnon ?? []).length === 0, "visitante NÃO lê agendamentos");
  const sbB = await sessao(`barbeiro.fase2.${sufixo}@example.com`, senhaB);
  const { data: agB } = await sbB.from("agendamentos").select("barbeiro_id");
  ok((agB ?? []).every((x) => x.barbeiro_id === B), "barbeiro só lê os próprios agendamentos");
  const sbA = await sessao(ADMIN_EMAIL, ADMIN_SENHA);
  const { data: agA } = await sbA.from("agendamentos").select("id").eq("barbeiro_id", A);
  ok((agA ?? []).length >= 4, "admin lê os agendamentos (base da agenda da Fase 3)", `${agA?.length}`);

  // Limite por IP (anti-abuso)
  const ip = novoIp();
  let bloqueado = false;
  for (let i = 0; i < 12; i++) {
    const r = await confirmar({ ...pedido, telefone: TELS.d, hora: "23:59" }, ip);
    if (r.status === 429) bloqueado = true;
  }
  ok(bloqueado, "muitas tentativas do mesmo IP → 429");
  const outroIp = await confirmar({ ...pedido, telefone: TELS.d, hora: "23:59" }, novoIp());
  ok(outroIp.status !== 429, "outro IP segue normal");
} catch (e) {
  falhas++;
  console.log("ERRO no teste:", e.message);
} finally {
  await service.from("profiles").update({ atende_como_barbeiro: atendeAdmin.atende_como_barbeiro }).eq("id", atendeAdmin.id);
  // ---------------- Limpeza ----------------
  const { data: clis } = await service.from("clientes").select("id").in("telefone", criado.telefones);
  const ids = (clis ?? []).map((c) => c.id);
  if (ids.length) {
    await service.from("agendamentos").delete().in("cliente_id", ids);
    await service.from("clientes").delete().in("id", ids);
  }
  if (criado.bloqueios.length) await service.from("bloqueios").delete().in("id", criado.bloqueios);
  await service.from("jornadas").delete().eq("profile_id", adminProfile.id);
  if (jornadaAdminOriginal?.length) await service.from("jornadas").insert(jornadaAdminOriginal.map((j) => ({ ...j, profile_id: adminProfile.id })));
  await service.from("barbeiro_servicos").delete().eq("profile_id", adminProfile.id);
  if (servAdminOriginal?.length) await service.from("barbeiro_servicos").insert(servAdminOriginal.map((s) => ({ ...s, profile_id: adminProfile.id })));
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
}
await encerrarTestes();
