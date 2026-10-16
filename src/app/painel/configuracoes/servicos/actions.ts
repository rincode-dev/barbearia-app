"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario, erroDoBanco, mensagemDeErro } from "@/lib/db";
import { removerArquivoPublico } from "@/lib/arquivos";

type FormState = { error?: string; success?: string } | null;

const CAMINHO = "/painel/configuracoes/servicos";

// "40", "40,50", "R$ 1.234,56" → número. null se inválido.
function lerPreco(bruto: string): number | null {
  const limpo = bruto.replace(/[R$\s]/g, "");
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  return normalizado !== "" && Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) / 100 : null;
}

type DadosServico = { nome: string; descricao: string | null; preco: number; duracao_minutos: number; ordem: number };

function lerServico(formData: FormData): DadosServico | string {
  const nome = String(formData.get("nome") ?? "").trim();
  const descricao = String(formData.get("descricao") ?? "").trim() || null;
  const preco = lerPreco(String(formData.get("preco") ?? ""));
  const duracao = Number(formData.get("duracao_minutos"));
  const ordem = Number(formData.get("ordem") ?? 0);

  if (!nome) return "O nome é obrigatório.";
  if (preco === null) return "Preço inválido.";
  if (!Number.isInteger(duracao) || duracao < 5 || duracao > 600) {
    return "A duração precisa ficar entre 5 e 600 minutos.";
  }
  return { nome, descricao, preco, duracao_minutos: duracao, ordem: Number.isInteger(ordem) ? ordem : 0 };
}

function mensagemErroBanco(error: { code?: string; message: string }): string {
  return error.code === "23505" ? "Já existe um serviço com esse nome." : error.message;
}

export async function criarServico(_prevState: string | null, formData: FormData): Promise<string | null> {
  const { userId } = await requireAdmin();
  const dados = lerServico(formData);
  if (typeof dados === "string") return dados;
  const foto_path = String(formData.get("foto_path") ?? "").trim() || null;
  let id: string;
  try {
    const [novo] = await comoUsuario(
      userId,
      (tx) => tx<{ id: string }[]>`
        insert into public.servicos (nome, descricao, preco, duracao_minutos, ordem, foto_path)
        values (${dados.nome}, ${dados.descricao}, ${dados.preco}, ${dados.duracao_minutos}, ${dados.ordem}, ${foto_path})
        returning id`
    );
    id = novo.id;
  } catch (e) {
    return `Não foi possível criar: ${mensagemErroBanco(erroDoBanco(e))}`;
  }

  if (formData.get("todos_barbeiros") === "on") {
    try {
      await comoUsuario(userId, (tx) => tx`select public.atribuir_servico_a_todos(p_servico_id => ${id}::uuid)`);
    } catch (e) {
      return `Serviço criado, mas não foi possível atribuir aos barbeiros: ${mensagemDeErro(e)}`;
    }
  }

  revalidatePath(CAMINHO);
  revalidatePath("/");
  redirect(CAMINHO);
}

export async function atualizarServico(id: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const { userId } = await requireAdmin();
  const dados = lerServico(formData);
  if (typeof dados === "string") return { error: dados };

  // Foto: o campo só vem preenchido quando uma imagem nova foi enviada (decisão 22); aí a
  // anterior é apagada do Storage depois de salvar.
  const novaFoto = String(formData.get("foto_path") ?? "").trim() || null;
  let fotoAnterior: string | null = null;
  try {
    fotoAnterior = await comoUsuario(userId, async (tx) => {
      const [atual] = novaFoto ? await tx`select foto_path from public.servicos where id = ${id}` : [];
      await tx`
        update public.servicos
        set nome = ${dados.nome}, descricao = ${dados.descricao}, preco = ${dados.preco},
            duracao_minutos = ${dados.duracao_minutos}, ordem = ${dados.ordem}
            ${novaFoto ? tx`, foto_path = ${novaFoto}` : tx``}
        where id = ${id}`;
      return (atual?.foto_path as string | null) ?? null;
    });
  } catch (e) {
    return { error: `Não foi possível salvar: ${mensagemErroBanco(erroDoBanco(e))}` };
  }

  if (fotoAnterior && fotoAnterior !== novaFoto) {
    await removerArquivoPublico(fotoAnterior);
  }

  revalidatePath(CAMINHO);
  revalidatePath(`${CAMINHO}/${id}`);
  revalidatePath("/");
  return { success: "Serviço atualizado. Agendamentos já feitos mantêm o preço e a duração da época." };
}

export async function alternarAtivoServico(id: string, ativo: boolean) {
  const { userId } = await requireAdmin();
  await comoUsuario(userId, (tx) => tx`update public.servicos set ativo = ${ativo} where id = ${id}`);
  revalidatePath(CAMINHO);
  revalidatePath(`${CAMINHO}/${id}`);
  revalidatePath("/");
}
