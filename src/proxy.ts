import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO } from "@/lib/auth/cookie";

// Next.js 16: "proxy" substitui a convenção antiga "middleware" (descontinuada).
// Checagem otimista (só "tem cookie de sessão?"), como recomenda a documentação do Next:
// o proxy roda em toda requisição, então não consulta o banco. A validação de verdade
// (sessão existe, não venceu, usuário ativo) é feita no servidor por getCurrentProfile().
//
// Só o painel exige login. O resto (site da barbearia com o agendamento online em "/",
// "/agendar" — hoje só redireciona para "/" —, "/login") é público — docs/ARQUITETURA.md, decisão 1.
const PREFIXO_PAINEL = "/painel";

export function proxy(request: NextRequest) {
  const temSessao = request.cookies.has(COOKIE_SESSAO);
  const { pathname } = request.nextUrl;
  const ehPainel = pathname === PREFIXO_PAINEL || pathname.startsWith(`${PREFIXO_PAINEL}/`);

  if (!temSessao && ehPainel) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }
  if (temSessao && pathname === "/login") {
    const painelUrl = request.nextUrl.clone();
    painelUrl.pathname = PREFIXO_PAINEL;
    return NextResponse.redirect(painelUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // manifest.webmanifest também precisa passar sem sessão — é o navegador/SO que
    // busca ele sozinho, em background, pra decidir se oferece "Adicionar à tela
    // inicial".
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
