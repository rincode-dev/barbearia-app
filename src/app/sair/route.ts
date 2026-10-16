import { NextResponse } from "next/server";
import { encerrarSessao } from "@/lib/auth/sessao";

// Encerra a sessão e volta pro login. Usado quando a sessão venceu ou o usuário foi
// desativado com a sessão aberta (ver getCurrentProfile) — Route Handler porque,
// diferente de um Server Component, pode apagar o cookie de sessão.
export async function GET() {
  await encerrarSessao();
  // Location relativo, como o proxy faz: montar URL absoluta a partir do request dentro
  // do container daria o endereço interno (localhost:3000), não o que o navegador usou.
  return new NextResponse(null, { status: 307, headers: { Location: "/login" } });
}
