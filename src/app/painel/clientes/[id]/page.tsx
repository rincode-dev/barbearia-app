import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { ehUuid } from "@/lib/agendamento/disponibilidade";
import { alternarAtivoCliente } from "../actions";
import { EditarClienteForm } from "./edit-form";
import { dataHoraSP, formatarDataBR, formatarPreco, hojeSP } from "@/lib/datas";
import { calcularMetricas, textoDias } from "@/lib/clientes/metricas";
import { STATUS_CLASSE, STATUS_ROTULO, type StatusAgendamento } from "@/lib/agendamento/status";
import { numeroOS } from "@/lib/os";

type ItemHistorico = {
  id: string;
  inicio: string;
  status: StatusAgendamento;
  servicos: string;
  barbeiro_nome: string;
  valor_total: number | null;
  os_id: string | null;
  os_numero: number | null;
};

const dataCurta = (iso: string | null) => (iso ? formatarDataBR(dataHoraSP(new Date(iso)).data) : "—");

export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await getCurrentProfile();

  if (!ehUuid(id)) notFound();

  type Cliente = {
    id: string;
    nome: string;
    telefone: string;
    observacoes: string | null;
    origem: string;
    created_at: string;
    deleted_at: string | null;
  };
  type Resumo = {
    primeiro_atendimento: string | null;
    ultimo_atendimento: string | null;
    quantidade_atendimentos: number;
    proximo_agendamento: string | null;
  };
  const dados = await comoUsuario(profile.id, async (tx) => {
    const [cliente] = await tx<Cliente[]>`
      select id, nome, telefone, observacoes, origem, created_at, deleted_at from public.clientes where id = ${id}`;
    if (!cliente) return null;
    // Histórico pela visão de equipe: admin vê tudo; barbeiro, os agendamentos dele com
    // este cliente (nos dos colegas o cliente vem mascarado e não entra no filtro).
    const [resumo] = await tx<Resumo[]>`
      select primeiro_atendimento, ultimo_atendimento, quantidade_atendimentos, proximo_agendamento
      from public.clientes_resumo where cliente_id = ${id}`;
    const historico = await tx<ItemHistorico[]>`
      select id, inicio, status, servicos, barbeiro_nome, valor_total, os_id, os_numero
      from public.agenda_equipe where cliente_id = ${id} order by inicio desc`;
    // Valor e dia reais de cada atendimento concluído (RLS: barbeiro, só as OS dele).
    const osConcluidas = await tx<{ id: string; total: number; iniciada_em: string }[]>`
      select id, total, iniciada_em from public.ordens_servico where cliente_id = ${id} and status = 'concluida'`;
    return { cliente, resumo: resumo ?? null, historico: [...historico], osConcluidas: [...osConcluidas] };
  });
  if (!dados) notFound();
  const { cliente, resumo, historico, osConcluidas } = dados;

  // Métricas (só concluídos): valor = total da OS (com desconto e adicionais), dia = dia do
  // atendimento (mesma base do Financeiro, decisão 36); sem OS, o agendado.
  const osPorId = new Map((osConcluidas ?? []).map((o) => [o.id, o]));
  const metricas = calcularMetricas(
    historico
      .filter((h) => h.status === "concluido")
      .map((h) => {
        const os = h.os_id ? osPorId.get(h.os_id) : undefined;
        return {
          dia: dataHoraSP(new Date(os?.iniciada_em ?? h.inicio)).data,
          valor: Number(os?.total ?? h.valor_total ?? 0),
        };
      }),
    hojeSP(),
    Boolean(resumo?.proximo_agendamento)
  );

  return (
    <main className="mx-auto max-w-2xl px-3 py-6 sm:px-4 sm:py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">{cliente.nome}</h1>
        <Link href="/painel/clientes" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Clientes
        </Link>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              cliente.deleted_at
                ? "inline-block rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600"
                : "inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400"
            }
          >
            {cliente.deleted_at ? "Arquivado" : "Ativo"}
          </span>
          <span className="text-xs text-neutral-500">
            Cadastrado {cliente.origem === "site" ? "pelo site" : "pelo painel"} em{" "}
            {new Date(cliente.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
          </span>
        </div>

        <form action={alternarAtivoCliente.bind(null, cliente.id, !cliente.deleted_at)}>
          <button
            type="submit"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            {cliente.deleted_at ? "Restaurar" : "Arquivar"}
          </button>
        </form>
      </div>

      <div className="mb-4">
        <EditarClienteForm cliente={cliente} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Atendimentos", String(resumo?.quantidade_atendimentos ?? 0)],
          ["Primeiro", dataCurta(resumo?.primeiro_atendimento ?? null)],
          ["Último", dataCurta(resumo?.ultimo_atendimento ?? null)],
          ["Próximo", dataCurta(resumo?.proximo_agendamento ?? null)],
        ].map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-xl border border-neutral-200 bg-surface p-3 text-center">
            <p className="text-lg font-semibold text-neutral-900">{valor}</p>
            <p className="text-xs text-neutral-500">{rotulo}</p>
          </div>
        ))}
      </div>

      <section className="mb-6" aria-labelledby="comportamento">
        <h2 id="comportamento" className="mb-2 text-sm font-semibold text-neutral-900">
          Comportamento
        </h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 bg-surface p-3">
            <p className="text-xs text-neutral-500">Ticket médio</p>
            <p className="mt-0.5 text-lg font-semibold text-neutral-900 tabular-nums">
              {metricas.ticketMedio !== null ? formatarPreco(metricas.ticketMedio) : "—"}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {metricas.atendimentos
                ? `Gasta em média por atendimento (${metricas.atendimentos} concluído${metricas.atendimentos > 1 ? "s" : ""})`
                : "Sem atendimentos concluídos ainda"}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-surface p-3">
            <p className="text-xs text-neutral-500">Tempo médio de retorno</p>
            <p className="mt-0.5 text-lg font-semibold text-neutral-900 tabular-nums">
              {metricas.retornoMedioDias !== null ? textoDias(metricas.retornoMedioDias) : "—"}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {metricas.retornoMedioDias !== null
                ? `Retorna em média a cada ${textoDias(metricas.retornoMedioDias)}`
                : metricas.visitas === 1
                  ? "Precisa de pelo menos 2 atendimentos para calcular"
                  : "Sem histórico suficiente"}
            </p>
          </div>
          <div
            className={`rounded-xl border p-3 ${
              metricas.atrasoDias !== null ? "border-amber-500/40 bg-amber-500/10" : "border-neutral-200 bg-surface"
            }`}
          >
            <p className="text-xs text-neutral-500">Tempo sem retornar</p>
            <p className="mt-0.5 text-lg font-semibold text-neutral-900 tabular-nums">
              {metricas.diasSemRetornar === null ? "—" : metricas.diasSemRetornar === 0 ? "Hoje" : textoDias(metricas.diasSemRetornar)}
            </p>
            <p className={`mt-0.5 text-xs ${metricas.atrasoDias !== null ? "text-amber-300" : "text-neutral-500"}`}>
              {metricas.diasSemRetornar === null
                ? "Ainda não teve atendimento concluído"
                : metricas.diasSemRetornar === 0
                  ? "Atendido hoje"
                  : `Não retorna há ${textoDias(metricas.diasSemRetornar)}`}
              {metricas.atrasoDias !== null && ` · ${textoDias(metricas.atrasoDias)} além do habitual`}
              {resumo?.proximo_agendamento && ` · já tem horário em ${dataCurta(resumo.proximo_agendamento).slice(0, 5)}`}
            </p>
          </div>
        </div>
        {profile.role !== "admin" && (
          <p className="mt-2 text-xs text-neutral-500">Considera só os seus atendimentos com este cliente.</p>
        )}
      </section>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">Histórico</h2>
        <Link href={`/painel/agenda/novo?cliente=${cliente.id}`} className="text-sm text-neutral-600 hover:text-neutral-900">
          + Novo agendamento
        </Link>
      </div>
      {historico.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-surface p-4 text-center text-sm text-neutral-500">
          Nenhum agendamento ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {historico.map((h) => (
            <li key={h.id}>
              <Link
                href={h.os_id ? `/painel/atendimentos/${h.os_id}` : `/painel/agenda/${h.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-surface p-3 hover:border-neutral-300"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-neutral-900">
                    {dataCurta(h.inicio)} · {h.servicos}
                  </span>
                  <span className="block text-xs text-neutral-500">
                    {h.barbeiro_nome}
                    {h.os_numero !== null && ` · OS ${numeroOS(h.os_numero)}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {/* Concluído: o valor cobrado (total da OS, com desconto/adicionais) — o
                      mesmo que entra no ticket médio; senão, o valor agendado. */}
                  <span className="text-sm text-neutral-900">
                    {h.os_id && osPorId.has(h.os_id)
                      ? formatarPreco(Number(osPorId.get(h.os_id)!.total))
                      : h.valor_total !== null
                        ? formatarPreco(Number(h.valor_total))
                        : ""}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSE[h.status]}`}>{STATUS_ROTULO[h.status]}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
