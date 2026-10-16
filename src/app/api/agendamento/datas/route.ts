import type { NextRequest } from "next/server";
import { datasDisponiveis } from "@/lib/agendamento/disponibilidade";
import { json, lerServicos, tratarErro } from "../resposta";

// GET /api/agendamento/datas?servicos=id,id → dias da janela com/sem horário livre.
export async function GET(request: NextRequest) {
  try {
    const { ctx, datas } = await datasDisponiveis(lerServicos(request.nextUrl.searchParams));
    return json({ duracaoTotal: ctx.duracaoTotal, valorTotal: ctx.valorTotal, datas });
  } catch (erro) {
    return tratarErro(erro);
  }
}
