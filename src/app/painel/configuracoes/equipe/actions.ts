"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { encerrarSessoesDoUsuario } from "@/lib/auth/sessao";
import { codigoDeErro, comoSistema, comoUsuario, mensagemDeErro } from "@/lib/db";
import { removerArquivoPublico } from "@/lib/arquivos";

type FormState = { error?: string; success?: string } | null;

const CAMINHO_EQUIPE = "/painel/configuracoes/equipe";

function lerPapel(formData: FormData): "admin" | "colaborador" | null {
  const role = String(formData.get("role") ?? "colaborador");
  return role === "admin" || role === "colaborador" ? role : null;
}

export async function criarMembro(_prevState: string | null, formData: FormData) {
  const { userId: adminId } = await requireAdmin();

  const nome = String(formData.get("nome") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  const telefone = String(formData.get("telefone") ?? "").trim();
  const role = lerPapel(formData);
  const atendeComoBarbeiro = formData.get("atende_como_barbeiro") === "on";

  if (!nome || !email || !senha) {
    return "Preencha nome, email e senha.";
  }
  if (senha.length < 6) {
    return "A senha precisa ter pelo menos 6 caracteres.";
  }
  if (!role) {
    return "Permissão inválida.";
  }

  // Sistema (ignora RLS) só depois do requireAdmin() acima. O trigger handle_new_user
  // cria o profile (nome vem do raw_user_meta_data) como colaborador.
  let novoId: string;
  try {
    const [novo] = await comoSistema(
      (tx) => tx`
        insert into auth.users (email, encrypted_password, raw_user_meta_data)
        values (${email}, extensions.crypt(${senha}, extensions.gen_salt('bf', 10)), ${tx.json({ nome })})
        returning id`
    );
    novoId = novo.id;
  } catch (e) {
    return codigoDeErro(e) === "23505"
      ? "Já existe um usuário com esse email."
      : `Não foi possível criar o acesso: ${mensagemDeErro(e)}`;
  }

  // Completa os dados escolhidos no formulário como o admin logado (RLS de profiles).
  try {
    await comoUsuario(
      adminId,
      (tx) => tx`
        update public.profiles
        set telefone = ${telefone || null}, role = ${role}, atende_como_barbeiro = ${atendeComoBarbeiro}
        where id = ${novoId}`
    );
  } catch (e) {
    return `Acesso criado, mas não foi possível salvar os dados: ${mensagemDeErro(e)}`;
  }

  revalidatePath(CAMINHO_EQUIPE);
  redirect(CAMINHO_EQUIPE);
}

export async function atualizarMembro(
  id: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const { profile: admin } = await requireAdmin();

  const nome = String(formData.get("nome") ?? "").trim();
  const telefone = String(formData.get("telefone") ?? "").trim();
  const role = lerPapel(formData);
  const atendeComoBarbeiro = formData.get("atende_como_barbeiro") === "on";
  const ordemSite = Number(formData.get("ordem_site") ?? 100);

  if (!nome) return { error: "Nome é obrigatório." };
  if (!Number.isInteger(ordemSite) || ordemSite < 0 || ordemSite > 999) return { error: "Ordem no site: use um número de 0 a 999." };
  if (!role) return { error: "Permissão inválida." };
  // Nunca deixar o sistema sem nenhum admin: ninguém rebaixa a si mesmo.
  if (id === admin.id && role !== "admin") {
    return { error: "Você não pode remover seu próprio acesso de administrador." };
  }

  try {
    await comoUsuario(
      admin.id,
      (tx) => tx`
        update public.profiles
        set nome = ${nome}, telefone = ${telefone || null}, role = ${role},
            atende_como_barbeiro = ${atendeComoBarbeiro}, ordem_site = ${ordemSite}
        where id = ${id}`
    );
  } catch (e) {
    return { error: `Não foi possível salvar: ${mensagemDeErro(e)}` };
  }

  revalidatePath(CAMINHO_EQUIPE);
  revalidatePath(`${CAMINHO_EQUIPE}/${id}`);
  revalidatePath("/");
  return { success: "Dados atualizados." };
}

// ---------------------------------------------------------------------------
// Dados de atendimento do barbeiro (Fase 1): foto, serviços que realiza, jornada.
// ---------------------------------------------------------------------------

export async function salvarFotoMembro(id: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const { userId: adminId } = await requireAdmin();
  const novaFoto = String(formData.get("foto_path") ?? "").trim() || null;
  const remover = formData.get("remover_foto") === "on";
  if (!novaFoto && !remover) return { error: "Escolha uma imagem ou marque para remover." };

  let fotoAnterior: string | null;
  try {
    fotoAnterior = await comoUsuario(adminId, async (tx) => {
      const [atual] = await tx`select foto_path from public.profiles where id = ${id}`;
      await tx`update public.profiles set foto_path = ${novaFoto} where id = ${id}`;
      return (atual?.foto_path as string | null) ?? null;
    });
  } catch (e) {
    return { error: `Não foi possível salvar: ${mensagemDeErro(e)}` };
  }

  // Foto antiga não fica esquecida na pasta pública.
  if (fotoAnterior && fotoAnterior !== novaFoto) {
    await removerArquivoPublico(fotoAnterior);
  }

  revalidatePath(`${CAMINHO_EQUIPE}/${id}`);
  return { success: novaFoto ? "Foto atualizada." : "Foto removida." };
}

export async function salvarServicosMembro(id: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const { userId: adminId } = await requireAdmin();
  const servicoIds = formData.getAll("servicos").map(String);

  try {
    await comoUsuario(adminId, (tx) => tx`select public.definir_servicos_barbeiro(${id}, ${servicoIds}::uuid[])`);
  } catch (e) {
    return { error: `Não foi possível salvar: ${mensagemDeErro(e)}` };
  }

  revalidatePath(`${CAMINHO_EQUIPE}/${id}`);
  revalidatePath("/painel/configuracoes/servicos");
  return { success: "Serviços atualizados." };
}

// Validação (início < fim, sem sobreposição) e troca tudo-ou-nada: substituir_jornada().
export async function salvarJornadaMembro(id: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const { userId: adminId } = await requireAdmin();
  let faixas: unknown;
  try {
    faixas = JSON.parse(String(formData.get("faixas") ?? "[]"));
  } catch {
    return { error: "Formato inválido de horários." };
  }
  if (!Array.isArray(faixas)) return { error: "Formato inválido de horários." };

  try {
    // tx.json: o objeto vai como jsonb de verdade (texto com ::jsonb viraria uma string JSON).
    await comoUsuario(adminId, (tx) => tx`select public.substituir_jornada(${id}, ${tx.json(faixas as Parameters<typeof tx.json>[0])})`);
  } catch (e) {
    return { error: mensagemDeErro(e) };
  }

  revalidatePath(`${CAMINHO_EQUIPE}/${id}`);
  return { success: "Jornada salva." };
}

export async function alternarAtivo(id: string, novoValor: boolean) {
  const { profile: admin } = await requireAdmin();

  if (id === admin.id && !novoValor) {
    throw new Error("Você não pode desativar sua própria conta.");
  }

  await comoUsuario(admin.id, (tx) => tx`update public.profiles set ativo = ${novoValor} where id = ${id}`);

  // Bloqueia (ou libera) o login de fato, não só o dado exibido na tela — desativar =
  // banir por 100 anos, como era no Supabase — e derruba as sessões abertas.
  if (novoValor) {
    await comoSistema((tx) => tx`update auth.users set banned_until = null, updated_at = now() where id = ${id}`);
  } else {
    await comoSistema(
      (tx) => tx`update auth.users set banned_until = now() + interval '100 years', updated_at = now() where id = ${id}`
    );
    await encerrarSessoesDoUsuario(id);
  }

  revalidatePath(CAMINHO_EQUIPE);
  revalidatePath(`${CAMINHO_EQUIPE}/${id}`);
}

export async function resetarSenha(
  id: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const { sessaoId } = await requireAdmin();

  const novaSenha = String(formData.get("novaSenha") ?? "");
  if (novaSenha.length < 6) {
    return { error: "A senha precisa ter pelo menos 6 caracteres." };
  }

  try {
    await comoSistema(
      (tx) => tx`
        update auth.users
        set encrypted_password = extensions.crypt(${novaSenha}, extensions.gen_salt('bf', 10)), updated_at = now()
        where id = ${id}`
    );
  } catch (e) {
    return { error: mensagemDeErro(e) };
  }
  // Senha nova derruba os outros aparelhos dessa pessoa (a sessão de quem trocou fica).
  await encerrarSessoesDoUsuario(id, sessaoId);

  return { success: "Senha redefinida." };
}
