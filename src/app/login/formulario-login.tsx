"use client";

import { useState, type ReactNode } from "react";
import { useActionState } from "react";
import { login } from "./actions";

// `marca` vem pronta do Server Component (page.tsx), que lê o cadastro da barbearia.
export function FormularioLogin({ marca }: { marca: ReactNode }) {
  const [error, formAction, isPending] = useActionState(login, null);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  return (
    // Mesma linguagem do site do cliente (decisão 43): fundo escuro com brilho vermelho e
    // textura fina, título editorial, botão vermelho.
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-neutral-50 px-5 py-10">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(80%_60%_at_100%_0%,rgba(255,59,64,0.16),transparent_60%)]" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-[0.05] bg-[repeating-linear-gradient(135deg,#fff_0_1px,transparent_1px_9px)]" />

      <div className="w-full max-w-sm animate-surgir">
        <div className="mb-8 flex justify-center [&_img]:h-28 sm:[&_img]:h-32">{marca}</div>

        <div className="rounded-2xl border border-neutral-200 bg-surface/95 p-6 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] backdrop-blur-sm sm:p-8">
          <p className="flex items-center gap-3 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-neutral-500">
            Área da equipe
            <span aria-hidden="true" className="h-px w-8 bg-accent" />
          </p>
          <h1 className="mt-2 font-display text-[1.75rem] font-extrabold uppercase leading-[0.95] tracking-tight text-neutral-900">
            Acesse sua <span className="text-accent">conta</span>
          </h1>
          <p className="mb-6 mt-2 text-sm text-neutral-500">Entre com seu e-mail e senha.</p>

          <form action={formAction} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-neutral-700">
                E-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="username"
                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm text-neutral-900 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-neutral-700">
                Senha
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={mostrarSenha ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm text-neutral-900 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  tabIndex={-1}
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500 hover:text-neutral-900"
                >
                  {mostrarSenha ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.243 4.243L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-neutral-600">
              <input
                type="checkbox"
                name="manter_conectado"
                value="1"
                defaultChecked
                className="h-4 w-4 rounded border-neutral-300 bg-surface accent-accent"
              />
              Permanecer conectado
            </label>

            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-lg bg-accent py-3.5 font-display text-sm font-bold uppercase tracking-[0.14em] text-white shadow-[0_10px_30px_-12px_rgba(255,59,64,0.8)] transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.99] disabled:opacity-50"
            >
              {isPending ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
