"use client";

import { useActionState, useState } from "react";
import { FORMAS_PAGAMENTO, MOTIVOS_DESCONTO, lerValorBR } from "@/lib/os";
import { formatarPreco } from "@/lib/datas";

type Estado = { error?: string; success?: string } | null;
type AcaoSemForm = (prev: Estado) => Promise<Estado>;
type AcaoComForm = (prev: Estado, formData: FormData) => Promise<Estado>;

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

function Mensagem({ state }: { state: Estado }) {
  if (state?.error)
    return (
      <p role="alert" className="mt-2 text-sm text-red-400">
        {state.error}
      </p>
    );
  if (state?.success) return <p className="mt-2 text-sm text-emerald-400">{state.success}</p>;
  return null;
}

const VARIANTES = {
  principal: "w-full rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:w-auto",
  secundario: "rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50",
  discreto: "text-xs text-neutral-500 hover:text-red-400 disabled:opacity-50",
};

// Botão que dispara uma Server Action já com os parâmetros "presos" (bind).
export function BotaoAcao({
  acao,
  rotulo,
  variante = "secundario",
}: {
  acao: AcaoSemForm;
  rotulo: string;
  variante?: keyof typeof VARIANTES;
}) {
  const [state, formAction, isPending] = useActionState(acao, null);
  return (
    <form action={formAction} className="inline">
      <button type="submit" disabled={isPending} className={VARIANTES[variante]}>
        {isPending ? "Aguarde..." : rotulo}
      </button>
      <Mensagem state={state} />
    </form>
  );
}

export function AdicionarServicoForm({ acao, servicos }: { acao: AcaoComForm; servicos: { id: string; nome: string; preco: number }[] }) {
  const [state, formAction, isPending] = useActionState(acao, null);
  return (
    <form action={formAction} className="mt-3 flex gap-2">
      <select name="servico_id" defaultValue="" required aria-label="Serviço adicional" className={INPUT}>
        <option value="" disabled>
          + Adicionar serviço...
        </option>
        {servicos.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nome} — {formatarPreco(s.preco)}
          </option>
        ))}
      </select>
      <button type="submit" disabled={isPending} className={VARIANTES.secundario}>
        {isPending ? "..." : "Adicionar"}
      </button>
      <Mensagem state={state} />
    </form>
  );
}

export function DescontoForm({
  acao,
  temDesconto,
}: {
  acao: AcaoComForm;
  temDesconto: boolean;
}) {
  const [state, formAction, isPending] = useActionState(acao, null);
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setAberto(true)} className="text-sm text-neutral-700 underline">
          {temDesconto ? "Alterar desconto" : "+ Aplicar desconto"}
        </button>
        {temDesconto && (
          <form action={formAction}>
            <input type="hidden" name="remover" value="1" />
            <button type="submit" disabled={isPending} className={VARIANTES.discreto}>
              Remover desconto
            </button>
          </form>
        )}
        <Mensagem state={state} />
      </div>
    );
  }

  return (
    <form action={formAction} className="grid grid-cols-2 gap-2">
      <select name="tipo" defaultValue="percentual" aria-label="Tipo de desconto" className={INPUT}>
        <option value="percentual">Percentual (%)</option>
        <option value="fixo">Valor fixo (R$)</option>
      </select>
      <input name="valor" inputMode="decimal" required placeholder="Ex.: 10" aria-label="Valor do desconto" className={INPUT} />
      <select
        name="motivo"
        required
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        aria-label="Motivo do desconto"
        className={`${INPUT} col-span-2`}
      >
        <option value="" disabled>
          Motivo...
        </option>
        {MOTIVOS_DESCONTO.map((m) => (
          <option key={m.valor} value={m.valor}>
            {m.rotulo}
          </option>
        ))}
      </select>
      <input
        name="observacao"
        placeholder={motivo === "personalizado" ? "Descreva o motivo" : "Observação (opcional)"}
        required={motivo === "personalizado"}
        aria-label="Observação do desconto"
        className={`${INPUT} col-span-2`}
      />
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={isPending} className={VARIANTES.secundario}>
          {isPending ? "Aplicando..." : "Aplicar desconto"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="text-sm text-neutral-500">
          Fechar
        </button>
      </div>
      <div className="col-span-2">
        <Mensagem state={state} />
      </div>
    </form>
  );
}

type ParteForm = { chave: number; forma: string; valor: string };

const emTexto = (n: number) => (Math.max(n, 0)).toFixed(2).replace(".", ",");

