import "server-only";
import { rm } from "node:fs/promises";
import path from "node:path";

// Fotos e logo em pasta no disco (docs/ARQUITETURA.md, decisão 47 — M3), no lugar do bucket
// público do Supabase. Mesmos caminhos de antes: publico/logo/…, publico/barbeiros/…,
// publico/servicos/…. Na VPS/Docker, ARQUIVOS_DIR aponta para um volume.
export const PASTA_ARQUIVOS = path.resolve(process.env.ARQUIVOS_DIR || "dados/arquivos");
const PASTA_PUBLICA = path.join(PASTA_ARQUIVOS, "publico");

// Caminho relativo seguro: só letras, números, "-", "_", "." e "/", sem "..", sem começar
// com "/". Qualquer coisa fora disso é recusada (nunca sai da pasta pública).
const CAMINHO_VALIDO = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*\.(jpg|png|webp)$/i;

export function arquivoPublico(relativo: string): string | null {
  if (!CAMINHO_VALIDO.test(relativo)) return null;
  const absoluto = path.join(PASTA_PUBLICA, relativo);
  return absoluto.startsWith(PASTA_PUBLICA + path.sep) ? absoluto : null;
}

// Foto trocada/removida: apaga o arquivo antigo (não fica lixo público). Sem erro se já
// não existir.
export async function removerArquivoPublico(relativo: string | null | undefined) {
  if (!relativo) return;
  const absoluto = arquivoPublico(relativo);
  if (absoluto) await rm(absoluto, { force: true });
}
