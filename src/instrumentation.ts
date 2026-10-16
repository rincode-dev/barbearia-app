// Roda uma vez quando o servidor sobe (Next.js). Só no Node: liga o relógio que abre os
// atendimentos no horário marcado (src/lib/atendimento-automatico.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ligarRelogioDeAtendimentos } = await import("@/lib/atendimento-automatico");
    ligarRelogioDeAtendimentos();
  }
}