// Pagamento dividido numa tela só: uma linha por forma (Dinheiro, Pix, cartão...). A 1ª
// já vem com o restante; "+ Adicionar forma" cria outra com o que ainda falta. Tudo é
// gravado de uma vez (tudo ou nada, no banco).
export function PagamentoForm({ acao, restante }: { acao: AcaoComForm; restante: number }) {
  const [state, formAction, isPending] = useActionState(acao, null);
  const [partes, setPartes] = useState<ParteForm[]>([{ chave: 0, forma: "pix", valor: emTexto(restante) }]);

  const valores = partes.map((p) => lerValorBR(p.valor));
  const soma = Math.round(valores.reduce<number>((s, v) => s + (v ?? 0), 0) * 100) / 100;
  const falta = Math.round((restante - soma) * 100) / 100;
  const invalido = valores.some((v) => v === null || v <= 0);
  const passou = falta < 0;

  function alterar(chave: number, campo: "forma" | "valor", valor: string) {
    setPartes((atual) => atual.map((p) => (p.chave === chave ? { ...p, [campo]: valor } : p)));
  }

  function adicionar() {
    setPartes((atual) => {
      const usadas = new Set(atual.map((p) => p.forma));
      const forma = FORMAS_PAGAMENTO.find((f) => !usadas.has(f.valor))?.valor ?? "outros";
      return [...atual, { chave: Math.max(...atual.map((p) => p.chave)) + 1, forma, valor: emTexto(falta) }];
    });
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="pagamentos" value={JSON.stringify(partes.map(({ forma, valor }) => ({ forma, valor })))} />
      {partes.map((p, i) => (
        <div key={p.chave} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <select
            value={p.forma}
            onChange={(e) => alterar(p.chave, "forma", e.target.value)}
            aria-label={`Forma de pagamento ${i + 1}`}
            className={INPUT}
          >
            {FORMAS_PAGAMENTO.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </select>
          <input
            value={p.valor}
            onChange={(e) => alterar(p.chave, "valor", e.target.value)}
            inputMode="decimal"
            required
            aria-label={`Valor ${i + 1}`}
            className={INPUT}
          />
          {partes.length > 1 ? (
            <button
              type="button"
              onClick={() => setPartes((atual) => atual.filter((x) => x.chave !== p.chave))}
              aria-label={`Remover forma ${i + 1}`}
              className="h-9 w-9 rounded-lg border border-neutral-300 text-neutral-500 hover:border-red-400 hover:text-red-400"
            >
              ×
            </button>
          ) : (
            <span className="w-9" />
          )}
        </div>
      ))}

      {partes.length < FORMAS_PAGAMENTO.length && (
        <button type="button" onClick={adicionar} className="text-sm font-medium text-accent hover:text-accent-hover">
          + Adicionar outra forma
        </button>
      )}

      <p className={`text-sm ${passou ? "text-red-400" : "text-neutral-500"}`}>
        {partes.length > 1 && <>Soma {formatarPreco(soma)} · </>}
        {passou
          ? `Passa ${formatarPreco(-falta)} do restante (${formatarPreco(restante)}).`
          : falta > 0
            ? `Ainda faltam ${formatarPreco(falta)} — fica como pagamento parcial.`
            : "Quita o restante da OS."}
      </p>

      <button type="submit" disabled={isPending || invalido || passou} className={VARIANTES.secundario}>
        {isPending ? "Registrando..." : partes.length > 1 ? `Registrar ${partes.length} pagamentos` : "Registrar pagamento"}
      </button>
      <Mensagem state={state} />
    </form>
  );
}

// "Não compareceu" durante o atendimento: pede um segundo toque para confirmar (tira a OS).
export function NaoCompareceuBotao({ acao }: { acao: AcaoSemForm }) {
  const [state, formAction, isPending] = useActionState(acao, null);
  const [confirmando, setConfirmando] = useState(false);
  if (!confirmando) {
    return (
      <button type="button" onClick={() => setConfirmando(true)} className="text-sm text-red-400 hover:underline">
        Não compareceu
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={isPending} className="rounded-lg bg-red-500/80 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
        {isPending ? "Salvando..." : "Confirmar: não compareceu"}
      </button>
      <button type="button" onClick={() => setConfirmando(false)} className="text-sm text-neutral-500 hover:text-neutral-900">
        Voltar
      </button>
      <Mensagem state={state} />
    </form>
  );
}
