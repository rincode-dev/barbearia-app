"use client";

import { useActionState } from "react";
import { atualizarMembro, resetarSenha } from "../actions";
import { CamposPermissao } from "../campos-permissao";

type Membro = {
  id: string;
  nome: string;
  telefone: string | null;
  role: "admin" | "colaborador";
  atende_como_barbeiro: boolean;
  ordem_site: number;
};

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function EditarMembroForm({ membro }: { membro: Membro }) {
  const action = atualizarMembro.bind(null, membro.id);
  const [state, formAction, isPending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5 sm:grid-cols-2"
    >
      <div>
        <label htmlFor="nome" className="mb-1 block text-sm text-neutral-700">Nome</label>
        <input id="nome" name="nome" defaultValue={membro.nome} required autoComplete="name" className={INPUT} />
      </div>

      <div>
        <label htmlFor="telefone" className="mb-1 block text-sm text-neutral-700">Telefone</label>
        <input
          id="telefone"
          name="telefone"
          defaultValue={membro.telefone ?? ""}
          type="tel"
          autoComplete="tel"
          className={INPUT}
        />
      </div>

      <CamposPermissao roleAtual={membro.role} atendeAtual={membro.atende_como_barbeiro} />

      <div>
        <label htmlFor="ordem_site" className="mb-1 block text-sm text-neutral-700">Ordem no site</label>
        <input id="ordem_site" name="ordem_site" type="number" min={0} max={999} defaultValue={membro.ordem_site} className={INPUT} />
        <p className="mt-1 text-xs text-neutral-400">Na escolha de profissional do site, menor aparece primeiro.</p>
      </div>

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {state?.error && (
        <p role="alert" className="sm:col-span-2 text-sm text-red-400">
          {state.error}
        </p>
      )}
      {state?.success && <p className="sm:col-span-2 text-sm text-emerald-400">{state.success}</p>}
    </form>
  );
}

export function ResetarSenhaForm({ id }: { id: string }) {
  const action = resetarSenha.bind(null, id);
  const [state, formAction, isPending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5"
    >
      <h2 className="mb-3 text-sm font-semibold text-neutral-900">Redefinir senha</h2>
      <div className="flex gap-3">
        <input
          name="novaSenha"
          type="password"
          minLength={6}
          required
          placeholder="Nova senha"
          autoComplete="new-password"
          className={INPUT}
        />
        <button
          type="submit"
          disabled={isPending}
          className="whitespace-nowrap rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Redefinir"}
        </button>
      </div>

      {state?.error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {state.error}
        </p>
      )}
      {state?.success && <p className="mt-2 text-sm text-emerald-400">{state.success}</p>}
    </form>
  );
}
