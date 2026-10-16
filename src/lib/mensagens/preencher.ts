// Mensagens de WhatsApp (docs/ARQUITETURA.md, decisão 38): 6 tipos fixos com texto editável
// pelo admin (tabela mensagens_templates). Roda no servidor e no navegador (prévia ao
// vivo na tela de Configurações → Mensagens).
import type { StatusAgendamento } from "@/lib/agendamento/status";

export type TipoMensagem =
  | "confirmar_agendamento"
  | "lembrete"
  | "agendamento_confirmado"
  | "atendimento_concluido"
  | "reagendamento"
  | "cancelamento";

export const TIPOS_MENSAGEM: { tipo: TipoMensagem; rotulo: string; quando: string }[] = [
  { tipo: "confirmar_agendamento", rotulo: "Confirmar agendamento", quando: "Pedir ao cliente que confirme o horário." },
  { tipo: "lembrete", rotulo: "Lembrete", quando: "Lembrar o cliente do horário (ex.: na véspera)." },
  { tipo: "agendamento_confirmado", rotulo: "Agendamento confirmado", quando: "Avisar que o horário está confirmado." },
  { tipo: "atendimento_concluido", rotulo: "Atendimento concluído", quando: "Agradecer depois do atendimento." },
  { tipo: "reagendamento", rotulo: "Reagendamento", quando: "Avisar o novo dia/horário depois de reagendar." },
  { tipo: "cancelamento", rotulo: "Cancelamento", quando: "Avisar que o horário foi cancelado." },
];

export const ROTULO_MENSAGEM = Object.fromEntries(TIPOS_MENSAGEM.map((t) => [t.tipo, t.rotulo])) as Record<
  TipoMensagem,
  string
>;

// Mensagens oferecidas em cada status do agendamento (a primeira é a sugerida).
export const MENSAGENS_POR_STATUS: Record<StatusAgendamento, TipoMensagem[]> = {
  agendado: ["confirmar_agendamento", "agendamento_confirmado", "lembrete", "reagendamento", "cancelamento"],
  em_atendimento: [],
  concluido: ["atendimento_concluido"],
  cancelado: ["cancelamento"],
  nao_compareceu: ["cancelamento"],
};

export type VariaveisMensagem = {
  cliente?: string;
  barbearia?: string;
  data?: string;
  hora?: string;
  barbeiro?: string;
  servicos?: string;
  valor?: string;
  endereco?: string;
  site?: string;
};

export const VARIAVEIS: { chave: keyof VariaveisMensagem; descricao: string; exemplo: string }[] = [
  { chave: "cliente", descricao: "primeiro nome do cliente", exemplo: "Carlos" },
  { chave: "barbearia", descricao: "nome da barbearia", exemplo: "Barbearia" },
  { chave: "data", descricao: "dia do horário", exemplo: "sexta, 26/09" },
  { chave: "hora", descricao: "hora do horário", exemplo: "14:30" },
  { chave: "barbeiro", descricao: "nome do barbeiro", exemplo: "Rafael" },
  { chave: "servicos", descricao: "serviços", exemplo: "Corte + Barba" },
  { chave: "valor", descricao: "valor (previsto, ou o total da OS)", exemplo: "R$ 70,00" },
  { chave: "endereco", descricao: "endereço da barbearia", exemplo: "Rua das Flores, 100" },
  { chave: "site", descricao: "link do site para agendar", exemplo: "https://suabarbearia.com.br" },
];

// Troca {variavel} pelo valor. Variável sem valor (ex.: endereço não cadastrado) some
// da mensagem — o cliente nunca recebe "{endereco}" cru; a tela de Mensagens avisa o
// admin quando o texto usa um dado que não está cadastrado. Chave desconhecida fica
// como está (erro de digitação visível na prévia).
export function preencherTemplate(conteudo: string, variaveis: VariaveisMensagem): string {
  const conhecidas = new Set<string>(VARIAVEIS.map((v) => v.chave));
  return conteudo
    .replace(/\{(\w+)\}/g, (match, chave: string) => {
      if (!conhecidas.has(chave)) return match;
      return (variaveis as Record<string, string | undefined>)[chave]?.trim() ?? "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function variaveisDesconhecidas(conteudo: string): string[] {
  const conhecidas = new Set<string>(VARIAVEIS.map((v) => v.chave));
  return [...conteudo.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((c) => !conhecidas.has(c));
}
