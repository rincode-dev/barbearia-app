"use client";

import { useActionState } from "react";
import { criarMembro } from "./actions";
import { CamposPermissao } from "./campos-permissao";

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function NovoMembroForm() {
  const [error, formAction, isPending] = useActionState(criarMembro, null);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <h2 className="text-sm font-semibold text-neutral-900">Novo acesso</h2>
      </div>

      <div>
        <label htmlFor="nome" className="mb-1 block text-sm text-neutral-700">Nome</label>
        <input id="nome" name="nome" required autoComplete="name" className={INPUT} />
      </div>

      <div>
        <label htmlFor="telefone" className="mb-1 block text-sm text-neutral-700">Telefone (opcional)</label>
        <input id="telefone" name="telefone" type="tel" autoComplete="tel" className={INPUT} />
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm text-neutral-700">Email (login)</label>
        <input id="email" name="email" type="email" required autoComplete="off" className={INPUT} />
      </div>

      <div>
        <label htmlFor="senha" className="mb-1 block text-sm text-neutral-700">Senha inicial</label>
        <input
          id="senha"
          name="senha"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className={INPUT}
        />
      </div>

      <CamposPermissao />

      {error && (
        <p role="alert" className="sm:col-span-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {isPending ? "Criando..." : "Criar acesso"}
        </button>
      </div>
    </form>
  );
}
