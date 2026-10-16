// Monta a grade horária da visão Dia (uma coluna por barbeiro): blocos posicionados pelo
// horário e duração, e as faixas "fora do expediente" (fora do funcionamento da
// barbearia, fora da jornada, intervalo, folga/bloqueio/feriado). Função pura — tudo em
// minutos do dia no fuso da barbearia; quem desenha é grade-dia.tsx.
// Imports relativos com .ts (como o motor): o arquivo roda direto no Node nos testes
// (scripts/testes/grade.mts), que não conhece o atalho "@/".
import { dataHoraSP, formatarDuracao } from "../../../lib/datas.ts";
import { intersectar, subtrair, type Intervalo } from "../../../lib/agendamento/motor.ts";
import type { StatusAgendamento } from "@/lib/agendamento/status";
import type { ItemAgenda } from "./visoes";

export type BlocoGrade = {
  id: string;
  inicio: number;
  fim: number;
  status: StatusAgendamento;
  cliente: string | null; // null = agendamento de colega (só a ocupação)
  servicos: string;
  faixa: string; // "10:00–10:30"
  duracao: string; // "30 min"
  href: string | null;
  // Sobreposição (só acontece com cancelado/não compareceu, que liberam o horário).
  pista: number;
  pistas: number;
};

export type ColunaGrade = {
  id: string;
  nome: string;
  eu: boolean;
  podeAgendar: boolean;
  blocos: BlocoGrade[];
  fora: Intervalo[]; // indisponível (hachurado)
};

export type Grade = { inicio: number; fim: number; colunas: ColunaGrade[] };

type Faixa = { inicio: string; fim: string }; // "09:00:00"
type Bloqueio = { profile_id: string | null; inicio: string; fim: string };

const DIA_INTEIRO: Intervalo = { inicio: 0, fim: 24 * 60 };

