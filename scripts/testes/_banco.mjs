// Adaptador dos testes antigos (fase0–fase6, ponta-a-ponta) para o PostgreSQL próprio
// (docs/ARQUITETURA.md, decisão 47 — M5). Imita só a parte do cliente do Supabase que esses
// testes usam — from/select/filtros/insert/update/delete/single/rpc, criar/apagar usuário,
// login — em cima do banco novo, com os mesmos papéis e a mesma RLS. Assim a lógica de
// cada teste (o que ele confere) fica igual à da época do Supabase.
//
//   service  = papel service_role (ignora RLS, como a chave de serviço)
//   anon     = papel anon (visitante)
//   sessao() = login de verdade no app (cookie para abrir as páginas) + cliente com o
//              papel authenticated daquele usuário (para o banco)
//   adminDoTeste() = TESTE_ADMIN_EMAIL/TESTE_ADMIN_SENHA se informados; senão um admin
//              temporário, apagado em encerrarTestes().
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

export const env = { ...process.env };
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim();
}
export const BASE = process.env.TESTE_BASE_URL || "http://127.0.0.1:3002";
const INICIO_TESTE = new Date().toISOString(); // limpeza das tentativas de login

const isoDeTimestamp = (t) => new Date(t.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();
const sql = postgres(env.DATABASE_URL, {
  max: 4,
  onnotice: () => {},
  // Mesmo formato do app (e do Supabase): numeric/bigint como número, datas como texto.
  types: {
    numero: { to: 1700, from: [1700, 20], serialize: String, parse: Number },
    data_hora: { to: 1184, from: [1184, 1114], serialize: (v) => (v instanceof Date ? v.toISOString() : v), parse: isoDeTimestamp },
    data: { to: 1082, from: [1082], serialize: (v) => v, parse: (v) => v },
  },
});

function erroDe(e) {
  return { code: e?.code, message: e?.message ?? String(e), details: e?.detail ?? null, hint: e?.hint ?? null };
}

async function executar(papel, usuarioId, texto, parametros = []) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${papel}`);
    if (usuarioId) await tx`select set_config('request.jwt.claim.sub', ${usuarioId}, true)`;
    return tx.unsafe(texto, parametros);
  });
}

const id = (nome) => `"${String(nome).replaceAll('"', '""')}"`;

// ---------------------------------------------------------------------------
// Relações para os selects com tabela embutida, ex.: agendamento_servicos(nome, preco)
// ---------------------------------------------------------------------------
let chaves = null;
async function chavesEstrangeiras() {
  chaves ??= await sql`
    select c.conrelid::regclass::text as filha, a.attname as coluna, c.confrelid::regclass::text as mae
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace`;
  return chaves;
}
const semEsquema = (t) => t.replace(/^public\./, "");

function dividirTopo(texto) {
  const partes = [];
  let nivel = 0;
  let atual = "";
  for (const ch of texto) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      partes.push(atual.trim());
      atual = "";
    } else atual += ch;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

async function colunasSQL(tabela, texto, apelido) {
  const partes = dividirTopo(texto || "*");
  const saida = [];
  for (const parte of partes) {
    const embutida = parte.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/s);
    if (!embutida) {
      if (parte === "*") saida.push(`${apelido}.*`);
      else {
        const [nome, coluna] = parte.includes(":") ? parte.split(":") : [parte, parte];
        saida.push(`${apelido}.${id(coluna.trim())} as ${id(nome.trim())}`);
      }
      continue;
    }
    const [, alias, rel, dica, internas] = embutida;
    const fks = await chavesEstrangeiras();
    const b = `e${Math.random().toString(36).slice(2, 7)}`;
    const internasSQL = await colunasSQL(rel, internas, b);
    // Filha (um-para-muitos): rel tem FK para a tabela atual.
    const filha = fks.find((f) => semEsquema(f.filha) === rel && semEsquema(f.mae) === tabela);
    // Mãe (muitos-para-um): a tabela atual tem FK para rel (dica = nome da constraint/coluna).
    const mae = fks.find(
      (f) => semEsquema(f.filha) === tabela && semEsquema(f.mae) === rel && (!dica || dica.includes(f.coluna))
    );
    if (filha) {
      saida.push(
        `coalesce((select json_agg(row_to_json(x)) from (select ${internasSQL} from public.${id(rel)} ${b} where ${b}.${id(filha.coluna)} = ${apelido}.id) x), '[]'::json) as ${id(alias ?? rel)}`
      );
    } else if (mae) {
      saida.push(
        `(select row_to_json(x) from (select ${internasSQL} from public.${id(rel)} ${b} where ${b}.id = ${apelido}.${id(mae.coluna)}) x) as ${id(alias ?? rel)}`
      );
    } else throw new Error(`adaptador: relação ${tabela} → ${rel} não encontrada`);
  }
  return saida.join(", ");
}

