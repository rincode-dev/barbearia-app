"use client";

import { useActionState, useState } from "react";
import { preencherTemplate, variaveisDesconhecidas, type VariaveisMensagem } from "@/lib/mensagens/preencher";
import { salvarMensagem } from "./actions";

type Props = {
  tipo: string;
  rotulo: string;
  quando: string;
  conteudo: string;
  padrao: string;
  exemplo: VariaveisMensagem;
  // Variáveis cujo dado não está cadastrado (ex.: endereço) — somem da mensagem enviada.
  semDado: { chave: string; onde: string }[];
};

export function FormularioMensagem({ tipo, rotulo, quando, conteudo, padrao, exemplo, semDado }: Props) {
  const [texto, setTexto] = useState(conteudo);
  const [aviso, salvar, salvando] = useActionState(salvarMensagem.bind(null, tipo), null);

  // Depois de salvar/restaurar, o servidor manda o novo `conteudo`: o campo acompanha.
  const [conteudoAnterior, setConteudoAnterior] = useState(conteudo);
  if (conteudo !== conteudoAnterior) {
    setConteudoAnterior(conteudo);
    setTexto(conteudo);
  }

  const desconhecidas = variaveisDesconhecidas(texto);
  const faltando = semDado.filter((v) => texto.includes(`{${v.chave}}`));

  return (
    <form action={salvar} className="space-y-2 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
      <div>
        <label htmlFor={`msg-${tipo}`} className="block text-sm font-medium text-neutral-900">
          {rotulo}
        </label>
        <p className="text-xs text-neutral-500">{quando}</p>
      </div>
      <textarea
        id={`msg-${tipo}`}
        name="conteudo"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        maxLength={1000}
        required
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <div className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
        <span className="block text-xs text-neutral-500">Prévia</span>
        {preencherTemplate(texto, exemplo)}
      </div>
      {desconhecidas.length > 0 && (
        <p className="text-xs text-red-400">
          Variável desconhecida: {desconhecidas.map((v) => `{${v}}`).join(", ")}
        </p>
      )}
      {faltando.map((v) => (
        <p key={v.chave} className="text-xs text-amber-300">
          {`{${v.chave}}`} ainda não está cadastrado ({v.onde}) — some da mensagem enviada.
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={salvando || texto === conteudo}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        {conteudo !== padrao && (
          <button
            type="submit"
            name="acao"
            value="restaurar"
            formNoValidate
            disabled={salvando}
            className="text-sm text-neutral-500 hover:text-neutral-900 disabled:opacity-50"
          >
            Restaurar texto padrão
          </button>
        )}
        {aviso?.error && <span className="text-sm text-red-400">{aviso.error}</span>}
        {aviso?.success && <span className="text-sm text-emerald-400">{aviso.success}</span>}
      </div>
    </form>
  );
}
