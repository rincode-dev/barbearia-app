import type { NextRequest } from "next/server";
import { lerSessao } from "@/lib/auth/sessao";
import { aoMudarAgenda } from "@/lib/ao-vivo";

// GET /api/ao-vivo — eventos (SSE) para a agenda e a OS ficarem ao vivo (decisão 47 — M4).
// Só para quem está logado. Manda "pronto" quando a escuta do banco está ativa e "mudou" a
// cada mudança em agendamentos/OS — sem dado nenhum: a tela recarrega pelo caminho normal.
const INTERVALO_BATIMENTO_MS = 25_000;

export async function GET(request: NextRequest) {
  if (!(await lerSessao())) return new Response("Faça login de novo.", { status: 401 });

  const codificador = new TextEncoder();
  let encerrar = () => {};

  const corpo = new ReadableStream<Uint8Array>({
    async start(controle) {
      const enviar = (texto: string) => {
        try {
          controle.enqueue(codificador.encode(texto));
        } catch {
          encerrar();
        }
      };

      let cancelar: () => void;
      try {
        cancelar = await aoMudarAgenda(() => enviar("event: mudou\ndata: {}\n\n"));
      } catch {
        enviar("event: erro\ndata: {}\n\n");
        controle.close();
        return;
      }
      // Comentário periódico: mantém a conexão aberta em proxies que derrubam conexão parada.
      const batimento = setInterval(() => enviar(": batimento\n\n"), INTERVALO_BATIMENTO_MS);
      encerrar = () => {
        clearInterval(batimento);
        cancelar();
        try {
          controle.close();
        } catch {
          // já fechado
        }
      };
      request.signal.addEventListener("abort", () => encerrar());

      // Pede ao navegador para reconectar em 3 s se cair.
      enviar("retry: 3000\nevent: pronto\ndata: {}\n\n");
    },
    cancel() {
      encerrar();
    },
  });

  return new Response(corpo, {
    headers: {
      // Obs.: o túnel rápido do Cloudflare (trycloudflare.com) não repassa SSE — segura a
      // resposta até o fim; aí a tela cai na checagem de 30 s. Na VPS (Nginx) ou num túnel
      // nomeado funciona.
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx (VPS): não segurar os eventos no buffer.
      "X-Accel-Buffering": "no",
    },
  });
}
