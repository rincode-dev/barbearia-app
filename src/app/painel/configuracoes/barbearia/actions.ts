"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario, mensagemDeErro } from "@/lib/db";
import { removerArquivoPublico } from "@/lib/arquivos";

type FormState = { error?: string; success?: string } | null;

function texto(formData: FormData, campo: string): string | null {
  const valor = String(formData.get(campo) ?? "").trim();
  return valor || null;
}

// "@barbearia", "barbearia" ou a URL completa → só o usuário.
function normalizarInstagram(valor: string | null): string | null {
  if (!valor) return null;
  const semUrl = valor.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "");
  return semUrl.replace(/^@/, "") || null;
}

export async function salvarDadosBarbearia(_prevState: FormState, formData: FormData): Promise<FormState> {
  const { userId } = await requireAdmin();
  const nome = texto(formData, "nome");
  if (!nome) return { error: "O nome da barbearia é obrigatório." };

  const mapaUrl = texto(formData, "mapa_url");
  if (mapaUrl && !/^https?:\/\//i.test(mapaUrl)) {
    return { error: "O link do mapa precisa começar com http:// ou https://." };
  }

  const novoLogo = texto(formData, "logo_path");
  const removerLogo = formData.get("remover_logo") === "on";
  let logoAnterior: string | null = null;
  let logoPath: string | null = null;
  try {
    [logoAnterior, logoPath] = await comoUsuario(userId, async (tx) => {
      const [atual] = await tx<{ logo_path: string | null }[]>`select logo_path from public.estabelecimento where id = 1`;
      const anterior = atual?.logo_path ?? null;
      const logo = novoLogo ?? (removerLogo ? null : anterior);
      await tx`
        update public.estabelecimento
        set nome = ${nome}, descricao = ${texto(formData, "descricao")}, logo_path = ${logo},
            endereco = ${texto(formData, "endereco")}, telefone = ${texto(formData, "telefone")},
            whatsapp = ${texto(formData, "whatsapp")}, instagram = ${normalizarInstagram(texto(formData, "instagram"))},
            mapa_url = ${mapaUrl}
        where id = 1`;
      return [anterior, logo] as const;
    });
  } catch (e) {
    return { error: `Não foi possível salvar: ${mensagemDeErro(e)}` };
  }

  // Logo trocado/removido: apaga o arquivo antigo (não fica lixo público).
  if (logoAnterior && logoAnterior !== logoPath) {
    await removerArquivoPublico(logoAnterior);
  }

  // Marca aparece em todo lugar (site, login, cabeçalho do painel, manifesto).
  revalidatePath("/", "layout");
  return { success: "Dados da barbearia atualizados." };
}
