// Prepara o banco PostgreSQL próprio (docs/ARQUITETURA.md, decisão 47) e aplica as migrations.
// Uso: npm run db:migrar              (aplica o que falta)
//      npm run db:migrar -- --dry-run  (só lista o que seria aplicado)
//
// Variáveis (no .env.local ou no ambiente):
//   DATABASE_URL        conexão do app: postgres://<usuario_app>:<senha>@host:porta/<banco>
//   DATABASE_ADMIN_URL  superusuário do servidor (postgres://postgres:<senha>@host:porta/postgres)
//
// O que faz, sempre de forma idempotente:
//   1. cria o banco e o usuário do app (login, noinherit, sem permissão própria), se faltarem;
//   2. só o usuário do app conecta nesse banco (vários clientes no mesmo servidor não se
//      enxergam);
//   3. aplica db/compat.sql e depois db/migrations/*.sql em ordem, cada arquivo numa
//      transação, anotando em migracoes.aplicadas;
//   4. dá ao usuário do app a entrada nos papéis anon/authenticated/service_role (só vale
//      com SET ROLE, que o app faz em toda transação).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import postgres from "postgres";

const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim();
  }
}
for (const nome of ["DATABASE_URL", "DATABASE_ADMIN_URL"]) {
  if (!env[nome]) {
    console.error(`${nome} não está definida (.env.local ou ambiente).`);
    process.exit(1);
  }
}

const dryRun = process.argv.includes("--dry-run");
const app = new URL(env.DATABASE_URL);
const banco = app.pathname.slice(1);
const usuarioApp = decodeURIComponent(app.username);
const senhaApp = decodeURIComponent(app.password);
if (!/^[a-z_][a-z0-9_]*$/.test(banco) || !/^[a-z_][a-z0-9_]*$/.test(usuarioApp)) {
  console.error("Nome do banco e do usuário do app: só letras minúsculas, números e _.");
  process.exit(1);
}

// db/migrations: as da época do Supabase (rodam sem mudança, graças ao compat) e as do
// banco próprio, em ordem de data.
const pastas = ["db/migrations"].filter((p) => existsSync(p));
const arquivos = [
  { versao: "00000000000000_compat", caminho: "db/compat.sql" },
  ...pastas
    .flatMap((p) => readdirSync(p).filter((f) => f.endsWith(".sql")).map((f) => ({ versao: f.replace(/\.sql$/, ""), caminho: `${p}/${f}` })))
    .sort((a, b) => a.versao.localeCompare(b.versao)),
];

const opcoes = { onnotice: () => {} };

// 1. Banco e usuário do app (conectado ao banco "postgres" do servidor).
const servidor = postgres(env.DATABASE_ADMIN_URL, opcoes);
try {
  const [{ existe: bancoExiste }] = await servidor`select exists(select 1 from pg_database where datname = ${banco}) as existe`;
  const [{ existe: usuarioExiste }] = await servidor`select exists(select 1 from pg_roles where rolname = ${usuarioApp}) as existe`;
  if (dryRun) {
    if (!bancoExiste) console.log(`criaria o banco ${banco}`);
    if (!usuarioExiste) console.log(`criaria o usuário ${usuarioApp}`);
  } else {
    if (!usuarioExiste) {
      await servidor.unsafe(`create role ${usuarioApp} login noinherit password ${literal(senhaApp)}`);
      console.log(`usuário ${usuarioApp} criado`);
    } else {
      // Mantém a senha igual à do DATABASE_URL (e o noinherit, se alguém mexeu).
      await servidor.unsafe(`alter role ${usuarioApp} login noinherit password ${literal(senhaApp)}`);
    }
    if (!bancoExiste) {
      await servidor.unsafe(`create database ${banco}`);
      console.log(`banco ${banco} criado`);
    }
  }
} finally {
  await servidor.end();
}
if (dryRun && !(await bancoJaExiste())) {
  console.log(arquivos.map((a) => `aplicaria ${a.versao}`).join("\n"));
  process.exit(0);
}

// 2–4. Dentro do banco do cliente, como superusuário.
const adminUrl = new URL(env.DATABASE_ADMIN_URL);
adminUrl.pathname = `/${banco}`;
const sql = postgres(adminUrl.toString(), opcoes);
try {
  await sql`create schema if not exists migracoes`;
  await sql`create table if not exists migracoes.aplicadas (versao text primary key, aplicada_em timestamptz not null default now())`;
  const feitas = new Set((await sql`select versao from migracoes.aplicadas`).map((r) => r.versao));
  const pendentes = arquivos.filter((a) => !feitas.has(a.versao));

  if (pendentes.length === 0) console.log("nenhuma migration pendente");
  for (const a of pendentes) {
    if (dryRun) {
      console.log(`aplicaria ${a.versao}`);
      continue;
    }
    const conteudo = readFileSync(a.caminho, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(conteudo);
      await tx`insert into migracoes.aplicadas (versao) values (${a.versao})`;
    });
    console.log(`aplicada ${a.versao}`);
  }

  if (!dryRun) {
    await sql.unsafe(`revoke connect on database ${banco} from public`);
    await sql.unsafe(`grant connect on database ${banco} to ${usuarioApp}`);
    await sql.unsafe(`grant anon, authenticated, service_role to ${usuarioApp}`);
    // O usuário do app não é dono de nada e não lê nada sem SET ROLE.
    await sql.unsafe(`revoke all on schema migracoes from ${usuarioApp}`);
  }
} finally {
  await sql.end();
}

async function bancoJaExiste() {
  const s = postgres(env.DATABASE_ADMIN_URL, opcoes);
  try {
    const [{ existe }] = await s`select exists(select 1 from pg_database where datname = ${banco}) as existe`;
    return existe;
  } finally {
    await s.end();
  }
}

function literal(texto) {
  return `'${String(texto).replaceAll("'", "''")}'`;
}
