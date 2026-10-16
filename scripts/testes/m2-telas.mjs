// Teste da M2 (camada de dados no banco próprio, decisão 47): container do branch em
// 127.0.0.1:3002. Entra como admin e como barbeiro (usuários temporários), abre todas as
// telas do painel, confere o que cada um enxerga (RLS) e faz um agendamento completo pelo
// site → OS → pagamento → conclusão → Financeiro. Cria e remove os próprios dados.
// Uso: node scripts/testes/m2-telas.mjs
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.TESTE_BASE_URL || "http://127.0.0.1:3002";
const env = { ...process.env };
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim();
}

const INICIO_TESTE = new Date().toISOString(); // limpeza das tentativas de login
let falhas = 0;
function ok(cond, descricao, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}

const sql = postgres(env.DATABASE_URL, { onnotice: () => {} });
const sistema = (fn) =>
  sql.begin(async (tx) => {
    await tx.unsafe("set local role service_role");
    return fn(tx);
  });
const como = (id, fn) =>
  sql.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claim.sub', ${id}, true)`;
    return fn(tx);
  });

const sufixo = randomBytes(4).toString("hex");
const SENHA = `Senha-${sufixo}`;
const usuarios = [];
const telefoneCliente = `5199${String(Date.now()).slice(-7)}`;

async function criarUsuario(nome, papel) {
  const [u] = await sistema(
    (tx) => tx`
      insert into auth.users (email, encrypted_password, raw_user_meta_data)
      values (${`m2-${papel}-${sufixo}@teste.local`}, extensions.crypt(${SENHA}, extensions.gen_salt('bf', 10)), ${sql.json({ nome })})
      returning id, email`
  );
  await sistema((tx) => tx`update public.profiles set role = ${papel === "admin" ? "admin" : "colaborador"}, atende_como_barbeiro = true where id = ${u.id}`);
  usuarios.push(u.id);
  return u;
}

