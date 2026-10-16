"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STATUS_ROTULO, type StatusAgendamento } from "@/lib/agendamento/status";
import { posicaoInicial, type BlocoGrade, type ColunaGrade, type Grade } from "./grade";
import { useRolagemContinua } from "@/components/use-rolagem-continua";

// Escala: 1 minuto = 1,6px → 30 min = 48px, 1h = 96px. Um atendimento de 1h ocupa
// exatamente a altura de uma hora da grade.
const PX = 1.6;
const PASSO_ENCAIXE = 15; // toque num horário livre arredonda para 15 min

// Cor por status: fundo suave + barra à esquerda (o texto do status vai no title/aria).
const COR: Record<StatusAgendamento, string> = {
  agendado: "border-sky-400 bg-sky-500/15",
  em_atendimento: "border-violet-400 bg-violet-500/25",
  concluido: "border-emerald-400 bg-emerald-500/15",
  cancelado: "border-neutral-400 bg-neutral-200/60 opacity-60",
  nao_compareceu: "border-red-400 bg-red-500/10 opacity-70",
};

const LINHAS = {
  // Linha forte em cada hora cheia, suave em cada meia hora.
  backgroundImage: [
    `repeating-linear-gradient(to bottom, var(--color-neutral-300) 0 1px, transparent 1px ${60 * PX}px)`,
    `repeating-linear-gradient(to bottom, var(--color-neutral-200) 0 1px, transparent 1px ${30 * PX}px)`,
  ].join(","),
};

const HACHURA = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(255,255,255,0.045) 0 5px, transparent 5px 11px)",
};

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function Bloco({ b, topo }: { b: BlocoGrade; topo: number }) {
  const altura = (b.fim - b.inicio) * PX;
  const largura = 100 / b.pistas;
  const titulo = `${b.faixa} · ${b.duracao}${b.cliente ? ` · ${b.cliente}` : " · Horário ocupado"}${b.servicos ? ` · ${b.servicos}` : ""} · ${STATUS_ROTULO[b.status]}`;
  const estilo = {
    top: (b.inicio - topo) * PX + 1,
    height: Math.max(altura - 2, 14),
    left: `calc(${b.pista * largura}% + 3px)`,
    width: `calc(${largura}% - 6px)`,
  };
  const riscado = b.status === "cancelado" ? "line-through" : "";
  const classe = `absolute overflow-hidden rounded-lg border-l-[3px] px-2 text-neutral-900 shadow-sm shadow-black/30 ${
    b.cliente === null ? "border-neutral-400 bg-neutral-200" : COR[b.status]
  }`;

  const nome = b.cliente ?? "Ocupado";
  const conteudo =
    altura < 30 ? (
      <p className={`truncate text-[11px] leading-[14px] ${riscado}`} style={{ paddingTop: Math.max(0, (altura - 16) / 2) }}>
        <span className="font-semibold tabular-nums">{b.faixa.slice(0, 5)}</span> {nome}
      </p>
    ) : altura < 58 ? (
      <div className="py-1">
        <p className={`truncate text-xs leading-4 font-semibold ${riscado}`}>{nome}</p>
        <p className="truncate text-[11px] leading-4 text-neutral-600 tabular-nums">
          {b.faixa} · {b.duracao}
        </p>
      </div>
    ) : (
      <div className="py-1.5">
        <p className={`truncate text-[13px] leading-4 font-semibold ${riscado}`}>{nome}</p>
        {b.servicos && <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-neutral-700">{b.servicos}</p>}
        <p className="mt-0.5 truncate text-[11px] leading-4 text-neutral-600 tabular-nums">
          {b.faixa} · {b.duracao}
        </p>
      </div>
    );

  return b.href ? (
    <Link href={b.href} data-bloco title={titulo} aria-label={titulo} style={estilo} className={`${classe} hover:brightness-125`}>
      {conteudo}
    </Link>
  ) : (
    <div data-bloco title={titulo} aria-label={titulo} style={estilo} className={classe}>
      {conteudo}
    </div>
  );
}

function Coluna({
  c,
  grade,
  data,
  agora,
}: {
  c: ColunaGrade;
  grade: Grade;
  data: string;
  agora: number | null;
}) {
  const router = useRouter();
  const [fantasma, setFantasma] = useState<number | null>(null);
  const altura = (grade.fim - grade.inicio) * PX;

  // Minuto (arredondado para 15) sob o ponteiro; null se estiver sobre um agendamento.
  function minutoSob(e: React.MouseEvent<HTMLDivElement>): number | null {
    if ((e.target as HTMLElement).closest("[data-bloco]")) return null;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const min = grade.inicio + Math.floor(y / PX / PASSO_ENCAIXE) * PASSO_ENCAIXE;
    return min >= grade.inicio && min < grade.fim ? min : null;
  }

  return (
    <div
      className={`relative border-l border-neutral-200 ${c.podeAgendar ? "cursor-pointer" : ""}`}
      style={{ height: altura, ...LINHAS, backgroundPositionY: "0px" }}
      onMouseMove={c.podeAgendar ? (e) => setFantasma(minutoSob(e)) : undefined}
      onMouseLeave={() => setFantasma(null)}
      onClick={
        c.podeAgendar
          ? (e) => {
              const min = minutoSob(e);
              if (min === null) return;
              const q = new URLSearchParams({ data, hora: hhmm(min), barbeiro: c.id });
              router.push(`/painel/agenda/novo?${q.toString()}`);
            }
          : undefined
      }
    >
      {c.fora.map((f, i) => {
        const ini = Math.max(f.inicio, grade.inicio);
        const fim = Math.min(f.fim, grade.fim);
        if (fim <= ini) return null;
        return (
          <div
            key={i}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bg-neutral-50/70"
            style={{ top: (ini - grade.inicio) * PX, height: (fim - ini) * PX, ...HACHURA }}
          />
        );
      })}

      {fantasma !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[3px] rounded-lg border border-dashed border-neutral-500 px-2 text-[11px] leading-5 text-neutral-600"
          style={{ top: (fantasma - grade.inicio) * PX + 1, height: 30 * PX - 2 }}
        >
          + {hhmm(fantasma)}
        </div>
      )}

      {c.blocos.map((b) => (
        <Bloco key={b.id} b={b} topo={grade.inicio} />
      ))}

      {agora !== null && agora >= grade.inicio && agora <= grade.fim && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
          style={{ top: (agora - grade.inicio) * PX }}
        />
      )}
    </div>
  );
}

