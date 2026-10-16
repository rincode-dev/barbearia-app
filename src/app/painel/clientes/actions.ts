"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { codigoDeErro, comoUsuario, mensagemDeErro } from "@/lib/db";
import { normalizarTelefoneCliente, telefoneValido } from "@/lib/clientes/telefone";

type ClienteExistente = { id: string; nome: string; arquivado: boolean };
type NovoClienteState = { error?: string; duplicado?: ClienteExistente } | null;
type FormState = { error?: string; success?: string; duplicado?: ClienteExistente } | null;

// Usa limit(1) em vez de maybeSingle(): telefone só vai ser de fato único depois
// da migration de constraint aplicada e da base existente ser corrigida — até lá
// (ou em qualquer corrida antes do commit da constraint) pode já haver mais de uma
// linha com o mesmo telefone, e maybeSingle() rejeita isso com erro em vez de
// devolver uma linha, o que faria essa checagem falhar silenciosamente.
async function buscarClientePorTelefone(userId: string, telefone: string) {
  const [cliente] = await comoUsuario(
    userId,
    (tx) => tx<{ id: string; nome: string; deleted_at: string | null }[]>`
      select id, nome, deleted_at from public.clientes
      where telefone = ${telefone}
      order by deleted_at asc nulls first
      limit 1`
  );
  if (!cliente) return null;
  return { id: cliente.id, nome: cliente.nome, arquivado: !!cliente.deleted_at } satisfies ClienteExistente;
}

export async function criarCliente(_prevState: NovoClienteState, formData: FormData): Promise<NovoClienteState> {
  const { userId } = await getCurrentProfile();

  const nome = String(formData.get("nome") ?? "").trim();
  const telefone = normalizarTelefoneCliente(String(formData.get("telefone") ?? ""));

  if (!nome) return { error: "Nome é obrigatório." };
  if (!telefone) return { error: "Telefone é obrigatório." };
  if (!telefoneValido(telefone)) return { error: "Telefone inválido — informe DDD + número." };

  const existente = await buscarClientePorTelefone(userId, telefone);
  if (existente) {
    return {
      error: `Já existe um cliente cadastrado com esse telefone: ${existente.nome}.`,
      duplicado: existente,
    };
  }

  let data: { id: string } | undefined;
  try {
    [data] = await comoUsuario(
      userId,
      (tx) => tx<{ id: string }[]>`
        insert into public.clientes (nome, telefone, criado_por) values (${nome}, ${telefone}, ${userId}) returning id`
    );
  } catch (error) {
    // corrida rara: dois cadastros com o mesmo telefone ao mesmo tempo — a
    // constraint do banco pega o que a checagem acima não pegou.
    if (codigoDeErro(error) === "23505") {
      const existenteAposCorrida = await buscarClientePorTelefone(userId, telefone);
      return {
        error: `Já existe um cliente cadastrado com esse telefone${
          existenteAposCorrida ? `: ${existenteAposCorrida.nome}` : ""
        }.`,
        duplicado: existenteAposCorrida ?? undefined,
      };
    }
    return { error: `Não foi possível criar o cliente: ${mensagemDeErro(error)}` };
  }
  if (!data) return { error: "Não foi possível criar o cliente." };

  revalidatePath("/painel/clientes");
  redirect(`/painel/clientes/${data.id}`);
}

export async function atualizarCliente(
  id: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const { userId } = await getCurrentProfile();

  const nome = String(formData.get("nome") ?? "").trim();
  const telefone = normalizarTelefoneCliente(String(formData.get("telefone") ?? ""));
  const observacoes = String(formData.get("observacoes") ?? "").trim();

  if (!nome) return { error: "Nome é obrigatório." };
  if (!telefone) return { error: "Telefone é obrigatório." };
  if (!telefoneValido(telefone)) return { error: "Telefone inválido — informe DDD + número." };

  const existente = await buscarClientePorTelefone(userId, telefone);
  if (existente && existente.id !== id) {
    return {
      error: `Esse telefone já pertence a outro cliente: ${existente.nome}.`,
      duplicado: existente,
    };
  }

  try {
    await comoUsuario(
      userId,
      (tx) => tx`
        update public.clientes set nome = ${nome}, telefone = ${telefone}, observacoes = ${observacoes || null}
        where id = ${id}`
    );
  } catch (error) {
    if (codigoDeErro(error) === "23505") {
      return { error: "Esse telefone já pertence a outro cliente." };
    }
    return { error: `Não foi possível salvar: ${mensagemDeErro(error)}` };
  }

  revalidatePath("/painel/clientes");
  revalidatePath(`/painel/clientes/${id}`);
  return { success: "Dados atualizados." };
}

// Arquivar = marcar deleted_at (some da listagem padrão, mas nada é apagado —
// agendamentos e OS continuam vinculados ao cadastro). Restaurar =
// só limpar deleted_at, sem criar ou duplicar nenhum registro.
export async function alternarAtivoCliente(id: string, arquivar: boolean) {
  const { userId } = await getCurrentProfile();

  await comoUsuario(
    userId,
    (tx) => tx`update public.clientes set deleted_at = ${arquivar ? new Date().toISOString() : null} where id = ${id}`
  );

  revalidatePath("/painel/clientes");
  revalidatePath(`/painel/clientes/${id}`);
}

// Mesma restauração de `alternarAtivoCliente`, mas levando direto pro cadastro —
// usado no aviso de telefone duplicado, quando o cliente já existe arquivado.
export async function restaurarClienteERedirecionar(id: string) {
  await alternarAtivoCliente(id, false);
  redirect(`/painel/clientes/${id}`);
}
