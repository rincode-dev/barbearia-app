import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Só afeta `next dev` (ignorado em build de produção) — permite acessar o dev
  // server via 127.0.0.1 em vez de localhost sem o aviso/bloqueio de cross-origin.
  allowedDevOrigins: ["127.0.0.1"],
  // Sem bodySizeLimit extra: logo e fotos sobem pela rota /api/arquivos (sem o limite
  // de 1 MB das Server Actions); Server Actions só recebem texto.
};

export default nextConfig;
