import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { lerSessao } from "@/lib/auth/sessao";
import { comoUsuario } from "@/lib/db";
import { arquivoPublico } from "@/lib/arquivos";

// POST /api/arquivos — envio de logo e fotos (docs/ARQUITETURA.md, decisão 47 — M3). Só admin.
// Recebe multipart com "arquivo" e "pasta"; grava em publico/<pasta>/<uuid>.<ext> e
// devolve { path }. O formulário da tela salva só esse caminho (como antes com o Storage).
// Rota (e não Server Action) porque Server Actions limitam o corpo a 1 MB.

const TAMANHO_MAXIMO = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tipo pelos primeiros bytes do arquivo, nunca pelo nome ou pelo que o navegador disse.
function tipoDaImagem(b: Buffer): "jpg" | "png" | "webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

// Pastas aceitas: as mesmas de antes no Storage.
function pastaValida(pasta: string) {
  if (pasta === "logo" || pasta === "servicos") return true;
  const [raiz, id, ...resto] = pasta.split("/");
  return raiz === "barbeiros" && UUID.test(id ?? "") && resto.length === 0;
}

const erro = (mensagem: string, status: number) => NextResponse.json({ erro: mensagem }, { status });

export async function POST(request: NextRequest) {
  const sessao = await lerSessao();
  if (!sessao) return erro("Faça login de novo.", 401);
  const [perfil] = await comoUsuario(
    sessao.userId,
    (tx) => tx<{ role: string; ativo: boolean }[]>`select role, ativo from public.profiles where id = ${sessao.userId}`
  );
  if (perfil?.role !== "admin" || !perfil.ativo) return erro("Só administradores enviam imagens.", 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return erro("Envio inválido.", 400);
  }
  const arquivo = form.get("arquivo");
  const pasta = String(form.get("pasta") ?? "");
  if (!(arquivo instanceof File)) return erro("Escolha uma imagem.", 400);
  if (!pastaValida(pasta)) return erro("Destino inválido.", 400);
  if (arquivo.size > TAMANHO_MAXIMO) return erro("A imagem passa de 5 MB.", 413);

  const conteudo = Buffer.from(await arquivo.arrayBuffer());
  const extensao = tipoDaImagem(conteudo);
  if (!extensao) return erro("Formato não suportado. Envie JPG, PNG ou WEBP.", 415);

  const relativo = `${pasta}/${randomUUID()}.${extensao}`;
  const destino = arquivoPublico(relativo);
  if (!destino) return erro("Destino inválido.", 400);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, conteudo, { flag: "wx" });

  return NextResponse.json({ path: relativo });
}
