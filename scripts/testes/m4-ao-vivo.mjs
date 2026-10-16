// Teste da M4 (agenda ao vivo por LISTEN/NOTIFY + SSE, decisão 47): container do branch em
// 127.0.0.1:3002. Abre /api/ao-vivo como um navegador (EventSource) e confere que mudanças
// em agendamentos/OS chegam na hora e as outras não. Cria e remove o próprio usuário.
// Uso: node scripts/testes/m4-ao-vivo.mjs
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
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const sufixo = randomBytes(4).toString("hex");
const SENHA = `Senha-${sufixo}`;
let usuarioId = null;

// Lê o fluxo SSE e guarda os eventos recebidos.
function abrirEventos(token) {
  const controle = new AbortController();
  const eventos = [];
  const pronto = fetch(`${BASE}/api/ao-vivo`, {
    headers: { cookie: `barbearia_sessao=${token}`, accept: "text/event-stream" },
    signal: controle.signal,
  }).then(async (r) => {
    const leitor = r.body.getReader();
    const decodificador = new TextDecoder();
    let resto = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await leitor.read();
          if (done) break;
          resto += decodificador.decode(value, { stream: true });
          let fim;
          while ((fim = resto.indexOf("\n\n")) >= 0) {
            const bloco = resto.slice(0, fim);
            resto = resto.slice(fim + 2);
            const nome = bloco.match(/^event: (.+)$/m)?.[1];
            if (nome) eventos.push(nome);
          }
        }
      } catch {
        // abortado
      }
    })();
    return r;
  });
  return { eventos, pronto, fechar: () => controle.abort() };
}

async function esperarEvento(eventos, nome, desde, ms = 3000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (eventos.slice(desde).includes(nome)) return true;
    await esperar(50);
  }
  return false;
}

try {
  let r = await fetch(`${BASE}/api/ao-vivo`);
  ok(r.status === 401, "sem login não recebe eventos", String(r.status));

  const [u] = await sistema(
    (tx) => tx`
      insert into auth.users (email, encrypted_password, raw_user_meta_data)
      values (${`m4-${sufixo}@teste.local`}, extensions.crypt(${SENHA}, extensions.gen_salt('bf', 10)), ${sql.json({ nome: "M4" })})
      returning id, email`
  );
  usuarioId = u.id;
  const html = await (await fetch(`${BASE}/login`)).text();
  const form = new FormData();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) {
    form.append(m[1], (m[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  form.append("email", u.email);
  form.append("password", SENHA);
  r = await fetch(`${BASE}/login`, { method: "POST", body: form, redirect: "manual", headers: { origin: BASE } });
  const token = r.headers.getSetCookie().find((c) => c.startsWith("barbearia_sessao="))?.match(/^barbearia_sessao=([^;]*)/)?.[1];

  const a = abrirEventos(token);
  const b = abrirEventos(token); // duas telas abertas ao mesmo tempo
  const resposta = await a.pronto;
  await b.pronto;
  ok(resposta.headers.get("content-type")?.startsWith("text/event-stream"), "rota responde como fluxo de eventos");
  ok(await esperarEvento(a.eventos, "pronto", 0), "evento \"pronto\" quando a escuta do banco está ativa");

  const [ag] = await sistema((tx) => tx`select id from public.agendamentos limit 1`);
  const [os] = await sistema((tx) => tx`select id from public.ordens_servico limit 1`);

  let desde = a.eventos.length;
  let desdeB = b.eventos.length;
  await sistema((tx) => tx`update public.agendamentos set observacao = observacao where id = ${ag.id}`);
  ok(await esperarEvento(a.eventos, "mudou", desde), "mudança em agendamento chega na hora");
  ok(await esperarEvento(b.eventos, "mudou", desdeB), "chega também na segunda tela aberta");

  desde = a.eventos.length;
  await sistema((tx) => tx`update public.ordens_servico set motivo_cancelamento = motivo_cancelamento where id = ${os.id}`);
  ok(await esperarEvento(a.eventos, "mudou", desde), "mudança em OS chega na hora");

  desde = a.eventos.length;
  await sistema((tx) => tx`update public.servicos set nome = nome where id = (select id from public.servicos limit 1)`);
  ok(!(await esperarEvento(a.eventos, "mudou", desde, 1500)), "mudança em serviço não gera aviso");

  const chegou = a.eventos.slice(-1)[0];
  ok(!a.eventos.some((e) => !["pronto", "mudou"].includes(e)), "só eventos esperados", a.eventos.join(","));
  void chegou;

  // Fechar uma tela não derruba a outra.
  a.fechar();
  await esperar(300);
  desdeB = b.eventos.length;
  await sistema((tx) => tx`update public.agendamentos set observacao = observacao where id = ${ag.id}`);
  ok(await esperarEvento(b.eventos, "mudou", desdeB), "fechar uma tela não afeta a outra");
  b.fechar();

  // A tela usa o novo "Ao vivo" (não o Supabase).
  const pagina = await (await fetch(`${BASE}/painel/agenda`, { headers: { cookie: `barbearia_sessao=${token}` } })).text();
  ok(pagina.includes("Atualizando a cada 30s") || pagina.includes("Ao vivo"), "agenda mostra o indicador ao vivo");
} catch (err) {
  falhas++;
  console.log("FALHOU  erro inesperado:", err.message);
} finally {
  if (usuarioId) await sistema((tx) => tx`delete from auth.users where id = ${usuarioId}`);
  // Tentativas de login registradas durante o teste (as de senha errada de propósito): o IP
  // visto pelo app é o da rede do Docker, igual para todas, então apaga pelo horário.
  await sistema((tx) => tx`delete from auth.tentativas_login where em >= ${INICIO_TESTE}`);
  await sql.end();
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou.");
process.exit(falhas ? 1 : 0);
