// Números do Início e do Financeiro. Todo cálculo é feito no banco pela função
// relatorio_financeiro (migration 20260924170000_relatorios.sql — fórmulas no cabeçalho
// e em docs/ARQUITETURA.md, decisão 36). Ela roda com a sessão de quem chama: o barbeiro
// recebe só os próprios números (RLS), o admin tudo — por isso recebe a transação
// comoUsuario() de quem está vendo.
import { mensagemDeErro, type Tx } from "@/lib/db";
import type { FormaPagamento, MotivoDesconto } from "@/lib/os";

export type Relatorio = {
  de: string;
  ate: string;
  faturamento: number;
  atendimentos: number;
  ticket_medio: number;
  recebido: number;
  pendente: number;
  pendente_total: number;
  previsto: number;
  agendados: number;
  cancelamentos: number;
  nao_comparecimentos: number;
  descontos: {
    total: number;
    quantidade: number;
    media: number;
    por_motivo: { motivo: MotivoDesconto; quantidade: number; total: number }[];
  };
  formas: { forma: FormaPagamento; quantidade: number; total: number }[];
  servicos: { servico_id: string; nome: string; quantidade: number; total: number }[];
  barbeiros: {
    barbeiro_id: string;
    nome: string;
    atendimentos: number;
    faturamento: number;
    ticket_medio: number;
    descontos: number;
  }[];
  por_dia: { dia: string; atendimentos: number; faturamento: number; recebido: number }[];
};

export async function buscarRelatorio(
  tx: Tx,
  de: string,
  ate: string,
  barbeiro?: string | null
): Promise<Relatorio> {
  try {
    const [linha] = await tx`
      select public.relatorio_financeiro(p_de => ${de}::date, p_ate => ${ate}::date, p_barbeiro => ${barbeiro || null}::uuid) as r`;
    return linha.r as Relatorio;
  } catch (e) {
    throw new Error(`relatorio_financeiro: ${mensagemDeErro(e)}`);
  }
}
