"use client";

import { useActionState, useState } from "react";
import { CampoImagem } from "@/components/campo-imagem";
import { EditorSemana, type Faixa } from "@/components/editor-semana";
import { salvarFotoMembro, salvarJornadaMembro, salvarServicosMembro } from "../actions";

type Estado = { error?: string; success?: string } | null;

function Rodape({ isPending, rotulo, state, desabilitado = false }: { isPending: boolean; rotulo: string; state: Estado; desabilitado?: boolean }) {
  return (
    <div className="mt-3">
      <button
        type="submit"
        disabled={isPending || desabilitado}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {isPending ? "Salvando..." : rotulo}
      </button>
      {state?.error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {state.error}
        </p>
      )}
      {state?.success && <p className="mt-2 text-sm text-emerald-400">{state.success}</p>}
    </div>
  );
}

export function FotoForm({ id, fotoUrl }: { id: string; fotoUrl: string | null }) {
  const [state, formAction, isPending] = useActionState(salvarFotoMembro.bind(null, id), null);
  const [enviando, setEnviando] = useState(false);
  return (
    <form action={formAction}>
      <CampoImagem
        name="foto_path"
        pasta={`barbeiros/${id}`}
        urlAtual={fotoUrl}
        rotulo="Foto (aparece no site ao escolher o barbeiro)"
        redonda
        onEnviandoChange={setEnviando}
      />
      {fotoUrl && (
        <label className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
          <input type="checkbox" name="remover_foto" className="accent-accent" />
          Remover foto
        </label>
      )}
      <Rodape isPending={isPending} rotulo="Salvar foto" state={state} desabilitado={enviando} />
    </form>
  );
}

export function ServicosForm({
  id,
  servicos,
  selecionados,
}: {
  id: string;
  servicos: { id: string; nome: string; ativo: boolean }[];
  selecionados: string[];
}) {
  const [state, formAction, isPending] = useActionState(salvarServicosMembro.bind(null, id), null);
  if (servicos.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum serviço cadastrado ainda (Configurações → Serviços).</p>;
  }
  return (
    <form action={formAction}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {servicos.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm text-neutral-800">
            <input
              type="checkbox"
              name="servicos"
              value={s.id}
              defaultChecked={selecionados.includes(s.id)}
              className="h-4 w-4 accent-accent"
            />
            {s.nome}
            {!s.ativo && <span className="text-xs text-neutral-500">(desativado)</span>}
          </label>
        ))}
      </div>
      <Rodape isPending={isPending} rotulo="Salvar serviços" state={state} />
    </form>
  );
}

export function JornadaForm({ id, faixas }: { id: string; faixas: Faixa[] }) {
  const [state, formAction, isPending] = useActionState(salvarJornadaMembro.bind(null, id), null);
  return (
    <form action={formAction}>
      <EditorSemana name="faixas" faixasIniciais={faixas} rotuloVazio="Folga" />
      <Rodape isPending={isPending} rotulo="Salvar jornada" state={state} />
    </form>
  );
}
