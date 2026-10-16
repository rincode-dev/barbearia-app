"use client";

import { useActionState, useState } from "react";
import { criarServico } from "./actions";
import { CamposServico } from "./campos-servico";

export function NovoServicoForm() {
  const [error, formAction, isPending] = useActionState(criarServico, null);
  const [enviando, setEnviando] = useState(false);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:grid-cols-2 sm:p-5"
    >
      <h2 className="text-sm font-semibold text-neutral-900 sm:col-span-2">Novo serviço</h2>
      <CamposServico onEnviandoChange={setEnviando} />
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-700">
        <input type="checkbox" name="todos_barbeiros" defaultChecked className="h-4 w-4 accent-accent" />
        Todos os barbeiros realizam
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-400 sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={isPending || enviando}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {isPending ? "Criando..." : "Criar serviço"}
        </button>
      </div>
    </form>
  );
}
