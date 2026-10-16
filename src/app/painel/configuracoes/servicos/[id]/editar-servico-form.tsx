"use client";

import { useActionState, useState } from "react";
import { atualizarServico } from "../actions";
import { CamposServico, type ServicoEditavel } from "../campos-servico";

export function EditarServicoForm({
  id,
  servico,
  fotoUrl,
}: {
  id: string;
  servico: ServicoEditavel;
  fotoUrl: string | null;
}) {
  const action = atualizarServico.bind(null, id);
  const [state, formAction, isPending] = useActionState(action, null);
  const [enviando, setEnviando] = useState(false);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:grid-cols-2 sm:p-5"
    >
      <CamposServico servico={servico} fotoUrl={fotoUrl} onEnviandoChange={setEnviando} />
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={isPending || enviando}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>
        {state?.error && (
          <p role="alert" className="mt-2 text-sm text-red-400">
            {state.error}
          </p>
        )}
        {state?.success && <p className="mt-2 text-sm text-emerald-400">{state.success}</p>}
      </div>
    </form>
  );
}
