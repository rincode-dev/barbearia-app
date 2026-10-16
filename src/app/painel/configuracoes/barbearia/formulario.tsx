"use client";

import { useActionState, useState } from "react";
import { CampoImagem } from "@/components/campo-imagem";
import { salvarDadosBarbearia } from "./actions";

export type DadosBarbearia = {
  nome: string;
  descricao: string | null;
  logoUrl: string | null;
  endereco: string | null;
  telefone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  mapaUrl: string | null;
};

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

function Campo({
  id,
  rotulo,
  valor,
  dica,
  ...props
}: { id: string; rotulo: string; valor: string | null; dica?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-neutral-700">
        {rotulo}
      </label>
      <input id={id} name={id} defaultValue={valor ?? ""} className={INPUT} {...props} />
      {dica && <p className="mt-1 text-xs text-neutral-400">{dica}</p>}
    </div>
  );
}

export function FormularioBarbearia({ dados }: { dados: DadosBarbearia }) {
  const [state, formAction, isPending] = useActionState(salvarDadosBarbearia, null);
  const [enviandoLogo, setEnviandoLogo] = useState(false);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:grid-cols-2 sm:p-5"
    >
      <Campo id="nome" rotulo="Nome da barbearia" valor={dados.nome} required />

      <div className="sm:row-span-2">
        <CampoImagem
          name="logo_path"
          pasta="logo"
          urlAtual={dados.logoUrl}
          rotulo="Logo"
          onEnviandoChange={setEnviandoLogo}
        />
        {dados.logoUrl && (
          <label className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
            <input type="checkbox" name="remover_logo" className="accent-accent" />
            Remover logo (mostrar só o nome)
          </label>
        )}
      </div>

      <div className="sm:col-span-1">
        <label htmlFor="descricao" className="mb-1 block text-sm text-neutral-700">
          Sobre a barbearia
        </label>
        <textarea
          id="descricao"
          name="descricao"
          rows={3}
          defaultValue={dados.descricao ?? ""}
          placeholder="Uma ou duas frases que aparecem no site."
          className={INPUT}
        />
      </div>

      <div className="sm:col-span-2">
        <Campo id="endereco" rotulo="Endereço" valor={dados.endereco} placeholder="Rua, número, bairro, cidade" />
      </div>
      <Campo id="telefone" rotulo="Telefone" valor={dados.telefone} type="tel" />
      <Campo
        id="whatsapp"
        rotulo="WhatsApp"
        valor={dados.whatsapp}
        type="tel"
        dica="Número que os clientes usam pra falar com a barbearia."
      />
      <Campo id="instagram" rotulo="Instagram" valor={dados.instagram} placeholder="@suabarbearia" />
      <Campo
        id="mapa_url"
        rotulo="Link do mapa (opcional)"
        valor={dados.mapaUrl}
        type="url"
        placeholder="https://maps.app.goo.gl/..."
        dica="Link do Google Maps. Sem ele, o site usa o endereço pra mostrar o mapa."
      />

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={isPending || enviandoLogo}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>
        {state?.error && (
          <p role="alert" className="mt-2 text-sm text-red-400">
            {state.error}
          </p>
        )}
        {state?.success && <p className="mt-2 text-sm text-emerald-400">{state.success}</p>}
      </div>
    </form>
  );
}
