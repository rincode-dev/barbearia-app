import { comoSistema } from "@/lib/db";

// Fluxo automático (docs/ARQUITETURA.md, decisão 48): no horário marcado o agendamento vira
// atendimento (OS aberta) sozinho — iniciar_atendimentos_do_horario() no banco. Roda a
// cada minuto no servidor (instrumentation.ts) e também ao abrir as telas da equipe, para
// quem abre a agenda no minuto exato já ver o atendimento aberto. Os avisos "ao vivo"
// saem pelo gatilho da tabela, então as telas abertas se atualizam sozinhas.
// Banco réplica (secundária da contingência, ainda não promovida) é só leitura: não tenta
// gravar — quem abre os atendimentos é o app ligado ao banco principal.
export async function abrirAtendimentosDoHorario(): Promise<void> {
  try {
    await comoSistema(async (tx) => {
      const [{ replica }] = await tx<{ replica: boolean }[]>`select pg_is_in_recovery() as replica`;
      if (!replica) await tx`select public.iniciar_atendimentos_do_horario()`;
    });
  } catch (erro) {
    // Não derruba a tela: a próxima checagem tenta de novo.
    console.error("[atendimento-automatico]", erro instanceof Error ? erro.message : erro);
  }
}

const global = globalThis as unknown as { __relogioAtendimentos?: boolean };

// Uma vez por processo: logo após virar cada minuto (os horários são em minutos cheios).
export function ligarRelogioDeAtendimentos(): void {
  if (global.__relogioAtendimentos) return;
  global.__relogioAtendimentos = true;
  const ateProximoMinuto = 60_000 - (Date.now() % 60_000) + 1_000;
  setTimeout(() => {
    void abrirAtendimentosDoHorario();
    setInterval(() => void abrirAtendimentosDoHorario(), 60_000);
  }, ateProximoMinuto);
}
