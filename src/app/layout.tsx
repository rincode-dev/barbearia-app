import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { getEstabelecimento } from "@/lib/estabelecimento";
import { fonteTitulos } from "./_site/fonte";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Título/descrição vêm do cadastro da barbearia — nada de marca fixa (decisão 6).
export async function generateMetadata(): Promise<Metadata> {
  const { nome, descricao } = await getEstabelecimento();
  return {
    title: nome,
    description: descricao ?? `Agende seu horário na ${nome}.`,
    // "Adicionar à Tela de Início" no iOS: sem isso o Safari abre com a barra de
    // endereço normal em vez de tela cheia (modo app), mesmo com o ícone certo.
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: nome,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0b0b0d",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${fonteTitulos.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PullToRefresh />
        {children}
      </body>
    </html>
  );
}
