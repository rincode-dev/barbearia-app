import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { ehUuid } from "@/lib/agendamento/disponibilidade";
import { dataHoraSP, DIAS_SEMANA, formatarDataBR, formatarDuracao, formatarPreco } from "@/lib/datas";
import { diaSemana } from "@/lib/agendamento/motor";
import {
  OUTRAS_ACOES,
  PODE_REAGENDAR,
  PROXIMO_PASSO,
  STATUS_CLASSE,
  STATUS_ROTULO,
  type StatusAgendamento,
} from "@/lib/agendamento/status";
import { formatarTelefone } from "@/lib/clientes/telefone";
import { construirLinkWhatsapp } from "@/lib/mensagens/whatsapp";
import { AoVivo } from "@/components/ao-vivo";
import { MensagensWhatsapp } from "@/components/mensagens-whatsapp";
import { getEstabelecimento } from "@/lib/estabelecimento";
import { MENSAGENS_POR_STATUS } from "@/lib/mensagens/preencher";
import { dataParaMensagem, linksWhatsapp, urlDoSite } from "@/lib/mensagens/servidor";
import { AcoesStatus, BotaoComecarAgora, FormularioReagendar } from "./acoes";
import { abrirAtendimentosDoHorario } from "@/lib/atendimento-automatico";
import { numeroOS } from "@/lib/os";

type Detalhe = {
  id: string;
  barbeiro_id: string;
  barbeiro_nome: string;
  inicio: string;
  fim: string;
  status: StatusAgendamento;
  origem: "site" | "painel";
  duracao_total_minutos: number;
  pode_ver_detalhes: boolean;
  cliente_id: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  valor_total: number | null;
  observacao: string | null;
  motivo_cancelamento: string | null;
  os_id: string | null;
  os_numero: number | null;
};

const aindaNaoComecou = (inicio: string) => new Date(inicio).getTime() > Date.now();

// Fim previsto se o atendimento começar neste minuto (mesma conta de comecar_agora()).
function terminoSeComecarAgora(duracaoMinutos: number) {
  const agora = new Date();
  agora.setSeconds(0, 0);
  return dataHoraSP(new Date(agora.getTime() + duracaoMinutos * 60_000)).hora;
}

