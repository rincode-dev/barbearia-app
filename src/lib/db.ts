import "server-only";
import postgres from "postgres";

// Acesso ao PostgreSQL próprio (docs/ARQUITETURA.md, decisão 47). Só o servidor fala com o
// banco. Toda operação roda numa transação com o papel certo — a RLS decide o que cada um
// vê, exatamente como no Supabase:
//   comoUsuario(id) = "authenticated" + usuário da sessão (auth.uid());
//   comoVisitante() = "anon" (site público);
//   comoSistema()   = "service_role", ignora a RLS — só depois de conferir permissão
//                     (requireAdmin etc.) ou em fluxo que já valida tudo no servidor
//                     (agendamento online, login).
// Consultas sempre com parâmetros (template sql`...`), nunca texto concatenado.

// Mesmo formato que o Supabase (PostgREST) devolvia, para o resto do app não mudar:
// numeric e bigint como número, timestamptz como texto ISO, date como "AAAA-MM-DD".
function isoDeTimestamp(texto: string) {
  return new Date(texto.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();
}

type Sql = postgres.Sql<{ numero: number; data_hora: string; data: string }>;
export type Tx = postgres.TransactionSql<{ numero: number; data_hora: string; data: string }>;

function criar(url: string | undefined, nome: string): Sql {
  if (!url) throw new Error(`${nome} não está definida.`);
  return postgres(url, {
    max: 10,
    idle_timeout: 30,
    onnotice: () => {},
    types: {
      numero: { to: 1700, from: [1700, 20], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
      data_hora: {
        to: 1184,
        from: [1184, 1114],
        serialize: (v: string | Date) => (v instanceof Date ? v.toISOString() : v),
        parse: isoDeTimestamp,
      },
      data: { to: 1082, from: [1082], serialize: (v: string) => v, parse: (v: string) => v },
    },
  }) as Sql;
}

// Contingência (docs/ARQUITETURA.md, "Contingência"). Na VPS secundária o app tem dois bancos:
//   DATABASE_URL           = o banco local (réplica da principal);
//   DATABASE_URL_PRINCIPAL = o banco da VPS principal, pela VPN.
// Enquanto o local for réplica, o app lê e grava na principal — assim, se só este app cair
// na principal, os domínios dele vêm para cá e ele atende normalmente. Quando o local vira
// principal (a secundária assumiu tudo), o app passa a usar só o local e não volta mais
// à principal até ser reiniciado: ela pode voltar com dados velhos. Banco local fora do ar
// = continua no local (dá erro), nunca "tenta a principal" às cegas.
// Sem DATABASE_URL_PRINCIPAL (VPS principal, dev), só o local — como sempre foi.
const CHECAR_A_CADA_MS = 5_000;

type Rota = { principal: boolean; checadoEm: number; checando: Promise<void> | null; presoNoLocal: boolean };

// Uma conexão (pool) por banco e por processo; em dev, sobrevive ao recarregamento dos módulos.
const global = globalThis as unknown as {
  __barbeariaSql?: Sql;
  __barbeariaSqlPrincipal?: Sql;
  __barbeariaRota?: Rota;
  __barbeariaAoTrocar?: Set<() => void>;
};
const rota = (global.__barbeariaRota ??= { principal: false, checadoEm: 0, checando: null, presoNoLocal: false });
const aoTrocar = (global.__barbeariaAoTrocar ??= new Set());

function local(): Sql {
  global.__barbeariaSql ??= criar(process.env.DATABASE_URL, "DATABASE_URL");
  return global.__barbeariaSql;
}
function remoto(): Sql | null {
  if (!process.env.DATABASE_URL_PRINCIPAL) return null;
  global.__barbeariaSqlPrincipal ??= criar(process.env.DATABASE_URL_PRINCIPAL, "DATABASE_URL_PRINCIPAL");
  return global.__barbeariaSqlPrincipal;
}

async function checarRota() {
  let principal = false;
  try {
    const consulta = local()<{ replica: boolean }[]>`select pg_is_in_recovery() as replica`;
    const tempo = new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error("tempo esgotado")), 3_000));
    const [linha] = await Promise.race([consulta, tempo]);
    if (linha?.replica) principal = !rota.presoNoLocal;
    else rota.presoNoLocal = true;
  } catch {
    principal = false; // local fora do ar: não arrisca a principal
  }
  if (principal !== rota.principal && rota.checadoEm > 0) for (const f of aoTrocar) f();
  rota.principal = principal;
  rota.checadoEm = Date.now();
}

// O banco a usar agora. Com um só banco configurado, é sempre o local.
export async function db(): Promise<Sql> {
  const r = remoto();
  if (!r) return local();
  if (Date.now() - rota.checadoEm > CHECAR_A_CADA_MS) {
    rota.checando ??= checarRota().finally(() => (rota.checando = null));
    // Só espera na primeira vez; depois segue com a rota conhecida e atualiza por trás.
    if (rota.checadoEm === 0) await rota.checando;
  }
  return rota.principal ? r : local();
}

// Avisa quando o app troca de banco (o "ao vivo" refaz a escuta no banco novo).
export function aoTrocarDeBanco(f: () => void): void {
  aoTrocar.add(f);
}

async function como<T>(papel: "authenticated" | "anon" | "service_role", usuarioId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await (await db()).begin(async (tx) => {
    // Papel e usuário valem só dentro desta transação (set local / set_config local).
    await tx.unsafe(`set local role ${papel}`);
    if (usuarioId) await tx`select set_config('request.jwt.claim.sub', ${usuarioId}, true)`;
    return fn(tx);
  })) as T;
}

export function comoUsuario<T>(usuarioId: string, fn: (tx: Tx) => Promise<T>) {
  return como("authenticated", usuarioId, fn);
}
export function comoVisitante<T>(fn: (tx: Tx) => Promise<T>) {
  return como("anon", null, fn);
}
export function comoSistema<T>(fn: (tx: Tx) => Promise<T>) {
  return como("service_role", null, fn);
}

// Texto do erro para a tela: as funções do banco já levantam mensagens em português
// ("Apenas administradores...", "Horário ocupado..."), como no Supabase.
export function mensagemDeErro(e: unknown) {
  return e instanceof Error ? e.message : "erro desconhecido";
}

// Código do Postgres (ex.: "23505" = valor duplicado), para tratar casos conhecidos.
// Lido pelo campo, não por instanceof: o Next pode empacotar a biblioteca em mais de uma
// cópia, e aí a classe PostgresError de uma cópia não reconhece o erro da outra.
export function codigoDeErro(e: unknown): string | undefined {
  const codigo = (e as { code?: unknown } | null)?.code;
  return typeof codigo === "string" && /^[0-9A-Z]{5}$/.test(codigo) ? codigo : undefined;
}

// { code, message } — o mesmo formato do erro do Supabase, que as funções de mensagem
// (mensagemErroAgenda, mensagemErroOS...) já sabem traduzir.
export function erroDoBanco(e: unknown): { code?: string; message: string } {
  return { code: codigoDeErro(e), message: mensagemDeErro(e) };
}
