import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { formatarDuracao, formatarPreco } from "@/lib/datas";
import { NovoServicoForm } from "./novo-servico-form";

type Servico = {
  id: string;
  nome: string;
  preco: number;
  duracao_minutos: number;
  ativo: boolean;
  barbeiro_ids: string[];
};

export default async function ServicosPage() {
  const { userId } = await requireAdmin();
  const [servicos, ativos] = await comoUsuario(userId, async (tx) => [
    await tx<Servico[]>`
      select s.id, s.nome, s.preco, s.duracao_minutos, s.ativo,
             coalesce((select array_agg(bs.profile_id) from public.barbeiro_servicos bs where bs.servico_id = s.id), '{}') as barbeiro_ids
      from public.servicos s
      order by s.ativo desc, s.ordem, s.nome`,
    await tx<{ id: string }[]>`select id from public.profiles where ativo and atende_como_barbeiro`,
  ] as const);
  // Conta só quem atende de verdade (ativo e "atende clientes") — o mesmo critério do
  // site para o serviço ser agendável (decisão 27).
  const idsAtivos = new Set(ativos.map((p) => p.id));
  const realizam = (s: Servico) => s.barbeiro_ids.filter((id) => idsAtivos.has(id)).length;

  return (
    <main className="mx-auto max-w-3xl px-3 py-6 sm:px-4 sm:py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Serviços</h1>
        <Link href="/painel/configuracoes" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Configurações
        </Link>
      </div>

      <div className="mb-8">
        <NovoServicoForm />
      </div>

      {servicos.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum serviço cadastrado ainda.</p>
      ) : (
        <div className="space-y-2">
          {servicos.map((s) => (
            <Link
              key={s.id}
              href={`/painel/configuracoes/servicos/${s.id}`}
              className={`flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-surface p-3 shadow-lg shadow-black/20 hover:border-neutral-300 ${
                s.ativo ? "" : "opacity-60"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900">
                  {s.nome}
                  {!s.ativo && <span className="ml-2 text-xs font-normal text-neutral-500">desativado</span>}
                </p>
                <p className="text-xs text-neutral-500">
                  {formatarDuracao(s.duracao_minutos)} ·{" "}
                  {realizam(s) === 0 ? (
                    <span className="text-amber-400">nenhum barbeiro realiza</span>
                  ) : (
                    `${realizam(s)} barbeiro(s)`
                  )}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-neutral-900">{formatarPreco(Number(s.preco))}</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
