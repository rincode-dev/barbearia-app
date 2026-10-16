"use client";

import { useActionState } from "react";
import { criarCliente, restaurarClienteERedirecionar } from "./actions";

export function NovoClienteForm() {
  const [state, formAction, isPending] = useActionState(criarCliente, null);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <h2 className="text-sm font-semibold text-neutral-900">Novo cliente</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Só nome e telefone por aqui — os demais dados são coletados depois, pelas fichas.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm text-neutral-700">Nome</label>
        <input
          name="nome"
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-neutral-700">Telefone</label>
        <input
          name="telefone"
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {state?.error && (
        <div className="sm:col-span-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <p role="alert">{state.error}</p>
          {state.duplicado && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <a
                href={`/painel/clientes/${state.duplicado.id}`}
                className="text-sm font-medium text-red-300 underline hover:text-red-200"
              >
                Ver cliente existente
              </a>
              {state.duplicado.arquivado && (
                <form action={restaurarClienteERedirecionar.bind(null, state.duplicado.id)}>
                  <button
                    type="submit"
                    className="rounded-lg border border-red-500/30 bg-surface px-3 py-1 text-sm font-medium text-red-300 hover:bg-red-500/10"
                  >
                    Restaurar cliente arquivado
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {isPending ? "Criando..." : "Criar cliente"}
        </button>
      </div>
    </form>
  );
}
