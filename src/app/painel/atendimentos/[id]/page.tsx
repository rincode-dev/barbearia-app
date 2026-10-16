import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { ehUuid } from "@/lib/agendamento/disponibilidade";
import { AoVivo } from "@/components/ao-vivo";
import { MensagensWhatsapp } from "@/components/mensagens-whatsapp";
import { getEstabelecimento } from "@/lib/estabelecimento";
import { dataParaMensagem, linksWhatsapp, urlDoSite } from "@/lib/mensagens/servidor";
import { dataHoraSP, DIAS_SEMANA, formatarDataBR, formatarPreco } from "@/lib/datas";
import { diaSemana } from "@/lib/agendamento/motor";
import { formatarTelefone } from "@/lib/clientes/telefone";
import {
  FORMA_ROTULO,
  MOTIVO_ROTULO,
  STATUS_OS_CLASSE,
  STATUS_OS_ROTULO,
  STATUS_PAGAMENTO_CLASSE,
  STATUS_PAGAMENTO_ROTULO,
  tituloOS,
  type FormaPagamento,
  type MotivoDesconto,
  type StatusOS,
  type StatusPagamento,
} from "@/lib/os";
import {
  adicionarServico,
  aplicarDesconto,
  concluirAtendimento,
  estornarPagamento,
  naoCompareceu,
  reabrirAtendimento,
  reagendarDaOS,
  registrarPagamentos,
  removerServico,
} from "../actions";
import {
  AdicionarServicoForm,
  BotaoAcao,
  DescontoForm,
  NaoCompareceuBotao,
  PagamentoForm,
} from "./componentes";
import { FormularioReagendar } from "../../agenda/[id]/acoes";
import { abrirAtendimentosDoHorario } from "@/lib/atendimento-automatico";

type OS = {
  id: string;
  numero: number | null;
  agendamento_id: string;
  barbeiro_id: string;
  status: StatusOS;
  subtotal: number;
  desconto_tipo: "fixo" | "percentual" | null;
  desconto_valor: number;
  desconto_motivo: MotivoDesconto | null;
  desconto_observacao: string | null;
  desconto_calculado: number;
  total: number;
  total_pago: number;
  status_pagamento: StatusPagamento;
  iniciada_em: string;
  concluida_em: string | null;
  motivo_cancelamento: string | null;
  clientes: { id: string; nome: string; telefone: string } | null;
  profiles: { nome: string } | null;
  agendamentos: { inicio: string; fim: string } | null;
};

function Secao({ titulo, children, direita }: { titulo: string; children: React.ReactNode; direita?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">{titulo}</h2>
        {direita}
      </div>
      {children}
    </section>
  );
}

const hora = (iso: string) => dataHoraSP(new Date(iso)).hora;

