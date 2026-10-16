import { NextResponse } from "next/server";
import { ErroAgendamento } from "@/lib/agendamento/disponibilidade";

// Respostas da API pública do agendamento: nunca em cache (disponibilidade muda a todo
// momento) e erros de regra com mensagem pronta pra mostrar ao cliente.
export function json(corpo: unknown, status = 200) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

export function tratarErro(erro: unknown) {
  if (erro instanceof ErroAgendamento) return json({ erro: erro.message }, 400);
  console.error("[agendamento]", erro);
  return json({ erro: "Não foi possível carregar agora. Tente de novo em instantes." }, 500);
}

export function lerServicos(params: URLSearchParams): string[] {
  return (params.get("servicos") ?? "").split(",").filter(Boolean);
}
