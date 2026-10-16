// Motor de disponibilidade — funções puras (sem banco, sem rede), testáveis isoladamente.
// Regras em docs/ARQUITETURA.md, seção "Motor de disponibilidade". Um início só é oferecido se
// o atendimento INTEIRO [início, início + duração) couber:
//   - dentro do funcionamento da barbearia naquele dia (respeitando intervalos);
//   - dentro da jornada do barbeiro naquele dia (respeitando intervalos);
//   - sem tocar bloqueio/feriado/folga nem outro agendamento ativo;
//   - a partir do instante mínimo (agora + antecedência mínima).
// Os candidatos andam de `granularidade` em `granularidade` minutos a partir de 00:00.
// Import relativo (não "@/"): permite rodar os testes do motor direto no Node.
import { instanteSP } from "../datas.ts";

export type FaixaSemana = { dia_semana: number; inicio: string; fim: string };

// Intervalo absoluto em milissegundos (epoch), meio-aberto: [inicio, fim).
export type Intervalo = { inicio: number; fim: number };

const MINUTO = 60_000;

export function diaSemana(data: string): number {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

function faixasDoDia(faixas: FaixaSemana[], data: string): Intervalo[] {
  const dow = diaSemana(data);
  return faixas
    .filter((f) => f.dia_semana === dow)
    .map((f) => ({
      inicio: instanteSP(data, f.inicio.slice(0, 5)).getTime(),
      fim: instanteSP(data, f.fim.slice(0, 5)).getTime(),
    }))
    .filter((i) => i.inicio < i.fim)
    .sort((a, b) => a.inicio - b.inicio);
}

// Interseção de duas listas de intervalos.
export function intersectar(a: Intervalo[], b: Intervalo[]): Intervalo[] {
  const resultado: Intervalo[] = [];
  for (const x of a) {
    for (const y of b) {
      const inicio = Math.max(x.inicio, y.inicio);
      const fim = Math.min(x.fim, y.fim);
      if (inicio < fim) resultado.push({ inicio, fim });
    }
  }
  return resultado.sort((p, q) => p.inicio - q.inicio);
}

// Remove de `livres` tudo que toca algum intervalo de `ocupados`.
export function subtrair(livres: Intervalo[], ocupados: Intervalo[]): Intervalo[] {
  let atual = livres;
  for (const o of ocupados) {
    const proximo: Intervalo[] = [];
    for (const l of atual) {
      if (o.fim <= l.inicio || o.inicio >= l.fim) {
        proximo.push(l); // não se tocam ([) meio-aberto: encostar não conflita)
        continue;
      }
      if (o.inicio > l.inicio) proximo.push({ inicio: l.inicio, fim: o.inicio });
      if (o.fim < l.fim) proximo.push({ inicio: o.fim, fim: l.fim });
    }
    atual = proximo;
  }
  return atual;
}

export type ParametrosDia = {
  data: string; // AAAA-MM-DD (dia na barbearia)
  duracaoMinutos: number;
  granularidadeMinutos: number;
  inicioMinimo: number; // ms epoch — agora + antecedência mínima
  funcionamento: FaixaSemana[]; // semana inteira da barbearia
  jornada: FaixaSemana[]; // semana inteira do barbeiro
  indisponiveis: Intervalo[]; // bloqueios, feriados e agendamentos ativos do barbeiro
};

// Horários de início livres ("HH:MM", hora de parede na barbearia), em ordem.
export function horariosLivres(p: ParametrosDia): string[] {
  if (p.duracaoMinutos <= 0 || p.granularidadeMinutos <= 0) return [];

  const janelas = subtrair(
    intersectar(faixasDoDia(p.funcionamento, p.data), faixasDoDia(p.jornada, p.data)),
    p.indisponiveis
  );
  if (janelas.length === 0) return [];

  const duracao = p.duracaoMinutos * MINUTO;
  const horarios: string[] = [];
  for (let minuto = 0; minuto < 24 * 60; minuto += p.granularidadeMinutos) {
    const hora = `${String(Math.floor(minuto / 60)).padStart(2, "0")}:${String(minuto % 60).padStart(2, "0")}`;
    const inicio = instanteSP(p.data, hora).getTime();
    if (inicio < p.inicioMinimo) continue;
    const fim = inicio + duracao;
    if (janelas.some((j) => j.inicio <= inicio && fim <= j.fim)) horarios.push(hora);
  }
  return horarios;
}
