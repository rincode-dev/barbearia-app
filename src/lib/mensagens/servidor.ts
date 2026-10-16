import "server-only";
import { headers } from "next/headers";
import type { Tx } from "@/lib/db";
import { DIAS_SEMANA, dataHoraSP, formatarDataBR } from "@/lib/datas";
import { diaSemana } from "@/lib/agendamento/motor";
import { construirLinkWhatsapp } from "./whatsapp";
import { ROTULO_MENSAGEM, preencherTemplate, type TipoMensagem, type VariaveisMensagem } from "./preencher";

export type LinkMensagem = { tipo: TipoMensagem; rotulo: string; href: string };

// Endereço do site como o navegador vê (subdomínio da barbearia). Dentro do Docker o
// request.url é o endereço interno — por isso Host/X-Forwarded-*, que o Nginx repassa.
export async function urlDoSite(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? (/^(127\.0\.0\.1|localhost)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

// "sexta, 26/09"
export function dataParaMensagem(inicio: string): { data: string; hora: string } {
  const { data, hora } = dataHoraSP(new Date(inicio));
  return { data: `${DIAS_SEMANA[diaSemana(data)].toLowerCase()}, ${formatarDataBR(data).slice(0, 5)}`, hora };
}

// Links wa.me já preenchidos para os tipos pedidos (na ordem pedida). Sem telefone ou
// sem texto cadastrado → lista vazia.
export async function linksWhatsapp(
  tx: Tx,
  telefone: string | null,
  tipos: TipoMensagem[],
  variaveis: VariaveisMensagem
): Promise<LinkMensagem[]> {
  if (!telefone || tipos.length === 0) return [];
  const data = await tx<{ tipo: string; conteudo: string }[]>`select tipo, conteudo from public.mensagens_templates where tipo = any(${tipos}::text[])`;
  const textos = new Map(data.map((t) => [t.tipo as TipoMensagem, t.conteudo as string]));
  return tipos.flatMap((tipo) => {
    const conteudo = textos.get(tipo);
    const href = conteudo ? construirLinkWhatsapp(telefone, preencherTemplate(conteudo, variaveis)) : null;
    return href ? [{ tipo, rotulo: ROTULO_MENSAGEM[tipo], href }] : [];
  });
}