export default async function OSPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await getCurrentProfile();
  if (!ehUuid(id)) notFound();
  await abrirAtendimentosDoHorario();

  type Pagamento = {
    id: string;
    forma: FormaPagamento;
    valor: number;
    created_at: string;
    estornado_em: string | null;
    profiles: { nome: string } | null;
  };
  const dados = await comoUsuario(profile.id, async (tx) => {
    const [os] = await tx<OS[]>`
      select o.id, o.numero, o.agendamento_id, o.barbeiro_id, o.status, o.subtotal, o.desconto_tipo, o.desconto_valor, o.desconto_motivo,
             o.desconto_observacao, o.desconto_calculado, o.total, o.total_pago, o.status_pagamento, o.iniciada_em,
             o.concluida_em, o.motivo_cancelamento,
             (select json_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone) from public.clientes c where c.id = o.cliente_id) as clientes,
             (select json_build_object('nome', p.nome) from public.profiles p where p.id = o.barbeiro_id) as profiles,
             (select json_build_object('inicio', a.inicio, 'fim', a.fim) from public.agendamentos a where a.id = o.agendamento_id) as agendamentos
      from public.ordens_servico o where o.id = ${id}`;
    if (!os) return null; // RLS: barbeiro só enxerga as próprias OS
    return {
      os,
      agendados: await tx<{ nome: string; preco: number }[]>`
        select nome, preco from public.agendamento_servicos where agendamento_id = ${os.agendamento_id} order by ordem`,
      realizados: await tx<{ id: string; nome: string; preco: number; origem: "agendado" | "adicional" }[]>`
        select id, nome, preco, origem from public.os_servicos where os_id = ${id} order by created_at`,
      pagamentos: await tx<Pagamento[]>`
        select pg.id, pg.forma, pg.valor, pg.created_at, pg.estornado_em,
               (select json_build_object('nome', p.nome) from public.profiles p where p.id = pg.registrado_por) as profiles
        from public.pagamentos pg where pg.os_id = ${id} order by pg.created_at`,
      servicosAtivos: await tx<{ id: string; nome: string; preco: number }[]>`
        select id, nome, preco from public.servicos where ativo order by ordem, nome`,
      // "Reagendou": o admin pode trocar o barbeiro; o barbeiro só reagenda para si.
      barbeiros:
        profile.role === "admin"
          ? await tx<{ id: string; nome: string }[]>`
              select id, nome from public.profiles where ativo and atende_como_barbeiro order by nome`
          : null,
    };
  });
  if (!dados) notFound();
  const { os, agendados, realizados, pagamentos, servicosAtivos, barbeiros } = dados;

  const aberta = os.status === "aberta";
  const restante = Math.max(0, Number(os.total) - Number(os.total_pago));
  const inicio = os.agendamentos ? dataHoraSP(new Date(os.agendamentos.inicio)) : null;
  const podeEstornar = aberta || profile.role === "admin";

  // Depois de concluída: "Atendimento concluído" pronto para o WhatsApp.
  const [barbearia, site] = await Promise.all([getEstabelecimento(), urlDoSite()]);
  const mensagens =
    os.status === "concluida"
      ? await comoUsuario(profile.id, (tx) => linksWhatsapp(tx, os.clientes?.telefone ?? null, ["atendimento_concluido"], {
          cliente: os.clientes?.nome.split(" ")[0],
          barbearia: barbearia.nome,
          ...(os.agendamentos ? dataParaMensagem(os.agendamentos.inicio) : {}),
          barbeiro: os.profiles?.nome,
          servicos: (realizados ?? []).map((s) => s.nome).join(" + "),
          valor: formatarPreco(Number(os.total)),
          endereco: barbearia.endereco ?? undefined,
          site,
        }))
      : [];

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-3 py-6 sm:px-4 sm:py-8">
      <div className="flex items-center justify-between">
        <Link href="/painel/atendimentos" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Atendimentos
        </Link>
        <AoVivo />
      </div>

      {/* Cabeçalho */}
      <section className="rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs text-neutral-500">Ordem de serviço</p>
            <h1 className="text-2xl font-semibold text-neutral-900">{tituloOS(os.numero, os.status)}</h1>
            {os.numero === null && os.status === "aberta" && (
              <p className="mt-0.5 text-xs text-neutral-500">O número sai ao concluir o atendimento.</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`rounded-full px-2.5 py-1 text-xs ${STATUS_OS_CLASSE[os.status]}`}>{STATUS_OS_ROTULO[os.status]}</span>
            {os.status !== "cancelada" && (
              <span className={`rounded-full px-2.5 py-1 text-xs ${STATUS_PAGAMENTO_CLASSE[os.status_pagamento]}`}>
                {STATUS_PAGAMENTO_ROTULO[os.status_pagamento]}
              </span>
            )}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-neutral-500">Cliente</dt>
            <dd>
              <Link href={`/painel/clientes/${os.clientes?.id}`} className="font-medium text-neutral-900 hover:underline">
                {os.clientes?.nome}
              </Link>
              <span className="block text-xs text-neutral-500">{formatarTelefone(os.clientes?.telefone ?? null)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Barbeiro</dt>
            <dd className="font-medium text-neutral-900">{os.profiles?.nome}</dd>
          </div>
          {inicio && os.agendamentos && (
            <div className="col-span-2">
              <dt className="text-xs text-neutral-500">Data e horário</dt>
              <dd className="text-neutral-900">
                {DIAS_SEMANA[diaSemana(inicio.data)]}, {formatarDataBR(inicio.data)} · {inicio.hora}–{hora(os.agendamentos.fim)}
                <Link href={`/painel/agenda/${os.agendamento_id}`} className="ml-2 text-xs text-neutral-500 hover:underline">
                  ver agendamento
                </Link>
              </dd>
            </div>
          )}
        </dl>
        {os.status === "cancelada" && os.motivo_cancelamento && (
          <p className="mt-2 text-sm text-neutral-500">Motivo do cancelamento: {os.motivo_cancelamento}</p>
        )}
      </section>

      {/* Serviços */}
      <Secao titulo="Serviços">
        <p className="mb-1 text-xs text-neutral-500">Agendados</p>
        <p className="mb-3 text-sm text-neutral-600">
          {(agendados ?? []).map((s) => `${s.nome} (${formatarPreco(Number(s.preco))})`).join(" + ") || "—"}
        </p>
        <p className="mb-1 text-xs text-neutral-500">Realizados</p>
        <ul className="space-y-1">
          {(realizados ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-neutral-900">
                {s.nome}
                {s.origem === "adicional" && (
                  <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">adicional</span>
                )}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-neutral-900">{formatarPreco(Number(s.preco))}</span>
                {aberta && <BotaoAcao acao={removerServico.bind(null, os.id, s.id)} rotulo="Remover" variante="discreto" />}
              </span>
            </li>
          ))}
          {(realizados ?? []).length === 0 && <li className="text-sm text-neutral-500">Nenhum serviço realizado.</li>}
        </ul>
        {aberta && (
          <AdicionarServicoForm
            acao={adicionarServico.bind(null, os.id)}
            servicos={(servicosAtivos ?? []).map((s) => ({ ...s, preco: Number(s.preco) }))}
          />
        )}
      </Secao>

      {/* Valores */}
      <Secao titulo="Valores">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-600">Serviços</dt>
            <dd className="text-neutral-900">{formatarPreco(Number(os.subtotal))}</dd>
          </div>
          {os.desconto_tipo && (
            <div className="flex justify-between">
              <dt className="text-neutral-600">
                Desconto {os.desconto_tipo === "percentual" ? `${Number(os.desconto_valor)}%` : ""}
                <span className="block text-xs text-neutral-500">
                  {os.desconto_motivo ? MOTIVO_ROTULO[os.desconto_motivo] : ""}
                  {os.desconto_observacao ? ` · ${os.desconto_observacao}` : ""}
                </span>
              </dt>
              <dd className="text-emerald-400">− {formatarPreco(Number(os.desconto_calculado))}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-semibold">
            <dt className="text-neutral-900">Total</dt>
            <dd className="text-neutral-900">{formatarPreco(Number(os.total))}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600">Pago</dt>
            <dd className="text-neutral-900">{formatarPreco(Number(os.total_pago))}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600">Restante</dt>
            <dd className={restante > 0 ? "font-semibold text-amber-300" : "text-neutral-900"}>{formatarPreco(restante)}</dd>
          </div>
        </dl>
        {aberta && (
          <div className="mt-3 border-t border-neutral-200 pt-3">
            <DescontoForm acao={aplicarDesconto.bind(null, os.id)} temDesconto={!!os.desconto_tipo} />
          </div>
        )}
      </Secao>

      {/* Pagamentos */}
      <Secao titulo="Pagamentos">
        <ul className="mb-3 space-y-1">
          {(pagamentos ?? []).map((p) => {
            const registradoPor = (p.profiles as unknown as { nome: string } | null)?.nome;
            return (
              <li key={p.id} className={`flex items-center justify-between gap-2 text-sm ${p.estornado_em ? "opacity-50" : ""}`}>
                <span className="text-neutral-900">
                  <span className={p.estornado_em ? "line-through" : ""}>{FORMA_ROTULO[p.forma as FormaPagamento]}</span>
                  <span className="block text-xs text-neutral-500">
                    {formatarDataBR(dataHoraSP(new Date(p.created_at)).data)} {hora(p.created_at)}
                    {registradoPor ? ` · ${registradoPor}` : ""}
                    {p.estornado_em ? " · estornado" : ""}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className={p.estornado_em ? "line-through" : "text-neutral-900"}>{formatarPreco(Number(p.valor))}</span>
                  {!p.estornado_em && podeEstornar && os.status !== "cancelada" && (
                    <BotaoAcao acao={estornarPagamento.bind(null, os.id, p.id)} rotulo="Estornar" variante="discreto" />
                  )}
                </span>
              </li>
            );
          })}
          {(pagamentos ?? []).length === 0 && <li className="text-sm text-neutral-500">Nenhum pagamento registrado.</li>}
        </ul>
        {os.status !== "cancelada" && restante > 0 && (
          <PagamentoForm key={restante} acao={registrarPagamentos.bind(null, os.id)} restante={restante} />
        )}
      </Secao>

      {/* Ações */}
      {aberta && (
        <section className="space-y-3 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
          <BotaoAcao acao={concluirAtendimento.bind(null, os.id)} rotulo="Concluir atendimento" variante="principal" />
          {restante > 0 && (
            <p className="text-xs text-neutral-500">
              Pode concluir mesmo com {formatarPreco(restante)} em aberto — a OS fica como {STATUS_PAGAMENTO_ROTULO[os.status_pagamento].toLowerCase()} e o
              pagamento pode ser registrado depois.
            </p>
          )}
          {/* Fora concluir, só: não compareceu ou reagendou (decisão 48). */}
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-neutral-200 pt-3">
            <NaoCompareceuBotao acao={naoCompareceu.bind(null, os.id, os.agendamento_id)} />
            {inicio && (
              <FormularioReagendar
                id={os.agendamento_id}
                dataAtual={inicio.data}
                barbeiroAtual={os.barbeiro_id}
                barbeiros={barbeiros}
                acao={reagendarDaOS.bind(null, os.id, os.agendamento_id)}
                rotulo="Reagendou"
              />
            )}
          </div>
        </section>
      )}
      {mensagens.length > 0 && (
        <section className="rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
          <MensagensWhatsapp links={mensagens} />
        </section>
      )}
      {os.status === "concluida" && profile.role === "admin" && (
        <div className="text-right">
          <BotaoAcao acao={reabrirAtendimento.bind(null, os.id)} rotulo="Reabrir OS para correção" variante="secundario" />
        </div>
      )}
    </main>
  );
}
