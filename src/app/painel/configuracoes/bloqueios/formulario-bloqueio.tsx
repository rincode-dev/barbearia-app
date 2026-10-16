"use client";

import { useActionState, useState } from "react";
import { criarBloqueio } from "./actions";

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function FormularioBloqueio({
  profileId,
  caminho,
  hoje,
}: {
  profileId: string | null;
  caminho: string;
  hoje: string;
}) {
  const action = criarBloqueio.bind(null, profileId, caminho);
  const [state, formAction, isPending] = useActionState(action, null);
  const [diaInteiro, setDiaInteiro] = useState(true);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-3 border-t border-neutral-200 pt-4">
      {profileId && (
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="tipo" className="mb-1 block text-sm text-neutral-700">Tipo</label>
          <select id="tipo" name="tipo" defaultValue="folga" className={INPUT}>
            <option value="folga">Folga</option>
            <option value="bloqueio">Bloqueio de horário</option>
          </select>
        </div>
      )}
      <div className={profileId ? "col-span-2 sm:col-span-1" : "col-span-2"}>
        <label htmlFor="motivo" className="mb-1 block text-sm text-neutral-700">Motivo (opcional)</label>
        <input
          id="motivo"
          name="motivo"
          placeholder={profileId ? "Ex.: consulta médica" : "Ex.: Natal"}
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor="data_inicio" className="mb-1 block text-sm text-neutral-700">De</label>
        <input id="data_inicio" name="data_inicio" type="date" min={hoje} required className={INPUT} />
      </div>
      <div>
        <label htmlFor="data_fim" className="mb-1 block text-sm text-neutral-700">Até (opcional)</label>
        <input id="data_fim" name="data_fim" type="date" min={hoje} className={INPUT} />
      </div>

      <label className="col-span-2 flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          name="dia_inteiro"
          checked={diaInteiro}
          onChange={(e) => setDiaInteiro(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        Dia inteiro
      </label>

      {!diaInteiro && (
        <>
          <div>
            <label htmlFor="hora_inicio" className="mb-1 block text-sm text-neutral-700">Das</label>
            <input id="hora_inicio" name="hora_inicio" type="time" required className={INPUT} />
          </div>
          <div>
            <label htmlFor="hora_fim" className="mb-1 block text-sm text-neutral-700">Às</label>
            <input id="hora_fim" name="hora_fim" type="time" required className={INPUT} />
          </div>
        </>
      )}

      <div className="col-span-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {isPending ? "Adicionando..." : profileId ? "Adicionar folga/bloqueio" : "Adicionar feriado/fechamento"}
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
