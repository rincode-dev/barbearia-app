// Teste da M0 (banco PostgreSQL próprio, decisão 47): as migrations rodaram no Postgres
// puro e a segurança responde igual à do Supabase para visitante, barbeiro e admin.
// Conecta como o usuário do app (DATABASE_URL). Cria e remove os próprios dados.
// Uso: node scripts/testes/m0-banco.mjs   (com o container barbearia-db no ar)
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

const env = { ...process.env };
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim();
}

let falhas = 0;
function ok(cond, descricao, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}
async function erroDe(promessa) {
  try {
    await promessa;
    return null;
  } catch (e) {
    return e;
  }
}

const sql = postgres(env.DATABASE_URL, { onnotice: () => {} });

// Mesmo padrão que o app vai usar (M2): uma transação por operação, com o papel certo e,
// para a equipe, o usuário da sessão em request.jwt.claim.sub.
function como(papel, usuarioId, fn) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${papel}`);
    if (usuarioId) await tx`select set_config('request.jwt.claim.sub', ${usuarioId}, true)`;
    return fn(tx);
  });
}
const sistema = (fn) => como("service_role", null, fn);
const visitante = (fn) => como("anon", null, fn);

const sufixo = randomBytes(4).toString("hex");
const criados = [];

try {
  // --- sem SET ROLE o usuário do app não lê nada ---
  let e = await erroDe(sql`select id from public.profiles limit 1`);
  ok(e?.code === "42501", "usuário do app sem SET ROLE não lê tabela", e?.code);
  e = await erroDe(sql`select id from auth.users limit 1`);
  ok(e?.code === "42501", "usuário do app sem SET ROLE não lê auth.users", e?.code);

  // --- criar usuários como o servidor (service_role): trigger cria o profile ---
  const jaTemAdmin = await sistema((tx) => tx`select exists(select 1 from public.profiles where role = 'admin') as t`);
  const [admin] = await sistema(
    (tx) => tx`
      insert into auth.users (email, encrypted_password, raw_user_meta_data)
      values (${`admin-${sufixo}@teste.local`}, extensions.crypt('senha-admin', extensions.gen_salt('bf')), ${sql.json({ nome: "Admin Teste" })})
      returning id`
  );
  criados.push(admin.id);
  if (!jaTemAdmin[0].t) {
    const [p] = await sistema((tx) => tx`select role, nome from public.profiles where id = ${admin.id}`);
    ok(p?.role === "admin" && p?.nome === "Admin Teste", "1º usuário vira admin com o nome do cadastro", JSON.stringify(p));
  } else {
    await sistema((tx) => tx`update public.profiles set role = 'admin' where id = ${admin.id}`);
  }
  const [barbeiro] = await sistema(
    (tx) => tx`
      insert into auth.users (email, encrypted_password, raw_user_meta_data)
      values (${`barbeiro-${sufixo}@teste.local`}, extensions.crypt('senha-barbeiro', extensions.gen_salt('bf')), ${sql.json({ nome: "Barbeiro Teste" })})
      returning id`
  );
  criados.push(barbeiro.id);
  const [pb] = await sistema((tx) => tx`select role from public.profiles where id = ${barbeiro.id}`);
  ok(pb?.role === "colaborador", "usuário seguinte nasce colaborador", pb?.role);

  // --- senha bcrypt conferida no banco ---
  const [certa] = await sistema(
    (tx) => tx`select encrypted_password = extensions.crypt('senha-barbeiro', encrypted_password) as ok from auth.users where id = ${barbeiro.id}`
  );
  const [errada] = await sistema(
    (tx) => tx`select encrypted_password = extensions.crypt('outra', encrypted_password) as ok from auth.users where id = ${barbeiro.id}`
  );
  ok(certa.ok && !errada.ok, "senha bcrypt: certa confere, errada não");
  // O Supabase grava bcrypt no formato $2a$ — o mesmo do pgcrypto, então as senhas
  // migradas continuam valendo.
  const [formato] = await sistema((tx) => tx`select left(encrypted_password, 4) as p from auth.users where id = ${barbeiro.id}`);
  ok(formato.p === "$2a$", "hash no formato bcrypt $2a$ (o mesmo do Supabase)", formato.p);

  // --- auth.uid() ---
  const [uid] = await como("authenticated", barbeiro.id, (tx) => tx`select auth.uid() as id`);
  ok(uid.id === barbeiro.id, "auth.uid() devolve o usuário da transação");
  const [semUid] = await visitante((tx) => tx`select auth.uid() as id`);
  ok(semUid.id === null, "visitante: auth.uid() nulo");
  const [depois] = await sql.begin(async (tx) => {
    await tx.unsafe("set local role service_role");
    return tx`select auth.uid() as id`;
  });
  ok(depois.id === null, "usuário da transação anterior não vaza para a próxima");

  // --- is_admin() ---
  const [ia] = await como("authenticated", admin.id, (tx) => tx`select public.is_admin() as v`);
  const [ib] = await como("authenticated", barbeiro.id, (tx) => tx`select public.is_admin() as v`);
  ok(ia.v === true && ib.v === false, "is_admin(): admin sim, barbeiro não");

  // --- auth.users fechado para equipe e visitante ---
  e = await erroDe(como("authenticated", admin.id, (tx) => tx`select email from auth.users`));
  ok(e?.code === "42501", "admin logado não lê auth.users direto", e?.code);
  e = await erroDe(visitante((tx) => tx`select email from auth.users`));
  ok(e?.code === "42501", "visitante não lê auth.users", e?.code);

  // --- estabelecimento: leitura pública, escrita só admin ---
  const est = await visitante((tx) => tx`select nome from public.estabelecimento`);
  ok(est.length === 1, "visitante lê o estabelecimento", String(est.length));
  const nomeOriginal = est[0]?.nome;
  const alterouBarbeiro = await como(
    "authenticated",
    barbeiro.id,
    (tx) => tx`update public.estabelecimento set nome = 'hack' returning id`
  );
  ok(alterouBarbeiro.length === 0, "barbeiro não altera o estabelecimento (RLS)");
  const alterouAdmin = await como(
    "authenticated",
    admin.id,
    (tx) => tx`update public.estabelecimento set nome = ${nomeOriginal} returning id`
  );
  ok(alterouAdmin.length === 1, "admin altera o estabelecimento");

  // --- serviços: visitante só vê ativos; só admin cria ---
  const [srvAtivo] = await como(
    "authenticated",
    admin.id,
    (tx) => tx`insert into public.servicos (nome, preco, duracao_minutos) values (${`Serviço ativo ${sufixo}`}, 40, 30) returning id`
  );
  const [srvInativo] = await como(
    "authenticated",
    admin.id,
    (tx) => tx`insert into public.servicos (nome, preco, duracao_minutos, ativo) values (${`Serviço inativo ${sufixo}`}, 40, 30, false) returning id`
  );
  const vistos = await visitante((tx) => tx`select id from public.servicos where id in (${srvAtivo.id}, ${srvInativo.id})`);
  ok(vistos.length === 1 && vistos[0].id === srvAtivo.id, "visitante vê só o serviço ativo");
  e = await erroDe(
    como("authenticated", barbeiro.id, (tx) => tx`insert into public.servicos (nome, preco, duracao_minutos) values ('x', 1, 30)`)
  );
  ok(e?.code === "42501", "barbeiro não cria serviço (RLS)", e?.code);

  // --- equipe só para logados ---
  const perfisVisitante = await visitante((tx) => tx`select id from public.profiles`);
  ok(perfisVisitante.length === 0, "visitante não lista a equipe");
  const perfisBarbeiro = await como("authenticated", barbeiro.id, (tx) => tx`select id from public.profiles`);
  ok(perfisBarbeiro.length >= 2, "barbeiro lista a equipe");

  // --- agendamento online: função fechada para visitante, aberta para o servidor ---
  e = await erroDe(
    visitante(
      (tx) => tx`select public.criar_agendamento('Fulano', '51999990000', ${barbeiro.id}::uuid, now(), array[${srvAtivo.id}]::uuid[], null, 3)`
    )
  );
  ok(e?.code === "42501", "visitante não executa criar_agendamento()", e?.code);

  // --- banco dos outros: o usuário do app só conecta no próprio banco ---
  const outro = new URL(env.DATABASE_URL);
  outro.pathname = "/postgres";
  const sqlOutro = postgres(outro.toString(), { onnotice: () => {}, connect_timeout: 5 });
  e = await erroDe(sqlOutro`select 1`);
  await sqlOutro.end();
  // O banco "postgres" do servidor é o de manutenção (aceita conexão de todos, mas não tem
  // dado). O que importa: nenhum banco de outro cliente aceita este usuário — o
  // db:migrar faz "revoke connect ... from public" em cada banco de cliente.
  const [conn] = await sistema(
    (tx) => tx`select has_database_privilege('public', current_database(), 'CONNECT') as publico`
  );
  ok(conn.publico === false, "banco do cliente não aceita conexão de outros usuários");

  // --- limpeza dos serviços ---
  await sistema((tx) => tx`delete from public.servicos where id in (${srvAtivo.id}, ${srvInativo.id})`);
} catch (err) {
  falhas++;
  console.log("FALHOU  erro inesperado:", err.message);
} finally {
  if (criados.length) await sistema((tx) => tx`delete from auth.users where id in ${sql(criados)}`);
  await sql.end();
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou.");
process.exit(falhas ? 1 : 0);
