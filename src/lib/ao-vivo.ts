import "server-only";
import { aoTrocarDeBanco, db } from "@/lib/db";

// Escuta do canal "agenda" do Postgres (LISTEN), uma por processo, repassada a todas as
// telas abertas (rota /api/ao-vivo). Os avisos não levam dado: só "algo mudou".
type Ouvinte = () => void;

const global = globalThis as unknown as {
  __aoVivo?: { ouvintes: Set<Ouvinte>; pronto: Promise<void> | null; parar: (() => void) | null; ligado?: boolean };
};
const estado = (global.__aoVivo ??= { ouvintes: new Set(), pronto: null, parar: null });

const avisar = () => {
  for (const ouvinte of estado.ouvintes) ouvinte();
};

function escutar() {
  // postgres.js mantém a conexão de escuta e reconecta sozinho se ela cair.
  estado.pronto ??= db()
    .then((sql) => sql.listen("agenda", avisar))
    .then(({ unlisten }) => {
      estado.parar = () => void unlisten().catch(() => {});
    })
    .catch((erro) => {
      estado.pronto = null; // tenta de novo na próxima tela que abrir
      throw erro;
    });
  return estado.pronto;
}

// Contingência: o app trocou de banco (db.ts) — a escuta passa para o banco novo, e as
// telas recarregam uma vez para não perder o que mudou no meio.
if (!estado.ligado) {
  estado.ligado = true;
  aoTrocarDeBanco(() => {
    estado.parar?.();
    estado.parar = null;
    estado.pronto = null;
    if (estado.ouvintes.size > 0) void escutar().then(avisar, () => {});
  });
}

// Registra quem quer saber das mudanças; devolve a função que cancela o registro.
export async function aoMudarAgenda(ouvinte: Ouvinte): Promise<() => void> {
  await escutar();
  estado.ouvintes.add(ouvinte);
  return () => estado.ouvintes.delete(ouvinte);
}
