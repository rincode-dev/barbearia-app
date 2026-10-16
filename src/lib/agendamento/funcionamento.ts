// Status "Aberto / Fechado" do site — funções puras (sem banco, sem rede), testadas em
// scripts/testes/funcionamento.mts. Vale o horário de funcionamento cadastrado (várias
// faixas por dia = intervalo de almoço) menos os feriados/fechamentos da barbearia.
// Import relativo (não "@/"): permite rodar os testes direto no Node.
import { DIAS_SEMANA, dataHoraSP, instanteSP, somarDias } from "../datas.ts";
import { diaSemana, subtrair, type FaixaSemana, type Intervalo } from "./motor.ts";

// Períodos em que a barbearia está aberta, de `hoje` até `hoje + dias`, já sem os
// feriados e com faixas encostadas unidas (09–12 + 12–18 = aberto até 18:00).
export function periodosAbertos(
  funcionamento: FaixaSemana[],
  feriados: Intervalo[],
  hoje: string,
  dias = 14
): Intervalo[] {
  const periodos: Intervalo[] = [];
  for (let i = 0; i <= dias; i++) {
    const data = somarDias(hoje, i);
    for (const f of funcionamento) {
      if (f.dia_semana !== diaSemana(data)) continue;
      const inicio = instanteSP(data, f.inicio.slice(0, 5)).getTime();
      const fim = instanteSP(data, f.fim.slice(0, 5)).getTime();
      if (inicio < fim) periodos.push({ inicio, fim });
    }
  }
  const livres = subtrair(periodos, feriados).sort((a, b) => a.inicio - b.inicio);

  const unidos: Intervalo[] = [];
  for (const p of livres) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && p.inicio <= ultimo.fim) ultimo.fim = Math.max(ultimo.fim, p.fim);
    else unidos.push({ ...p });
  }
  return unidos;
}

export type StatusFuncionamento =
  | { aberto: true; fechaEm: number }
  | { aberto: false; abreEm: number | null };

export function statusFuncionamento(periodos: Intervalo[], agora: number): StatusFuncionamento {
  const atual = periodos.find((p) => p.inicio <= agora && agora < p.fim);
  if (atual) return { aberto: true, fechaEm: atual.fim };
  const proximo = periodos.find((p) => p.inicio > agora);
  return { aberto: false, abreEm: proximo?.inicio ?? null };
}

// Texto da linha de baixo: "Fecha às 18:00" / "Abre Sex às 09:00". null quando não há
// abertura cadastrada nos próximos dias.
export function detalheStatus(status: StatusFuncionamento): string | null {
  if (status.aberto) return `Fecha às ${dataHoraSP(new Date(status.fechaEm)).hora}`;
  if (status.abreEm === null) return null;
  const { data, hora } = dataHoraSP(new Date(status.abreEm));
  return `Abre ${DIAS_SEMANA[diaSemana(data)].slice(0, 3)} às ${hora}`;
}
