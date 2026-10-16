import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { AoVivo } from "@/components/ao-vivo";
import { GradeValores, Indicador, ListaPeriodos, ListaRanking, type ItemValor } from "@/components/numeros";
import { formatarDataBR, formatarPreco, hojeSP, somarDias } from "@/lib/datas";
import { FORMA_ROTULO, MOTIVO_ROTULO } from "@/lib/os";
import { buscarRelatorio, type Relatorio } from "@/lib/relatorios";
import { NOMES_MES, deslocar, periodo } from "../agenda/visoes";
import { SelectBarbeiro } from "./filtro-barbeiro";

type Params = { periodo?: string; de?: string; ate?: string; barbeiro?: string };

const PERIODOS = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "semana", rotulo: "Semana" },
  { valor: "mes", rotulo: "Mês" },
  { valor: "mes_passado", rotulo: "Mês passado" },
  { valor: "personalizado", rotulo: "Período" },
] as const;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CAMPO = "rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none";

function resolverPeriodo(params: Params, hoje: string): { tipo: string; de: string; ate: string } {
  switch (params.periodo) {
    case "hoje":
      return { tipo: "hoje", de: hoje, ate: hoje };
    case "semana":
      return { tipo: "semana", ...periodo("semana", hoje) };
    case "mes_passado":
      return { tipo: "mes_passado", ...periodo("mes", deslocar("mes", hoje, -1)) };
    case "personalizado": {
      const de = params.de && DATA.test(params.de) ? params.de : somarDias(hoje, -29);
      let ate = params.ate && DATA.test(params.ate) ? params.ate : hoje;
      if (ate < de) ate = de;
      // Mesmo limite da função do banco (~1 ano e pouco).
      if (somarDias(de, 400) < ate) ate = somarDias(de, 400);
      return { tipo: "personalizado", de, ate };
    }
    default:
      return { tipo: "mes", ...periodo("mes", hoje) };
  }
}

// Evolução no período: por dia até ~2 meses; acima disso, por mês.
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function evolucao(rel: Relatorio): ItemValor[] {
  if (rel.por_dia.length <= 62) {
    return rel.por_dia.map((d) => ({
      chave: d.dia,
      rotulo: formatarDataBR(d.dia).slice(0, 5),
      valor: d.faturamento,
      texto: formatarPreco(d.faturamento),
      selo: d.atendimentos ? plural(d.atendimentos, "atendimento", "atendimentos") : "",
    }));
  }
  const meses = new Map<string, { faturamento: number; atendimentos: number }>();
  for (const d of rel.por_dia) {
    const chave = d.dia.slice(0, 7);
    const m = meses.get(chave) ?? { faturamento: 0, atendimentos: 0 };
    m.faturamento += d.faturamento;
    m.atendimentos += d.atendimentos;
    meses.set(chave, m);
  }
  return [...meses].map(([chave, m]) => {
    const [ano, mes] = chave.split("-").map(Number);
    return {
      chave,
      rotulo: `${NOMES_MES[mes - 1].slice(0, 3)}/${ano}`,
      valor: m.faturamento,
      texto: formatarPreco(m.faturamento),
      selo: m.atendimentos ? plural(m.atendimentos, "atendimento", "atendimentos") : "",
    };
  });
}

