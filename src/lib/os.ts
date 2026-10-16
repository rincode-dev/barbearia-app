// Ordem de Serviço: rótulos, formatação e mensagens (regras garantidas no banco —
// migration 20260924160000_ordens_servico.sql).

export type StatusOS = "aberta" | "concluida" | "cancelada";
export type StatusPagamento = "pendente" | "parcial" | "pago";
export type FormaPagamento = "dinheiro" | "pix" | "debito" | "credito" | "outros";
export type MotivoDesconto = "fidelidade" | "promocao" | "cortesia" | "cupom" | "personalizado";

// "OS Nº 000152"
export function numeroOS(numero: number | string): string {
  return String(numero).padStart(6, "0");
}

// A OS só ganha número ao ser concluída (decisão 49): antes disso é "OS em andamento";
// cancelada sem nunca ter sido concluída fica sem número.
export function tituloOS(numero: number | string | null, status: StatusOS): string {
  if (numero !== null) return `OS Nº ${numeroOS(numero)}`;
  return status === "cancelada" ? "OS cancelada" : "OS em andamento";
}

export const STATUS_OS_ROTULO: Record<StatusOS, string> = {
  aberta: "Em atendimento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const STATUS_OS_CLASSE: Record<StatusOS, string> = {
  aberta: "bg-violet-500/15 text-violet-300",
  concluida: "bg-emerald-500/15 text-emerald-300",
  cancelada: "bg-neutral-200 text-neutral-500 line-through",
};

export const STATUS_PAGAMENTO_ROTULO: Record<StatusPagamento, string> = {
  pendente: "Pagamento pendente",
  parcial: "Pagamento parcial",
  pago: "Pago",
};

export const STATUS_PAGAMENTO_CLASSE: Record<StatusPagamento, string> = {
  pendente: "bg-red-500/10 text-red-400",
  parcial: "bg-amber-500/15 text-amber-300",
  pago: "bg-emerald-500/15 text-emerald-300",
};

export const FORMAS_PAGAMENTO: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "pix", rotulo: "Pix" },
  { valor: "debito", rotulo: "Débito" },
  { valor: "credito", rotulo: "Crédito" },
  { valor: "outros", rotulo: "Outros" },
];

// "40", "40,50", "R$ 1.234,56" → 40 / 40.5 / 1234.56. null se não for número.
export function lerValorBR(bruto: string): number | null {
  const limpo = bruto.replace(/[R$%\s]/g, "");
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  return normalizado !== "" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export const FORMA_ROTULO = Object.fromEntries(FORMAS_PAGAMENTO.map((f) => [f.valor, f.rotulo])) as Record<
  FormaPagamento,
  string
>;

export const MOTIVOS_DESCONTO: { valor: MotivoDesconto; rotulo: string }[] = [
  { valor: "fidelidade", rotulo: "Cliente fidelidade" },
  { valor: "promocao", rotulo: "Promoção" },
  { valor: "cortesia", rotulo: "Cortesia" },
  { valor: "cupom", rotulo: "Cupom" },
  { valor: "personalizado", rotulo: "Personalizado" },
];

export const MOTIVO_ROTULO = Object.fromEntries(MOTIVOS_DESCONTO.map((m) => [m.valor, m.rotulo])) as Record<
  MotivoDesconto,
  string
>;

const MENSAGENS: Record<string, string> = {
  OS_NAO_ENCONTRADA: "Ordem de serviço não encontrada.",
  SEM_PERMISSAO: "Você não tem permissão para esta ação.",
  OS_FECHADA: "Esta OS não está mais aberta.",
  TRANSICAO_INVALIDA: "Essa ação não é possível no status atual. Recarregue a página.",
  AGENDAMENTO_NAO_ENCONTRADO: "Agendamento não encontrado.",
  SERVICOS_INVALIDOS: "Serviço inválido ou desativado.",
  ITEM_NAO_ENCONTRADO: "Serviço não encontrado na OS.",
  DESCONTO_INVALIDO: "Desconto inválido (percentual até 100%, valor maior que zero).",
  MOTIVO_DESCONTO_INVALIDO: "Escolha o motivo do desconto.",
  VALOR_INVALIDO: "Informe um valor maior que zero.",
  PAGAMENTO_ACIMA_DO_RESTANTE: "O pagamento é maior do que o valor que falta.",
  PAGAMENTO_NAO_ENCONTRADO: "Pagamento não encontrado ou já estornado.",
  OS_SEM_SERVICOS: "Adicione pelo menos um serviço antes de concluir.",
  OS_COM_PAGAMENTO: "Há pagamento registrado nesta OS. Estorne antes de marcar não compareceu ou reagendar.",
  BARBEIRO_INDISPONIVEL: "Esse barbeiro não está ativo para atendimento.",
};

export function mensagemErroOS(error: { code?: string; message: string }): string {
  // Constraint ordens_servico_pago_ate_o_total: o total ficaria abaixo do já pago.
  if (error.code === "23514") return "O total ficaria menor que o valor já pago. Estorne um pagamento antes.";
  // Trava de sobreposição da agenda (reagendar pela OS).
  if (error.code === "23P01" || error.code === "40P01") return "Esse barbeiro já tem um agendamento nesse horário.";
  return MENSAGENS[error.message] ?? error.message;
}
