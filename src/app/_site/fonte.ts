import { Montserrat } from "next/font/google";

// Fonte dos títulos do site público (forte, geométrica — linguagem "barbearia premium").
// Aplicada no <html> (layout raiz): site do cliente e painel usam (decisão 43).
export const fonteTitulos = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});
