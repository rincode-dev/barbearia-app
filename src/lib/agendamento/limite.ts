import "server-only";

// Limite simples de tentativas por IP para o agendamento público (anti-abuso, decisão 3).
// Em memória: suficiente pra 1 container por barbearia (docs/ARQUITETURA.md, decisão da
// plataforma: 1 build/container por cliente). Reinicia junto com o container.
const JANELA_MS = 60 * 60 * 1000;
const MAXIMO = 10;
const tentativas = new Map<string, number[]>();

//
// Atrás do Cloudflare (contingência com segunda VPS), o Nginx só vê o IP do Cloudflare;
// o do visitante vem em CF-Connecting-IP. Só é lido com IP_PELO_CLOUDFLARE=1 — e isso só
// pode ser ligado quando o firewall aceita apenas o Cloudflare, senão o cabeçalho é forjável.
export function ipDaRequisicao(headers: Headers): string {
  if (process.env.IP_PELO_CLOUDFLARE === "1") {
    const cf = headers.get("cf-connecting-ip")?.trim();
    if (cf) return cf;
  }
  // Atrás do Nginx da plataforma (nginx-templates/cliente.conf.template), X-Real-IP é
  // SOBRESCRITO com o IP real da conexão ($remote_addr) — não dá pra falsificar. Já o
  // X-Forwarded-For acumula o que o próprio visitante mandar; se precisar dele, só o
  // ÚLTIMO item (acrescentado pelo Nginx) é confiável. O container só escuta em
  // 127.0.0.1, então ninguém chega nele sem passar pelo Nginx.
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const encaminhado = headers.get("x-forwarded-for")?.split(",").map((p) => p.trim()).filter(Boolean);
  return encaminhado?.at(-1) || "local";
}

// true = pode seguir; false = passou do limite.
export function registrarTentativa(ip: string): boolean {
  const agora = Date.now();
  const recentes = (tentativas.get(ip) ?? []).filter((t) => agora - t < JANELA_MS);
  if (recentes.length >= MAXIMO) {
    tentativas.set(ip, recentes);
    return false;
  }
  recentes.push(agora);
  tentativas.set(ip, recentes);
  if (tentativas.size > 5000) {
    for (const [chave, lista] of tentativas) {
      if (lista.every((t) => agora - t >= JANELA_MS)) tentativas.delete(chave);
    }
  }
  return true;
}
