// Métricas de comportamento do cliente (ficha do cliente). Só atendimentos CONCLUÍDOS
// entram (cancelado/não compareceu/ainda marcado não contam). Função pura, testada em
// scripts/testes/metricas-cliente.mts.
//
// - Ticket médio: média do valor realmente cobrado (total da OS, já com desconto) por
//   atendimento concluído.
// - Retorno médio: intervalo médio, em dias, entre um atendimento concluído e o próximo.
//   Conta DIAS distintos (dois serviços no mesmo dia são uma visita só, senão um intervalo
//   de 0 dia puxaria a média para baixo). Média dos intervalos = (último − primeiro) ÷
//   (visitas − 1). Precisa de pelo menos 2 visitas.
// - Sem retornar: dias desde o último atendimento concluído até hoje.
// - Atraso: quanto passou do intervalo habitual (só com retorno médio calculado e sem
//   horário já marcado) — é o que ajuda a achar quem está sumindo.

export type AtendimentoConcluido = { dia: string; valor: number }; // dia AAAA-MM-DD (fuso da barbearia)

export type MetricasCliente = {
  atendimentos: number;
  ticketMedio: number | null;
  visitas: number;
  retornoMedioDias: number | null;
  diasSemRetornar: number | null;
  atrasoDias: number | null; // > 0 = passou do habitual
};

// Folga antes de considerar "atrasado": 25% do intervalo habitual, no mínimo 7 dias.
const tolerancia = (retorno: number) => Math.max(7, Math.round(retorno * 0.25));

export function diasEntre(de: string, ate: string): number {
  const utc = (d: string) => {
    const [a, m, dia] = d.split("-").map(Number);
    return Date.UTC(a, m - 1, dia);
  };
  return Math.round((utc(ate) - utc(de)) / 86_400_000);
}

export function calcularMetricas(
  atendimentos: AtendimentoConcluido[],
  hoje: string,
  temHorarioMarcado = false
): MetricasCliente {
  const n = atendimentos.length;
  const ticketMedio = n ? Math.round((atendimentos.reduce((s, a) => s + a.valor, 0) / n) * 100) / 100 : null;

  const dias = [...new Set(atendimentos.map((a) => a.dia))].sort();
  const visitas = dias.length;
  const retornoMedioDias =
    visitas >= 2 ? Math.round(diasEntre(dias[0], dias[visitas - 1]) / (visitas - 1)) : null;
  // Atendimento concluído "no futuro" (atendido antes do dia marcado) não gera negativo.
  const diasSemRetornar = visitas ? Math.max(0, diasEntre(dias[visitas - 1], hoje)) : null;

  const atrasoDias =
    retornoMedioDias !== null && diasSemRetornar !== null && !temHorarioMarcado
      ? diasSemRetornar - retornoMedioDias > tolerancia(retornoMedioDias)
        ? diasSemRetornar - retornoMedioDias
        : null
      : null;

  return { atendimentos: n, ticketMedio, visitas, retornoMedioDias, diasSemRetornar, atrasoDias };
}

// "Retorna em média a cada 37 dias" / "a cada 1 dia".
export function textoDias(n: number): string {
  return n === 1 ? "1 dia" : `${n} dias`;
}
