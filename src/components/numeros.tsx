// Peças visuais dos números (Início, Financeiro) — decisão 46. Sem barras de progresso:
// número em destaque + pequenos indicadores (selo, ✓, ponto, anel, %). Cores com papel
// fixo: VERDE = positivo/confirmado (recebido, pago, concluído); VERMELHO (acento) =
// atenção (pendente, cancelamento); o resto é neutro. O texto sempre traz o valor — nada
// depende só da cor.

export type Tom = "neutro" | "positivo" | "atencao";

const CARTAO: Record<Tom, string> = {
  neutro: "border-neutral-200 bg-surface",
  positivo:
    "border-emerald-500/25 bg-[linear-gradient(160deg,rgba(16,185,129,0.09),transparent_60%)] bg-surface shadow-[0_0_28px_-16px_rgba(16,185,129,0.55)]",
  atencao: "border-accent/15 bg-surface",
};

function Check({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

// Anel pequeno de proporção (0–1). Só enfeite: o número/percentual está sempre escrito ao lado.
export function Anel({ fracao, tom = "neutro", tamanho = 28 }: { fracao: number; tom?: Tom; tamanho?: number }) {
  const r = (tamanho - 4) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.min(Math.max(fracao, 0), 1);
  const cor = tom === "positivo" ? "stroke-emerald-400" : tom === "atencao" ? "stroke-accent" : "stroke-neutral-600";
  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} className="shrink-0 -rotate-90" aria-hidden="true">
      <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" strokeWidth={3} className="stroke-neutral-200" />
      <circle
        cx={tamanho / 2}
        cy={tamanho / 2}
        r={r}
        fill="none"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={`${c * f} ${c}`}
        className={`${cor} transition-[stroke-dasharray] duration-500`}
      />
    </svg>
  );
}

// Selo pequeno: "✓ 1 pagamento" (positivo), "2×" (neutro), "3 pendentes" (atenção).
export function Selo({ children, tom = "neutro", check = false }: { children: React.ReactNode; tom?: Tom; check?: boolean }) {
  const cls = {
    neutro: "border-neutral-300 bg-neutral-100 text-neutral-700",
    positivo: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    atencao: "border-accent/30 bg-accent/10 text-accent",
  }[tom];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${cls}`}>
      {check && <Check />}
      {children}
    </span>
  );
}

export function Indicador({
  rotulo,
  valor,
  detalhe,
  destaque = false,
  tom = "neutro",
  progresso,
  emVermelho = false,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  destaque?: boolean;
  tom?: Tom;
  // Valor e detalhe em vermelho (ex.: valores pendentes no Início).
  emVermelho?: boolean;
  // 0–1: anel pequeno no canto (ex.: concluídos de agendados).
  progresso?: number;
}) {
  return (
    <div className={`relative rounded-xl border p-3 ${CARTAO[tom]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-neutral-500">
          {tom === "atencao" && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(255,59,64,0.8)]" />}
          {rotulo}
        </p>
        {progresso !== undefined ? (
          <Anel fracao={progresso} tom={tom === "neutro" ? "positivo" : tom} tamanho={22} />
        ) : (
          tom === "positivo" && (
            <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <Check className="h-2.5 w-2.5" />
            </span>
          )
        )}
      </div>
      <p
        className={`mt-0.5 font-semibold tabular-nums ${destaque ? "text-2xl" : "text-lg"} ${
          emVermelho ? "text-accent" : tom === "positivo" ? "text-emerald-400" : "text-neutral-900"
        }`}
      >
        {valor}
      </p>
      {detalhe && <p className={`mt-0.5 text-xs ${emVermelho ? "text-accent" : "text-neutral-500"}`}>{detalhe}</p>}
    </div>
  );
}

// Um item de lista: rótulo, valor principal, selo e (opcional) participação no total.
export type ItemValor = {
  chave: string;
  rotulo: string;
  valor: number; // usado só para a participação (%)
  texto: string; // valor já formatado, em destaque
  selo?: string; // ex.: "1 pagamento", "2×"
  detalhe?: string; // linha pequena abaixo
  // Linha extra no bloco da grade (ex.: "Descontos: R$ 12,00"); vermelha quando `alerta`.
  extra?: { texto: string; alerta: boolean };
};

function participacao(itens: ItemValor[]) {
  const total = itens.reduce((s, i) => s + Math.max(i.valor, 0), 0);
  return (v: number) => (total > 0 ? Math.max(v, 0) / total : 0);
}

const pct = (f: number) => `${Math.round(f * 100)}%`;

// Blocos lado a lado (poucos itens: formas de pagamento, barbeiros).
export function GradeValores({ itens, vazio, tom = "neutro" }: { itens: ItemValor[]; vazio: string; tom?: Tom }) {
  if (itens.length === 0) return <Vazio texto={vazio} />;
  const parte = participacao(itens);
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {itens.map((i) => (
        <li key={i.chave} className={`rounded-xl border p-3 ${tom === "positivo" ? CARTAO.positivo : CARTAO.neutro}`}>
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-neutral-500">{i.rotulo}</span>
            {itens.length > 1 && <span className="shrink-0 text-[11px] text-neutral-500 tabular-nums">{pct(parte(i.valor))}</span>}
          </div>
          <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tom === "positivo" ? "text-emerald-400" : "text-neutral-900"}`}>{i.texto}</p>
          {i.selo && (
            <div className="mt-1">
              <Selo tom={tom} check={tom === "positivo"}>
                {i.selo}
              </Selo>
            </div>
          )}
          {i.detalhe && <p className="mt-1 truncate text-[11px] text-neutral-500">{i.detalhe}</p>}
          {i.extra && (
            <p className={`mt-0.5 truncate text-[11px] tabular-nums ${i.extra.alerta ? "font-medium text-accent" : "text-neutral-500"}`}>{i.extra.texto}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

// Lista compacta (ranking: serviços, motivos de desconto). Uma linha por item.
export function ListaRanking({ itens, vazio }: { itens: ItemValor[]; vazio: string }) {
  if (itens.length === 0) return <Vazio texto={vazio} />;
  const parte = participacao(itens);
  return (
    <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-surface">
      {itens.map((i, n) => (
        <li key={i.chave} className="flex items-center gap-3 px-3 py-2.5">
          <span className="w-4 shrink-0 text-center text-xs font-semibold text-neutral-500 tabular-nums">{n + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900">{i.rotulo}</p>
            <p className="text-xs text-neutral-500 tabular-nums">
              {i.detalhe ?? i.texto}
              {itens.length > 1 && <span className="text-neutral-400"> · {pct(parte(i.valor))}</span>}
            </p>
          </div>
          <Selo>{i.selo ?? i.texto}</Selo>
        </li>
      ))}
    </ul>
  );
}

// Evolução (por dia/mês): uma linha fina por período; sem movimento fica apagado.
export function ListaPeriodos({ itens }: { itens: ItemValor[] }) {
  return (
    <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-surface text-sm">
      {itens.map((i) => {
        const vazio = i.valor <= 0;
        return (
          <li key={i.chave} className={`flex items-center justify-between gap-3 px-3 py-2 ${vazio ? "opacity-45" : ""}`}>
            <span className="w-14 shrink-0 text-neutral-700 tabular-nums">{i.rotulo}</span>
            <span className="flex-1 text-xs text-neutral-500">{i.selo}</span>
            <span className={`font-semibold tabular-nums ${vazio ? "text-neutral-500" : "text-emerald-400"}`}>{i.texto}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Vazio({ texto }: { texto: string }) {
  if (!texto) return null;
  return <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">{texto}</p>;
}
