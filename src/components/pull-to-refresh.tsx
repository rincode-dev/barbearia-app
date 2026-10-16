"use client";

import { useEffect, useRef, useState } from "react";

const LIMIAR_PX = 70;
const PUXAO_MAXIMO_PX = 100;

// Em modo standalone (app aberto pelo atalho da tela inicial, sem a UI do
// navegador) o iOS/Android perdem o pull-to-refresh nativo — não tem mais
// barra de endereço pra "puxar contra". Este componente reimplementa o gesto
// manualmente, só quando standalone (nunca interfere no navegador normal, que
// já tem o pull-to-refresh dele mesmo). Um reload completo (não um refresh
// suave) de propósito: é o comportamento que o gesto substitui.
export function PullToRefresh() {
  const [puxado, setPuxado] = useState(0);
  const [atualizando, setAtualizando] = useState(false);
  const puxadoRef = useRef(0);
  const inicioY = useRef<number | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!standalone) return;

    function definirPuxado(valor: number) {
      puxadoRef.current = valor;
      setPuxado(valor);
    }

    // Toque dentro de uma área rolada para baixo (ex.: grade da agenda) é para rolar essa
    // área para cima, não para atualizar a página.
    function dentroDeAreaRolada(alvo: EventTarget | null) {
      for (let el = alvo instanceof Element ? alvo : null; el && el !== document.body; el = el.parentElement) {
        if (el.scrollTop > 0) return true;
      }
      return false;
    }

    function aoTocar(e: TouchEvent) {
      inicioY.current = window.scrollY <= 0 && !dentroDeAreaRolada(e.target) ? e.touches[0].clientY : null;
    }

    function aoMover(e: TouchEvent) {
      if (inicioY.current === null) return;
      const delta = e.touches[0].clientY - inicioY.current;
      if (delta <= 0 || window.scrollY > 0) {
        inicioY.current = null;
        definirPuxado(0);
        return;
      }
      // Amortece o movimento (puxar 200px do dedo vira só ~100px visuais),
      // pra não esticar indefinidamente nem parecer solto demais.
      definirPuxado(Math.min(delta * 0.5, PUXAO_MAXIMO_PX));
      if (e.cancelable) e.preventDefault();
    }

    function aoSoltar() {
      if (puxadoRef.current > LIMIAR_PX) {
        setAtualizando(true);
        window.location.reload();
      } else {
        definirPuxado(0);
      }
      inicioY.current = null;
    }

    document.addEventListener("touchstart", aoTocar, { passive: true });
    document.addEventListener("touchmove", aoMover, { passive: false });
    document.addEventListener("touchend", aoSoltar, { passive: true });
    document.addEventListener("touchcancel", aoSoltar, { passive: true });
    return () => {
      document.removeEventListener("touchstart", aoTocar);
      document.removeEventListener("touchmove", aoMover);
      document.removeEventListener("touchend", aoSoltar);
      document.removeEventListener("touchcancel", aoSoltar);
    };
  }, []);

  if (puxado === 0 && !atualizando) return null;

  return (
    <div
      aria-hidden="true"
      data-pull-to-refresh=""
      className="flex items-center justify-center overflow-hidden bg-background transition-[height] duration-150"
      style={{ height: atualizando ? 48 : puxado }}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full border-2 border-accent border-t-transparent ${
          atualizando ? "animate-spin" : ""
        }`}
        style={atualizando ? undefined : { transform: `rotate(${(puxado / PUXAO_MAXIMO_PX) * 360}deg)` }}
      />
    </div>
  );
}
