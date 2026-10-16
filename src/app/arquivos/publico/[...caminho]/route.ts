import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { arquivoPublico } from "@/lib/arquivos";

// GET /arquivos/publico/<caminho> — logo e fotos (informação pública da barbearia, exibida
// no site sem login). Cada envio ganha um nome novo (uuid), então o arquivo nunca muda:
// cache longo no navegador.
const TIPOS: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

// Foto registrada no banco mas ausente no disco (na contingência as fotos não são
// sincronizadas com a segunda VPS): imagem neutra em vez de imagem quebrada. Barbeiro
// ganha uma silhueta; logo e serviço, nada visível. Cache curto: se a foto aparecer
// depois, o navegador busca de novo.
const SILHUETA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1c1c1f"/><circle cx="50" cy="38" r="17" fill="#3f3f46"/><path d="M18 92c3-19 16-29 32-29s29 10 32 29z" fill="#3f3f46"/></svg>`;
const VAZIA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`;

function imagemPadrao(relativo: string) {
  return new Response(relativo.startsWith("barbeiros/") ? SILHUETA : VAZIA, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caminho: string[] }> }) {
  const { caminho } = await params;
  const relativo = caminho.join("/");
  const absoluto = arquivoPublico(relativo);
  if (!absoluto) return new Response("Não encontrado", { status: 404 });

  let conteudo: Buffer;
  try {
    conteudo = await readFile(absoluto);
  } catch {
    return imagemPadrao(relativo);
  }
  const extensao = relativo.split(".").pop()!.toLowerCase();
  return new Response(new Uint8Array(conteudo), {
    headers: {
      "Content-Type": TIPOS[extensao] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
