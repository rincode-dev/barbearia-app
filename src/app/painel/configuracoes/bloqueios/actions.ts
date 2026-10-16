"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario, mensagemDeErro } from "@/lib/db";
import { instanteSP, somarDias } from "@/lib/datas";

type FormState = { error?: string; success?: string } | null;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

// profileId nulo = feriado/fechamento da barbearia inteira; senão folga/bloqueio do
// barbeiro. `caminho` é a página a revalidar (horários ou página do barbeiro).
export async function criarBloqueio(
  profileId: string | null,
  caminho: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const { userId } = await requireAdmin();

  const tipo = profileId ? String(formData.get("tipo") ?? "folga") : "feriado";
  if (profileId && tipo !== "folga" && tipo !== "bloqueio") return { error: "Tipo inválido." };

  const dataInicio = String(formData.get("data_inicio") ?? "");
  const dataFim = String(formData.get("data_fim") ?? "") || dataInicio;
  const diaInteiro = formData.get("dia_inteiro") === "on";
  const horaInicio = String(formData.get("hora_inicio") ?? "");
  const horaFim = String(formData.get("hora_fim") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim() || null;

  if (!DATA.test(dataInicio) || !DATA.test(dataFim)) return { error: "Informe as datas." };
  if (dataFim < dataInicio) return { error: "A data final não pode ser antes da inicial." };

  let inicio: Date;
  let fim: Date;
  if (diaInteiro) {
    // Dias inteiros no fuso da barbearia: [00:00 do 1º dia, 00:00 do dia seguinte ao último).
    inicio = instanteSP(dataInicio, "00:00");
    fim = instanteSP(somarDias(dataFim, 1), "00:00");
  } else {
    if (!HORA.test(horaInicio) || !HORA.test(horaFim)) return { error: "Informe o horário de início e de fim." };
    inicio = instanteSP(dataInicio, horaInicio);
    fim = instanteSP(dataFim, horaFim);
    if (fim <= inicio) return { error: "O fim precisa ser depois do início." };
  }

  try {
    await comoUsuario(
      userId,
      (tx) => tx`
        insert into public.bloqueios (profile_id, tipo, inicio, fim, motivo, criado_por)
        values (${profileId}, ${tipo}, ${inicio.toISOString()}, ${fim.toISOString()}, ${motivo}, ${userId})`
    );
  } catch (e) {
    return { error: `Não foi possível salvar: ${mensagemDeErro(e)}` };
  }

  revalidatePath(caminho);
  return { success: "Bloqueio adicionado." };
}

export async function removerBloqueio(id: string, caminho: string) {
  const { userId } = await requireAdmin();
  await comoUsuario(userId, (tx) => tx`delete from public.bloqueios where id = ${id}`);
  revalidatePath(caminho);
}
