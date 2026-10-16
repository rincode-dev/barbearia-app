// Teste da M3 (fotos em disco, decisão 47): container do branch em 127.0.0.1:3002 com a
// pasta dados/arquivos montada. Leitura pública das fotos, envio só por admin, validação
// do formato pelos bytes, tamanho e destino. Cria e remove os próprios usuários/arquivos.
// Uso: node scripts/testes/m3-arquivos.mjs
import { existsSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.TESTE_BASE_URL || "http://127.0.0.1:3002";
const PASTA = "dados/arquivos/publico";
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

const sufixo = randomBytes(4).toString("hex");
const SENHA = `Senha-${sufixo}`;
const usuarios = [];
const enviados = [];

async function criarUsuario(papel) {
  const [u] = await sistema(
    (tx) => tx`
      insert into auth.users (email, encrypted_password, raw_user_meta_data)
      values (${`m3-${papel}-${sufixo}@teste.local`}, extensions.crypt(${SENHA}, extensions.gen_salt('bf', 10)), ${sql.json({ nome: `M3 ${papel}` })})
      returning id, email`
  );
  await sistema((tx) => tx`update public.profiles set role = ${papel} where id = ${u.id}`);
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
  return r.headers.getSetCookie().find((c) => c.startsWith("barbearia_sessao="))?.match(/^barbearia_sessao=([^;]*)/)?.[1];
}

// PNG 1x1 válido
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function enviar(token, pasta, conteudo, nome = "foto.png", tipo = "image/png") {
  const form = new FormData();
  form.append("pasta", pasta);
  form.append("arquivo", new Blob([conteudo], { type: tipo }), nome);
  const r = await fetch(`${BASE}/api/arquivos`, {
    method: "POST",
    body: form,
    headers: token ? { cookie: `barbearia_sessao=${token}` } : {},
  });
  const corpo = await r.json().catch(() => ({}));
  if (corpo.path) enviados.push(corpo.path);
  return { status: r.status, corpo };
}

try {
  // --- leitura pública da foto que já existe (logo copiado do Supabase) ---
  const [est] = await sistema((tx) => tx`select logo_path from public.estabelecimento where id = 1`);
  if (est?.logo_path) {
    const r = await fetch(`${BASE}/arquivos/publico/${est.logo_path}`);
    const corpo = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && r.headers.get("content-type") === "image/png", "logo servido pela rota pública", `${r.status} ${r.headers.get("content-type")}`);
    ok(/immutable/.test(r.headers.get("cache-control") ?? ""), "foto com cache longo");
    ok(corpo.equals(readFileSync(`${PASTA}/${est.logo_path}`)), "conteúdo igual ao arquivo em disco");
    const site = await (await fetch(`${BASE}/`)).text();
    ok(site.includes(`/arquivos/publico/${est.logo_path}`), "site usa o endereço novo do logo");
  }
  // Foto que falta no disco (contingência: fotos não vão para a segunda VPS) → imagem
  // padrão, com cache curto; barbeiro ganha silhueta.
  let r = await fetch(`${BASE}/arquivos/publico/logo/nao-existe.png`);
  let corpo = await r.text();
  ok(r.status === 200 && r.headers.get("content-type") === "image/svg+xml" && !corpo.includes("<circle")
    && r.headers.get("cache-control") === "public, max-age=300", "logo inexistente = imagem vazia, cache curto", `${r.status} ${r.headers.get("content-type")}`);
  r = await fetch(`${BASE}/arquivos/publico/barbeiros/00000000-0000-0000-0000-000000000000/nao-existe.jpg`);
  corpo = await r.text();
  ok(r.status === 200 && r.headers.get("content-type") === "image/svg+xml" && corpo.includes("<circle"), "foto de barbeiro inexistente = silhueta");
  r = await fetch(`${BASE}/arquivos/publico/%2e%2e/%2e%2e/package.json`);
  ok(r.status === 404, "caminho com .. não sai da pasta", String(r.status));
  r = await fetch(`${BASE}/arquivos/publico/logo/..%2f..%2f..%2fpackage.json`);
  ok(r.status === 404, "caminho com ../ codificado não sai da pasta", String(r.status));

  // --- envio ---
  const admin = await criarUsuario("admin");
  const barbeiro = await criarUsuario("colaborador");
  const tokenAdmin = await entrar(admin.email);
  const tokenBarbeiro = await entrar(barbeiro.email);

  let e = await enviar(null, "servicos", PNG);
  ok(e.status === 401, "sem login não envia", String(e.status));
  e = await enviar(tokenBarbeiro, "servicos", PNG);
  ok(e.status === 403, "barbeiro não envia", String(e.status));
  e = await enviar(tokenAdmin, "servicos", Buffer.from("isto não é imagem"), "falsa.png");
  ok(e.status === 415, "arquivo que só tem nome de .png é recusado", String(e.status));
  e = await enviar(tokenAdmin, "../../etc", PNG);
  ok(e.status === 400, "pasta fora das permitidas é recusada", String(e.status));
  e = await enviar(tokenAdmin, "barbeiros/nao-e-uuid", PNG);
  ok(e.status === 400, "pasta de barbeiro sem id válido é recusada", String(e.status));
  e = await enviar(tokenAdmin, "servicos", Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));
  ok(e.status === 413, "imagem acima de 5 MB é recusada", String(e.status));

  e = await enviar(tokenAdmin, "servicos", PNG, "../../../x.png");
  ok(e.status === 200 && /^servicos\/[0-9a-f-]{36}\.png$/.test(e.corpo.path ?? ""), "admin envia; o nome do arquivo é gerado pelo servidor", e.corpo.path);
  ok(existsSync(`${PASTA}/${e.corpo.path}`), "arquivo gravado na pasta dados/arquivos");
  r = await fetch(`${BASE}/arquivos/publico/${e.corpo.path}`);
  ok(r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(PNG), "foto enviada já é servida pela rota pública");

  e = await enviar(tokenAdmin, `barbeiros/${barbeiro.id}`, PNG);
  ok(e.status === 200 && e.corpo.path?.startsWith(`barbeiros/${barbeiro.id}/`), "envio para a pasta de um barbeiro", e.corpo.path);
} catch (err) {
  falhas++;
  console.log("FALHOU  erro inesperado:", err.message);
} finally {
  for (const p of enviados) rmSync(`${PASTA}/${p}`, { force: true });
  for (const id of usuarios) rmSync(`${PASTA}/barbeiros/${id}`, { recursive: true, force: true });
  if (usuarios.length) await sistema((tx) => tx`delete from auth.users where id in ${sql(usuarios)}`);
  // Tentativas de login registradas durante o teste (as de senha errada de propósito): o IP
  // visto pelo app é o da rede do Docker, igual para todas, então apaga pelo horário.
  await sistema((tx) => tx`delete from auth.tentativas_login where em >= ${INICIO_TESTE}`);
  await sql.end();
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou.");
process.exit(falhas ? 1 : 0);
