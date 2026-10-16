import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { ehUuid } from "@/lib/agendamento/disponibilidade";
import { urlPublicaStorage } from "@/lib/estabelecimento";
import { alternarAtivoServico } from "../actions";
import { EditarServicoForm } from "./editar-servico-form";

type Servico = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  duracao_minutos: number;
  ordem: number;
  ativo: boolean;
  foto_path: string | null;
  barbeiros: { id: string; nome: string; ativo: boolean }[];
};

export default async function ServicoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await requireAdmin();
  if (!ehUuid(id)) notFound();
  const [servico] = await comoUsuario(
    userId,
    (tx) => tx<Servico[]>`
      select s.id, s.nome, s.descricao, s.preco, s.duracao_minutos, s.ordem, s.ativo, s.foto_path,
             coalesce((select json_agg(json_build_object('id', p.id, 'nome', p.nome, 'ativo', p.ativo))
                       from public.barbeiro_servicos bs join public.profiles p on p.id = bs.profile_id
                       where bs.servico_id = s.id), '[]') as barbeiros
      from public.servicos s where s.id = ${id}`
  );
  if (!servico) notFound();
  const barbeiros = servico.barbeiros.filter((p) => p.ativo);

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-3 py-6 sm:px-4 sm:py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">{servico.nome}</h1>
        <Link href="/painel/configuracoes/servicos" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Serviços
        </Link>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20">
        <span
          className={
            servico.ativo
              ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400"
              : "rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600"
          }
        >
          {servico.ativo ? "Ativo — aparece no site" : "Desativado — não aparece no site"}
        </span>
        <form action={alternarAtivoServico.bind(null, servico.id, !servico.ativo)}>
          <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
            {servico.ativo ? "Desativar" : "Reativar"}
          </button>
        </form>
      </div>

      <EditarServicoForm
        id={servico.id}
        fotoUrl={urlPublicaStorage(servico.foto_path)}
        servico={{
          nome: servico.nome,
          descricao: servico.descricao,
          preco: Number(servico.preco),
          duracao_minutos: servico.duracao_minutos,
          ordem: servico.ordem,
        }}
      />

      <div className="rounded-2xl border border-neutral-200 bg-surface p-4 text-sm shadow-lg shadow-black/20">
        <p className="font-medium text-neutral-900">Quem realiza</p>
        <p className="mt-1 text-neutral-600">
          {barbeiros.length === 0 ? "Nenhum barbeiro — o serviço não fica disponível para agendamento." : barbeiros.map((b) => b.nome).join(", ")}
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Para mudar, abra o barbeiro em{" "}
          <Link href="/painel/configuracoes/equipe" className="underline hover:text-neutral-900">
            Barbeiros e usuários
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
