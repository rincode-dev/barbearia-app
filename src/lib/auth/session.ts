import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { COOKIE_SESSAO } from "./cookie";
import { lerSessao } from "./sessao";

export type Profile = {
  id: string;
  nome: string;
  role: "admin" | "colaborador";
  ativo: boolean;
  telefone: string | null;
  atende_como_barbeiro: boolean;
};

// Uma consulta por requisição, mesmo com várias chamadas no layout e na página.
export const getCurrentProfile = cache(async function getCurrentProfile(): Promise<{
  userId: string;
  sessaoId: string;
  email: string | null;
  profile: Profile;
}> {
  const sessao = await lerSessao();

  if (!sessao) {
    // Cookie velho (sessão vencida/apagada): /sair apaga o cookie; sem cookie, direto ao
    // login. Ir ao /login com o cookie ainda lá faria o proxy mandar de volta ao painel.
    const temCookie = (await cookies()).has(COOKIE_SESSAO);
    redirect(temCookie ? "/sair" : "/login");
  }

  const [profile] = await comoUsuario(
    sessao.userId,
    (tx) => tx<Profile[]>`
      select id, nome, role, ativo, telefone, atende_como_barbeiro
      from public.profiles where id = ${sessao.userId}`
  );

  // profile deveria sempre existir (trigger handle_new_user); desativado com sessão
  // aberta também sai. Em ambos os casos pelo /sair, que apaga a sessão e o cookie (um
  // Server Component não consegue apagar cookie).
  if (!profile || !profile.ativo) {
    redirect("/sair");
  }

  return { userId: sessao.userId, sessaoId: sessao.sessaoId, email: sessao.email, profile };
});

export async function requireAdmin() {
  const session = await getCurrentProfile();

  if (session.profile.role !== "admin" || !session.profile.ativo) {
    redirect("/painel");
  }

  return session;
}