export default async function AgendamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await getCurrentProfile();
  if (!ehUuid(id)) notFound();
  await abrirAtendimentosDoHorario();

  const [ag, servicos, barbeiros] = await comoUsuario(profile.id, async (tx) => {
    const [ag] = await tx<(Detalhe & { pode_ver_detalhes: boolean })[]>`
      select id, barbeiro_id, barbeiro_nome, inicio, fim, status, origem, duracao_total_minutos, pode_ver_detalhes,
             cliente_id, cliente_nome, cliente_telefone, valor_total, observacao, motivo_cancelamento, os_id, os_numero
      from public.agenda_equipe where id = ${id}`;
    const servicos = await tx<{ nome: string; preco: number; duracao_minutos: number }[]>`
      select nome, preco, duracao_minutos from public.agendamento_servicos where agendamento_id = ${id} order by ordem`;
    const barbeiros =
      profile.role === "admin"
        ? await tx<{ id: string; nome: string }[]>`
            select id, nome from public.profiles where ativo and atende_como_barbeiro order by nome`
        : null;
    return [ag, servicos, barbeiros] as const;
  });
  // Agendamento de colega: o barbeiro só vê a ocupação na agenda, não o detalhe.
  if (!ag || !ag.pode_ver_detalhes) notFound();
  // Em atendimento, o agendamento e a OS são o mesmo momento: abre direto a OS.
  if (ag.status === "em_atendimento" && ag.os_id) redirect(`/painel/atendimentos/${ag.os_id}`);

  const inicio = dataHoraSP(new Date(ag.inicio));
  const fim = dataHoraSP(new Date(ag.fim));
  const linkWhatsapp = ag.cliente_telefone ? construirLinkWhatsapp(ag.cliente_telefone, `Olá, ${ag.cliente_nome?.split(" ")[0]}!`) : null;
  const [barbearia, site] = await Promise.all([getEstabelecimento(), urlDoSite()]);
  const mensagens = await comoUsuario(profile.id, (tx) => linksWhatsapp(tx, ag.cliente_telefone, MENSAGENS_POR_STATUS[ag.status], {
    cliente: ag.cliente_nome?.split(" ")[0],
    barbearia: barbearia.nome,
    ...dataParaMensagem(ag.inicio),
    barbeiro: ag.barbeiro_nome,
    servicos: (servicos ?? []).map((s) => s.nome).join(" + "),
    valor: formatarPreco(Number(ag.valor_total)),
    endereco: barbearia.endereco ?? undefined,
    site,
  }));

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-3 py-6 sm:px-4 sm:py-8">
      <div className="flex items-center justify-between">
        <Link href={`/painel/agenda?data=${inicio.data}`} className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Agenda
        </Link>
        <AoVivo />
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-lg font-semibold text-neutral-900">
              {DIAS_SEMANA[diaSemana(inicio.data)]}, {formatarDataBR(inicio.data)} · {inicio.hora}–{fim.hora}
            </p>
            <p className="text-sm text-neutral-600">
              com {ag.barbeiro_nome} · {formatarDuracao(ag.duracao_total_minutos)} · agendado pelo{" "}
              {ag.origem === "site" ? "site" : "painel"}
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs ${STATUS_CLASSE[ag.status]}`}>{STATUS_ROTULO[ag.status]}</span>
        </div>

        {ag.status === "cancelado" && ag.motivo_cancelamento && (
          <p className="mt-2 text-sm text-neutral-500">Motivo: {ag.motivo_cancelamento}</p>
        )}

        <div className="mt-4 border-t border-neutral-200 pt-4">
          <p className="text-xs text-neutral-500">Cliente</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/painel/clientes/${ag.cliente_id}`} className="font-medium text-neutral-900 hover:underline">
              {ag.cliente_nome}
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-neutral-600">{formatarTelefone(ag.cliente_telefone)}</span>
              {linkWhatsapp && (
                <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                  WhatsApp
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-neutral-200 pt-4">
          <p className="mb-1 text-xs text-neutral-500">Serviços agendados</p>
          <ul className="space-y-1 text-sm">
            {(servicos ?? []).map((s, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-neutral-800">
                  {s.nome} <span className="text-neutral-500">· {formatarDuracao(s.duracao_minutos)}</span>
                </span>
                <span className="text-neutral-800">{formatarPreco(Number(s.preco))}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between border-t border-neutral-200 pt-2 text-sm font-semibold text-neutral-900">
            <span>Total previsto</span>
            <span>{formatarPreco(Number(ag.valor_total))}</span>
          </p>
        </div>

        {ag.observacao && <p className="mt-3 text-sm text-neutral-600">Obs.: {ag.observacao}</p>}
      </section>

      <section className="space-y-4 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
        {ag.os_id && ["em_atendimento", "concluido", "cancelado"].includes(ag.status) ? (
          <Link
            href={`/painel/atendimentos/${ag.os_id}`}
            className="block w-full rounded-xl bg-accent px-4 py-3 text-center text-base font-semibold text-white hover:bg-accent-hover sm:inline-block sm:w-auto"
          >
            {ag.os_numero !== null ? `Abrir OS Nº ${numeroOS(ag.os_numero)}` : "Abrir OS"}
          </Link>
        ) : (
          <>
            {ag.status === "agendado" && (
              <div className="space-y-3">
                <p className="text-sm text-neutral-600">
                  O atendimento começa sozinho às {inicio.hora}, com a OS aberta.
                </p>
                {/* Cliente adiantado: começa agora e o fim é recalculado pela duração. */}
                {aindaNaoComecou(ag.inicio) && (
                  <BotaoComecarAgora id={ag.id} termino={terminoSeComecarAgora(ag.duracao_total_minutos)} />
                )}
              </div>
            )}
            <AcoesStatus id={ag.id} principal={PROXIMO_PASSO[ag.status]} outras={OUTRAS_ACOES[ag.status] ?? []} />
          </>
        )}
        {PODE_REAGENDAR.includes(ag.status) && (
          <FormularioReagendar
            id={ag.id}
            dataAtual={inicio.data}
            barbeiroAtual={ag.barbeiro_id}
            barbeiros={barbeiros}
          />
        )}
        {mensagens.length > 0 && (
          <div className="border-t border-neutral-200 pt-4">
            <MensagensWhatsapp links={mensagens} />
          </div>
        )}
      </section>
    </main>
  );
}
