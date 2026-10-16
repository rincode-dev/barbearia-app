"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { alterarStatus, comecarAgora, horariosParaReagendar, reagendar } from "../actions";
import type { Acao } from "@/lib/agendamento/status";

type Estado = { error?: string; success?: string } | null;

function Mensagem({ state }: { state: Estado }) {
  if (state?.error)
    return (
      <p role="alert" className="mt-2 text-sm text-red-400">
        {state.error}
      </p>
    );
  if (state?.success) return <p className="mt-2 text-sm text-emerald-400">{state.success}</p>;
  return null;
}

// Um botão = um formulário (Server Action com a transição já definida).
function BotaoStatus({ id, acao, principal = false }: { id: string; acao: Acao; principal?: boolean }) {
  const [state, formAction, isPending] = useActionState(alterarStatus.bind(null, id, acao.para), null);
  const [pedindoMotivo, setPedindoMotivo] = useState(false);

  if (acao.pedeMotivo && !pedindoMotivo) {
    return (
      <button
        type="button"
        onClick={() => setPedindoMotivo(true)}
        className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
      >
        {acao.rotulo}
      </button>
    );
  }

  return (
    <form action={formAction} className={acao.pedeMotivo ? "w-full space-y-2" : ""}>
      {acao.pedeMotivo && (
        <input
          name="motivo"
          placeholder="Motivo do cancelamento (opcional)"
          autoFocus
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
      )}
      <button
        type="submit"
        disabled={isPending}
        className={
          principal
            ? "w-full rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
            : acao.pedeMotivo
              ? "rounded-lg bg-red-500/80 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              : "rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        }
      >
        {isPending ? "Salvando..." : acao.pedeMotivo ? "Confirmar cancelamento" : acao.rotulo}
      </button>
      <Mensagem state={state} />
    </form>
  );
}

