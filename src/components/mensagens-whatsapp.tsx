import type { LinkMensagem } from "@/lib/mensagens/servidor";

// Botões que abrem o WhatsApp com a mensagem pronta (sem envio automático — requisitos do produto,
// item 24). A primeira mensagem é a sugerida para o status; as outras ficam menores.
export function MensagensWhatsapp({ links }: { links: LinkMensagem[] }) {
  if (links.length === 0) return null;
  const [sugerida, ...outras] = links;
  return (
    <div>
      <p className="mb-2 text-xs text-neutral-500">Mensagem no WhatsApp</p>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={sugerida.href}
          target="_blank"
          rel="noopener noreferrer"
          data-mensagem={sugerida.tipo}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          {sugerida.rotulo}
        </a>
        {outras.map((l) => (
          <a
            key={l.tipo}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            data-mensagem={l.tipo}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            {l.rotulo}
          </a>
        ))}
      </div>
    </div>
  );
}
