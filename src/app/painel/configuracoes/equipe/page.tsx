import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario, mensagemDeErro } from "@/lib/db";
import { NovoMembroForm } from "./novo-membro-form";
import { alternarAtivo } from "./actions";

type Membro = {
  id: string;
  nome: string;
  email: string | null;
  role: "admin" | "colaborador";
  ativo: boolean;
  atende_como_barbeiro: boolean;
};

function descricaoFuncao(m: Membro) {
  if (m.role === "admin") return m.atende_como_barbeiro ? "Administrador · atende" : "Administrador";
  return m.atende_como_barbeiro ? "Barbeiro" : "Colaborador (não atende)";
}

function SeloStatus({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={
        ativo
          ? "shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400"
          : "shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600"
      }
    >
      {ativo ? "Ativo" : "Desativado"}
    </span>
  );
}

export default async function EquipePage() {
  const { profile: admin } = await requireAdmin();

  let membros: Membro[] = [];
  let error: { message: string } | null = null;
  try {
    membros = [
      ...(await comoUsuario(
        admin.id,
        (tx) => tx<Membro[]>`select id, nome, email, role, ativo, atende_como_barbeiro from public.profiles order by nome`
      )),
    ];
  } catch (e) {
    error = { message: mensagemDeErro(e) };
  }

  return (
    <main className="mx-auto max-w-3xl px-3 py-6 sm:px-4 sm:py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Barbeiros e usuários</h1>
        <Link href="/painel/configuracoes" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Configurações
        </Link>
      </div>

      <div className="mb-8">
        <NovoMembroForm />
      </div>

      {error && (
        <p className="text-sm text-red-400">Não foi possível carregar a equipe: {error.message}</p>
      )}

      <div className="space-y-2">
        {membros.map((m) => (
          <div
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-surface p-3 shadow-lg shadow-black/20"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-900">{m.nome || "Sem nome"}</span>
                <SeloStatus ativo={m.ativo} />
              </div>
              <p className="break-all text-xs text-neutral-500">
                {m.email} · {descricaoFuncao(m)}
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href={`/painel/configuracoes/equipe/${m.id}`}
                className="text-xs text-neutral-600 hover:text-neutral-900 sm:text-sm"
              >
                Editar
              </Link>
              {m.id !== admin.id && (
                <form action={alternarAtivo.bind(null, m.id, !m.ativo)}>
                  <button type="submit" className="text-xs text-neutral-600 hover:text-neutral-900 sm:text-sm">
                    {m.ativo ? "Remover acesso" : "Reativar"}
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