// ---------------------------------------------------------------------------
// Consulta no estilo do cliente do Supabase (thenable → { data, error, count })
// ---------------------------------------------------------------------------
class Consulta {
  constructor(cliente, tabela) {
    this.cliente = cliente;
    this.tabela = tabela;
    this.op = "select";
    this.colunas = "*";
    this.opcoesSelect = {};
    this.retornar = false;
    this.filtros = [];
    this.ordens = [];
    this.limite = null;
    this.modoUnico = null;
  }
  select(colunas = "*", opcoes = {}) {
    if (this.op === "select") {
      this.colunas = colunas;
      this.opcoesSelect = opcoes;
    } else {
      this.retornar = true;
      this.colunas = colunas;
    }
    return this;
  }
  insert(valores) {
    this.op = "insert";
    this.valores = Array.isArray(valores) ? valores : [valores];
    return this;
  }
  update(valores) {
    this.op = "update";
    this.valores = valores;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c, v) { this.filtros.push(["=", c, v]); return this; }
  neq(c, v) { this.filtros.push(["<>", c, v]); return this; }
  gt(c, v) { this.filtros.push([">", c, v]); return this; }
  gte(c, v) { this.filtros.push([">=", c, v]); return this; }
  lt(c, v) { this.filtros.push(["<", c, v]); return this; }
  lte(c, v) { this.filtros.push(["<=", c, v]); return this; }
  like(c, v) { this.filtros.push(["like", c, v]); return this; }
  ilike(c, v) { this.filtros.push(["ilike", c, v]); return this; }
  in(c, v) { this.filtros.push(["in", c, v]); return this; }
  is(c, v) { this.filtros.push(["is", c, v]); return this; }
  contains(c, v) { this.filtros.push(["@>", c, v]); return this; }
  not(c, operador, v) { this.filtros.push(["not", c, [operador, v]]); return this; }
  match(objeto) {
    for (const [c, v] of Object.entries(objeto)) this.eq(c, v);
    return this;
  }
  order(c, { ascending = true, nullsFirst } = {}) {
    this.ordens.push(`t.${id(c)} ${ascending ? "asc" : "desc"}${nullsFirst === undefined ? "" : nullsFirst ? " nulls first" : " nulls last"}`);
    return this;
  }
  limit(n) { this.limite = n; return this; }
  single() { this.modoUnico = "single"; return this; }
  maybeSingle() { this.modoUnico = "maybe"; return this; }

  onde(parametros) {
    const p = (v) => {
      parametros.push(v);
      return `$${parametros.length}`;
    };
    const lista = (texto) => String(texto).replace(/^\(|\)$/g, "").split(",").map((x) => x.trim());
    const partes = this.filtros.map(([op, c, v]) => {
      const col = `t.${id(c)}`;
      if (op === "in") return `${col} = any(${p(v)})`;
      if (op === "is") return `${col} is ${v === null ? "null" : v ? "true" : "false"}`;
      if (op === "not") {
        const [o, valor] = v;
        if (o === "is") return `${col} is not ${valor === null || valor === "null" ? "null" : valor ? "true" : "false"}`;
        if (o === "in") return `not (${col}::text = any(${p(lista(valor))}::text[]))`;
        if (o === "eq") return `${col} <> ${p(valor)}`;
        throw new Error(`adaptador: not(${o}) não suportado`);
      }
      return `${col} ${op} ${p(v)}`;
    });
    return partes.length ? ` where ${partes.join(" and ")}` : "";
  }

