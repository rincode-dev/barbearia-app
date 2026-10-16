import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { dataHoraSP, formatarDataBR, hojeSP, somarDias } from "@/lib/datas";
import { removerBloqueio } from "./actions";
import { FormularioBloqueio } from "./formulario-bloqueio";

type Bloqueio = { id: string; tipo: string; inicio: string; fim: string; motivo: string | null };

const ROTULO_TIPO: Record<string, string> = { feriado: "Fechado", folga: "Folga", bloqueio: "Bloqueio" };

// "25/12/2026 (dia inteiro)", "24/12 a 26/12/2026 (dias inteiros)" ou
// "25/12/2026 14:00–16:00" — sempre no fuso da barbearia.
function descreverPeriodo(b: Bloqueio): string {
  const ini = dataHoraSP(new Date(b.inicio));
  const fim = dataHoraSP(new Date(b.fim));
  if (ini.hora === "00:00" && fim.hora === "00:00") {
    const ultimoDia = somarDias(fim.data, -1);
    return ultimoDia === ini.data
      ? `${formatarDataBR(ini.data)} (dia inteiro)`
      : `${formatarDataBR(ini.data)} a ${formatarDataBR(ultimoDia)} (dias inteiros)`;
  }
  if (ini.data === fim.data) return `${formatarDataBR(ini.data)} ${ini.hora}–${fim.hora}`;
  return `${formatarDataBR(ini.data)} ${ini.hora} a ${formatarDataBR(fim.data)} ${fim.hora}`;
}

/**
 * Lista os bloqueios que ainda não terminaram + formulário para adicionar.
 * profileId nulo = feriados/fechamentos da barbearia; senão, folgas/bloqueios do barbeiro.
 */
export async function SecaoBloqueios({ profileId, caminho }: { profileId: string | null; caminho: string }) {
  const { userId } = await getCurrentProfile();
  const bloqueios = await comoUsuario(
    userId,
    (tx) => tx<Bloqueio[]>`
      select id, tipo, inicio, fim, motivo from public.bloqueios
      where fim > ${new Date().toISOString()}
        and ${profileId ? tx`profile_id = ${profileId}` : tx`profile_id is null`}
      order by inicio`
  );

  return (
    <div className="space-y-3">
      {bloqueios.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum cadastrado daqui pra frente.</p>
      ) : (
        <ul className="space-y-2">
          {bloqueios.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            >
              <span className="text-neutral-800">
                <span className="mr-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                  {ROTULO_TIPO[b.tipo] ?? b.tipo}
                </span>
                {descreverPeriodo(b)}
                {b.motivo && <span className="text-neutral-500"> · {b.motivo}</span>}
              </span>
              <form action={removerBloqueio.bind(null, b.id, caminho)}>
                <button type="submit" className="text-xs text-neutral-500 hover:text-red-400">
                  Remover
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <FormularioBloqueio profileId={profileId} caminho={caminho} hoje={hojeSP()} />
    </div>
  );
}
