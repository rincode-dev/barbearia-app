import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { getEstabelecimento } from "@/lib/estabelecimento";
import { comoUsuario } from "@/lib/db";
import type { Faixa } from "@/components/editor-semana";
import { SecaoBloqueios } from "../bloqueios/secao-bloqueios";
import { FormularioFuncionamento, FormularioRegras } from "./formularios";

const CAMINHO = "/painel/configuracoes/horarios";

function Bloco({ titulo, descricao, children }: { titulo: string; descricao: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-surface p-4 shadow-lg shadow-black/20 sm:p-5">
      <h2 className="text-sm font-semibold text-neutral-900">{titulo}</h2>
      <p className="mb-4 text-xs text-neutral-500">{descricao}</p>
      {children}
    </section>
  );
}

export default async function HorariosPage() {
  const { userId } = await requireAdmin();
  const faixas = await comoUsuario(
    userId,
    (tx) => tx<Faixa[]>`select dia_semana, inicio, fim from public.horarios_funcionamento order by inicio`
  );
  const barbearia = await getEstabelecimento();

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-3 py-6 sm:px-4 sm:py-10">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Horários e agendamento</h1>
        <Link href="/painel/configuracoes" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Configurações
        </Link>
      </div>

      <Bloco
        titulo="Funcionamento da barbearia"
        descricao="Use mais de uma faixa no mesmo dia para intervalos (ex.: almoço). Dia sem faixa = fechado. A jornada de cada barbeiro é configurada na página dele."
      >
        <FormularioFuncionamento faixas={[...faixas]} />
      </Bloco>

      <Bloco
        titulo="Regras do agendamento online"
        descricao="Valem para os horários oferecidos no site."
      >
        <FormularioRegras
          regras={{
            antecedenciaMinimaMinutos: barbearia.antecedenciaMinimaMinutos,
            janelaAgendamentoDias: barbearia.janelaAgendamentoDias,
            granularidadeMinutos: barbearia.granularidadeMinutos,
            politicaCancelamento: barbearia.politicaCancelamento,
          }}
        />
      </Bloco>

      <Bloco
        titulo="Feriados e fechamentos"
        descricao="Dias ou horários em que a barbearia inteira não atende."
      >
        <SecaoBloqueios profileId={null} caminho={CAMINHO} />
      </Bloco>
    </main>
  );
}