  async montar() {
    const parametros = [];
    const t = `public.${id(this.tabela)}`;
    if (this.op === "select") {
      const where = this.onde(parametros);
      if (this.opcoesSelect.head) return { texto: `select count(*)::int as n from ${t} t${where}`, parametros, contar: "head" };
      const cols = await colunasSQL(this.tabela, this.colunas, "t");
      const extra = this.opcoesSelect.count ? ", count(*) over()::int as __total" : "";
      const ordem = this.ordens.length ? ` order by ${this.ordens.join(", ")}` : "";
      const lim = this.limite !== null ? ` limit ${Number(this.limite)}` : "";
      return { texto: `select ${cols}${extra} from ${t} t${where}${ordem}${lim}`, parametros, contar: this.opcoesSelect.count ? "linhas" : null };
    }
    const retorno = this.retornar ? ` returning *` : "";
    if (this.op === "insert") {
      const nomes = [...new Set(this.valores.flatMap((v) => Object.keys(v)))];
      const linhas = this.valores.map(
        (v) => `(${nomes.map((n) => (n in v ? (parametros.push(v[n]), `$${parametros.length}`) : "default")).join(", ")})`
      );
      return { texto: `insert into ${t} as t (${nomes.map(id).join(", ")}) values ${linhas.join(", ")}${retorno}`, parametros };
    }
    if (this.op === "update") {
      const sets = Object.entries(this.valores).map(([c, v]) => (parametros.push(v), `${id(c)} = $${parametros.length}`));
      return { texto: `update ${t} as t set ${sets.join(", ")}${this.onde(parametros)}${retorno}`, parametros };
    }
    return { texto: `delete from ${t} as t${this.onde(parametros)}${retorno}`, parametros };
  }

