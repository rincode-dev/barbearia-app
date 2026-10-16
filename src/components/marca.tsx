/* eslint-disable @next/next/no-img-element -- logo enviado pela barbearia (servido por
   /arquivos/publico/..., não de /public); a imagem já chega comprimida do envio. */

// Logo da barbearia quando cadastrada; senão, o nome em texto. Nunca uma marca fixa.
export function Marca({
  nome,
  logoUrl,
  tamanho = "md",
}: {
  nome: string;
  logoUrl: string | null;
  tamanho?: "sm" | "md" | "lg";
}) {
  const alturaLogo = { sm: "h-8", md: "h-14", lg: "h-24" }[tamanho];
  const textoNome = { sm: "text-base", md: "text-xl", lg: "text-3xl" }[tamanho];
  // lighten: logo com fundo preto se funde ao fundo escuro em vez de virar um quadrado.

  if (logoUrl) {
    return <img src={logoUrl} alt={nome} className={`${alturaLogo} w-auto object-contain mix-blend-lighten`} />;
  }

  return (
    <span className={`${textoNome} font-display font-extrabold uppercase tracking-tight text-neutral-900`}>{nome}</span>
  );
}
