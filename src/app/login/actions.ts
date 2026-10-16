"use server";

import { redirect } from "next/navigation";
import { criarSessao, encerrarSessao, verificarCredenciais } from "@/lib/auth/sessao";

export async function login(_prevState: string | null, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const manterConectado = formData.get("manter_conectado") === "1";

  if (!email || !password) {
    return "Informe email e senha.";
  }

  const resultado = await verificarCredenciais(email, password);
  if (!resultado.ok) {
    if (resultado.motivo === "tentativas") return "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.";
    if (resultado.motivo === "bloqueado") return "Este acesso está desativado. Fale com o administrador.";
    return "Email ou senha inválidos.";
  }

  await criarSessao(resultado.userId, manterConectado);
  redirect("/painel");
}

export async function logout() {
  await encerrarSessao();
  redirect("/login");
}
