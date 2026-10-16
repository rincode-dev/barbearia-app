import type { NextRequest } from "next/server";
import { horariosDisponiveis } from "@/lib/agendamento/disponibilidade";
import { json, lerServicos, tratarErro } from "../resposta";

// GET /api/agendamento/horarios?servicos=id,id&data=AAAA-MM-DD&barbeiro=id → inícios livres.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const { horarios } = await horariosDisponiveis(
      lerServicos(params),
      params.get("data") ?? "",
      params.get("barbeiro") ?? ""
    );
    return json({ horarios });
  } catch (erro) {
    return tratarErro(erro);
  }
}