function Secao({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-900">{titulo}</h2>
      {nota && <p className="text-xs text-neutral-500">{nota}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

// Financeiro + Relatórios (requisitos do produto, itens 21 e 22; menu enxuto, decisão 14).
// Todos os números vêm de relatorio_financeiro (fórmulas: docs/ARQUITETURA.md, decisão 36).
export default async function FinanceiroPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { userId } = await requireAdmin();
  const params = await searchParams;
  const hoje = hojeSP();
  const { tipo, de, ate } = resolverPeriodo(params, hoje);

  const [barbeiros, barbeiro, rel] = await comoUsuario(userId, async (tx) => {
    const barbeiros = await tx<{ id: string; nome: string; ativo: boolean }[]>`
      select id, nome, ativo from public.profiles where atende_como_barbeiro order by nome`;
    const barbeiro = barbeiros.some((b) => b.id === params.barbeiro) ? params.barbeiro! : "";
    return [barbeiros, barbeiro, await buscarRelatorio(tx, de, ate, barbeiro)] as const;
  });

  const link = (mudancas: Partial<Params>) => {
    const q = new URLSearchParams();
    const final: Params = { periodo: tipo, barbeiro, ...mudancas };
    if (final.periodo === "personalizado") {
      final.de ??= de;
      final.ate ??= ate;
    }
    for (const [k, v] of Object.entries(final)) if (v) q.set(k, v);
    return `/painel/financeiro?${q.toString()}`;
  };
  const rotuloPeriodo = de === ate ? formatarDataBR(de) : `${formatarDataBR(de)} a ${formatarDataBR(ate)}`;
  const linkPendentes = `/painel/atendimentos?status=concluida&pagamento=pendentes&de=${de}&ate=${ate}`;

  return (
    <main className="mx-auto max-w-3xl space-y-7 px-3 py-6 sm:px-4 sm:py-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Financeiro</h1>
          <p className="text-sm text-neutral-500">{rotuloPeriodo}</p>
        </div>
        <AoVivo />
      </div>

      {/* Filtros numa linha só, acima de tudo. */}
      <div className="space-y-2">
        <nav className="flex flex-wrap gap-1.5" aria-label="Filtro de datas">
          {PERIODOS.map((p) => (
            <Link
              key={p.valor}
              href={link({ periodo: p.valor, de: undefined, ate: undefined })}
              aria-current={tipo === p.valor ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                tipo === p.valor
                  ? "border-accent bg-accent font-medium text-white"
                  : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {p.rotulo}
            </Link>
          ))}
        </nav>
        {/* Datas só em "Período"; o barbeiro vale para qualquer período e aplica ao trocar. */}
        <form action="/painel/financeiro" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="periodo" value={tipo} />
          {tipo === "personalizado" && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                De
                <input type="date" name="de" defaultValue={de} aria-label="Data inicial" className={CAMPO} />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                Até
                <input type="date" name="ate" defaultValue={ate} aria-label="Data final" className={CAMPO} />
              </label>
            </>
          )}
          <SelectBarbeiro barbeiros={barbeiros} valor={barbeiro} className={CAMPO} />
          {tipo === "personalizado" && (
            <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
              Aplicar período
            </button>
          )}
          {barbeiro && (
            <Link href={link({ barbeiro: undefined })} className="text-sm text-neutral-500 hover:text-neutral-900">
              Limpar barbeiro
            </Link>
          )}
        </form>
      </div>

      <section>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Indicador
            rotulo="Faturamento"
            valor={formatarPreco(rel.faturamento)}
            detalhe="atendimentos concluídos"
            destaque
            tom="positivo"
          />
          <Indicador rotulo="Recebido" valor={formatarPreco(rel.recebido)} detalhe="pagamentos no período" destaque tom="positivo" />
          <Link href={linkPendentes} className="block rounded-xl hover:ring-1 hover:ring-neutral-300">
            <Indicador
              rotulo="Pendente →"
              valor={formatarPreco(rel.pendente)}
              detalhe={`em aberto no total: ${formatarPreco(rel.pendente_total)}`}
              destaque
              tom={rel.pendente_total > 0 ? "atencao" : "neutro"}
            />
          </Link>
          <Indicador rotulo="Atendimentos" valor={String(rel.atendimentos)} />
          <Indicador rotulo="Ticket médio" valor={formatarPreco(rel.ticket_medio)} />
          <Indicador
            rotulo="Cancelamentos"
            valor={String(rel.cancelamentos)}
            detalhe={`${rel.nao_comparecimentos} não compareceu`}
            tom={rel.cancelamentos + rel.nao_comparecimentos > 0 ? "atencao" : "neutro"}
          />
        </div>
      </section>

      <Secao titulo="Formas de pagamento" nota="O que entrou no caixa no período (estornos não contam).">
        <GradeValores
          tom="positivo"
          vazio="Nenhum pagamento no período."
          itens={rel.formas.map((f) => ({
            chave: f.forma,
            rotulo: FORMA_ROTULO[f.forma] ?? f.forma,
            valor: f.total,
            texto: formatarPreco(f.total),
            selo: plural(f.quantidade, "pagamento", "pagamentos"),
          }))}
        />
      </Secao>

      <Secao
        titulo="Serviços mais realizados"
        nota="Serviços dos atendimentos concluídos, pelo preço de tabela da época (antes do desconto)."
      >
        <ListaRanking
          vazio="Nenhum atendimento concluído no período."
          itens={rel.servicos.map((s) => ({
            chave: s.servico_id,
            rotulo: s.nome,
            valor: s.quantidade,
            texto: formatarPreco(s.total),
            selo: `${s.quantidade}×`,
          }))}
        />
      </Secao>

      {!barbeiro && (
        <Secao titulo="Faturamento por barbeiro">
          <GradeValores
            tom="positivo"
            vazio="Nenhum atendimento concluído no período."
            itens={rel.barbeiros.map((b) => ({
              chave: b.barbeiro_id,
              rotulo: b.nome || "Sem nome",
              valor: b.faturamento,
              texto: formatarPreco(b.faturamento),
              selo: plural(b.atendimentos, "atendimento", "atendimentos"),
              detalhe: `ticket ${formatarPreco(b.ticket_medio)}`,
              // Desconto dado nos atendimentos do barbeiro (vermelho quando houver).
              extra: { texto: `Descontos: ${formatarPreco(Number(b.descontos))}`, alerta: Number(b.descontos) > 0 },
            }))}
          />
        </Secao>
      )}

      <Secao titulo="Descontos concedidos">
        <div className="grid grid-cols-3 gap-2">
          <Indicador rotulo="Total" valor={formatarPreco(rel.descontos.total)} />
          <Indicador rotulo="Atendimentos" valor={String(rel.descontos.quantidade)} />
          <Indicador rotulo="Média" valor={formatarPreco(rel.descontos.media)} />
        </div>
        {rel.descontos.por_motivo.length > 0 && (
          <div className="mt-2">
            <ListaRanking
              vazio=""
              itens={rel.descontos.por_motivo.map((m) => ({
                chave: m.motivo,
                rotulo: MOTIVO_ROTULO[m.motivo] ?? m.motivo,
                valor: m.total,
                texto: formatarPreco(m.total),
                selo: `${m.quantidade}×`,
              }))}
            />
          </div>
        )}
      </Secao>

      {rel.por_dia.length > 1 && (
        <Secao titulo={rel.por_dia.length <= 62 ? "Faturamento por dia" : "Faturamento por mês"}>
          <ListaPeriodos itens={evolucao(rel)} />
        </Secao>
      )}
    </main>
  );
}
