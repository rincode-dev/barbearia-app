"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario, mensagemDeErro } from "@/lib/db";

type FormState = { error?: string; success?: string } | null;

const CAMINHO = "/painel/configuracoes/horarios";

function lerFaixas(formData: FormData): unknown {
  try {
    return JSON.parse(String(formData.get("faixas") ?? "[]"));
  } catch {
    return null;
  }
}

// Validação de verdade (início < fim, sem sobreposição) e a troca tudo-ou-nada ficam na
// função do banco substituir_horarios_funcionamento().
export async function salvarFuncionamento(_prevState: FormState, formData: FormData): Promise<FormState> {
  const { userId } = await requireAdmin();
  const faixas = lerFaixas(formData);
  if (!Array.isArray(faixas)) return { error: "Formato inválido de horários." };

  try {
    await comoUsuario(
      userId,
      (tx) => tx`select public.substituir_horarios_funcionamento(p_faixas => ${tx.json(faixas as Parameters<typeof tx.json>[0])})`
    );
  } catch (e) {
    return { error: mensagemDeErro(e) };
  }

  revalidatePath(CAMINHO);
  revalidatePath("/");
  return { success: "Horário de funcionamento salvo." };
}

const GRANULARIDADES = [5, 10, 15, 20, 30, 60];

export async function salvarRegrasAgendamento(_prevState: FormState, formData: FormData): Promise<FormState> {
  const { userId } = await requireAdmin();
  const antecedencia = Number(formData.get("antecedencia_minima_minutos"));
  const janela = Number(formData.get("janela_agendamento_dias"));
  const granularidade = Number(formData.get("granularidade_minutos"));
  const politica = String(formData.get("politica_cancelamento") ?? "").trim() || null;

  if (!Number.isInteger(antecedencia) || antecedencia < 0) return { error: "Antecedência inválida." };
  if (!Number.isInteger(janela) || janela < 1 || janela > 365) {
    return { error: "O limite de dias precisa ficar entre 1 e 365." };
  }
  if (!GRANULARIDADES.includes(granularidade)) return { error: "Intervalo entre horários inválido." };

  try {
    await comoUsuario(
      userId,
      (tx) => tx`
        update public.estabelecimento
        set antecedencia_minima_minutos = ${antecedencia}, janela_agendamento_dias = ${janela},
            granularidade_minutos = ${granularidade}, politica_cancelamento = ${politica}
        where id = 1`
    );
  } catch (e) {
    return { error: `Não foi possível salvar: ${mensagemDeErro(e)}` };
  }

  revalidatePath(CAMINHO);
  return { success: "Regras de agendamento salvas." };
}
