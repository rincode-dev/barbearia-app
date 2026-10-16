"use client";

import { useActionState } from "react";
import { atualizarCliente } from "../actions";

type Cliente = {
  id: string;
  nome: string;
  telefone: string | null;
  observacoes: string | null;
};

export function EditarClienteForm({ cliente }: { cliente: Cliente }) {
  const action = atualizarCliente.bind(null, cliente.id);
  const [state, formAction, isPending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5 sm:grid-cols-2"
    >
      <div>
        <label className="mb-1 block text-sm text-neutral-700">Nome</label>
        <input
          name="nome"
          defaultValue={cliente.nome}
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-neutral-700">Telefone</label>
        <input
          name="telefone"
          defaultValue={cliente.telefone ?? ""}
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm text-neutral-700">Observações</label>
        <textarea
          name="observacoes"
          rows={2}
          defaultValue={cliente.observacoes ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {state?.error && (
        <p role="alert" className="sm:col-span-2 text-sm text-red-400">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="sm:col-span-2 text-sm text-emerald-400">{state.success}</p>
      )}
    </form>
  );
}
