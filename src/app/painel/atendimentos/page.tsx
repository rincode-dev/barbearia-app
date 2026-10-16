import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario, type Tx } from "@/lib/db";
import { AoVivo } from "@/components/ao-vivo";
import { dataHoraSP, formatarDataBR, formatarPreco, hojeSP, instanteSP, somarDias } from "@/lib/datas";
import { abrirAtendimentosDoHorario } from "@/lib/atendimento-automatico";
import {
  STATUS_OS_CLASSE,
  STATUS_OS_ROTULO,
  STATUS_PAGAMENTO_CLASSE,
  STATUS_PAGAMENTO_ROTULO,
  tituloOS,
  type StatusOS,
  type StatusPagamento,
} from "@/lib/os";

type Linha = {
  id: string;
  numero: number | null;
  status: StatusOS;
  total: number;
  total_pago: number;
  status_pagamento: StatusPagamento;
  iniciada_em: string;
  clientes: { nome: string } | null;
  profiles: { nome: string } | null;
};

type Params = { status?: string; pagamento?: string; de?: string; ate?: string; q?: string };

// Colunas da lista + nome do cliente e do barbeiro (mesmo formato de antes: clientes.nome,
// profiles.nome).
const colunasOS = (tx: Tx) => tx`
  o.id, o.numero, o.status, o.total, o.total_pago, o.status_pagamento, o.iniciada_em,
  (select json_build_object('nome', c.nome) from public.clientes c where c.id = o.cliente_id) as clientes,
  (select json_build_object('nome', p.nome) from public.profiles p where p.id = o.barbeiro_id) as profiles`;

function CartaoOS({ os }: { os: Linha }) {
  const inicio = dataHoraSP(new Date(os.iniciada_em));
  return (
    <Link
      href={`/painel/atendimentos/${os.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-surface p-3 hover:border-neutral-300"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-neutral-900">
          {tituloOS(os.numero, os.status)} · {os.clientes?.nome}
        </span>
        <span className="block text-xs text-neutral-500">
          {formatarDataBR(inicio.data)} {inicio.hora} · {os.profiles?.nome}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold text-neutral-900">{formatarPreco(Number(os.total))}</span>
        <span className="flex gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_OS_CLASSE[os.status]}`}>{STATUS_OS_ROTULO[os.status]}</span>
          {os.status !== "cancelada" && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_PAGAMENTO_CLASSE[os.status_pagamento]}`}>
              {STATUS_PAGAMENTO_ROTULO[os.status_pagamento]}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

// Lista de OS. RLS: barbeiro vê as próprias, admin todas.
export default async function AtendimentosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { userId } = await getCurrentProfile();
  await abrirAtendimentosDoHorario();

  const hoje = hojeSP();
  const de = params.de && /^\d{4}-\d{2}-\d{2}$/.test(params.de) ? params.de : somarDias(hoje, -30);
  const ate = params.ate && /^\d{4}-\d{2}-\d{2}$/.test(params.ate) ? params.ate : hoje;
  const status = ["concluida", "cancelada", "todas"].includes(params.status ?? "") ? params.status! : "concluida";

  // Busca por parte do nome (sem diferenciar maiúsculas nem acentos) ou do telefone do
  // cliente (com ou sem máscara: no banco ele fica só com dígitos). Vale para as duas listas.
  const busca = (params.q ?? "").trim().slice(0, 80);
  const termo = busca.replace(/[\\%_]/g, (c) => `\\${c}`);
  const digitos = busca.replace(/\D/g, "");

  const [listaAbertas, listaDemais] = await comoUsuario(userId, async (tx) => {
    const filtroBusca = busca
      ? tx`and exists (
          select 1 from public.clientes c
          where c.id = o.cliente_id
            and (public.sem_acento(c.nome) ilike public.sem_acento(${"%" + termo + "%"}) ${digitos ? tx`or c.telefone like ${"%" + digitos + "%"}` : tx``})
        )`
      : tx``;
    return [
    await tx<Linha[]>`select ${colunasOS(tx)} from public.ordens_servico o where o.status = 'aberta' ${filtroBusca} order by o.iniciada_em`,
    await tx<Linha[]>`
      select ${colunasOS(tx)} from public.ordens_servico o
      where o.status <> 'aberta'
        and o.iniciada_em >= ${instanteSP(de, "00:00").toISOString()}
        and o.iniciada_em < ${instanteSP(somarDias(ate, 1), "00:00").toISOString()}
        ${status !== "todas" ? tx`and o.status = ${status}` : tx``}
        ${params.pagamento === "pendentes" ? tx`and o.status_pagamento <> 'pago'` : tx``}
        ${filtroBusca}
      order by o.iniciada_em desc
      limit 200`,
    ] as const;
  });
  const pendenteNoPeriodo = listaDemais
    .filter((o) => o.status === "concluida")
    .reduce((s, o) => s + Math.max(0, Number(o.total) - Number(o.total_pago)), 0);

  const input = "rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none";

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-3 py-6 sm:px-4 sm:py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">OS</h1>
        <AoVivo />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Em atendimento agora</h2>
        {listaAbertas.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-surface p-4 text-sm text-neutral-500">
            {busca
              ? `Nenhum atendimento em andamento para "${busca}".`
              : "Nenhum atendimento em andamento. Para iniciar, abra o agendamento na Agenda."}
          </p>
        ) : (
          <div className="space-y-2">
            {listaAbertas.map((os) => (
              <CartaoOS key={os.id} os={os} />
            ))}
          </div>
        )}
      </section>

      <section>
        <form action="/painel/atendimentos" className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={busca}
            placeholder="Nome ou telefone do cliente"
            aria-label="Buscar por nome ou telefone do cliente"
            className={`${input} w-full sm:w-64`}
          />
          <select name="status" defaultValue={status} aria-label="Status" className={input}>
            <option value="concluida">Concluídas</option>
            <option value="cancelada">Canceladas</option>
            <option value="todas">Concluídas e canceladas</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-neutral-700">
            <input type="checkbox" name="pagamento" value="pendentes" defaultChecked={params.pagamento === "pendentes"} className="accent-accent" />
            Só com pagamento em aberto
          </label>
          <input type="date" name="de" defaultValue={de} aria-label="De" className={input} />
          <input type="date" name="ate" defaultValue={ate} aria-label="Até" className={input} />
          <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
            Filtrar
          </button>
        </form>
        {pendenteNoPeriodo > 0 && (
          <p className="mb-3 text-sm text-amber-300">Em aberto no período: {formatarPreco(pendenteNoPeriodo)}</p>
        )}
        {listaDemais.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-surface p-4 text-sm text-neutral-500">
            {busca ? `Nenhuma OS no período para "${busca}".` : "Nenhuma OS no período."}
          </p>
        ) : (
          <div className="space-y-2">
            {listaDemais.map((os) => (
              <CartaoOS key={os.id} os={os} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
