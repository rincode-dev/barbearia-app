"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario, erroDoBanco, type Tx } from "@/lib/db";
import { FORMAS_PAGAMENTO, lerValorBR, mensagemErroOS } from "@/lib/os";
import { instanteSP } from "@/lib/datas";

type FormState = { error?: string; success?: string } | null;

// Toda regra (permissão, OS aberta, total >= pago, pagamento <= restante) está nas funções
// do banco; aqui só lê o formulário, chama e traduz o erro.
function revalidarOS(osId: string) {
  revalidatePath(`/painel/atendimentos/${osId}`);
  revalidatePath("/painel/atendimentos");
  revalidatePath("/painel/agenda", "layout");
  revalidatePath("/painel/clientes", "layout");
}

// Chama a função do banco como o usuário logado. Devolve a mensagem de erro já
// traduzida, ou null se deu certo.
async function chamar(fn: (tx: Tx) => Promise<unknown>): Promise<string | null> {
  const { userId } = await getCurrentProfile();
  try {
    await comoUsuario(userId, fn);
    return null;
  } catch (e) {
    return mensagemErroOS(erroDoBanco(e));
  }
}

function lerValor(bruto: FormDataEntryValue | null): number | null {
  const limpo = String(bruto ?? "").replace(/[R$%\s]/g, "");
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  return normalizado !== "" && Number.isFinite(n) ? n : null;
}

export async function adicionarServico(osId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const servicoId = String(formData.get("servico_id") ?? "");
  if (!servicoId) return { error: "Escolha o serviço." };
  const erro = await chamar(
    (tx) => tx`select public.adicionar_servico_os(p_os_id => ${osId}::uuid, p_servico_id => ${servicoId}::uuid)`
  );
  if (erro) return { error: erro };
  revalidarOS(osId);
  return { success: "Serviço adicionado." };
}

export async function removerServico(osId: string, itemId: string, _prev: FormState): Promise<FormState> {
  const erro = await chamar((tx) => tx`select public.remover_servico_os(p_item_id => ${itemId}::uuid)`);
  if (erro) return { error: erro };
  revalidarOS(osId);
  return { success: "Serviço removido." };
}

export async function aplicarDesconto(osId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const remover = formData.get("remover") === "1";
  const tipo = String(formData.get("tipo") ?? "");
  const valor = lerValor(formData.get("valor"));
  const motivo = String(formData.get("motivo") ?? "");
  const observacao = String(formData.get("observacao") ?? "").trim() || null;
  if (!remover) {
    if (tipo !== "fixo" && tipo !== "percentual") return { error: "Escolha o tipo de desconto." };
    if (valor === null || valor <= 0) return { error: "Informe o valor do desconto." };
    if (!motivo) return { error: "Escolha o motivo do desconto." };
    if (motivo === "personalizado" && !observacao) return { error: "Descreva o motivo personalizado." };
  }
  const erro = await chamar(
    (tx) => tx`
      select public.aplicar_desconto_os(
        p_os_id => ${osId}::uuid,
        p_tipo => ${remover ? null : tipo},
        p_valor => ${remover ? 0 : valor}::numeric,
        p_motivo => ${remover ? null : motivo},
        p_observacao => ${remover ? null : observacao})`
  );
  if (erro) return { error: erro };
  revalidarOS(osId);
  return { success: remover ? "Desconto removido." : "Desconto aplicado." };
}

// Uma ou mais formas de uma vez (ex.: parte em dinheiro, parte no Pix). O banco grava
// todas ou nenhuma (registrar_pagamentos) — nunca fica meio registrado.
export async function registrarPagamentos(osId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  let partes: { forma: string; valor: string }[];
  try {
    partes = JSON.parse(String(formData.get("pagamentos") ?? "[]"));
  } catch {
    return { error: "Pagamento inválido." };
  }
  if (!Array.isArray(partes) || partes.length === 0) return { error: "Informe pelo menos uma forma de pagamento." };
  const pagamentos: { forma: string; valor: number }[] = [];
  for (const p of partes) {
    const valor = lerValorBR(String(p?.valor ?? ""));
    if (!FORMAS_PAGAMENTO.some((f) => f.valor === p?.forma)) return { error: "Escolha a forma de pagamento." };
    if (valor === null || valor <= 0) return { error: "Informe o valor de cada forma de pagamento." };
    pagamentos.push({ forma: p.forma, valor });
  }
  const erro = await chamar(
    (tx) => tx`select public.registrar_pagamentos(p_os_id => ${osId}::uuid, p_pagamentos => ${tx.json(pagamentos)})`
  );
  if (erro) return { error: erro };
  revalidarOS(osId);
  return { success: pagamentos.length > 1 ? `${pagamentos.length} pagamentos registrados.` : "Pagamento registrado." };
}

export async function estornarPagamento(osId: string, pagamentoId: string, _prev: FormState): Promise<FormState> {
  const erro = await chamar((tx) => tx`select public.estornar_pagamento(p_pagamento_id => ${pagamentoId}::uuid)`);
  if (erro) return { error: erro };
  revalidarOS(osId);
  return { success: "Pagamento estornado." };
}

export async function concluirAtendimento(osId: string, _prev: FormState): Promise<FormState> {
  const erro = await chamar((tx) => tx`select public.concluir_atendimento(p_os_id => ${osId}::uuid)`);
  if (erro) return { error: erro };
  revalidarOS(osId);
  return { success: "Atendimento concluído." };
}

export async function reabrirAtendimento(osId: string, _prev: FormState): Promise<FormState> {
  const erro = await chamar((tx) => tx`select public.reabrir_atendimento(p_os_id => ${osId}::uuid)`);
  if (erro) return { error: erro };
  revalidarOS(osId);
  return { success: "OS reaberta." };
}

// Durante o atendimento (decisão 48): "Não compareceu" e "Reagendou" tiram a OS (o banco
// recusa se houver pagamento ativo) e levam de volta ao agendamento.
export async function naoCompareceu(osId: string, agendamentoId: string, _prev: FormState): Promise<FormState> {
  const erro = await chamar(
    (tx) => tx`select public.alterar_status_agendamento(p_id => ${agendamentoId}::uuid, p_novo => ${"nao_compareceu"})`
  );
  if (erro) return { error: erro };
  revalidarOS(osId);
  redirect(`/painel/agenda/${agendamentoId}`);
}

export async function reagendarDaOS(osId: string, agendamentoId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const data = String(formData.get("data") ?? "");
  const hora = String(formData.get("hora") ?? "");
  const barbeiro = String(formData.get("barbeiro_id") ?? "") || null;
  if (!/^d{4}-d{2}-d{2}$/.test(data) || !/^d{2}:d{2}$/.test(hora)) return { error: "Informe a nova data e o horário." };
  const erro = await chamar(
    (tx) => tx`
      select public.reagendar_agendamento(
        p_id => ${agendamentoId}::uuid,
        p_novo_inicio => ${instanteSP(data, hora).toISOString()}::timestamptz,
        p_novo_barbeiro_id => ${barbeiro}::uuid)`
  );
  if (erro) return { error: erro };
  revalidarOS(osId);
  redirect(`/painel/agenda/${agendamentoId}`);
}
