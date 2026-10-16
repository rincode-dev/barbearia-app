"use client";

import { useEffect, useState } from "react";
import { detalheStatus, statusFuncionamento } from "@/lib/agendamento/funcionamento";
import type { Intervalo } from "@/lib/agendamento/motor";
import { IconeRelogio } from "./visual";

// "Aberto / Fecha às 18:00" ou "Fechado / Abre Sex às 09:00". Os períodos vêm do servidor
// (funcionamento − feriados); o relógio anda aqui, então a página aberta muda de status
// sozinha na hora de abrir/fechar. O 1º desenho usa o instante do servidor (sem diferença
// entre o HTML e a hidratação).
export function StatusFuncionamento({ periodos, agoraServidor }: { periodos: Intervalo[]; agoraServidor: number }) {
  const [agora, setAgora] = useState(agoraServidor);
  useEffect(() => {
    const tique = () => setAgora(Date.now());
    const primeiro = setTimeout(tique, 0);
    const intervalo = setInterval(tique, 30_000);
    return () => {
      clearTimeout(primeiro);
      clearInterval(intervalo);
    };
  }, []);

  const status = statusFuncionamento(periodos, agora);
  const detalhe = detalheStatus(status);
  return (
    // data-aberto: o brilho do topo (page.tsx) fica verde enquanto está aberto.
    <div aria-live="polite" data-aberto={status.aberto || undefined} className="space-y-2">
      <p className={`flex items-center gap-2.5 max-[379px]:justify-center font-display text-lg font-bold sm:text-2xl ${status.aberto ? "text-emerald-400" : "text-brasa"}`}>
        <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
          {status.aberto && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${status.aberto ? "bg-emerald-400" : "bg-brasa"}`} />
        </span>
        {status.aberto ? "Aberto" : "Fechado"}
      </p>
      {detalhe && (
        <p className="flex items-center gap-2.5 text-[0.95rem] text-giz/85 max-[379px]:justify-center sm:text-lg">
          <IconeRelogio className="h-[1.1rem] w-[1.1rem] shrink-0 text-nevoa" />
          {detalhe}
        </p>
      )}
    </div>
  );
}
