import { Marca } from "@/components/marca";
import { getCurrentProfile } from "@/lib/auth/session";
import { getEstabelecimento } from "@/lib/estabelecimento";
import { logout } from "@/app/login/actions";
import { NavAbas, type Aba } from "./nav-abas";

// Menu enxuto (docs/ARQUITETURA.md, decisão 14): Serviços, Barbeiros, Horários e Mensagens
// ficam dentro de Configurações; Relatórios dentro de Financeiro.
const ABAS_EQUIPE: Aba[] = [
  { href: "/painel", label: "Início" },
  { href: "/painel/agenda", label: "Agenda" },
  { href: "/painel/atendimentos", label: "OS" },
  { href: "/painel/clientes", label: "Clientes" },
];

const ABAS_ADMIN: Aba[] = [
  ...ABAS_EQUIPE,
  { href: "/painel/financeiro", label: "Financeiro" },
  { href: "/painel/configuracoes", label: "Configurações", curto: "Ajustes" },
];

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const [{ profile }, barbearia] = await Promise.all([getCurrentProfile(), getEstabelecimento()]);

  return (
    // .painel: títulos na voz do site (globals.css) — decisão 43.
    <div className="painel min-h-screen bg-neutral-50">
      {/* Barra usuário + Sair fica no fluxo normal (some ao rolar); marca + abas
          (header abaixo) ficam fixas no topo. */}
      <div className="border-b border-neutral-200 bg-neutral-50">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3 px-4 py-2 sm:justify-between">
          <span className="hidden min-w-0 items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-neutral-500 sm:flex">
            Área da equipe
            <span aria-hidden="true" className="h-px w-6 bg-accent" />
          </span>
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-xs text-neutral-700 sm:text-sm">
              {profile.nome || "Sem nome"}
              <span className="ml-1.5 text-neutral-500">· {profile.role === "admin" ? "administrador" : "barbeiro"}</span>
            </span>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-full border border-neutral-300 px-3.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:border-accent hover:text-neutral-900 sm:text-sm"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </div>

      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50/90 backdrop-blur-md">
        <div className="relative isolate flex justify-center overflow-hidden border-b border-neutral-200/60 bg-neutral-50 py-2.5">
          {/* Mesmo fundo do topo do site: brilho vermelho discreto + textura fina. */}
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(60%_140%_at_100%_0%,rgba(255,59,64,0.12),transparent_60%)]" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-[0.05] bg-[repeating-linear-gradient(135deg,#fff_0_1px,transparent_1px_9px)]" />
          <Marca nome={barbearia.nome} logoUrl={barbearia.logoUrl} tamanho="md" />
        </div>
        <NavAbas abas={profile.role === "admin" ? ABAS_ADMIN : ABAS_EQUIPE} />
      </header>

      {children}
    </div>
  );
}