export function GradeDia({
  grade,
  data,
  agoraInicial,
  hoje,
}: {
  grade: Grade;
  data: string;
  agoraInicial: number | null; // minutos do dia agora, se `data` é hoje
  hoje: boolean;
}) {
  const rolagem = useRef<HTMLDivElement>(null);
  // No limite de cima/baixo da grade, o gesto continua rolando a página (sem ficar preso).
  useRolagemContinua(rolagem);
  const [agora, setAgora] = useState(agoraInicial);

  // A linha do "agora" anda sozinha (a página em si já atualiza com o AoVivo).
  useEffect(() => {
    if (!hoje) return;
    const t = setInterval(() => setAgora((a) => (a === null ? a : a + 1)), 60_000);
    return () => clearInterval(t);
  }, [hoje]);

  // Posição inicial, só ao abrir o dia (regra em posicaoInicial, grade.ts). Antes mirava
  // sempre o "agora": às 21:57, com a barbearia fechando às 20:00, a grade abria no fim
  // do dia, vazio, escondendo os atendimentos.
  // Logo depois de montar, a posição às vezes era desfeita (visto no navegador: aplicada e,
  // ~0,5s depois, de volta a 0 — o fim da navegação reposiciona a página). Por isso a
  // posição é reaplicada no próximo quadro e mais duas vezes no primeiro segundo, mas
  // nunca depois que a pessoa mexe na grade (rolar, tocar, clicar, teclado).
  useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const alvo = (posicaoInicial(grade, agoraInicial) - grade.inicio) * PX;
    let mexeu = false;
    const marcar = () => (mexeu = true);
    const aplicar = () => {
      if (!mexeu) el.scrollTop = alvo;
    };
    const eventos = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    eventos.forEach((e) => el.addEventListener(e, marcar, { passive: true }));
    aplicar();
    const quadro = requestAnimationFrame(aplicar);
    const tempos = [300, 900].map((ms) => setTimeout(aplicar, ms));
    return () => {
      cancelAnimationFrame(quadro);
      tempos.forEach(clearTimeout);
      eventos.forEach((e) => el.removeEventListener(e, marcar));
    };
    // Só ao abrir o dia (atualizações ao vivo não devem pular a rolagem do usuário).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const horas: number[] = [];
  for (let m = grade.inicio; m <= grade.fim; m += 30) horas.push(m);
  const altura = (grade.fim - grade.inicio) * PX;
  const colunasCss = `3.25rem repeat(${Math.max(grade.colunas.length, 1)}, minmax(9rem, 1fr))`;
  // Largura do cabeçalho e do corpo = a das colunas: 100% quando cabem; senão, a soma dos
  // mínimos (o mesmo tamanho que elas já teriam ao transbordar). Sem isso o cabeçalho
  // ficava com a largura só da parte visível e a linha de baixo parava no meio da última
  // coluna ao rolar para o lado (celular).
  const larguraGrade = `max(100%, calc(3.25rem + ${Math.max(grade.colunas.length, 1)} * 9rem))`;

  return (
    // isolate: as camadas fixas da grade (nomes no topo, horários à esquerda) ficam contidas
    // aqui dentro — sem isso passavam por cima do cabeçalho fixo do painel ao rolar a página.
    <div className="isolate rounded-2xl border border-neutral-200 bg-surface">
      <div
        ref={rolagem}
        className="relative max-h-[calc(100dvh-8rem)] min-h-[24rem] overflow-auto overscroll-y-none overscroll-x-contain rounded-2xl sm:max-h-[calc(100dvh-15rem)]"
      >
        {/* Cabeçalho: um barbeiro por coluna (fixo no topo ao rolar). */}
        <div className="sticky top-0 z-30 grid border-b border-neutral-300 bg-surface" style={{ gridTemplateColumns: colunasCss, width: larguraGrade }}>
          <div className="sticky left-0 z-10 bg-surface" />
          {grade.colunas.map((c) => (
            <div key={c.id} className="truncate border-l border-neutral-200 px-2 py-2 text-center text-sm font-semibold text-neutral-900">
              {c.nome}
              {c.eu && <span className="ml-1 text-xs font-normal text-neutral-500">(eu)</span>}
              <span className="block text-[11px] font-normal text-neutral-500">
                {c.blocos.filter((b) => b.status !== "cancelado" && b.status !== "nao_compareceu").length} atend.
              </span>
            </div>
          ))}
        </div>

        <div className="grid pt-2 pb-3" style={{ gridTemplateColumns: colunasCss, width: larguraGrade }}>
          {/* Horários na lateral (fixos à esquerda ao rolar para o lado). */}
          <div className="sticky left-0 z-20 bg-surface" style={{ height: altura }}>
            {horas.map((m) => (
              <span
                key={m}
                className={`absolute right-2 -translate-y-1/2 text-[11px] tabular-nums ${m % 60 === 0 ? "text-neutral-700" : "text-neutral-400"}`}
                style={{ top: (m - grade.inicio) * PX }}
              >
                {hhmm(m)}
              </span>
            ))}
            {agora !== null && agora >= grade.inicio && agora <= grade.fim && (
              <span
                className="absolute right-0 z-10 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-red-500"
                style={{ top: (agora - grade.inicio) * PX }}
                title={`Agora: ${hhmm(agora)}`}
              />
            )}
          </div>
          {grade.colunas.length === 0 ? (
            <p className="p-6 text-sm text-neutral-500">Nenhum barbeiro atendendo.</p>
          ) : (
            grade.colunas.map((c) => <Coluna key={c.id} c={c} grade={grade} data={data} agora={agora} />)
          )}
        </div>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-200 px-3 py-2 text-[11px] text-neutral-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm border border-neutral-300 bg-surface" /> Livre
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm border border-neutral-300 bg-neutral-50" style={HACHURA} /> Fora do expediente
        </span>
        {(["agendado", "em_atendimento", "concluido"] as StatusAgendamento[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-sm border-l-[3px] ${COR[s]}`} /> {STATUS_ROTULO[s]}
          </span>
        ))}
        <span className="ml-auto hidden sm:inline">Clique num horário livre para agendar</span>
        <span className="sm:hidden">Toque num horário livre para agendar</span>
      </div>
    </div>
  );
}
