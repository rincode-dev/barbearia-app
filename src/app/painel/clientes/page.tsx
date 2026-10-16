import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario, mensagemDeErro } from "@/lib/db";
import { formatarTelefone } from "@/lib/clientes/telefone";
import { dataHoraSP, formatarDataBR } from "@/lib/datas";
import { NovoClienteForm } from "./novo-cliente-form";

type StatusFiltro = "ativos" | "arquivados" | "todos";

const FILTROS: { value: StatusFiltro; label: string }[] = [
  { value: "ativos", label: "Ativos" },
  { value: "arquivados", label: "Arquivados" },
  { value: "todos", label: "Todos" },
];

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { userId } = await getCurrentProfile();
  const { q, status } = await searchParams;
  const busca = (q ?? "").trim();
  const statusFiltro: StatusFiltro =
    status === "arquivados" || status === "todos" ? status : "ativos";

  // Busca por parte do nome (sem diferenciar maiúsculas nem acentos) ou do telefone
  // (curingas do LIKE escapados).
  const termo = busca.replace(/[\\%_]/g, (c) => `\\${c}`);
  const termoDigitos = busca.replace(/\D/g, "");
  type Cliente = { id: string; nome: string; telefone: string; origem: string; deleted_at: string | null };
  // Primeiro/último atendimento, quantidade e próximo agendamento (view clientes_resumo).
  type Resumo = { cliente_id: string; ultimo_atendimento: string | null; quantidade_atendimentos: number; proximo_agendamento: string | null };

  let clientes: Cliente[] | null = null;
  let resumos: Resumo[] = [];
  let error: { message: string } | null = null;
  try {
    [clientes, resumos] = await comoUsuario(userId, async (tx) => {
      const clientes = await tx<Cliente[]>`
        select id, nome, telefone, origem, deleted_at from public.clientes
        where true
          ${statusFiltro === "ativos" ? tx`and deleted_at is null` : statusFiltro === "arquivados" ? tx`and deleted_at is not null` : tx``}
          ${busca ? tx`and (public.sem_acento(nome) ilike public.sem_acento(${"%" + termo + "%"}) or telefone ilike ${"%" + (termoDigitos || termo) + "%"})` : tx``}
        order by nome`;
      const ids = clientes.map((c) => c.id);
      const resumos = ids.length
        ? await tx<Resumo[]>`
            select cliente_id, ultimo_atendimento, quantidade_atendimentos, proximo_agendamento
            from public.clientes_resumo where cliente_id = any(${ids}::uuid[])`
        : [];
      return [[...clientes], [...resumos]] as const;
    });
  } catch (e) {
    error = { message: mensagemDeErro(e) };
  }
  const resumoPorId = new Map(resumos.map((r) => [r.cliente_id, r]));
  const dataCurta = (iso: string | null) => (iso ? formatarDataBR(dataHoraSP(new Date(iso)).data) : "—");

  return (
    <main className="mx-auto max-w-3xl px-3 py-6 sm:px-4 sm:py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Clientes</h1>
      </div>

      <div className="mb-8">
        <NovoClienteForm />
      </div>

      <form className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3" action="/painel/clientes">
        {statusFiltro !== "ativos" && (
          <input type="hidden" name="status" value={statusFiltro} />
        )}
        <input
          name="q"
          defaultValue={busca}
          placeholder="Buscar por nome ou telefone"
          className="w-full min-w-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="submit"
          className="whitespace-nowrap rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
        >
          Buscar
        </button>
      </form>

      <div className="mb-4 flex items-center gap-2">
        {FILTROS.map((f) => {
          const params = new URLSearchParams();
          if (f.value !== "ativos") params.set("status", f.value);
          if (busca) params.set("q", busca);
          const href = params.size > 0 ? `/painel/clientes?${params.toString()}` : "/painel/clientes";
          const ativo = f.value === statusFiltro;
          return (
            <Link
              key={f.value}
              href={href}
              className={
                ativo
                  ? "rounded-full bg-accent px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
              }
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {error && (
        <p className="text-sm text-red-400">
          Não foi possível carregar os clientes: {error.message}
        </p>
      )}

      {/* Mobile: cards (evita rolagem horizontal). Desktop: tabela. */}
      <div className="space-y-2 sm:hidden">
        {clientes?.map((c) => (
          <div
            key={c.id}
            className="rounded-xl border border-neutral-200 bg-surface p-3 shadow-lg shadow-black/20"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-neutral-900">{c.nome}</p>
              {c.deleted_at && (
                <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                  Arquivado
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500">
              {formatarTelefone(c.telefone)}
              {c.origem === "site" ? " · agendou pelo site" : ""}
            </p>
            <p className="text-xs text-neutral-500">
              {resumoPorId.get(c.id)?.quantidade_atendimentos ?? 0} atendimento(s) · último: {dataCurta(resumoPorId.get(c.id)?.ultimo_atendimento ?? null)}
              {resumoPorId.get(c.id)?.proximo_agendamento && ` · próximo: ${dataCurta(resumoPorId.get(c.id)!.proximo_agendamento)}`}
            </p>
            <div className="mt-2 text-right">
              <Link
                href={`/painel/clientes/${c.id}`}
                className="rounded-lg border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:border-neutral-400 hover:bg-neutral-100"
              >
                Ver / Editar
              </Link>
            </div>
          </div>
        ))}
        {clientes?.length === 0 && (
          <p className="rounded-xl border border-neutral-200 bg-surface p-6 text-center text-sm text-neutral-500 shadow-lg shadow-black/20">
            Nenhum cliente encontrado.
          </p>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-neutral-200 bg-surface shadow-lg shadow-black/20 sm:block">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Telefone</th>
              <th className="px-4 py-2 font-medium">Último atendimento</th>
              <th className="px-4 py-2 font-medium">Atendimentos</th>
              <th className="px-4 py-2 font-medium">Próximo</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {clientes?.map((c) => (
              <tr key={c.id} className="border-t border-neutral-100">
                <td className="px-4 py-2 text-neutral-900">
                  {c.nome}
                  {c.deleted_at && (
                    <span className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                      Arquivado
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-neutral-600">{formatarTelefone(c.telefone)}</td>
                <td className="px-4 py-2 text-neutral-600">{dataCurta(resumoPorId.get(c.id)?.ultimo_atendimento ?? null)}</td>
                <td className="px-4 py-2 text-neutral-600">{resumoPorId.get(c.id)?.quantidade_atendimentos ?? 0}</td>
                <td className="px-4 py-2 text-neutral-600">{dataCurta(resumoPorId.get(c.id)?.proximo_agendamento ?? null)}</td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/painel/clientes/${c.id}`}
                    className="text-sm text-neutral-600 hover:text-neutral-900"
                  >
                    Ver / Editar
                  </Link>
                </td>
              </tr>
            ))}
            {clientes?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
