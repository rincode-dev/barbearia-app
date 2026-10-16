// Status do agendamento (docs/ARQUITETURA.md, "Status do agendamento" e decisão 48):
// Agendado → (no horário, sozinho) Em atendimento = OS aberta → Concluído. Sem confirmar,
// "cliente chegou" nem "iniciar". As transições válidas são garantidas no banco
// (alterar_status_agendamento); aqui só o que a tela oferece.
export type StatusAgendamento = "agendado" | "em_atendimento" | "concluido" | "cancelado" | "nao_compareceu";

export const STATUS_ROTULO: Record<StatusAgendamento, string> = {
  agendado: "Agendado",
  em_atendimento: "Em atendimento",
  concluido: "Concluído",
  cancelado: "Cancelado",
  nao_compareceu: "Não compareceu",
};

export const STATUS_CLASSE: Record<StatusAgendamento, string> = {
  agendado: "bg-sky-500/10 text-sky-300",
  em_atendimento: "bg-violet-500/15 text-violet-300",
  concluido: "bg-emerald-500/15 text-emerald-300",
  cancelado: "bg-neutral-200 text-neutral-500 line-through",
  nao_compareceu: "bg-red-500/10 text-red-400",
};

// Não ocupam a agenda (liberam o horário).
export const STATUS_INATIVOS: StatusAgendamento[] = ["cancelado", "nao_compareceu"];

export type Acao = { para: StatusAgendamento; rotulo: string; pedeMotivo?: boolean };

// Botão principal por status. Em atendimento/concluído a tela é a da OS.
export const PROXIMO_PASSO: Partial<Record<StatusAgendamento, Acao>> = {
  cancelado: { para: "agendado", rotulo: "Reabrir agendamento" },
  nao_compareceu: { para: "agendado", rotulo: "Reabrir agendamento" },
};

// "Mais ações" por status (sempre transições aceitas pelo banco).
export const OUTRAS_ACOES: Partial<Record<StatusAgendamento, Acao[]>> = {
  agendado: [{ para: "cancelado", rotulo: "Cancelar", pedeMotivo: true }],
};

export const PODE_REAGENDAR: StatusAgendamento[] = ["agendado"];

// Erros de regra levantados pelas funções do banco (P0001) e pela trava de sobreposição.
const MENSAGENS: Record<string, string> = {
  AGENDAMENTO_NAO_ENCONTRADO: "Agendamento não encontrado.",
  SEM_PERMISSAO: "Você não tem permissão para alterar este agendamento.",
  TRANSICAO_INVALIDA: "Essa mudança não é possível no status atual. Recarregue a página.",
  OS_COM_PAGAMENTO: "Há pagamento registrado nesta OS. Estorne antes de marcar não compareceu ou reagendar.",
  BARBEIRO_INDISPONIVEL: "Esse barbeiro não está ativo para atendimento.",
  SERVICOS_INVALIDOS: "Algum serviço não está ativo ou não é feito por esse barbeiro.",
  CLIENTE_NAO_ENCONTRADO: "Cliente não encontrado.",
  NOME_INVALIDO: "Informe o nome do cliente.",
  TELEFONE_INVALIDO: "Telefone inválido — informe DDD + número.",
};

export function mensagemErroAgenda(error: { code?: string; message: string }): string {
  if (error.code === "23P01" || error.code === "40P01") return "Esse barbeiro já tem um agendamento nesse horário.";
  return MENSAGENS[error.message] ?? error.message;
}
