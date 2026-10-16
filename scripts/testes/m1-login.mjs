// Teste da M1 (login próprio, decisão 47): container do branch em 127.0.0.1:3002 ligado ao
// Postgres local. Envia o formulário de login de verdade (como um navegador sem JS) e
// confere cookie, sessões no banco, saída, desativação e limite de tentativas.
// Cria e remove os próprios usuários. Uso: node scripts/testes/m1-login.mjs
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
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
const hash = (t) => createHash("sha256").update(t).digest("hex");

const sufixo = randomBytes(4).toString("hex");
const SENHA = `Senha-${sufixo}`;
const emailBarbeiro = `m1-barbeiro-${sufixo}@teste.local`;
const emailLimite = `m1-limite-${sufixo}@teste.local`;
const criados = [];

async function criarUsuario(email, nome) {
  const [u] = await sistema(
    (tx) => tx`
      insert into auth.users (email, encrypted_password, raw_user_meta_data)
      values (${email}, extensions.crypt(${SENHA}, extensions.gen_salt('bf', 10)), ${sql.json({ nome })})
      returning id`
  );
  criados.push(u.id);
  return u.id;
}

// Envia o formulário do /login com os campos ocultos que o Next gera para a Server Action.
async function entrar(email, senha, manter = true) {
  const html = await (await fetch(`${BASE}/login`, { redirect: "manual" })).text();
  const form = new FormData();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) {
    form.append(m[1], (m[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  form.append("email", email);
  form.append("password", senha);
  if (manter) form.append("manter_conectado", "1");
  const r = await fetch(`${BASE}/login`, { method: "POST", body: form, redirect: "manual", headers: { origin: BASE } });
  const setCookie = r.headers.getSetCookie().find((c) => c.startsWith("barbearia_sessao=")) ?? null;
  const token = setCookie?.match(/^barbearia_sessao=([^;]*)/)?.[1] ?? null;
  return { status: r.status, destino: r.headers.get("location"), setCookie, token, html: r.status === 200 ? await r.text() : "" };
}

async function pagina(caminho, token) {
  const r = await fetch(BASE + caminho, {
    headers: token ? { cookie: `barbearia_sessao=${token}` } : {},
    redirect: "manual",
  });
  return {
    status: r.status,
    destino: r.headers.get("location"),
    setCookie: r.headers.getSetCookie().find((c) => c.startsWith("barbearia_sessao=")) ?? null,
    html: r.status === 200 ? await r.text() : "",
  };
}
const caminhoDe = (url) => (url ? new URL(url, BASE).pathname : null);

try {
  const barbeiroId = await criarUsuario(emailBarbeiro, "Barbeiro M1");
  await criarUsuario(emailLimite, "Limite M1");

  // --- sem sessão ---
  let p = await pagina("/painel");
  ok(p.status === 307 && caminhoDe(p.destino) === "/login", "/painel sem cookie vai ao /login", `${p.status} ${p.destino}`);

  // --- senha errada / e-mail inexistente ---
  let r = await entrar(emailBarbeiro, "errada");
  ok(r.status === 200 && r.html.includes("Email ou senha inválidos") && !r.token, "senha errada: mensagem e nenhum cookie");
  r = await entrar(`nao-existe-${sufixo}@teste.local`, SENHA);
  ok(r.status === 200 && r.html.includes("Email ou senha inválidos") && !r.token, "e-mail inexistente: a mesma mensagem");

  // --- login com "permanecer conectado" ---
  r = await entrar(emailBarbeiro.toUpperCase(), SENHA, true);
  ok(r.status === 303 && caminhoDe(r.destino) === "/painel", "login certo (e-mail em maiúsculas) leva ao /painel", `${r.status} ${r.destino}`);
  ok(/HttpOnly/i.test(r.setCookie ?? "") && /SameSite=lax/i.test(r.setCookie ?? ""), "cookie httpOnly e SameSite=Lax");
  const maxAge = Number(r.setCookie?.match(/Max-Age=(\d+)/i)?.[1]);
  ok(maxAge === 90 * 24 * 60 * 60, "permanecer conectado: cookie de 90 dias", String(maxAge));
  const tokenPermanente = r.token;
  let [s] = await sistema((tx) => tx`select user_id, permanente, expira_em, token_hash from auth.sessoes where token_hash = ${hash(tokenPermanente)}`);
  ok(s?.user_id === barbeiroId && s.permanente === true, "sessão gravada no banco para o usuário certo");
  const [bruto] = await sistema((tx) => tx`select count(*)::int as n from auth.sessoes where token_hash = ${tokenPermanente}`);
  ok(bruto.n === 0, "o banco guarda só o hash do token, nunca o token");
  const [ultimo] = await sistema((tx) => tx`select last_sign_in_at from auth.users where id = ${barbeiroId}`);
  ok(ultimo.last_sign_in_at !== null, "último acesso registrado");

  // --- login sem "permanecer conectado" ---
  r = await entrar(emailBarbeiro, SENHA, false);
  ok(r.status === 303 && r.token && !/Max-Age/i.test(r.setCookie ?? ""), "sem permanecer conectado: cookie some ao fechar o navegador");
  [s] = await sistema((tx) => tx`select permanente, expira_em from auth.sessoes where token_hash = ${hash(r.token)}`);
  const horas = (new Date(s.expira_em) - Date.now()) / 3600000;
  ok(s.permanente === false && horas > 11.9 && horas <= 12, "sessão temporária vence em 12 horas", horas.toFixed(2));
  const tokenTemporario = r.token;

  // --- com sessão ---
  p = await pagina("/painel", tokenPermanente);
  ok(p.status === 200 && p.html.includes("Barbeiro M1"), "/painel com sessão abre e mostra o nome", String(p.status));
  p = await pagina("/login", tokenPermanente);
  ok(p.status === 307 && caminhoDe(p.destino) === "/painel", "/login com sessão vai ao painel");

  // --- cookie inválido e sessão vencida ---
  p = await pagina("/painel", "token-inventado");
  ok(p.status === 307 && caminhoDe(p.destino) === "/sair", "cookie inválido vai ao /sair", `${p.status} ${p.destino}`);
  p = await pagina("/sair", "token-inventado");
  ok(p.status === 307 && caminhoDe(p.destino) === "/login" && /barbearia_sessao=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(p.setCookie ?? ""), "/sair apaga o cookie e vai ao login");
  await sistema((tx) => tx`update auth.sessoes set expira_em = now() - interval '1 minute' where token_hash = ${hash(tokenTemporario)}`);
  p = await pagina("/painel", tokenTemporario);
  ok(p.status === 307 && caminhoDe(p.destino) === "/sair", "sessão vencida não entra");

  // --- sair apaga a sessão do banco ---
  r = await entrar(emailBarbeiro, SENHA, true);
  const tokenSair = r.token;
  await pagina("/sair", tokenSair);
  const [apos] = await sistema((tx) => tx`select count(*)::int as n from auth.sessoes where token_hash = ${hash(tokenSair)}`);
  ok(apos.n === 0, "/sair apaga a sessão do banco");
  p = await pagina("/painel", tokenSair);
  ok(p.status === 307 && caminhoDe(p.destino) === "/sair", "cookie de sessão encerrada não entra mais");

  // --- desativado ---
  await sistema((tx) => tx`update public.profiles set ativo = false where id = ${barbeiroId}`);
  p = await pagina("/painel", tokenPermanente);
  ok(p.status === 307 && caminhoDe(p.destino) === "/sair", "perfil desativado com sessão aberta é mandado embora");
  await sistema((tx) => tx`update auth.users set banned_until = now() + interval '100 years' where id = ${barbeiroId}`);
  r = await entrar(emailBarbeiro, SENHA);
  ok(r.status === 200 && r.html.includes("Este acesso está desativado") && !r.token, "usuário desativado não consegue entrar");
  await sistema((tx) => tx`update auth.users set banned_until = null where id = ${barbeiroId}`);
  await sistema((tx) => tx`update public.profiles set ativo = true where id = ${barbeiroId}`);
  r = await entrar(emailBarbeiro, SENHA);
  ok(r.status === 303, "reativado entra de novo");

  // --- limite de tentativas por e-mail ---
  for (let i = 0; i < 5; i++) await entrar(emailLimite, "errada");
  r = await entrar(emailLimite, SENHA);
  ok(r.status === 200 && r.html.includes("Muitas tentativas") && !r.token, "6ª tentativa bloqueada mesmo com a senha certa");
  r = await entrar(emailBarbeiro, SENHA);
  ok(r.status === 303, "o bloqueio vale só para aquele e-mail");
  await sistema((tx) => tx`delete from auth.tentativas_login where chave = ${`email:${emailLimite}`}`);
  r = await entrar(emailLimite, SENHA);
  ok(r.status === 303, "passada a janela, entra normalmente");
} catch (err) {
  falhas++;
  console.log("FALHOU  erro inesperado:", err.message);
} finally {
  if (criados.length) {
    await sistema((tx) => tx`delete from auth.users where id in ${sql(criados)}`);
  }
  await sistema(
    // Tentativas de login registradas durante o teste (as de senha errada de propósito): o IP
    // visto pelo app é o da rede do Docker, igual para todas, então apaga pelo horário.
    (tx) => tx`delete from auth.tentativas_login where em >= ${INICIO_TESTE}`
  );
  await sql.end();
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou.");
process.exit(falhas ? 1 : 0);
