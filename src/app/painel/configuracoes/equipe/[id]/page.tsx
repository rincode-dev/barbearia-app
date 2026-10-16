import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { ehUuid } from "@/lib/agendamento/disponibilidade";
import { urlPublicaStorage } from "@/lib/estabelecimento";
import type { Faixa } from "@/components/editor-semana";
import { SecaoBloqueios } from "../../bloqueios/secao-bloqueios";
import { alternarAtivo } from "../actions";
import { EditarMembroForm, ResetarSenhaForm } from "./edit-forms";
import { FotoForm, JornadaForm, ServicosForm } from "./barbeiro-forms";

function Bloco({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
      <h2 className="text-sm font-semibold text-neutral-900">{titulo}</h2>
      {descricao && <p className="text-xs text-neutral-500">{descricao}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function EditarMembroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile: admin } = await requireAdmin();

  if (!ehUuid(id)) notFound();
  type Membro = {
    id: string;
    nome: string;
    email: string | null;
    role: "admin" | "colaborador";
    ativo: boolean;
    telefone: string | null;
    atende_como_barbeiro: boolean;
    foto_path: string | null;
    ordem_site: number;
  };
  const dados = await comoUsuario(admin.id, async (tx) => {
    const [membro] = await tx<Membro[]>`
      select id, nome, email, role, ativo, telefone, atende_como_barbeiro, foto_path, ordem_site
      from public.profiles where id = ${id}`;
    if (!membro) return null;
    // Dados de atendimento só existem pra quem atende clientes.
    if (!membro.atende_como_barbeiro) return { membro, servicos: [], meusServicos: [], jornada: [] };
    return {
      membro,
      servicos: [
        ...(await tx<{ id: string; nome: string; ativo: boolean }[]>`
          select id, nome, ativo from public.servicos order by ativo desc, ordem, nome`),
      ],
      meusServicos: [
        ...(await tx<{ servico_id: string }[]>`select servico_id from public.barbeiro_servicos where profile_id = ${id}`),
      ],
      jornada: [
        ...(await tx<Faixa[]>`select dia_semana, inicio, fim from public.jornadas where profile_id = ${id} order by inicio`),
      ],
    };
  });
  if (!dados) {
    notFound();
  }
  const { membro } = dados;

  const caminho = `/painel/configuracoes/equipe/${id}`;

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-3 py-6 sm:px-4 sm:py-10">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">{membro.nome || "Sem nome"}</h1>
        <Link href="/painel/configuracoes/equipe" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Equipe
        </Link>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
        <div>
          <p className="text-sm text-neutral-500">{membro.email}</p>
          <span
            className={
              membro.ativo
                ? "mt-1 inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400"
                : "mt-1 inline-block rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600"
            }
          >
            {membro.ativo ? "Ativo" : "Desativado"}
          </span>
        </div>

        {membro.id !== admin.id && (
          <form action={alternarAtivo.bind(null, membro.id, !membro.ativo)}>
            <button
              type="submit"
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              {membro.ativo ? "Remover acesso" : "Reativar"}
            </button>
          </form>
        )}
      </div>

      <EditarMembroForm membro={membro} />

      {membro.atende_como_barbeiro ? (
        <>
          <Bloco titulo="Foto">
            <FotoForm id={membro.id} fotoUrl={urlPublicaStorage(membro.foto_path)} />
          </Bloco>

          <Bloco titulo="Serviços que realiza" descricao="Só aparecem no agendamento os serviços marcados aqui.">
            <ServicosForm
              id={membro.id}
              servicos={dados.servicos}
              selecionados={dados.meusServicos.map((s) => s.servico_id)}
            />
          </Bloco>

          <Bloco
            titulo="Jornada semanal"
            descricao="Horários em que atende. Dia sem faixa = folga fixa. O site só oferece horários dentro da jornada E do funcionamento da barbearia."
          >
            <JornadaForm id={membro.id} faixas={dados.jornada} />
          </Bloco>

          <Bloco titulo="Folgas e bloqueios" descricao="Ausências pontuais (férias, consulta, compromisso).">
            <SecaoBloqueios profileId={membro.id} caminho={caminho} />
          </Bloco>
        </>
      ) : (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
          Esta pessoa não atende clientes. Marque &ldquo;Atende clientes&rdquo; acima para configurar foto, serviços e
          jornada.
        </p>
      )}

      <ResetarSenhaForm id={membro.id} />
    </main>
  );
}
