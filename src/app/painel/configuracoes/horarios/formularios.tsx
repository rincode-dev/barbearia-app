"use client";

import { useActionState } from "react";
import { EditorSemana, type Faixa } from "@/components/editor-semana";
import { salvarFuncionamento, salvarRegrasAgendamento } from "./actions";

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

function Mensagens({ state }: { state: { error?: string; success?: string } | null }) {
  return (
    <>
      {state?.error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {state.error}
        </p>
      )}
      {state?.success && <p className="mt-2 text-sm text-emerald-400">{state.success}</p>}
    </>
  );
}

export function FormularioFuncionamento({ faixas }: { faixas: Faixa[] }) {
  const [state, formAction, isPending] = useActionState(salvarFuncionamento, null);
  return (
    <form action={formAction}>
      <EditorSemana name="faixas" faixasIniciais={faixas} />
      <button
        type="submit"
        disabled={isPending}
        className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {isPending ? "Salvando..." : "Salvar funcionamento"}
      </button>
      <Mensagens state={state} />
    </form>
  );
}

const OPCOES_ANTECEDENCIA = [
  { valor: 0, rotulo: "Sem antecedência" },
  { valor: 30, rotulo: "30 minutos" },
  { valor: 60, rotulo: "1 hora" },
  { valor: 120, rotulo: "2 horas" },
  { valor: 240, rotulo: "4 horas" },
  { valor: 720, rotulo: "12 horas" },
  { valor: 1440, rotulo: "1 dia" },
];

export type Regras = {
  antecedenciaMinimaMinutos: number;
  janelaAgendamentoDias: number;
  granularidadeMinutos: number;
  politicaCancelamento: string | null;
};

export function FormularioRegras({ regras }: { regras: Regras }) {
  const [state, formAction, isPending] = useActionState(salvarRegrasAgendamento, null);
  const antecedenciaForaDaLista = !OPCOES_ANTECEDENCIA.some((o) => o.valor === regras.antecedenciaMinimaMinutos);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div>
        <label htmlFor="antecedencia" className="mb-1 block text-sm text-neutral-700">Antecedência mínima</label>
        <select
          id="antecedencia"
          name="antecedencia_minima_minutos"
          defaultValue={regras.antecedenciaMinimaMinutos}
          className={INPUT}
        >
          {antecedenciaForaDaLista && (
            <option value={regras.antecedenciaMinimaMinutos}>{regras.antecedenciaMinimaMinutos} minutos</option>
          )}
          {OPCOES_ANTECEDENCIA.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="janela" className="mb-1 block text-sm text-neutral-700">Agendar até quantos dias à frente</label>
        <input
          id="janela"
          name="janela_agendamento_dias"
          type="number"
          min={1}
          max={365}
          defaultValue={regras.janelaAgendamentoDias}
          className={INPUT}
        />
      </div>
      <div>
        <label htmlFor="granularidade" className="mb-1 block text-sm text-neutral-700">Intervalo entre horários</label>
        <select
          id="granularidade"
          name="granularidade_minutos"
          defaultValue={regras.granularidadeMinutos}
          className={INPUT}
        >
          {[5, 10, 15, 20, 30, 60].map((m) => (
            <option key={m} value={m}>
              de {m} em {m} min
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-3">
        <label htmlFor="politica" className="mb-1 block text-sm text-neutral-700">Regras de cancelamento (texto para o cliente)</label>
        <textarea
          id="politica"
          name="politica_cancelamento"
          rows={2}
          defaultValue={regras.politicaCancelamento ?? ""}
          placeholder="Ex.: Cancelamentos com pelo menos 2 horas de antecedência, pelo WhatsApp."
          className={INPUT}
        />
      </div>
      <div className="sm:col-span-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Salvar regras"}
        </button>
        <Mensagens state={state} />
      </div>
    </form>
  );
}
