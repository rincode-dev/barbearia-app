"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario, erroDoBanco } from "@/lib/db";
import { ErroAgendamento, horariosDisponiveis } from "@/lib/agendamento/disponibilidade";
import { mensagemErroAgenda, type StatusAgendamento } from "@/lib/agendamento/status";
import { normalizarTelefoneCliente } from "@/lib/clientes/telefone";
import { instanteSP } from "@/lib/datas";

type FormState = { error?: string; success?: string } | null;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

function revalidarAgenda(id?: string) {
  revalidatePath("/painel/agenda");
  if (id) revalidatePath(`/painel/agenda/${id}`);
  revalidatePath("/painel/clientes", "layout");
}

// Permissão (dono ou admin) e transições válidas: alterar_status_agendamento() no banco.
export async function alterarStatus(
  id: string,
  novo: StatusAgendamento,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const { userId } = await getCurrentProfile();
  const motivo = String(formData.get("motivo") ?? "").trim() || null;
  try {
    await comoUsuario(
      userId,
      (tx) => tx`select public.alterar_status_agendamento(p_id => ${id}::uuid, p_novo => ${novo}, p_motivo => ${motivo})`
    );
  } catch (e) {
    return { error: mensagemErroAgenda(erroDoBanco(e)) };
  }
  revalidarAgenda(id);
  return { success: "Status atualizado." };
}

export async function reagendar(id: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const { userId } = await getCurrentProfile();
  const data = String(formData.get("data") ?? "");
  const hora = String(formData.get("hora") ?? "");
  const barbeiro = String(formData.get("barbeiro_id") ?? "") || null;
  if (!DATA.test(data) || !HORA.test(hora)) return { error: "Informe a nova data e o horário." };

  try {
    await comoUsuario(
      userId,
      (tx) => tx`
        select public.reagendar_agendamento(
          p_id => ${id}::uuid,
          p_novo_inicio => ${instanteSP(data, hora).toISOString()}::timestamptz,
          p_novo_barbeiro_id => ${barbeiro}::uuid)`
    );
  } catch (e) {
    return { error: mensagemErroAgenda(erroDoBanco(e)) };
  }
  revalidarAgenda(id);
  return { success: "Reagendado." };
}

// Sugestão de horários livres para o encaixe (mesmo motor do site, em modo painel).
export async function buscarHorariosLivres(servicoIds: string[], data: string, barbeiroId: string) {
  await getCurrentProfile();
  try {
    const { horarios } = await horariosDisponiveis(servicoIds, data, barbeiroId, "painel");
    return { horarios };
  } catch (erro) {
    return { horarios: [] as string[], erro: erro instanceof ErroAgendamento ? erro.message : "Não foi possível calcular." };
  }
}

// Encaixe / agendamento pelo painel. Barbeiro só agenda para si; admin para qualquer um
// (conferido em criar_agendamento_painel). Cliente existente ou novo (dedupe por telefone).
export async function criarEncaixe(_prevState: FormState, formData: FormData): Promise<FormState> {
  const { profile } = await getCurrentProfile();

  const clienteId = String(formData.get("cliente_id") ?? "") || null;
  const nome = String(formData.get("cliente_nome") ?? "").trim();
  const telefone = normalizarTelefoneCliente(String(formData.get("cliente_telefone") ?? ""));
  const barbeiroId = profile.role === "admin" ? String(formData.get("barbeiro_id") ?? "") : profile.id;
  const servicoIds = formData.getAll("servicos").map(String);
  const data = String(formData.get("data") ?? "");
  const hora = String(formData.get("hora") ?? "");
  const observacao = String(formData.get("observacao") ?? "").trim() || null;

  if (!clienteId && (!nome || !telefone)) return { error: "Escolha um cliente ou informe nome e telefone do novo cliente." };
  if (!barbeiroId) return { error: "Escolha o barbeiro." };
  if (servicoIds.length === 0) return { error: "Escolha pelo menos um serviço." };
  if (!DATA.test(data) || !HORA.test(hora)) return { error: "Informe data e horário." };

  let novoId: string | null;
  try {
    const [linha] = await comoUsuario(
      profile.id,
      (tx) => tx`
        select public.criar_agendamento_painel(
          p_cliente_id => ${clienteId}::uuid,
          p_cliente_nome => ${nome},
          p_cliente_telefone => ${telefone},
          p_barbeiro_id => ${barbeiroId}::uuid,
          p_inicio => ${instanteSP(data, hora).toISOString()}::timestamptz,
          p_servico_ids => ${servicoIds}::uuid[],
          p_observacao => ${observacao}) as id`
    );
    novoId = linha?.id ?? null;
  } catch (e) {
    return { error: mensagemErroAgenda(erroDoBanco(e)) };
  }
  if (!novoId) return { error: "Não foi possível agendar." };

  revalidarAgenda();
  redirect(`/painel/agenda/${novoId}`);
}

// Reagendar: horários livres do barbeiro na data, para os serviços do próprio agendamento
// (o horário atual dele não conta como ocupado). Mesmo motor do site, em modo painel.
export async function horariosParaReagendar(agendamentoId: string, data: string, barbeiroId: string) {
  const { profile } = await getCurrentProfile();
  const [ag] = await comoUsuario(profile.id, async (tx) => {
    // RLS: o barbeiro só enxerga os próprios agendamentos.
    const linhas = await tx<{ barbeiro_id: string; servicos: string[] }[]>`
      select a.barbeiro_id,
             coalesce((select array_agg(s.servico_id order by s.ordem) from public.agendamento_servicos s where s.agendamento_id = a.id), '{}') as servicos
      from public.agendamentos a where a.id = ${agendamentoId}`;
    return linhas;
  });
  if (!ag) return { horarios: [] as string[], erro: "Agendamento não encontrado." };
  // Só o admin troca de barbeiro (reagendar_agendamento confere de novo ao salvar).
  const barbeiro = profile.role === "admin" && barbeiroId ? barbeiroId : ag.barbeiro_id;
  try {
    const { horarios } = await horariosDisponiveis(ag.servicos, data, barbeiro, "painel", agendamentoId);
    return { horarios };
  } catch (erro) {
    return { horarios: [] as string[], erro: erro instanceof ErroAgendamento ? erro.message : "Não foi possível calcular." };
  }
}

// Cliente adiantado: o atendimento passa a começar agora (fim recalculado pela duração dos
// serviços) e a OS é aberta — comecar_agora() no banco.
export async function comecarAgora(agendamentoId: string, _prevState: FormState): Promise<FormState> {
  const { userId } = await getCurrentProfile();
  let osId: string | null = null;
  try {
    const [linha] = await comoUsuario(userId, (tx) => tx`select public.comecar_agora(p_agendamento_id => ${agendamentoId}::uuid) as id`);
    osId = linha?.id ?? null;
  } catch (e) {
    const erro = erroDoBanco(e);
    if (erro.code === "23P01" || erro.code === "40P01") return { error: "O barbeiro tem outro cliente marcado dentro desse tempo. Conclua ou reagende o outro antes." };
    return { error: mensagemErroAgenda(erro) };
  }
  if (!osId) return { error: "Não foi possível começar." };
  revalidarAgenda(agendamentoId);
  redirect(`/painel/atendimentos/${osId}`);
}