export function AcoesStatus({ id, principal, outras }: { id: string; principal?: Acao; outras: Acao[] }) {
  return (
    <div className="space-y-3">
      {principal && <BotaoStatus id={id} acao={principal} principal />}
      {outras.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-neutral-500 hover:text-neutral-900">Mais ações</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {outras.map((a) => (
              <BotaoStatus key={a.para} id={id} acao={a} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// Reagendar: escolhe a data (e o barbeiro, se admin) → mostra só os horários livres dele
// naquele dia (expediente, folgas, fechamentos e duração dos serviços). "Outro horário"
// libera digitar a hora para encaixe fora da lista; o banco ainda recusa sobreposição.
export function FormularioReagendar({
  id,
  dataAtual,
  barbeiroAtual,
  barbeiros,
  acao,
  rotulo = "Reagendar",
}: {
  id: string;
  dataAtual: string;
  barbeiroAtual: string;
  barbeiros: { id: string; nome: string }[] | null;
  // Outra ação com o mesmo formulário (ex.: "Reagendou" na OS, que tira a OS e volta à agenda).
  acao?: (prev: Estado, formData: FormData) => Promise<Estado>;
  rotulo?: string;
}) {
  const [state, formAction, isPending] = useActionState(acao ?? reagendar.bind(null, id), null);
  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState(dataAtual);
  const [barbeiro, setBarbeiro] = useState(barbeiroAtual);
  const [hora, setHora] = useState("");
  const [manual, setManual] = useState(false);
  const [livres, setLivres] = useState<{ chave: string; horarios: string[]; erro?: string } | null>(null);
  const [buscando, iniciarBusca] = useTransition();
  const chave = `${data}|${barbeiro}`;

  // Busca de novo sempre que a data ou o barbeiro mudam (só com o formulário aberto).
  useEffect(() => {
    if (!aberto || !data) return;
    iniciarBusca(async () => {
      const r = await horariosParaReagendar(id, data, barbeiro);
      setLivres({ chave: `${data}|${barbeiro}`, horarios: r.horarios, erro: r.erro });
    });
  }, [aberto, data, barbeiro, id]);

  const atuais = livres?.chave === chave ? livres : null;
  const input = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none";
  return (
    <details onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm text-neutral-500 hover:text-neutral-900">{rotulo}</summary>
      <form action={formAction} className="mt-3 space-y-3">
        <div className={`grid gap-3 ${barbeiros ? "sm:grid-cols-2" : ""}`}>
          <div>
            <label htmlFor={`data-${id}`} className="mb-1 block text-xs text-neutral-500">
              Nova data
            </label>
            <input
              id={`data-${id}`}
              name="data"
              type="date"
              value={data}
              onChange={(e) => {
                setData(e.target.value);
                setHora("");
              }}
              required
              className={input}
            />
          </div>
          {barbeiros && (
            <div>
              <label htmlFor={`barbeiro-${id}`} className="mb-1 block text-xs text-neutral-500">
                Barbeiro
              </label>
              <select
                id={`barbeiro-${id}`}
                name="barbeiro_id"
                value={barbeiro}
                onChange={(e) => {
                  setBarbeiro(e.target.value);
                  setHora("");
                }}
                className={input}
              >
                {barbeiros.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div aria-live="polite">
          <p className="mb-1.5 text-xs text-neutral-500">Horários livres</p>
          {buscando || !atuais ? (
            <p className="text-sm text-neutral-500">Consultando a agenda...</p>
          ) : atuais.horarios.length === 0 ? (
            <p data-sem-horario className="text-sm text-red-400">
              {atuais.erro ?? "Sem horário livre nesse dia."}
            </p>
          ) : (
            <div data-horarios-livres className="flex flex-wrap gap-2">
              {atuais.horarios.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setHora(h);
                    setManual(false);
                  }}
                  aria-pressed={!manual && hora === h}
                  className={`rounded-lg border px-2.5 py-1 text-sm tabular-nums ${
                    !manual && hora === h
                      ? "border-accent bg-accent/10 text-neutral-900"
                      : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={() => {
              setManual((v) => !v);
              setHora("");
            }}
            className="text-xs text-neutral-500 underline hover:text-neutral-900"
          >
            {manual ? "Escolher da lista de horários livres" : "Outro horário (encaixe)"}
          </button>
          {manual && (
            <div className="mt-2 max-w-40">
              <label htmlFor={`hora-${id}`} className="sr-only">
                Horário do encaixe
              </label>
              <input id={`hora-${id}`} type="time" value={hora} onChange={(e) => setHora(e.target.value)} required className={input} />
            </div>
          )}
        </div>

        <input type="hidden" name="hora" value={hora} />
        <div>
          <button
            type="submit"
            disabled={isPending || !hora}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            {isPending ? "Salvando..." : hora ? `Reagendar para ${hora}` : "Escolha um horário"}
          </button>
          <p className="mt-1 text-xs text-neutral-400">Mantém serviços e valor.</p>
          <Mensagem state={state} />
        </div>
      </form>
    </details>
  );
}

// Cliente adiantado: um toque mostra o que vai acontecer; o segundo confirma.
export function BotaoComecarAgora({ id, termino }: { id: string; termino: string }) {
  const [state, formAction, isPending] = useActionState(comecarAgora.bind(null, id), null);
  const [confirmando, setConfirmando] = useState(false);
  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
      >
        Começar agora
      </button>
    );
  }
  return (
    <form action={formAction} className="space-y-2 rounded-xl border border-neutral-200 p-3">
      <p className="text-sm text-neutral-700">
        O atendimento passa a começar agora e termina por volta das <strong className="tabular-nums">{termino}</strong>, pela
        duração dos serviços. A OS é aberta.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {isPending ? "Abrindo OS..." : "Confirmar: começar agora"}
        </button>
        <button type="button" onClick={() => setConfirmando(false)} className="text-sm text-neutral-500 hover:text-neutral-900">
          Voltar
        </button>
      </div>
      <Mensagem state={state} />
    </form>
  );
}
