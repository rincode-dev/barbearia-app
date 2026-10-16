import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";

type Secao = { titulo: string; descricao: string; href?: string; fase?: number };

// Tudo que é configuração do negócio fica aqui dentro, pra manter o menu principal
// enxuto (docs/ARQUITETURA.md, decisão 14). Seções sem href ainda não existem.
const SECOES: Secao[] = [
  {
    titulo: "Barbeiros e usuários",
    descricao: "Acessos, permissões, foto, serviços, jornada e folgas de cada barbeiro.",
    href: "/painel/configuracoes/equipe",
  },
  {
    titulo: "Dados da barbearia",
    descricao: "Nome, logo, endereço, telefone, WhatsApp, Instagram e mapa.",
    href: "/painel/configuracoes/barbearia",
  },
  {
    titulo: "Horários e agendamento",
    descricao: "Funcionamento por dia, feriados, antecedência mínima e regras de agendamento.",
    href: "/painel/configuracoes/horarios",
  },
  { titulo: "Serviços", descricao: "Serviços, preços e duração.", href: "/painel/configuracoes/servicos" },
  {
    titulo: "Mensagens",
    descricao: "Textos de WhatsApp para confirmação, lembrete e avisos.",
    href: "/painel/configuracoes/mensagens",
  },
];

export default async function ConfiguracoesPage() {
  await requireAdmin();

  return (
    <main className="mx-auto max-w-3xl px-3 py-6 sm:px-4 sm:py-10">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Configurações</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {SECOES.map((s) =>
          s.href ? (
            <Link
              key={s.titulo}
              href={s.href}
              className="rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 transition-colors hover:border-neutral-300 hover:bg-neutral-100"
            >
              <p className="font-medium text-neutral-900">{s.titulo}</p>
              <p className="mt-1 text-sm text-neutral-500">{s.descricao}</p>
            </Link>
          ) : (
            <div
              key={s.titulo}
              className="rounded-2xl border border-dashed border-neutral-300 bg-surface p-4 opacity-60"
            >
              <p className="font-medium text-neutral-900">
                {s.titulo} <span className="text-xs font-normal text-neutral-500">· Fase {s.fase}</span>
              </p>
              <p className="mt-1 text-sm text-neutral-500">{s.descricao}</p>
            </div>
          )
        )}
      </div>
    </main>
  );
}
