"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// `curto`: rótulo no celular. As 6 abas do admin com os nomes completos não cabem em
// 375px (medido: 489px) — "Configurações" sumia sem nenhum sinal de que existia.
export type Aba = { href: string; label: string; curto?: string };

// Client component só pra destacar a aba atual (usePathname). "/painel" (Início) só é
// ativa na raiz exata; as demais também nas subpáginas (ex.: /painel/clientes/123).
export function NavAbas({ abas }: { abas: Aba[] }) {
  const pathname = usePathname();
  const ativaRef = useRef<HTMLAnchorElement>(null);

  // Tela ainda mais estreita (ex.: 320px): a barra rola, e a aba atual fica sempre visível.
  useEffect(() => {
    ativaRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav className="nav-abas mx-auto flex max-w-5xl items-center gap-3 overflow-x-auto px-3 text-[13px] whitespace-nowrap [scrollbar-width:none] sm:gap-6 sm:px-4 sm:text-sm">
      {abas.map((aba) => {
        const ativa =
          aba.href === "/painel" ? pathname === "/painel" : pathname.startsWith(aba.href);
        return (
          <Link
            key={aba.href}
            href={aba.href}
            ref={ativa ? ativaRef : undefined}
            aria-current={ativa ? "page" : undefined}
            // Aba ativa: texto claro + traço vermelho encostado na base da barra.
            className={`relative shrink-0 py-3 transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors ${
              ativa
                ? "font-semibold text-neutral-900 after:bg-accent"
                : "text-neutral-500 after:bg-transparent hover:text-neutral-900"
            }`}
          >
            {aba.curto ? (
              <>
                <span className="sm:hidden">{aba.curto}</span>
                <span className="hidden sm:inline">{aba.label}</span>
              </>
            ) : (
              aba.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}