async function entrar(email) {
  const html = await (await fetch(`${BASE}/login`)).text();
  const form = new FormData();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) {
    form.append(m[1], (m[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  form.append("email", email);
  form.append("password", SENHA);
  const r = await fetch(`${BASE}/login`, { method: "POST", body: form, redirect: "manual", headers: { origin: BASE } });
  const token = r.headers.getSetCookie().find((c) => c.startsWith("barbearia_sessao="))?.match(/^barbearia_sessao=([^;]*)/)?.[1];
  if (!token) throw new Error(`login de ${email} falhou (${r.status})`);
  return token;
}

async function pagina(caminho, token) {
  const r = await fetch(BASE + caminho, { headers: token ? { cookie: `barbearia_sessao=${token}` } : {}, redirect: "manual" });
  return { status: r.status, destino: r.headers.get("location"), html: r.status === 200 ? await r.text() : "" };
}
const semErro = (html) => !/Não foi possível carregar|Application error|permission denied/i.test(html);

try {
  const admin = await criarUsuario("Admin M2", "admin");
  const barbeiro = await criarUsuario("Barbeiro M2", "colaborador");
  const tokenAdmin = await entrar(admin.email);
  const tokenBarbeiro = await entrar(barbeiro.email);

  // Serviço temporário feito pelo barbeiro temporário, com jornada e funcionamento reais.
  const [servico] = await como(
    admin.id,
    (tx) => tx`insert into public.servicos (nome, preco, duracao_minutos) values (${`Corte M2 ${sufixo}`}, 80, 30) returning id`
  );
  await como(admin.id, (tx) => tx`select public.definir_servicos_barbeiro(${barbeiro.id}, array[${servico.id}]::uuid[])`);
  const funcionamento = await sistema((tx) => tx`select dia_semana, inicio::text, fim::text from public.horarios_funcionamento`);
  await como(
    admin.id,
    (tx) => tx`select public.substituir_jornada(${barbeiro.id}, ${sql.json(funcionamento.map((f) => ({ dia_semana: f.dia_semana, inicio: f.inicio.slice(0, 5), fim: f.fim.slice(0, 5) })))})`
  );

  // --- site público ---
  let p = await pagina("/");
  ok(p.status === 200 && p.html.includes(`Corte M2 ${sufixo}`), "site lista o serviço novo", String(p.status));

  const datas = await (await fetch(`${BASE}/api/agendamento/datas?servicos=${servico.id}`)).json();
  const dia = datas.datas?.find((d) => d.disponivel)?.data;
  ok(Boolean(dia), "API de datas devolve dia disponível", dia);
  const barbeiros = await (await fetch(`${BASE}/api/agendamento/barbeiros?servicos=${servico.id}&data=${dia}`)).json();
  const opcao = barbeiros.barbeiros?.find((b) => b.id === barbeiro.id);
  ok(opcao?.horarios > 0, "API de barbeiros devolve o barbeiro com horários", String(opcao?.horarios));
  const horarios = await (await fetch(`${BASE}/api/agendamento/horarios?servicos=${servico.id}&data=${dia}&barbeiro=${barbeiro.id}`)).json();
  const hora = horarios.horarios?.[0];
  ok(Boolean(hora), "API de horários devolve horário livre", hora);

  let r = await fetch(`${BASE}/api/agendamento/confirmar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ servicos: [servico.id], data: dia, barbeiro: barbeiro.id, hora, nome: "Cliente M2", telefone: telefoneCliente }),
  });
  let corpo = await r.json();
  ok(r.status === 200 && corpo.agendamento?.valorTotal === 80, "agendamento pelo site confirmado", `${r.status} ${corpo.erro ?? ""}`);
  r = await fetch(`${BASE}/api/agendamento/confirmar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ servicos: [servico.id], data: dia, barbeiro: barbeiro.id, hora, nome: "Outro M2", telefone: `${telefoneCliente.slice(0, -1)}9` }),
  });
  corpo = await r.json();
  ok(r.status === 409 && corpo.horarioIndisponivel, "mesmo horário de novo é recusado", String(r.status));

  const [ag] = await sistema(
    (tx) => tx`select a.id, a.cliente_id from public.agendamentos a join public.clientes c on c.id = a.cliente_id where c.telefone like ${"%" + telefoneCliente.slice(-8)}`
  );
  ok(Boolean(ag), "agendamento gravado no banco");

  // --- OS pelo banco, como o usuário (mesmas funções que as telas chamam) ---
  const [os] = await como(barbeiro.id, (tx) => tx`select public.iniciar_atendimento(${ag.id}::uuid) as id`);
  await como(barbeiro.id, (tx) => tx`select public.aplicar_desconto_os(${os.id}::uuid, 'percentual', 10, 'fidelidade', null)`);
  await como(
    barbeiro.id,
    (tx) => tx`select public.registrar_pagamentos(${os.id}::uuid, ${sql.json([{ forma: "dinheiro", valor: 40 }, { forma: "pix", valor: 32 }])})`
  );
  await como(barbeiro.id, (tx) => tx`select public.concluir_atendimento(${os.id}::uuid)`);
  const [osFinal] = await sistema((tx) => tx`select numero, total, total_pago, status_pagamento, status from public.ordens_servico where id = ${os.id}`);
  ok(Number(osFinal.total) === 72 && osFinal.status_pagamento === "pago" && osFinal.status === "concluida", "OS: R$ 80 − 10% = R$ 72, paga e concluída");

  // --- telas do admin ---
  const telasAdmin = [
    "/painel",
    "/painel/agenda",
    "/painel/agenda?visao=semana",
    "/painel/agenda?visao=mes",
    `/painel/agenda?data=${dia}`,
    `/painel/agenda/${ag.id}`,
    "/painel/agenda/novo",
    "/painel/atendimentos",
    `/painel/atendimentos/${os.id}`,
    "/painel/clientes",
    "/painel/clientes?q=Cliente%20M2",
    `/painel/clientes/${ag.cliente_id}`,
    "/painel/financeiro",
    `/painel/financeiro?periodo=personalizado&de=${dia}&ate=${dia}`,
    "/painel/configuracoes",
    "/painel/configuracoes/barbearia",
    "/painel/configuracoes/equipe",
    `/painel/configuracoes/equipe/${barbeiro.id}`,
    "/painel/configuracoes/horarios",
    "/painel/configuracoes/mensagens",
    "/painel/configuracoes/servicos",
    `/painel/configuracoes/servicos/${servico.id}`,
  ];
  for (const t of telasAdmin) {
    p = await pagina(t, tokenAdmin);
    ok(p.status === 200 && semErro(p.html), `admin abre ${t}`, String(p.status));
  }
  p = await pagina(`/painel/agenda?data=${dia}`, tokenAdmin);
  ok(p.html.includes("Cliente M2"), "agenda do dia mostra o cliente do site");
  p = await pagina(`/painel/atendimentos/${os.id}`, tokenAdmin);
  // O pagamento foi registrado pelo barbeiro; o nome dele aparece na lista de pagamentos.
  ok(p.html.includes("72,00") && p.html.includes("Barbeiro M2"), "OS mostra total e quem registrou o pagamento");
  p = await pagina(`/painel/clientes/${ag.cliente_id}`, tokenAdmin);
  ok(p.html.includes(`OS ${String(osFinal.numero).padStart(6, "0")}`) || p.html.includes(String(osFinal.numero).padStart(6, "0")), "ficha do cliente mostra o número da OS");
  // Financeiro conta pelo dia em que o atendimento aconteceu (a OS foi iniciada hoje).
  const [{ hoje }] = await sistema((tx) => tx`select (now() at time zone 'America/Sao_Paulo')::date::text as hoje`);
  p = await pagina(`/painel/financeiro?periodo=personalizado&de=${hoje}&ate=${hoje}`, tokenAdmin);
  ok(p.html.includes("72,00"), "Financeiro de hoje mostra os R$ 72,00");

  // Aba "OS" (desktop e celular) e busca por nome/telefone na lista de OS (2026-09-26).
  const numeroOS = String(osFinal.numero).padStart(6, "0");
  p = await pagina("/painel/atendimentos", tokenAdmin);
  ok(/>OS<\/a>|>OS<\/span>/.test(p.html) && !p.html.includes(">Atendimentos<"), "aba chama \"OS\" (sem \"Atendimentos\")");
  const listaOS = (q) => pagina(`/painel/atendimentos?status=todas&q=${encodeURIComponent(q)}`, tokenAdmin);
  p = await listaOS("cliente m2");
  ok(p.html.includes(numeroOS), "busca de OS por parte do nome (sem diferenciar maiúsculas)");
  const tel = telefoneCliente;
  p = await listaOS(`(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`);
  ok(p.html.includes(numeroOS), "busca de OS pelo telefone com máscara");
  p = await listaOS(tel.slice(-5));
  ok(p.html.includes(numeroOS), "busca de OS por pedaço do telefone");
  p = await listaOS("clíênte m2");
  ok(p.html.includes(numeroOS), "busca de OS ignora acentos (\"clíênte\" acha \"Cliente\")");
  p = await pagina(`/painel/clientes?q=${encodeURIComponent("clíênte m2")}`, tokenAdmin);
  ok(p.html.includes("Cliente M2"), "busca de clientes ignora acentos");
  p = await listaOS(`Ninguem ${Date.now()}`);
  ok(!p.html.includes(numeroOS) && p.html.includes("Nenhuma OS no período para"), "busca sem resultado mostra o aviso");
  p = await listaOS("100%_");
  ok(p.status === 200 && !p.html.includes(numeroOS), "curingas do LIKE na busca não quebram nem casam tudo");
  p = await pagina("/painel/agenda/id-invalido", tokenAdmin);
  ok(p.status === 404, "id malformado na URL dá 404, não erro", String(p.status));

  // --- barbeiro: telas dele sim, de admin não ---
  for (const t of ["/painel", "/painel/agenda", `/painel/agenda/${ag.id}`, "/painel/atendimentos", `/painel/atendimentos/${os.id}`, "/painel/clientes"]) {
    p = await pagina(t, tokenBarbeiro);
    ok(p.status === 200 && semErro(p.html), `barbeiro abre ${t}`, String(p.status));
  }
  for (const t of ["/painel/financeiro", "/painel/configuracoes/equipe", "/painel/configuracoes/servicos"]) {
    p = await pagina(t, tokenBarbeiro);
    ok(p.status === 307 && new URL(p.destino, BASE).pathname === "/painel", `barbeiro é barrado em ${t}`, `${p.status} ${p.destino}`);
  }

  // RLS: OS de outro barbeiro não aparece para o barbeiro temporário.
  const [outra] = await sistema((tx) => tx`select id from public.ordens_servico where barbeiro_id <> ${barbeiro.id} limit 1`);
  if (outra) {
    p = await pagina(`/painel/atendimentos/${outra.id}`, tokenBarbeiro);
    ok(p.status === 404, "barbeiro não abre a OS de um colega (RLS)", String(p.status));
  }
} catch (err) {
  falhas++;
  console.log("FALHOU  erro inesperado:", err.message);
} finally {
  // Limpeza: tudo que foi criado com o telefone e os usuários temporários. Como
  // superusuário (só ele desliga os gatilhos para apagar OS/pagamentos, que o app nunca apaga).
  const adminUrl = new URL(env.DATABASE_ADMIN_URL);
  adminUrl.pathname = new URL(env.DATABASE_URL).pathname;
  const superusuario = postgres(adminUrl.toString(), { onnotice: () => {} });
  await superusuario.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const clientes = await tx`select id from public.clientes where telefone like ${"%" + telefoneCliente.slice(-8)} or telefone like ${"%" + telefoneCliente.slice(-8, -1) + "9"}`;
    const ids = clientes.map((c) => c.id);
    if (ids.length) {
      const ags = (await tx`select id from public.agendamentos where cliente_id in ${tx(ids)}`).map((a) => a.id);
      if (ags.length) {
        const oss = (await tx`select id from public.ordens_servico where agendamento_id in ${tx(ags)}`).map((o) => o.id);
        if (oss.length) {
          await tx`delete from public.pagamentos where os_id in ${tx(oss)}`;
          await tx`delete from public.os_servicos where os_id in ${tx(oss)}`;
          await tx`delete from public.ordens_servico where id in ${tx(oss)}`;
        }
        await tx`delete from public.agendamento_servicos where agendamento_id in ${tx(ags)}`;
        await tx`delete from public.agendamentos where id in ${tx(ags)}`;
      }
      await tx`delete from public.clientes where id in ${tx(ids)}`;
    }
    await tx`delete from public.servicos where nome = ${`Corte M2 ${sufixo}`}`;
    if (usuarios.length) {
      await tx`delete from public.jornadas where profile_id in ${tx(usuarios)}`;
      await tx`delete from public.barbeiro_servicos where profile_id in ${tx(usuarios)}`;
      await tx`delete from public.profiles where id in ${tx(usuarios)}`;
      // Com os gatilhos desligados não há cascata: sessões apagadas à mão.
      await tx`delete from auth.sessoes where user_id in ${tx(usuarios)}`;
      await tx`delete from auth.users where id in ${tx(usuarios)}`;
    }
    // Tentativas de login registradas durante o teste (as de senha errada de propósito): o IP
    // visto pelo app é o da rede do Docker, igual para todas, então apaga pelo horário.
    await tx`delete from auth.tentativas_login where em >= ${INICIO_TESTE}`;
    // Número da OS (decisão 49): contador volta ao maior número que sobrou.
    await tx`update public.contador_os set ultimo = coalesce((select max(numero) from public.ordens_servico), 0)`;
  });
  await superusuario.end();
  await sql.end();
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou.");
process.exit(falhas ? 1 : 0);
