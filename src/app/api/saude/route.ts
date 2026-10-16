import { db } from "@/lib/db";

// GET /api/saude — o app e o banco estão respondendo? Usada pelo vigia da contingência
// (segunda VPS): a secundária consulta a principal a cada ~30 s e só assume depois de
// várias falhas seguidas. Sem login e sem dado nenhum da barbearia.
//   200 { ok: true, banco: "principal" | "replica" } — "replica" = banco só de leitura
//        (secundária ainda não promovida): o site abre, mas não grava agendamento.
//   503 { ok: false } — banco fora do ar ou demorando mais que o limite.
export const dynamic = "force-dynamic";

const LIMITE_MS = 5_000;

export async function GET() {
  const cabecalhos = { "Cache-Control": "no-store" };
  try {
    // Na secundária, "principal" também quando o app grava no banco da principal pela VPN
    // (ver db.ts) — é o que o vigia confere antes de mandar os domínios de um app para cá.
    // Em duas linhas de propósito: "(await db())`...`" é compilado errado pelo Next (chama a
    // consulta antes do await).
    const sql = await db();
    const consulta = sql<{ replica: boolean }[]>`select pg_is_in_recovery() as replica`;
    const tempo = new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error("tempo esgotado")), LIMITE_MS));
    const [linha] = await Promise.race([consulta, tempo]);
    return Response.json({ ok: true, banco: linha?.replica ? "replica" : "principal" }, { headers: cabecalhos });
  } catch (erro) {
    console.error("[saude]", erro instanceof Error ? erro.message : erro);
    return Response.json({ ok: false }, { status: 503, headers: cabecalhos });
  }
}
