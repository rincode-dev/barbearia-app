import type { NextRequest } from "next/server";
import { barbeirosDisponiveis } from "@/lib/agendamento/disponibilidade";
import { json, lerServicos, tratarErro } from "../resposta";

// GET /api/agendamento/barbeiros?servicos=id,id&data=AAAA-MM-DD → barbeiros que fazem
// todos os serviços, com quantos horários livres têm no dia.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const barbeiros = await barbeirosDisponiveis(lerServicos(params), params.get("data") ?? "");
    return json({ barbeiros });
  } catch (erro) {
    return tratarErro(erro);
  }
}
