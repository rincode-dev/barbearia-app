// Copia os dados de um banco da barbearia (PostgreSQL próprio) para outro já preparado
// com `npm run db:migrar` — é como os dados vão do PC para a VPS (docs/ARQUITETURA.md,
// "Como levar para a VPS"). As fotos vão à parte (a pasta dados/arquivos).
//
// Uso: ORIGEM_DATABASE_URL=postgres://postgres:<senha>@<host>:<porta>/<banco> \
//        node scripts/copiar-banco.mjs [--substituir]
// Destino: o banco do DATABASE_URL do .env.local (ou do ambiente), gravado como
// superusuário (DATABASE_ADMIN_URL). Recusa se o destino já tem usuários, a não ser com
// --substituir (que apaga os dados do destino antes).
//
// Copia auth.users (senhas bcrypt continuam valendo), todas as tabelas de public e os
// contadores (numeração das OS). Sessões não: todo mundo entra de novo no servidor novo.
// Uma transação só, com os gatilhos desligados: os dados chegam exatamente como estão.
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim();
  }
}
for (const nome of ["ORIGEM_DATABASE_URL", "DATABASE_URL", "DATABASE_ADMIN_URL"]) {
  if (!env[nome]) {
    console.error(`${nome} não está definida.`);
    process.exit(1);
  }
}
const substituir = process.argv.includes("--substituir");

const destinoUrl = new URL(env.DATABASE_ADMIN_URL);
destinoUrl.pathname = new URL(env.DATABASE_URL).pathname;
if (new URL(env.ORIGEM_DATABASE_URL).toString() === destinoUrl.toString()) {
  console.error("Origem e destino são o mesmo banco.");
  process.exit(1);
}
// Datas e horas trafegam como texto, sem passar pelo Date do JavaScript (que só guarda
// milissegundos): a cópia fica exata, até o microssegundo.
const EXATO = {
  onnotice: () => {},
  types: { texto_data: { to: 1184, from: [1184, 1114, 1082], serialize: (v) => v, parse: (v) => v } },
};
const origem = postgres(env.ORIGEM_DATABASE_URL, EXATO);
const destino = postgres(destinoUrl.toString(), EXATO);

try {
  const [{ n: usuariosDestino }] = await destino`select count(*)::int as n from auth.users`;
  if (usuariosDestino > 0 && !substituir) {
    console.error(`O destino já tem ${usuariosDestino} usuário(s). Use --substituir para apagar e copiar de novo.`);
    process.exit(1);
  }

  // Mesmas migrations dos dois lados: senão a cópia não faz sentido.
  const versoes = async (s) => (await s`select versao from migracoes.aplicadas order by versao`).map((r) => r.versao).join(",");
  if ((await versoes(origem)) !== (await versoes(destino))) {
    console.error("Origem e destino estão com migrations diferentes. Rode `npm run db:migrar` no destino (e confira a origem).");
    process.exit(1);
  }

  const tabelas = (await destino`select tablename from pg_tables where schemaname = 'public' order by tablename`).map((r) => r.tablename);
  const colunasDe = async (s, esquema, tabela) =>
    (
      await s`
        select column_name from information_schema.columns
        where table_schema = ${esquema} and table_name = ${tabela} and is_generated = 'NEVER'
        order by ordinal_position`
    ).map((r) => r.column_name);

  const colunasUsuarios = await colunasDe(destino, "auth", "users");
  const usuarios = await origem`select ${origem(colunasUsuarios)} from auth.users`;
  const dados = {};
  for (const t of tabelas) {
    const colunas = await colunasDe(destino, "public", t);
    dados[t] = { colunas, linhas: await origem`select ${origem(colunas)} from public.${origem(t)}` };
  }
  const contadores = await origem`
    select schemaname || '.' || sequencename as nome, last_value as valor from pg_sequences
    where schemaname = 'public' and last_value is not null`;

  const inserir = async (tx, alvo, colunas, linhas) => {
    for (let i = 0; i < linhas.length; i += 500) {
      const bloco = linhas.slice(i, i + 500).map((l) => colunas.map((c) => l[c]));
      await tx`insert into ${tx(alvo.esquema)}.${tx(alvo.tabela)} (${tx(colunas)}) overriding system value values ${tx(bloco)}`;
    }
  };

  await destino.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    // Limpa tudo (as migrations criam linhas iniciais, como o estabelecimento e os textos
    // padrão das mensagens; os valores reais vêm da origem).
    await tx.unsafe(`truncate ${tabelas.map((t) => `public."${t}"`).join(", ")}, auth.sessoes, auth.tentativas_login, auth.users cascade`);
    if (usuarios.length) await inserir(tx, { esquema: "auth", tabela: "users" }, colunasUsuarios, usuarios);
    for (const [t, { colunas, linhas }] of Object.entries(dados)) {
      if (linhas.length) await inserir(tx, { esquema: "public", tabela: t }, colunas, linhas);
    }
    for (const c of contadores) await tx`select setval(${c.nome}::regclass, ${c.valor})`;
  });

  console.log(`usuários: ${usuarios.length}`);
  for (const [t, { linhas }] of Object.entries(dados)) console.log(`${t}: ${linhas.length}`);
  for (const c of contadores) console.log(`contador ${c.nome}: ${c.valor}`);
  console.log("Pronto. Copie também a pasta dados/arquivos (logo e fotos).");
} finally {
  await origem.end();
  await destino.end();
}
