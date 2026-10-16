import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { comoSistema } from "@/lib/db";
import { ipDaRequisicao } from "@/lib/agendamento/limite";
import { COOKIE_SESSAO } from "./cookie";

// Login próprio (docs/ARQUITETURA.md, decisão 47 — M1).
// - Senha: bcrypt em auth.users, conferida no banco (extensions.crypt) — o mesmo formato
//   do Supabase, então as senhas antigas continuam valendo.
// - Sessão: token aleatório (32 bytes) no cookie httpOnly; no banco, só o SHA-256 dele.
// - "Permanecer conectado": cookie e sessão de 90 dias; sem isso, cookie some ao fechar
//   o navegador e a sessão vence em 12 horas.

const DURACAO_PERMANENTE_MS = 90 * 24 * 60 * 60 * 1000;
const DURACAO_TEMPORARIA_MS = 12 * 60 * 60 * 1000;
// Limite de tentativas que falharam, numa janela de 15 minutos.
const JANELA_TENTATIVAS = "15 minutes";
const MAX_FALHAS_POR_EMAIL = 5;
const MAX_FALHAS_POR_IP = 20;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Mesmo critério do agendamento online (ipDaRequisicao): X-Real-IP, que o Nginx sobrescreve
// com o IP real; senão o ÚLTIMO item do X-Forwarded-For (o primeiro vem do próprio
// visitante e poderia ser trocado a cada tentativa para driblar o limite por IP).
async function ipDoPedido() {
  return ipDaRequisicao(await headers());
}

// HTTPS de verdade (VPS com proxy reverso, túnel): cookie "secure". No Docker local
// (http://127.0.0.1) não dá para marcar secure.
async function conexaoSegura() {
  const h = await headers();
  return h.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

export type ResultadoLogin = { ok: true; userId: string } | { ok: false; motivo: "invalido" | "bloqueado" | "tentativas" };

export async function verificarCredenciais(emailInformado: string, senha: string): Promise<ResultadoLogin> {
  const email = emailInformado.trim().toLowerCase();
  const ip = await ipDoPedido();
  const chaveEmail = `email:${email}`;
  const chaveIp = `ip:${ip}`;

  return comoSistema(async (tx) => {
    const [falhas] = await tx`
      select
        count(*) filter (where chave = ${chaveEmail}) as por_email,
        count(*) filter (where chave = ${chaveIp}) as por_ip
      from auth.tentativas_login
      where chave in (${chaveEmail}, ${chaveIp}) and em > now() - ${JANELA_TENTATIVAS}::interval`;
    if (falhas.por_email >= MAX_FALHAS_POR_EMAIL || falhas.por_ip >= MAX_FALHAS_POR_IP) {
      return { ok: false, motivo: "tentativas" } as const;
    }

    // E-mail inexistente também passa por um bcrypt (hash novo), para a resposta não
    // denunciar pelo tempo quais e-mails existem.
    const [linha] = await tx`
      select u.id, u.banned_until,
             u.encrypted_password is not null
               and u.encrypted_password = extensions.crypt(${senha}, u.encrypted_password) as senha_ok
      from (select 1) x
      left join auth.users u on u.email = ${email}`;
    if (!linha?.id) {
      await tx`select extensions.crypt(${senha}, extensions.gen_salt('bf'))`;
    }

    if (!linha?.id || !linha.senha_ok) {
      await tx`insert into auth.tentativas_login (chave) values (${chaveEmail}), (${chaveIp})`;
      // Faxina ocasional do histórico de tentativas.
      await tx`delete from auth.tentativas_login where em < now() - interval '1 day'`;
      return { ok: false, motivo: "invalido" } as const;
    }
    if (linha.banned_until && new Date(linha.banned_until) > new Date()) {
      return { ok: false, motivo: "bloqueado" } as const;
    }

    await tx`delete from auth.tentativas_login where chave = ${chaveEmail}`;
    await tx`update auth.users set last_sign_in_at = now() where id = ${linha.id}`;
    return { ok: true, userId: linha.id as string } as const;
  });
}

export async function criarSessao(userId: string, permanente: boolean) {
  const token = randomBytes(32).toString("base64url");
  const duracao = permanente ? DURACAO_PERMANENTE_MS : DURACAO_TEMPORARIA_MS;
  const expira = new Date(Date.now() + duracao);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;

  await comoSistema(async (tx) => {
    await tx`
      insert into auth.sessoes (token_hash, user_id, permanente, expira_em, user_agent)
      values (${hashToken(token)}, ${userId}, ${permanente}, ${expira.toISOString()}, ${userAgent})`;
    // Faxina ocasional das sessões vencidas.
    await tx`delete from auth.sessoes where expira_em < now()`;
  });

  (await cookies()).set(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await conexaoSegura(),
    path: "/",
    // Sem "permanecer conectado": cookie de sessão do navegador (sem maxAge).
    ...(permanente ? { maxAge: Math.floor(duracao / 1000) } : {}),
  });
}

export type SessaoValida = { sessaoId: string; userId: string; email: string };

// Lê e confere a sessão do cookie. Não altera cookie (serve para Server Components).
export async function lerSessao(): Promise<SessaoValida | null> {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  if (!token) return null;

  return comoSistema(async (tx) => {
    const [s] = await tx`
      select s.id, s.user_id, s.ultimo_uso_em, u.email
      from auth.sessoes s
      join auth.users u on u.id = s.user_id
      where s.token_hash = ${hashToken(token)}
        and s.expira_em > now()
        and (u.banned_until is null or u.banned_until <= now())`;
    if (!s) return null;
    // Registro de último uso, no máximo uma escrita por hora.
    if (Date.now() - new Date(s.ultimo_uso_em).getTime() > 60 * 60 * 1000) {
      await tx`update auth.sessoes set ultimo_uso_em = now() where id = ${s.id}`;
    }
    return { sessaoId: s.id as string, userId: s.user_id as string, email: s.email as string };
  });
}

// Apaga a sessão do banco e o cookie. Só em Server Action ou Route Handler.
export async function encerrarSessao() {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;
  if (token) {
    await comoSistema((tx) => tx`delete from auth.sessoes where token_hash = ${hashToken(token)}`);
  }
  jar.delete(COOKIE_SESSAO);
}

// Derruba todas as sessões de um usuário (desativado, senha trocada), menos a atual.
export async function encerrarSessoesDoUsuario(userId: string, excetoSessaoId?: string) {
  await comoSistema(
    (tx) => tx`delete from auth.sessoes where user_id = ${userId} and id is distinct from ${excetoSessaoId ?? null}::uuid`
  );
}
