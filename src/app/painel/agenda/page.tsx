import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { ehUuid } from "@/lib/agendamento/disponibilidade";
import { AoVivo } from "@/components/ao-vivo";
import { DIAS_SEMANA, dataHoraSP, formatarDataBR, formatarPreco, hojeSP, instanteSP, somarDias } from "@/lib/datas";
import { diaSemana } from "@/lib/agendamento/motor";
import { STATUS_CLASSE, STATUS_INATIVOS, STATUS_ROTULO, type StatusAgendamento } from "@/lib/agendamento/status";
import { NOMES_MES, dataDoItem, deslocar, faixaDoItem, periodo, type ItemAgenda, type Visao } from "./visoes";
import { minutosDoDia, montarGrade } from "./grade";
import { GradeDia } from "./grade-dia";
import { abrirAtendimentosDoHorario } from "@/lib/atendimento-automatico";

type Params = { visao?: string; data?: string; barbeiro?: string; status?: string; servico?: string };

const SELECT =
  "rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none";

function CartaoAgendamento({ a, compacto = false }: { a: ItemAgenda; compacto?: boolean }) {
  const inativo = STATUS_INATIVOS.includes(a.status);
  const conteudo = (
    <div className={`rounded-xl border border-neutral-200 bg-surface p-3 ${inativo ? "opacity-60" : ""} ${a.pode_ver_detalhes ? "hover:border-neutral-300" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-neutral-900">{faixaDoItem(a)}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSE[a.status]}`}>{STATUS_ROTULO[a.status]}</span>
      </div>
      <p className="mt-1 text-sm text-neutral-800">
        {a.pode_ver_detalhes ? a.cliente_nome : <span className="text-neutral-500">Horário ocupado</span>}
      </p>
      {!compacto && <p className="text-xs text-neutral-500">{a.servicos}</p>}
      <div className="mt-1 flex items-center justify-between text-xs text-neutral-500">
        <span>{a.barbeiro_nome}</span>
        {a.valor_total !== null && <span>{formatarPreco(Number(a.valor_total))}</span>}
      </div>
    </div>
  );
  return a.pode_ver_detalhes ? <Link href={`/painel/agenda/${a.id}`}>{conteudo}</Link> : conteudo;
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { profile } = await getCurrentProfile();
  await abrirAtendimentosDoHorario();
  const hoje = hojeSP();
  const visao: Visao = params.visao === "semana" || params.visao === "mes" ? params.visao : "dia";
  const data = params.data && /^\d{4}-\d{2}-\d{2}$/.test(params.data) ? params.data : hoje;
  const filtroStatus = params.status ?? "ativos";
  const { de, ate } = periodo(visao, data);

  // Filtro com id malformado na URL é ignorado (não derruba a página).
  const filtroBarbeiro = params.barbeiro && ehUuid(params.barbeiro) ? params.barbeiro : null;
  const filtroServico = params.servico && ehUuid(params.servico) ? params.servico : null;

  // Visão Dia = grade horária: precisa do expediente do dia para mostrar o que está livre.
  const dow = diaSemana(data);
  type Faixa = { inicio: string; fim: string };
  type FaixaDe = Faixa & { profile_id: string | null };
  const { itens, barbeiros, servicos, expediente } = await comoUsuario(profile.id, async (tx) => {
    const itens = await tx<ItemAgenda[]>`
      select id, barbeiro_id, barbeiro_nome, inicio, fim, status, servicos, pode_ver_detalhes, cliente_nome, valor_total
      from public.agenda_equipe
      where inicio >= ${instanteSP(de, "00:00").toISOString()}
        and inicio < ${instanteSP(somarDias(ate, 1), "00:00").toISOString()}
        ${filtroBarbeiro ? tx`and barbeiro_id = ${filtroBarbeiro}` : tx``}
        ${filtroServico ? tx`and servico_ids @> array[${filtroServico}]::uuid[]` : tx``}
        ${
          filtroStatus === "ativos"
            ? tx`and status <> all(${STATUS_INATIVOS as string[]}::text[])`
            : filtroStatus !== "todos"
              ? tx`and status = ${filtroStatus}`
              : tx``
        }
      order by inicio`;
    const barbeiros = await tx<{ id: string; nome: string }[]>`
      select id, nome from public.profiles where ativo and atende_como_barbeiro order by nome`;
    const servicos = await tx<{ id: string; nome: string }[]>`select id, nome from public.servicos order by nome`;
    const expediente =
      visao === "dia"
        ? ([
            await tx<Faixa[]>`select inicio, fim from public.horarios_funcionamento where dia_semana = ${dow}`,
            await tx<(Faixa & { profile_id: string })[]>`select profile_id, inicio, fim from public.jornadas where dia_semana = ${dow}`,
            await tx<FaixaDe[]>`
              select profile_id, inicio, fim from public.bloqueios
              where inicio < ${instanteSP(somarDias(data, 1), "00:00").toISOString()}
                and fim > ${instanteSP(data, "00:00").toISOString()}`,
          ] as const)
        : null;
    return { itens, barbeiros, servicos, expediente };
  });

  const grade =
    visao === "dia" && expediente
      ? montarGrade({
          data,
          itens,
          barbeiros: barbeiros.filter((b) => !params.barbeiro || b.id === params.barbeiro),
          funcionamento: [...expediente[0]],
          jornadas: [...expediente[1]],
          bloqueios: [...expediente[2]],
          euId: profile.id,
          admin: profile.role === "admin",
        })
      : null;
  const agoraSP = dataHoraSP(new Date());
  const semana = periodo("semana", data);

  const link = (mudancas: Partial<Params>) => {
    const q = new URLSearchParams();
    const final = { visao, data, barbeiro: params.barbeiro, status: params.status, servico: params.servico, ...mudancas };
    for (const [k, v] of Object.entries(final)) if (v) q.set(k, v);
    return `/painel/agenda?${q.toString()}`;
  };

  const [ano, mes] = data.split("-").map(Number);
  const rotuloPeriodo =
    visao === "dia"
      ? `${DIAS_SEMANA[diaSemana(data)]}, ${formatarDataBR(data)}`
      : visao === "semana"
        ? `${formatarDataBR(de).slice(0, 5)} a ${formatarDataBR(ate)}`
        : `${NOMES_MES[mes - 1]} de ${ano}`;

  const porDia = new Map<string, ItemAgenda[]>();
  for (const item of itens) {
    const d = dataDoItem(item);
    porDia.set(d, [...(porDia.get(d) ?? []), item]);
  }

  return (
    <main className="mx-auto max-w-5xl px-3 py-6 sm:px-4 sm:py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-neutral-900">Agenda</h1>
          <AoVivo />
        </div>
        <Link
          href={`/painel/agenda/novo?data=${visao === "dia" ? data : hoje}`}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          + Novo agendamento
        </Link>
      </div>

      {/* Visão + navegação */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-surface p-3">
        <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-sm">
          {(["dia", "semana", "mes"] as Visao[]).map((v) => (
            <Link
              key={v}
              href={link({ visao: v })}
              className={`px-3 py-1.5 ${v === visao ? "bg-accent font-medium text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
            >
              {v === "dia" ? "Dia" : v === "semana" ? "Semana" : "Mês"}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={link({ data: deslocar(visao, data, -1) })} className="rounded-lg border border-neutral-300 px-2 py-1 hover:bg-neutral-100" aria-label="Anterior">
            ←
          </Link>
          <span className="min-w-36 text-center font-medium text-neutral-900">{rotuloPeriodo}</span>
          <Link href={link({ data: deslocar(visao, data, 1) })} className="rounded-lg border border-neutral-300 px-2 py-1 hover:bg-neutral-100" aria-label="Próximo">
            →
          </Link>
          {data !== hoje && (
            <Link href={link({ data: hoje })} className="text-xs text-neutral-500 hover:text-neutral-900">
              Hoje
            </Link>
          )}
        </div>
      </div>

      {/* Filtros (GET: funcionam sem JavaScript e ficam no link) */}
      <form action="/painel/agenda" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="visao" value={visao} />
        <input type="hidden" name="data" value={data} />
        <select name="barbeiro" defaultValue={params.barbeiro ?? ""} aria-label="Barbeiro" className={SELECT}>
          <option value="">Todos os barbeiros</option>
          {barbeiros.map((b) => (
            <option key={b.id} value={b.id}>
              {b.id === profile.id ? `${b.nome} (eu)` : b.nome}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={filtroStatus} aria-label="Status" className={SELECT}>
          <option value="ativos">Ativos</option>
          <option value="todos">Todos os status</option>
          {(Object.keys(STATUS_ROTULO) as StatusAgendamento[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_ROTULO[s]}
            </option>
          ))}
        </select>
        <select name="servico" defaultValue={params.servico ?? ""} aria-label="Serviço" className={SELECT}>
          <option value="">Todos os serviços</option>
          {servicos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
          Filtrar
        </button>
      </form>

      {/* DIA: faixa da semana + grade horária */}
      {visao === "dia" && grade && (
        <>
          <nav className="mb-3 grid grid-cols-7 gap-1" aria-label="Dias da semana">
            {Array.from({ length: 7 }, (_, i) => somarDias(semana.de, i)).map((d) => {
              const selecionado = d === data;
              return (
                <Link
                  key={d}
                  href={link({ data: d })}
                  aria-current={selecionado ? "date" : undefined}
                  className={`flex flex-col items-center rounded-xl py-1.5 text-xs transition-colors ${
                    selecionado
                      ? "bg-accent font-semibold text-white"
                      : "text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  <span className={selecionado ? "" : "text-neutral-500"}>{DIAS_SEMANA[diaSemana(d)].slice(0, 3)}</span>
                  <span className="text-base leading-6 tabular-nums">{Number(d.slice(8))}</span>
                  <span
                    className={`h-1 w-1 rounded-full ${d === hoje ? (selecionado ? "bg-neutral-50" : "bg-red-500") : "bg-transparent"}`}
                    aria-label={d === hoje ? "hoje" : undefined}
                  />
                </Link>
              );
            })}
          </nav>
          <GradeDia
            grade={grade}
            data={data}
            hoje={data === hoje}
            agoraInicial={data === hoje ? minutosDoDia(agoraSP.hora) : null}
          />
        </>
      )}

      {/* SEMANA */}
      {visao === "semana" && (
        <div className="space-y-4">
          {Array.from({ length: 7 }, (_, i) => somarDias(de, i)).map((d) => {
            const doDia = porDia.get(d) ?? [];
            return (
              <section key={d}>
                <Link href={link({ visao: "dia", data: d })} className="mb-2 inline-block text-sm font-semibold text-neutral-900 hover:underline">
                  {DIAS_SEMANA[diaSemana(d)]}, {formatarDataBR(d).slice(0, 5)}
                  {d === hoje && <span className="ml-2 text-xs font-normal text-neutral-500">hoje</span>}
                </Link>
                {doDia.length === 0 ? (
                  <p className="text-xs text-neutral-500">Sem agendamentos.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {doDia.map((a) => (
                      <CartaoAgendamento key={a.id} a={a} compacto />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* MÊS */}
      {visao === "mes" && (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-surface">
          <div className="grid grid-cols-7 border-b border-neutral-200 text-center text-xs text-neutral-500">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <div key={d} className="py-2">
                {DIAS_SEMANA[d].slice(0, 3)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: (diaSemana(de) + 6) % 7 }, (_, i) => (
              <div key={`vazio-${i}`} className="h-16 border-b border-r border-neutral-100 sm:h-20" />
            ))}
            {Array.from({ length: Number(ate.slice(8)) }, (_, i) => somarDias(de, i)).map((d) => {
              const qtd = (porDia.get(d) ?? []).length;
              return (
                <Link
                  key={d}
                  href={link({ visao: "dia", data: d })}
                  className="flex h-16 flex-col gap-1 border-b border-r border-neutral-100 p-1.5 hover:bg-neutral-100 sm:h-20"
                >
                  <span
                    className={`text-xs ${d === hoje ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white" : "text-neutral-600"}`}
                  >
                    {Number(d.slice(8))}
                  </span>
                  {qtd > 0 && (
                    <span className="rounded bg-accent/15 px-1 text-[11px] font-medium text-neutral-900">
                      {qtd} <span className="hidden sm:inline">agend.</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
