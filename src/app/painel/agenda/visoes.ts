import { dataHoraSP, somarDias } from "@/lib/datas";
import { diaSemana } from "@/lib/agendamento/motor";
import type { StatusAgendamento } from "@/lib/agendamento/status";

export type Visao = "dia" | "semana" | "mes";

export type ItemAgenda = {
  id: string;
  barbeiro_id: string;
  barbeiro_nome: string;
  inicio: string;
  fim: string;
  status: StatusAgendamento;
  servicos: string;
  pode_ver_detalhes: boolean;
  cliente_nome: string | null;
  valor_total: number | null;
};

export const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Período [de, ate] (datas inclusivas, no fuso da barbearia) de cada visão.
export function periodo(visao: Visao, data: string): { de: string; ate: string } {
  if (visao === "dia") return { de: data, ate: data };
  if (visao === "semana") {
    const dow = diaSemana(data);
    const segunda = somarDias(data, dow === 0 ? -6 : 1 - dow);
    return { de: segunda, ate: somarDias(segunda, 6) };
  }
  const [ano, mes] = data.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  return { de: `${ano}-${mm}-01`, ate: `${ano}-${mm}-${String(ultimo).padStart(2, "0")}` };
}

// Data de referência do período anterior/seguinte.
export function deslocar(visao: Visao, data: string, sentido: 1 | -1): string {
  if (visao === "dia") return somarDias(data, sentido);
  if (visao === "semana") return somarDias(data, 7 * sentido);
  const [ano, mes] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1 + sentido, 1));
  return alvo.toISOString().slice(0, 10);
}

export function dataDoItem(item: { inicio: string }): string {
  return dataHoraSP(new Date(item.inicio)).data;
}

export function faixaDoItem(item: { inicio: string; fim: string }): string {
  return `${dataHoraSP(new Date(item.inicio)).hora}–${dataHoraSP(new Date(item.fim)).hora}`;
}
