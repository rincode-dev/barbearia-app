"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const INTERVALO_CHECAGEM_MS = 30_000;

/**
 * Mantém a tela atualizada sozinha (requisitos do produto, item 12: "a agenda deverá refletir
 * em tempo real os agendamentos realizados pelo site"):
 * - eventos de /api/ao-vivo (LISTEN/NOTIFY do Postgres, decisão 47): qualquer mudança em
 *   agendamentos ou OS recarrega os dados da página na hora — o aviso não traz dado, e a
 *   recarga passa pela RLS (admin tudo, barbeiro os próprios + ocupação dos colegas);
 * - checagem a cada 30s com a aba visível: cobre reconexões e aparelho que dormiu.
 * Recarregar = router.refresh() (Server Components buscam de novo; o estado da tela fica).
 */
export function AoVivo() {
  const router = useRouter();
  const [conectado, setConectado] = useState(false);
  const agendado = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const atualizar = () => {
      // Agrupa rajadas de avisos (ex.: agendamento + OS) num único refresh.
      if (agendado.current) clearTimeout(agendado.current);
      agendado.current = setTimeout(() => router.refresh(), 400);
    };

    // EventSource reconecta sozinho se a conexão cair; "Ao vivo" só com a escuta pronta.
    const eventos = new EventSource("/api/ao-vivo");
    eventos.addEventListener("pronto", () => setConectado(true));
    eventos.addEventListener("mudou", atualizar);
    eventos.addEventListener("erro", () => setConectado(false));
    eventos.onerror = () => setConectado(false);

    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, INTERVALO_CHECAGEM_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
      if (agendado.current) clearTimeout(agendado.current);
      eventos.close();
    };
  }, [router]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500" title="Atualiza sozinho quando algo muda">
      <span className={`h-2 w-2 rounded-full ${conectado ? "bg-emerald-400" : "bg-neutral-400"}`} aria-hidden="true" />
      {conectado ? "Ao vivo" : "Atualizando a cada 30s"}
    </span>
  );
}
