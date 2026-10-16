import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/session";
import { comoUsuario } from "@/lib/db";
import { hojeSP } from "@/lib/datas";
import { FormularioEncaixe } from "./formulario";

// Agendamento pelo painel: encaixe de balcão, marcação por telefone. Barbeiro agenda para
// si; admin escolhe o barbeiro.
export default async function NovoAgendamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; data?: string; hora?: string; barbeiro?: string }>;
}) {
  const { cliente, data, hora, barbeiro } = await searchParams;
  const { profile } = await getCurrentProfile();
  const [clientes, servicos, barbeiros] = await comoUsuario(profile.id, async (tx) => [
    await tx<{ id: string; nome: string; telefone: string }[]>`
      select id, nome, telefone from public.clientes where deleted_at is null order by nome`,
    await tx<{ id: string; nome: string; preco: number; duracao_minutos: number }[]>`
      select id, nome, preco, duracao_minutos from public.servicos where ativo order by ordem, nome`,
    profile.role === "admin"
      ? await tx<{ id: string; nome: string }[]>`
          select id, nome from public.profiles where ativo and atende_como_barbeiro order by nome`
      : null,
  ] as const);

  return (
    <main className="mx-auto max-w-2xl px-3 py-6 sm:px-4 sm:py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Novo agendamento</h1>
        <Link href="/painel/agenda" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Agenda
        </Link>
      </div>
      {profile.role !== "admin" && !profile.atende_como_barbeiro ? (
        <p className="text-sm text-neutral-500">Só quem atende clientes pode agendar para si.</p>
      ) : (
        <FormularioEncaixe
          clientes={clientes ?? []}
          servicos={(servicos ?? []).map((s) => ({ ...s, preco: Number(s.preco) }))}
          barbeiros={barbeiros}
          barbeiroFixo={
            profile.role !== "admin"
              ? profile.id
              : // Toque num horário livre da grade da agenda já traz o barbeiro da coluna.
                (barbeiros ?? []).some((b) => b.id === barbeiro)
                ? barbeiro!
                : profile.atende_como_barbeiro
                  ? profile.id
                  : ""
          }
          clienteInicial={cliente}
          dataInicial={data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : hojeSP()}
          horaInicial={hora && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora) ? hora : ""}
        />
      )}
    </main>
  );
}
