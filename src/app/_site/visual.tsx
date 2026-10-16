// Peças visuais do site público: ícones de traço fino e o título "editorial" (rótulo
// pequeno espaçado + título forte com a última palavra em vermelho). Sem estado — servem
// tanto à página (servidor) quanto à reserva (cliente).

type PropsIcone = { className?: string };
const traco = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function IconeTesoura({ className = "h-5 w-5" }: PropsIcone) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...traco} aria-hidden="true">
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="6" cy="18" r="2.6" />
      <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
    </svg>
  );
}

export function IconeNavalha({ className = "h-5 w-5" }: PropsIcone) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...traco} aria-hidden="true">
      {/* navalha aberta: lâmina larga (fio embaixo) presa ao cabo fino pelo pino */}
      <path d="M12.5 11.5 19.5 4.5c1 1 1.5 2.4 1.2 3.8L15 13.9Z" />
      <path d="M12.5 11.5 3.5 20.5" />
      <circle cx="13.4" cy="12.4" r="1" />
    </svg>
  );
}

export function IconeOlho({ className = "h-5 w-5" }: PropsIcone) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...traco} aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

export function IconeGota({ className = "h-5 w-5" }: PropsIcone) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...traco} aria-hidden="true">
      <path d="M12 3.5s6 6.4 6 10.7a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5Z" />
    </svg>
  );
}

export function IconeRelogio({ className = "h-5 w-5" }: PropsIcone) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...traco} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function IconeLocal({ className = "h-5 w-5" }: PropsIcone) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...traco} aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

// Balão de conversa com telefone (genérico, sem a marca do WhatsApp).
export function IconeConversa({ className = "h-5 w-5" }: PropsIcone) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...traco} aria-hidden="true">
      <path d="M4.5 19.5 5.6 16A8 8 0 1 1 8.4 18.6Z" />
      <path d="M9.4 8.6c.3-.4.8-.4 1 0l.7 1.3c.1.3 0 .6-.2.8l-.4.4c.4.9 1.2 1.7 2.1 2.1l.4-.4c.2-.2.5-.3.8-.2l1.3.7c.4.2.4.7 0 1-.6.6-1.5.8-2.3.4a7.3 7.3 0 0 1-3.8-3.8c-.4-.8-.2-1.7.4-2.3Z" />
    </svg>
  );
}

export function IconeSeta({ className = "h-4 w-4" }: PropsIcone) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...traco} strokeWidth={2} aria-hidden="true">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function IconeCheck({ className = "h-4 w-4" }: PropsIcone) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...traco} strokeWidth={2.6} aria-hidden="true">
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

// Ícone que acompanha o serviço, pelo nome (o cadastro não tem campo de ícone). Na dúvida,
// tesoura.
export function IconeDoServico({ nome, className }: { nome: string } & PropsIcone) {
  const n = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // Combo com corte/cabelo é "corte" antes de tudo; depois sobrancelha, química e barba.
  if (/corte|cabelo/.test(n)) return <IconeTesoura className={className} />;
  if (/sobrancelha|olho/.test(n)) return <IconeOlho className={className} />;
  if (/platinad|luzes|color|tintur|pigment|quimic|hidrat|progressiv|relax|limpeza|facial|higiene/.test(n)) return <IconeGota className={className} />;
  if (/barb|navalha|pezinho|contorno|acabamento/.test(n)) return <IconeNavalha className={className} />;
  return <IconeTesoura className={className} />;
}

// NOSSOS SERVIÇOS ───
// ESCOLHA SEU
// SERVIÇO            ← vermelho
export function TituloEditorial({
  id,
  rotulo,
  titulo,
  destaque,
  descricao,
  compacto = false,
}: {
  id?: string;
  rotulo: string;
  titulo: string;
  destaque: string;
  descricao?: string;
  compacto?: boolean;
}) {
  return (
    <div className={compacto ? "mb-4" : "mb-6"}>
      <p className="flex items-center gap-3 text-[0.7rem] font-medium uppercase tracking-[0.32em] text-nevoa">
        {rotulo}
        <span aria-hidden="true" className="h-px w-10 bg-brasa" />
      </p>
      <h2
        id={id}
        className={`mt-2 font-display font-extrabold uppercase leading-[0.95] tracking-tight text-giz ${
          compacto ? "text-2xl sm:text-[1.75rem]" : "text-[2.1rem] sm:text-5xl"
        }`}
      >
        {titulo} <span className={compacto ? "text-brasa" : "block text-brasa"}>{destaque}</span>
      </h2>
      {descricao && <p className="mt-3 text-[0.95rem] text-nevoa">{descricao}</p>}
    </div>
  );
}
