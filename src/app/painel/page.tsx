import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { AoVivo } from "@/components/ao-vivo";
import { Indicador, ListaRanking } from "@/components/numeros";
import { DIAS_SEMANA, dataHoraSP, formatarDataBR, formatarPreco, hojeSP, instanteSP, somarDias } from "@/lib/datas";
import { diaSemana } from "@/lib/agendamento/motor";
import { STATUS_CLASSE, STATUS_ROTULO, type StatusAgendamento } from "@/lib/agendamento/status";
import { buscarRelatorio } from "@/lib/relatorios";
import { NOMES_MES, periodo } from "./agenda/visoes";
import { abrirAtendimentosDoHorario } from "@/lib/atendimento-automatico";

type Proximo = {
  id: string;
  inicio: string;
  status: StatusAgendamento;
  servicos: string;
  barbeiro_nome: string;
  cliente_nome: string | null;
  os_id: string | null;
};

// "14:30" hoje; "amanhã 09:00"; "sáb 27/09 10:00" nos outros dias.
function rotuloHorario(inicio: string, hoje: string): string {
  const { data, hora } = dataHoraSP(new Date(inicio));
  if (data === hoje) return hora;
  if (data === somarDias(hoje, 1)) return `amanhã ${hora}`;
  return `${DIAS_SEMANA[diaSemana(data)].slice(0, 3).toLowerCase()} ${formatarDataBR(data).slice(0, 5)} ${hora}`;
}

