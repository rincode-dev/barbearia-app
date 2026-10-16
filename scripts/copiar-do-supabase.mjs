// Copia os dados do Supabase de dev para o PostgreSQL próprio (docs/ARQUITETURA.md, decisão 47).
// Uso: node scripts/copiar-do-supabase.mjs               (recusa se o destino já tem dados)
//      node scripts/copiar-do-supabase.mjs --substituir  (apaga o destino e copia de novo)
//
// Lê do Supabase (SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL, pelo pooler IPv4) e
// grava no banco do DATABASE_URL como superusuário (DATABASE_ADMIN_URL). Copia:
//   - auth.users (id, e-mail, senha bcrypt — as senhas atuais continuam valendo, nome,
//     desativação);
//   - todas as tabelas de public (menos colunas calculadas pelo banco) e os contadores
//     (numeração das OS);
//   - as fotos do bucket "publico" para dados/arquivos/publico/<mesmo caminho>.
// Os gatilhos ficam desligados durante a cópia (session_replication_role = replica): os
// dados chegam como estão, sem recalcular nem criar profile de novo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import postgres from "postgres";

const env = { ...process.env };
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim();
}
for (const nome of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_DB_PASSWORD", "DATABASE_URL", "DATABASE_ADMIN_URL"]) {
  if (!env[nome]) {
    console.error(`${nome} não está definida no .env.local.`);
    process.exit(1);
  }
}
const substituir = process.argv.includes("--substituir");
const PASTA_ARQUIVOS = env.ARQUIVOS_DIR || "dados/arquivos";

// Datas e horas trafegam como texto, sem passar pelo Date do JavaScript (que só guarda
// milissegundos): a cópia fica exata, até o microssegundo.
const EXATO = {
  onnotice: () => {},
  types: { texto_data: { to: 1184, from: [1184, 1114, 1082], serialize: (v) => v, parse: (v) => v } },
};
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const ref = new URL(supabaseUrl).hostname.split(".")[0];
const origem = postgres({
  host: env.SUPABASE_POOLER_HOST || "aws-0-sa-east-1.pooler.supabase.com",
  port: 5432,
  user: `postgres.${ref}`,
  password: env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: "require",
  ...EXATO,
});
const destinoUrl = new URL(env.DATABASE_ADMIN_URL);
destinoUrl.pathname = new URL(env.DATABASE_URL).pathname;
const destino = postgres(destinoUrl.toString(), EXATO);

try {
  const [{ n: usuariosDestino }] = await destino`select count(*)::int as n from auth.users`;
  if (usuariosDestino > 0 && !substituir) {
    console.error(`O destino já tem ${usuariosDestino} usuário(s). Use --substituir para apagar e copiar de novo.`);
    process.exit(1);
  }

  // Tabelas de public no destino (as migrations já rodaram lá) e colunas copiáveis.
  const tabelas = (
    await destino`select tablename from pg_tables where schemaname = 'public' order by tablename`
  ).map((r) => r.tablename);

  const usuarios = await origem`
    select id, lower(email) as email, encrypted_password, coalesce(raw_user_meta_data, '{}'::jsonb) as raw_user_meta_data,
           banned_until, last_sign_in_at, created_at, updated_at
    from auth.users
    where email is not null`;

  const dados = {};
  for (const t of tabelas) {
    const colunasDestino = await destino`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${t} and is_generated = 'NEVER'
      order by ordinal_position`;
    const colunasOrigem = new Set(
      (await origem`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${t}`).map(
        (r) => r.column_name
      )
    );
    const colunas = colunasDestino.map((r) => r.column_name).filter((c) => colunasOrigem.has(c));
    if (colunas.length === 0) {
      console.log(`(pulada: ${t} não existe no Supabase)`);
      continue;
    }
    dados[t] = { colunas, linhas: await origem`select ${origem(colunas)} from public.${origem(t)}` };
  }

  const contadores = await origem`
    select sequencename as nome, last_value as valor from pg_sequences
    where schemaname = 'public' and last_value is not null`;

  await destino.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    // Sempre limpa: as migrations já criam linhas iniciais (estabelecimento, textos padrão
    // das mensagens), que vêm do Supabase com os valores reais. Sem usuários no destino (ou
    // com --substituir, conferido acima), não há dado de verdade a perder aqui.
    await tx.unsafe(`truncate ${tabelas.map((t) => `public."${t}"`).join(", ")}, auth.users cascade`);
    for (const u of usuarios) {
      await tx`insert into auth.users ${tx(u)}`;
    }
    for (const [t, { colunas, linhas }] of Object.entries(dados)) {
      // Em blocos, para não estourar o limite de parâmetros por comando.
      for (let i = 0; i < linhas.length; i += 500) {
        // overriding system value: mantém o número original das colunas geradas pelo banco
        // (ex.: número da OS), em vez de gerar um novo.
        const bloco = linhas.slice(i, i + 500).map((l) => colunas.map((c) => l[c]));
        await tx`insert into public.${tx(t)} (${tx(colunas)}) overriding system value values ${tx(bloco)}`;
      }
    }
    for (const c of contadores) {
      await tx`select setval(${`public.${c.nome}`}::regclass, ${c.valor})`;
    }
  });

  console.log(`usuários: ${usuarios.length}`);
  for (const [t, { linhas }] of Object.entries(dados)) console.log(`${t}: ${linhas.length}`);
  for (const c of contadores) console.log(`contador ${c.nome}: ${c.valor}`);

  // Fotos: o bucket é público, então baixa pela URL pública (sem chave).
  const objetos = await origem`select name from storage.objects where bucket_id = 'publico' order by name`;
  let baixadas = 0;
  for (const { name } of objetos) {
    const caminhoLocal = `${PASTA_ARQUIVOS}/publico/${name}`;
    if (existsSync(caminhoLocal) && !substituir) continue;
    const r = await fetch(`${supabaseUrl}/storage/v1/object/public/publico/${name.split("/").map(encodeURIComponent).join("/")}`);
    if (!r.ok) {
      console.log(`foto não baixada: ${name} (${r.status})`);
      continue;
    }
    mkdirSync(dirname(caminhoLocal), { recursive: true });
    writeFileSync(caminhoLocal, Buffer.from(await r.arrayBuffer()));
    baixadas++;
  }
  console.log(`fotos: ${baixadas} de ${objetos.length} baixadas para ${PASTA_ARQUIVOS}/publico`);
} finally {
  await origem.end();
  await destino.end();
}