export function minutosDoDia(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

// Instante → minutos no dia `data` (cortado ao dia: começou ontem = 0, termina amanhã = 1440).
function minutosNoDia(instante: string, data: string): number {
  const { data: d, hora } = dataHoraSP(new Date(instante));
  if (d < data) return 0;
  if (d > data) return DIA_INTEIRO.fim;
  return minutosDoDia(hora);
}

const faixas = (lista: Faixa[]): Intervalo[] =>
  lista.map((f) => ({ inicio: minutosDoDia(f.inicio), fim: minutosDoDia(f.fim) }));

// Distribui blocos que se sobrepõem lado a lado (pistas), por grupo de sobreposição.
function distribuirPistas(blocos: BlocoGrade[]): BlocoGrade[] {
  const ordenados = [...blocos].sort((a, b) => a.inicio - b.inicio || b.fim - a.fim);
  let grupo: BlocoGrade[] = [];
  let fimGrupo = -1;
  const fechar = () => {
    const pistas = Math.max(0, ...grupo.map((b) => b.pista)) + 1;
    grupo.forEach((b) => (b.pistas = pistas));
    grupo = [];
  };
  for (const b of ordenados) {
    if (b.inicio >= fimGrupo && grupo.length) fechar();
    const ocupadas = new Set(grupo.filter((g) => g.fim > b.inicio).map((g) => g.pista));
    let pista = 0;
    while (ocupadas.has(pista)) pista++;
    b.pista = pista;
    grupo.push(b);
    fimGrupo = Math.max(fimGrupo, b.fim);
  }
  if (grupo.length) fechar();
  return ordenados;
}

export function montarGrade(p: {
  data: string;
  itens: ItemAgenda[];
  barbeiros: { id: string; nome: string }[];
  funcionamento: Faixa[]; // do dia da semana
  jornadas: (Faixa & { profile_id: string })[]; // do dia da semana
  bloqueios: Bloqueio[]; // que tocam o dia
  euId: string;
  admin: boolean;
}): Grade {
  const aberto = faixas(p.funcionamento);
  const feriados = p.bloqueios
    .filter((b) => b.profile_id === null)
    .map((b) => ({ inicio: minutosNoDia(b.inicio, p.data), fim: minutosNoDia(b.fim, p.data) }));

  // Colunas: barbeiros que atendem + quem tem agendamento no dia e não está na lista
  // (ex.: desativado depois de agendar). O barbeiro logado vê a própria coluna primeiro.
  const conhecidos = new Map(p.barbeiros.map((b) => [b.id, b.nome]));
  for (const i of p.itens) if (!conhecidos.has(i.barbeiro_id)) conhecidos.set(i.barbeiro_id, i.barbeiro_nome);
  const ids = [...conhecidos.keys()].sort((a, b) => (a === p.euId ? -1 : b === p.euId ? 1 : 0));

  const colunas: ColunaGrade[] = ids.map((id) => {
    const trabalha = faixas(p.jornadas.filter((j) => j.profile_id === id));
    const folgas = p.bloqueios
      .filter((b) => b.profile_id === id)
      .map((b) => ({ inicio: minutosNoDia(b.inicio, p.data), fim: minutosNoDia(b.fim, p.data) }));
    const disponivel = subtrair(intersectar(aberto, trabalha), [...feriados, ...folgas]);
    const blocos = p.itens
      .filter((i) => i.barbeiro_id === id)
      .map((i): BlocoGrade => {
        const inicio = minutosNoDia(i.inicio, p.data);
        const fim = Math.max(minutosNoDia(i.fim, p.data), inicio + 5);
        return {
          id: i.id,
          inicio,
          fim,
          status: i.status,
          cliente: i.pode_ver_detalhes ? i.cliente_nome : null,
          servicos: i.servicos,
          faixa: `${dataHoraSP(new Date(i.inicio)).hora}–${dataHoraSP(new Date(i.fim)).hora}`,
          duracao: formatarDuracao(Math.round((new Date(i.fim).getTime() - new Date(i.inicio).getTime()) / 60000)),
          href: i.pode_ver_detalhes ? `/painel/agenda/${i.id}` : null,
          pista: 0,
          pistas: 1,
        };
      });
    return {
      id,
      nome: conhecidos.get(id) || "Sem nome",
      eu: id === p.euId,
      podeAgendar: p.admin || id === p.euId,
      blocos: distribuirPistas(blocos),
      fora: subtrair([DIA_INTEIRO], disponivel),
    };
  });

  // Janela visível: do primeiro ao último horário de funcionamento/jornada/agendamento,
  // em horas cheias; dia sem nada cadastrado = 08:00–20:00.
  const marcos = [
    ...aberto.flatMap((f) => [f.inicio, f.fim]),
    ...faixas(p.jornadas).flatMap((f) => [f.inicio, f.fim]),
    ...colunas.flatMap((c) => c.blocos.flatMap((b) => [b.inicio, b.fim])),
  ];
  const inicio = marcos.length ? Math.floor(Math.min(...marcos) / 60) * 60 : 8 * 60;
  const fim = marcos.length ? Math.ceil(Math.max(...marcos) / 60) * 60 : 20 * 60;
  return { inicio, fim: Math.max(fim, inicio + 60), colunas };
}

// Minuto do dia que deve ficar no topo ao abrir a grade (ver GradeDia):
// - hoje, com `agora` dentro da janela → agora − 60 (a última hora como contexto);
// - senão (hoje antes de abrir/depois de fechar, ou outro dia) → 1º atendimento ativo
//   − 30; sem atendimento → início da grade.
export function posicaoInicial(grade: Grade, agora: number | null): number {
  if (agora !== null && agora >= grade.inicio && agora < grade.fim) return Math.max(grade.inicio, agora - 60);
  const inicios = grade.colunas.flatMap((c) =>
    c.blocos.filter((b) => b.status !== "cancelado" && b.status !== "nao_compareceu").map((b) => b.inicio)
  );
  return inicios.length ? Math.max(grade.inicio, Math.min(...inicios) - 30) : grade.inicio;
}
