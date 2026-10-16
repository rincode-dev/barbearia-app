"use client";

import { useActionState, useState, useTransition } from "react";
import { ClienteCombobox } from "@/components/ui/cliente-combobox";
import { formatarDuracao, formatarPreco } from "@/lib/datas";
import { buscarHorariosLivres, criarEncaixe } from "../actions";

type Servico = { id: string; nome: string; preco: number; duracao_minutos: number };
type Cliente = { id: string; nome: string; telefone: string | null };

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function FormularioEncaixe({
  clientes,
  servicos,
  barbeiros,
  barbeiroFixo,
  clienteInicial,
  dataInicial,
  horaInicial = "",
}: {
  clientes: Cliente[];
  servicos: Servico[];
  barbeiros: { id: string; nome: string }[] | null; // null = barbeiro logado agenda só pra si
  barbeiroFixo: string;
  clienteInicial?: string;
  dataInicial: string;
  horaInicial?: string;
}) {
  const [state, formAction, isPending] = useActionState(criarEncaixe, null);
  const [clienteNovo, setClienteNovo] = useState(false);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [barbeiro, setBarbeiro] = useState(barbeiroFixo);
  const [data, setData] = useState(dataInicial);
  const [hora, setHora] = useState(horaInicial);
  const [sugestoes, setSugestoes] = useState<string[] | null>(null);
  const [erroSugestoes, setErroSugestoes] = useState<string | null>(null);
  const [buscando, iniciarBusca] = useTransition();

  const escolhidos = servicos.filter((s) => selecionados.includes(s.id));
  const total = escolhidos.reduce((s, x) => s + x.preco, 0);
  const duracao = escolhidos.reduce((s, x) => s + x.duracao_minutos, 0);

  function verHorarios() {
    setErroSugestoes(null);
    iniciarBusca(async () => {
      const r = await buscarHorariosLivres(selecionados, data, barbeiro);
      setSugestoes(r.horarios);
      if (r.erro) setErroSugestoes(r.erro);
    });
  }

  // Mudou serviço/barbeiro/data: sugestões antigas deixam de valer.
  function invalidarSugestoes() {
    setSugestoes(null);
    setErroSugestoes(null);
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Cliente */}
      <section className="rounded-2xl border border-neutral-200 bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Cliente</h2>
          <button type="button" onClick={() => setClienteNovo((v) => !v)} className="text-xs text-neutral-500 hover:text-neutral-900">
            {clienteNovo ? "Buscar cliente cadastrado" : "+ Cliente novo"}
          </button>
        </div>
        {clienteNovo ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="cliente_nome" placeholder="Nome" required className={INPUT} aria-label="Nome do cliente" />
            <input name="cliente_telefone" type="tel" placeholder="Telefone com DDD" required className={INPUT} aria-label="Telefone do cliente" />
            <p className="text-xs text-neutral-400 sm:col-span-2">Se o telefone já for de um cliente cadastrado, o agendamento vai para ele.</p>
          </div>
        ) : (
          <ClienteCombobox clientes={clientes} defaultClienteId={clienteInicial} />
        )}
      </section>

      {/* Serviços */}
      <section className="rounded-2xl border border-neutral-200 bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Serviços</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {servicos.map((s) => (
            <label key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="servicos"
                  value={s.id}
                  checked={selecionados.includes(s.id)}
                  onChange={(e) => {
                    setSelecionados((atual) => (e.target.checked ? [...atual, s.id] : atual.filter((x) => x !== s.id)));
                    invalidarSugestoes();
                  }}
                  className="h-4 w-4 accent-accent"
                />
                {s.nome}
              </span>
              <span className="text-neutral-500">{formatarPreco(s.preco)}</span>
            </label>
          ))}
        </div>
        {selecionados.length > 0 && (
          <p className="mt-2 text-sm text-neutral-700">
            Total: <strong>{formatarPreco(total)}</strong> · {formatarDuracao(duracao)}
          </p>
        )}
      </section>

      {/* Quando e com quem */}
      <section className="rounded-2xl border border-neutral-200 bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Quando</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {barbeiros ? (
            <select
              name="barbeiro_id"
              value={barbeiro}
              onChange={(e) => {
                setBarbeiro(e.target.value);
                invalidarSugestoes();
              }}
              required
              aria-label="Barbeiro"
              className={INPUT}
            >
              <option value="" disabled>
                Barbeiro...
              </option>
              {barbeiros.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
          ) : (
            <input type="hidden" name="barbeiro_id" value={barbeiroFixo} />
          )}
          <input
            name="data"
            type="date"
            value={data}
            onChange={(e) => {
              setData(e.target.value);
              invalidarSugestoes();
            }}
            required
            aria-label="Data"
            className={INPUT}
          />
          <input name="hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} required aria-label="Horário" className={INPUT} />
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={verHorarios}
            disabled={selecionados.length === 0 || !barbeiro || !data || buscando}
            className="text-sm text-neutral-700 underline disabled:no-underline disabled:opacity-40"
          >
            {buscando ? "Calculando..." : "Ver horários livres"}
          </button>
          {sugestoes && (
            <div className="mt-2 flex flex-wrap gap-2">
              {sugestoes.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  {erroSugestoes ?? "Nenhum horário livre dentro da jornada — ainda dá pra encaixar digitando o horário."}
                </p>
              ) : (
                sugestoes.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHora(h)}
                    className={`rounded-lg border px-2.5 py-1 text-sm ${hora === h ? "border-accent bg-accent/10 text-neutral-900" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"}`}
                  >
                    {h}
                  </button>
                ))
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-neutral-400">
            Pelo painel dá pra encaixar fora da jornada; só não dá para o barbeiro ter dois clientes no mesmo horário.
          </p>
        </div>
      </section>

      <textarea name="observacao" rows={2} placeholder="Observação (opcional)" aria-label="Observação" className={INPUT} />

      {state?.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-xl bg-accent py-3 text-base font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {isPending ? "Agendando..." : "Agendar"}
      </button>
    </form>
  );
}
