"use client";

import { useEffect, type RefObject } from "react";
import { deveRepassar, proximaVelocidade } from "@/lib/rolagem-continua";

// Liga a rolagem contínua (src/lib/rolagem-continua.ts) numa área com rolagem própria:
// no limite de cima/baixo, o movimento do dedo ou da roda passa para a página. A área
// precisa de `overscroll-y-none` (sem "elástico" nem encadeamento nativo, que no celular
// só aconteceria num toque novo e brigaria com este repasse).
export function useRolagemContinua(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let ultimoY = 0;
    let inicioX = 0;
    let inicioY = 0;
    let eixo: "x" | "y" | null = null;
    let repassando = false;
    let amostras: { t: number; d: number }[] = [];
    let quadroInercia = 0;

    const pararInercia = () => cancelAnimationFrame(quadroInercia);

    function aoTocar(e: TouchEvent) {
      pararInercia();
      const t = e.touches[0];
      inicioX = t.clientX;
      inicioY = ultimoY = t.clientY;
      eixo = null;
      repassando = false;
      amostras = [];
    }

    function aoMover(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      // Só gesto vertical: arrastar para o lado (colunas dos barbeiros) segue nativo.
      if (!eixo) {
        const dx = Math.abs(t.clientX - inicioX);
        const dy = Math.abs(t.clientY - inicioY);
        if (dx < 4 && dy < 4) return;
        eixo = dy >= dx ? "y" : "x";
      }
      if (eixo !== "y") return;

      const delta = ultimoY - t.clientY; // > 0: conteúdo descendo
      ultimoY = t.clientY;
      if (delta !== 0 && deveRepassar(el!, delta)) {
        if (e.cancelable) e.preventDefault();
        window.scrollBy(0, delta);
        repassando = true;
        const agora = performance.now();
        amostras.push({ t: agora, d: delta });
        amostras = amostras.filter((a) => agora - a.t < 100);
      } else {
        repassando = false;
        amostras = [];
      }
    }

    function aoSoltar() {
      if (!repassando || amostras.length < 2) return;
      const dt = amostras[amostras.length - 1].t - amostras[0].t || 16;
      let v = amostras.reduce((s, a) => s + a.d, 0) / dt; // px/ms
      let anterior = performance.now();
      const passo = (agora: number) => {
        const dt = Math.min(agora - anterior, 32);
        anterior = agora;
        window.scrollBy(0, v * dt);
        v = proximaVelocidade(v);
        if (v !== 0) quadroInercia = requestAnimationFrame(passo);
      };
      quadroInercia = requestAnimationFrame(passo);
    }

    function aoRodar(e: WheelEvent) {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // zoom / rolagem lateral
      const fator = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      const delta = e.deltaY * fator;
      if (delta !== 0 && deveRepassar(el!, delta)) {
        e.preventDefault();
        window.scrollBy(0, delta);
      }
    }

    el.addEventListener("touchstart", aoTocar, { passive: true });
    el.addEventListener("touchmove", aoMover, { passive: false });
    el.addEventListener("touchend", aoSoltar, { passive: true });
    el.addEventListener("touchcancel", aoSoltar, { passive: true });
    el.addEventListener("wheel", aoRodar, { passive: false });
    return () => {
      pararInercia();
      el.removeEventListener("touchstart", aoTocar);
      el.removeEventListener("touchmove", aoMover);
      el.removeEventListener("touchend", aoSoltar);
      el.removeEventListener("touchcancel", aoSoltar);
      el.removeEventListener("wheel", aoRodar);
    };
  }, [ref]);
}
