import type { MetadataRoute } from "next";
import { getEstabelecimento } from "@/lib/estabelecimento";

// Convenção do Next.js: gera /manifest.webmanifest automaticamente, já linkado no
// <head>. É o que faz o Chrome/Android oferecer "Adicionar à tela inicial" e o app
// abrir em modo standalone. Quem instala é a equipe, então abre direto no painel.
// Nome e logo vêm do cadastro da barbearia; sem logo, usa o ícone genérico (icon.svg).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { nome, logoUrl } = await getEstabelecimento();
  return {
    name: nome,
    short_name: nome,
    description: `Painel da ${nome}.`,
    start_url: "/painel",
    display: "standalone",
    background_color: "#121214",
    theme_color: "#121214",
    icons: logoUrl
      ? [{ src: logoUrl, sizes: "any", purpose: "any" }]
      : [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
