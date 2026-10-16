"use client";

import { useState } from "react";
import { DIAS_SEMANA } from "@/lib/datas";

export type Faixa = { dia_semana: number; inicio: string; fim: string };

type FaixaLocal = { id: number; inicio: string; fim: string };

let proximoId = 1;
const novaFaixa = (inicio = "09:00", fim = "18:00"): FaixaLocal => ({ id: proximoId++, inicio, fim });

// Ordem de exibição: segunda a domingo (como a barbearia pensa a semana); o valor
// gravado continua 0=domingo…6=sábado.
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

/**
 * Editor de horário semanal (funcionamento da barbearia ou jornada de um barbeiro).
 * Cada dia pode ter várias faixas (ex.: 09:00–12:00 e 13:00–19:00 = intervalo de almoço);
 * dia sem faixa = fechado/folga. O resultado vai num input escondido (`name`) como JSON —
 * a validação de verdade (início < fim, sem sobreposição) é feita no banco.
 */
export function EditorSemana({
  name,
  faixasIniciais,
  rotuloVazio = "Fechado",
}: {
  name: string;
  faixasIniciais: Faixa[];
  rotuloVazio?: string;
}) {
  const [porDia, setPorDia] = useState<Record<number, FaixaLocal[]>>(() => {
    const inicial: Record<number, FaixaLocal[]> = {};
    for (let d = 0; d < 7; d++) inicial[d] = [];
    for (const f of [...faixasIniciais].sort((a, b) => a.inicio.localeCompare(b.inicio))) {
      inicial[f.dia_semana].push(novaFaixa(f.inicio.slice(0, 5), f.fim.slice(0, 5)));
    }
    return inicial;
  });

  function atualizar(dia: number, faixas: FaixaLocal[]) {
    setPorDia((atual) => ({ ...atual, [dia]: faixas }));
  }

  function adicionar(dia: number) {
    const faixas = porDia[dia];
    const ultima = faixas[faixas.length - 1];
    // Segunda faixa do dia sugere começar onde a anterior termina (padrão "volta do almoço").
    atualizar(dia, [...faixas, ultima ? novaFaixa(ultima.fim, ultima.fim < "18:00" ? "18:00" : "22:00") : novaFaixa()]);
  }

  function copiarParaTodos(dia: number) {
    setPorDia((atual) => {
      const copia: Record<number, FaixaLocal[]> = {};
      for (let d = 0; d < 7; d++) {
        copia[d] = atual[dia].map((f) => novaFaixa(f.inicio, f.fim));
      }
      return copia;
    });
  }

  const serializado: Faixa[] = Object.entries(porDia).flatMap(([dia, faixas]) =>
    faixas.map((f) => ({ dia_semana: Number(dia), inicio: f.inicio, fim: f.fim }))
  );

  return (
    <div className="space-y-2">
      {ORDEM_DIAS.map((dia) => {
        const faixas = porDia[dia];
        return (
          <div key={dia} className="rounded-xl border border-neutral-200 bg-neutral-50/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="w-20 text-sm font-medium text-neutral-900">{DIAS_SEMANA[dia]}</span>
              <div className="flex gap-3 text-xs">
                {faixas.length > 0 && (
                  <button type="button" onClick={() => copiarParaTodos(dia)} className="text-neutral-500 hover:text-neutral-900">
                    Copiar para todos os dias
                  </button>
                )}
                <button type="button" onClick={() => adicionar(dia)} className="text-neutral-700 hover:text-neutral-900">
                  + Faixa
                </button>
              </div>
            </div>

            {faixas.length === 0 ? (
              <p className="mt-1 text-xs text-neutral-500">{rotuloVazio}</p>
            ) : (
              <div className="mt-2 space-y-2">
                {faixas.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={f.inicio}
                      required
                      aria-label={`${DIAS_SEMANA[dia]} — início da faixa ${i + 1}`}
                      onChange={(e) => atualizar(dia, faixas.map((x) => (x.id === f.id ? { ...x, inicio: e.target.value } : x)))}
                      className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                    />
                    <span className="text-neutral-500">até</span>
                    <input
                      type="time"
                      value={f.fim}
                      required
                      aria-label={`${DIAS_SEMANA[dia]} — fim da faixa ${i + 1}`}
                      onChange={(e) => atualizar(dia, faixas.map((x) => (x.id === f.id ? { ...x, fim: e.target.value } : x)))}
                      className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => atualizar(dia, faixas.filter((x) => x.id !== f.id))}
                      className="ml-auto text-xs text-neutral-500 hover:text-red-400"
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <input type="hidden" name={name} value={JSON.stringify(serializado)} />
    </div>
  );
}