// Início (requisitos do produto, item 11): hoje, próximos atendimentos e o mês — enxuto.
// Admin vê a barbearia inteira; barbeiro vê só o próprio desempenho (o RLS já limita os
// números dele, docs/ARQUITETURA.md decisões 15 e 36).
export default async function InicioPage() {
  const { profile } = await getCurrentProfile();
  await abrirAtendimentosDoHorario();
  const admin = profile.role === "admin";

  const hoje = hojeSP();
  const mes = periodo("mes", hoje);
  const agora = new Date();

  const [relHoje, relMes, [pendentes], lista] = await comoUsuario(profile.id, async (tx) => [
    await buscarRelatorio(tx, hoje, hoje),
    await buscarRelatorio(tx, mes.de, mes.ate),
    // OS concluídas no mês com pagamento em aberto (mesmo critério do filtro "Só com
    // pagamento em aberto" da lista de OS). O RLS limita o barbeiro às dele.
    await tx<{ valor: string; quantidade: number }[]>`
      select coalesce(sum(o.total - o.total_pago), 0) as valor, count(*)::int as quantidade
      from public.ordens_servico o
      where o.status = 'concluida' and o.status_pagamento <> 'pago'
        and o.iniciada_em >= ${instanteSP(mes.de).toISOString()}
        and o.iniciada_em < ${instanteSP(somarDias(mes.ate, 1)).toISOString()}`,
    await tx<Proximo[]>`
      select id, inicio, status, servicos, barbeiro_nome, cliente_nome, os_id
      from public.agenda_equipe
      where status in ('agendado', 'em_atendimento')
        and fim >= ${agora.toISOString()}
        and (${admin} or barbeiro_id = ${profile.id})
      order by inicio
      limit 8`,
  ] as const);
  const [, mm] = hoje.split("-").map(Number);
  const servicosVendidos = relMes.servicos.reduce((s, i) => s + i.quantidade, 0);

  return (
    <main className="mx-auto max-w-3xl space-y-7 px-3 py-6 sm:px-4 sm:py-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Início</h1>
          <p className="text-sm text-neutral-500">
            {DIAS_SEMANA[diaSemana(hoje)]}, {formatarDataBR(hoje)}
            {!admin && " · seu desempenho"}
          </p>
        </div>
        <AoVivo />
      </div>

      {/* Hoje e mês em painéis próprios: o do dia mais escuro e sóbrio, o do mês um tom
          mais claro com um brilho discreto no topo — dá para ver onde um termina e o
          outro começa sem cor nova. Próximos atendimentos vêm depois dos números. */}
      <section className="rounded-2xl border border-neutral-200/70 bg-[#111113] p-3 sm:p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-900">Hoje</h2>
          <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-400">Resumo do dia</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Indicador
            rotulo="Atendimentos"
            valor={`${relHoje.atendimentos} de ${relHoje.agendados}`}
            detalhe="concluídos de agendados"
            progresso={relHoje.agendados > 0 ? relHoje.atendimentos / relHoje.agendados : 0}
            tom={relHoje.agendados > 0 && relHoje.atendimentos >= relHoje.agendados ? "positivo" : "neutro"}
          />
          <Indicador rotulo="Faturamento previsto" valor={formatarPreco(relHoje.previsto)} />
          <Indicador rotulo="Recebido" valor={formatarPreco(relHoje.recebido)} tom={relHoje.recebido > 0 ? "positivo" : "neutro"} />
          <Indicador
            rotulo="Cancelamentos"
            valor={String(relHoje.cancelamentos)}
            tom={relHoje.cancelamentos + relHoje.nao_comparecimentos > 0 ? "atencao" : "neutro"}
            detalhe={relHoje.nao_comparecimentos > 0 ? `+ ${relHoje.nao_comparecimentos} não compareceu` : undefined}
          />
          <Indicador
            rotulo="Descontos"
            valor={formatarPreco(relHoje.descontos.total)}
            detalhe={relHoje.descontos.quantidade > 0 ? `em ${relHoje.descontos.quantidade} atendimento(s)` : undefined}
          />
          {relHoje.pendente > 0 && <Indicador rotulo="A receber (hoje)" valor={formatarPreco(relHoje.pendente)} tom="atencao" />}
        </div>
      </section>

      <section className="relative overflow-hidden rounded-2xl border border-neutral-300/60 bg-[#141417] bg-[radial-gradient(120%_60%_at_50%_0%,rgba(255,255,255,0.045),transparent_70%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Nome do mês a partir da data de hoje (fuso de São Paulo) — nunca fixo. */}
            <h2 className="text-sm font-semibold text-neutral-900">{NOMES_MES[mm - 1]}</h2>
            <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
              Mês atual
            </span>
          </div>
          {admin && (
            <Link href="/painel/financeiro?periodo=mes" className="text-xs text-neutral-500 hover:text-neutral-900">
              Ver Financeiro →
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Indicador rotulo="Faturamento" valor={formatarPreco(relMes.faturamento)} destaque tom={relMes.faturamento > 0 ? "positivo" : "neutro"} />
          <Indicador rotulo="Atendimentos" valor={String(relMes.atendimentos)} destaque />
          <Indicador rotulo="Ticket médio" valor={formatarPreco(relMes.ticket_medio)} />
          <Indicador
            rotulo="Descontos"
            valor={formatarPreco(relMes.descontos.total)}
            detalhe={relMes.descontos.quantidade > 0 ? `em ${relMes.descontos.quantidade} atendimento(s)` : undefined}
          />
          <Indicador
            rotulo="Cancelamentos"
            valor={String(relMes.cancelamentos)}
            tom={relMes.cancelamentos + relMes.nao_comparecimentos > 0 ? "atencao" : "neutro"}
            detalhe={relMes.nao_comparecimentos > 0 ? `+ ${relMes.nao_comparecimentos} não compareceu` : undefined}
          />
          <Indicador rotulo="Serviços vendidos" valor={String(servicosVendidos)} />
          <Link
            href={`/painel/atendimentos?status=concluida&pagamento=pendentes&de=${mes.de}&ate=${mes.ate}`}
            className="block rounded-xl hover:ring-1 hover:ring-neutral-300"
          >
            <Indicador
              rotulo="Valores pendentes"
              valor={formatarPreco(Number(pendentes.valor))}
              detalhe={
                pendentes.quantidade === 0
                  ? "nenhum atendimento"
                  : `${pendentes.quantidade} atendimento${pendentes.quantidade > 1 ? "s" : ""}`
              }
              tom={pendentes.quantidade > 0 ? "atencao" : "neutro"}
              emVermelho={pendentes.quantidade > 0}
            />
          </Link>
        </div>
        {relMes.servicos.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-medium text-neutral-500">Mais realizados no mês</h3>
            <ListaRanking
              vazio=""
              itens={relMes.servicos.slice(0, 5).map((s) => ({
                chave: s.servico_id,
                rotulo: s.nome,
                valor: s.quantidade,
                texto: formatarPreco(s.total),
                selo: `${s.quantidade}×`,
              }))}
            />
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Próximos atendimentos</h2>
          <Link href="/painel/agenda" className="text-xs text-neutral-500 hover:text-neutral-900">
            Ver agenda →
          </Link>
        </div>
        {lista.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-surface p-4 text-sm text-neutral-500">
            Nenhum atendimento marcado daqui pra frente.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-surface">
            {lista.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm text-neutral-900">
                    <span className="font-semibold tabular-nums">{rotuloHorario(a.inicio, hoje)}</span>{" "}
                    · {a.cliente_nome}
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    {a.servicos}
                    {admin && ` · ${a.barbeiro_nome}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_CLASSE[a.status]}`}>{STATUS_ROTULO[a.status]}</span>
                  <Link
                    href={a.os_id ? `/painel/atendimentos/${a.os_id}` : `/painel/agenda/${a.id}`}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                  >
                    {a.os_id ? "Abrir OS" : "Ver"}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