  async executar() {
    try {
      const { texto, parametros, contar } = await this.montar();
      let linhas = [...(await executar(this.cliente.papel, this.cliente.usuarioId, texto, parametros))];
      if (contar === "head") return { data: null, error: null, count: linhas[0].n };
      let count = null;
      if (contar === "linhas") {
        count = linhas[0]?.__total ?? 0;
        linhas = linhas.map(({ __total, ...resto }) => (void __total, resto));
      }
      if (this.op !== "select" && !this.retornar) return { data: null, error: null, count };
      if (this.modoUnico) {
        if (linhas.length === 1) return { data: linhas[0], error: null, count };
        if (linhas.length === 0 && this.modoUnico === "maybe") return { data: null, error: null, count };
        return {
          data: null,
          error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
          count,
        };
      }
      return { data: linhas, error: null, count };
    } catch (e) {
      return { data: null, error: erroDe(e), count: null };
    }
  }
  then(resolver, rejeitar) {
    return this.executar().then(resolver, rejeitar);
  }
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------
let funcoes = null;
async function assinaturaDe(nome) {
  funcoes ??= await sql`
    select p.proname as nome, p.proretset as conjunto, p.prorettype = 'void'::regtype as vazio
    from pg_proc p where p.pronamespace = 'public'::regnamespace`;
  const f = funcoes.find((x) => x.nome === nome);
  if (!f) throw new Error(`adaptador: função ${nome} não existe`);
  return f;
}

async function criarUsuario({ email, password, user_metadata = {} }) {
  try {
    const [u] = await executar(
      "service_role",
      null,
      `insert into auth.users (email, encrypted_password, raw_user_meta_data)
       values ($1, extensions.crypt($2, extensions.gen_salt('bf', 10)), $3) returning id, email`,
      [String(email).toLowerCase(), password, user_metadata]
    );
    return { data: { user: u }, error: null };
  } catch (e) {
    if (e.code === "23505") return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
    return { data: { user: null }, error: erroDe(e) };
  }
}

function novoCliente(papel, usuarioId = null) {
  const cliente = {
    papel,
    usuarioId,
    from: (tabela) => new Consulta(cliente, tabela),
    async rpc(nome, args = {}) {
      try {
        const f = await assinaturaDe(nome);
        const nomes = Object.keys(args);
        const lista = nomes.map((n, i) => `${id(n)} => $${i + 1}`).join(", ");
        const valores = nomes.map((n) => args[n]);
        const chamada = `public.${id(nome)}(${lista})`;
        if (f.conjunto) {
          return { data: [...(await executar(cliente.papel, cliente.usuarioId, `select * from ${chamada}`, valores))], error: null };
        }
        const [linha] = await executar(cliente.papel, cliente.usuarioId, `select ${chamada} as r`, valores);
        return { data: f.vazio ? null : linha.r, error: null };
      } catch (e) {
        return { data: null, error: erroDe(e) };
      }
    },
    auth: {
      admin: {
        createUser: criarUsuario,
        async deleteUser(uid) {
          try {
            await executar("service_role", null, "delete from auth.users where id = $1", [uid]);
            return { data: {}, error: null };
          } catch (e) {
            return { data: null, error: erroDe(e) };
          }
        },
        async updateUserById(uid, { password, ban_duration } = {}) {
          try {
            if (password) {
              await executar("service_role", null, "update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 10)) where id = $1", [uid, password]);
            }
            if (ban_duration) {
              await executar(
                "service_role",
                null,
                ban_duration === "none" ? "update auth.users set banned_until = null where id = $1" : "update auth.users set banned_until = now() + interval '100 years' where id = $1",
                [uid]
              );
            }
            return { data: { user: { id: uid } }, error: null };
          } catch (e) {
            return { data: null, error: erroDe(e) };
          }
        },
      },
      // Login só no "banco" (sem cookie): o cliente passa a agir como aquele usuário.
      async signInWithPassword({ email, password }) {
        const [u] = await executar(
          "service_role",
          null,
          `select id, email from auth.users
           where email = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)
             and (banned_until is null or banned_until <= now())`,
          [email, password]
        );
        if (!u) return { data: { user: null }, error: { message: "Invalid login credentials" } };
        cliente.papel = "authenticated";
        cliente.usuarioId = u.id;
        return { data: { user: u }, error: null };
      },
      async signOut() {
        cliente.papel = "anon";
        cliente.usuarioId = null;
        return { error: null };
      },
    },
  };
  return cliente;
}

export const service = novoCliente("service_role");
export const anon = novoCliente("anon");
// Cliente "limpo" de visitante, para quem precisa fazer signInWithPassword nele.
export const clienteVisitante = () => novoCliente("anon");
// Mesmo uso do createClient do Supabase: com a chave de serviço = service_role; com
// qualquer outra chave = visitante novo (que pode fazer signInWithPassword).
export const createClient = (_url, chave) =>
  chave && chave === env.SUPABASE_SERVICE_ROLE_KEY ? novoCliente("service_role") : novoCliente("anon");

// Login de verdade no app (formulário do /login) → cookie para as páginas + cliente do banco
// agindo como esse usuário. Mesmo formato que os testes usavam: { sb, cookie }.
export async function sessao(email, senha) {
  const html = await (await fetch(`${BASE}/login`)).text();
  const form = new FormData();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) {
    form.append(m[1], (m[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  form.append("email", email);
  form.append("password", senha);
  const r = await fetch(`${BASE}/login`, { method: "POST", body: form, redirect: "manual", headers: { origin: BASE } });
  const token = r.headers.getSetCookie().find((c) => c.startsWith("barbearia_sessao="))?.match(/^barbearia_sessao=([^;]*)/)?.[1];
  if (!token) throw new Error(`login ${email}: recusado (${r.status})`);
  const [u] = await executar("service_role", null, "select id from auth.users where email = lower($1)", [email]);
  return { sb: novoCliente("authenticated", u.id), cookie: `barbearia_sessao=${token}` };
}

// Admin para os testes: o de verdade (se a senha foi informada) ou um temporário.
const temporarios = [];
export async function adminDoTeste() {
  if (process.env.TESTE_ADMIN_SENHA) {
    return { email: process.env.TESTE_ADMIN_EMAIL, senha: process.env.TESTE_ADMIN_SENHA };
  }
  const sufixo = randomBytes(4).toString("hex");
  const email = `teste-admin-${sufixo}@teste.local`;
  const senha = `Admin-${sufixo}`;
  const { data, error } = await criarUsuario({ email, password: senha, user_metadata: { nome: "Admin (teste)" } });
  if (error) throw new Error(`admin temporário: ${error.message}`);
  // Mesmo perfil do admin de dev: admin que não atende (os testes ligam o "atende" quando precisam).
  await executar("service_role", null, "update public.profiles set role = 'admin', atende_como_barbeiro = false where id = $1", [data.user.id]);
  temporarios.push(data.user.id);
  return { email, senha };
}

// Apaga o admin temporário e fecha a conexão. Chamar antes do process.exit do teste.
export async function encerrarTestes() {
  for (const uid of temporarios) {
    try {
      await executar("service_role", null, "delete from auth.users where id = $1", [uid]);
    } catch (e) {
      // Algo do teste ainda aponta para ele: desativa em vez de apagar e avisa.
      await executar("service_role", null, "update public.profiles set ativo = false where id = $1", [uid]);
      await executar("service_role", null, "update auth.users set banned_until = now() + interval '100 years' where id = $1", [uid]);
      console.log(`AVISO  admin temporário ${uid} não pôde ser apagado (${e.message}); ficou desativado.`);
    }
  }
  // Tentativas de login registradas durante o teste (as de senha errada de propósito): o IP
  // visto pelo app é o da rede do Docker, igual para todas, então apaga pelo horário.
  await executar("service_role", null, "delete from auth.tentativas_login where em >= $1", [INICIO_TESTE]).catch(() => {});
  // Número da OS (decisão 49): as OS de teste concluídas já foram apagadas; o contador volta
  // ao maior número que sobrou, para a sequência real continuar sem buraco.
  await executar("service_role", null, "update public.contador_os set ultimo = coalesce((select max(numero) from public.ordens_servico), 0)").catch(() => {});
  await sql.end();
}
