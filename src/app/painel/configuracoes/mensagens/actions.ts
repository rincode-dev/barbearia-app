"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario, mensagemDeErro } from "@/lib/db";
import { TIPOS_MENSAGEM, variaveisDesconhecidas, type TipoMensagem } from "@/lib/mensagens/preencher";

type FormState = { error?: string; success?: string } | null;

function tipoValido(tipo: string): tipo is TipoMensagem {
  return TIPOS_MENSAGEM.some((t) => t.tipo === tipo);
}

// Um só formulário (e um só estado de aviso) para salvar e restaurar: o botão
// "Restaurar texto padrão" envia acao=restaurar.
export async function salvarMensagem(tipo: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const { userId } = await requireAdmin();
  if (!tipoValido(tipo)) return { error: "Tipo de mensagem inválido." };
  if (formData.get("acao") === "restaurar") return restaurarMensagem(userId, tipo);

  const conteudo = String(formData.get("conteudo") ?? "").trim();
  if (!conteudo) return { error: "O texto não pode ficar vazio." };
  if (conteudo.length > 1000) return { error: "Use no máximo 1000 caracteres." };
  const desconhecidas = variaveisDesconhecidas(conteudo);
  if (desconhecidas.length) {
    return { error: `Variável desconhecida: ${desconhecidas.map((v) => `{${v}}`).join(", ")}. Confira a lista acima.` };
  }

  try {
    await comoUsuario(userId, (tx) => tx`update public.mensagens_templates set conteudo = ${conteudo} where tipo = ${tipo}`);
  } catch (e) {
    return { error: `Não foi possível salvar: ${mensagemDeErro(e)}` };
  }

  revalidatePath("/painel/configuracoes/mensagens");
  return { success: "Mensagem salva." };
}

async function restaurarMensagem(userId: string, tipo: TipoMensagem): Promise<FormState> {
  try {
    const restauradas = await comoUsuario(
      userId,
      (tx) => tx`update public.mensagens_templates set conteudo = conteudo_padrao where tipo = ${tipo} returning tipo`
    );
    if (restauradas.length === 0) return { error: "Mensagem não encontrada." };
  } catch (e) {
    return { error: `Não foi possível restaurar: ${mensagemDeErro(e)}` };
  }

  revalidatePath("/painel/configuracoes/mensagens");
  return { success: "Texto padrão restaurado." };
}
