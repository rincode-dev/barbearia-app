// Testes unitários de ipDaRequisicao (sem banco, sem rede).
// Rodar da raiz: node --experimental-strip-types --no-warnings --conditions=react-server scripts/testes/ip.mts
// (--conditions=react-server: limite.ts importa "server-only", que só carrega nesse modo.)
import { ipDaRequisicao } from "../../src/lib/agendamento/limite.ts";

let falhas = 0;
function ok(cond: boolean, descricao: string, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}

const h = (o: Record<string, string>) => new Headers(o);

delete process.env.IP_PELO_CLOUDFLARE;
ok(ipDaRequisicao(h({ "x-real-ip": "1.1.1.1", "cf-connecting-ip": "9.9.9.9" })) === "1.1.1.1",
  "sem IP_PELO_CLOUDFLARE: CF-Connecting-IP é ignorado (seria forjável)");
ok(ipDaRequisicao(h({ "x-forwarded-for": "5.5.5.5, 2.2.2.2" })) === "2.2.2.2", "sem X-Real-IP: último do X-Forwarded-For");
ok(ipDaRequisicao(h({})) === "local", "sem cabeçalho nenhum: 'local'");

process.env.IP_PELO_CLOUDFLARE = "1";
ok(ipDaRequisicao(h({ "x-real-ip": "1.1.1.1", "cf-connecting-ip": "9.9.9.9" })) === "9.9.9.9",
  "com IP_PELO_CLOUDFLARE=1: usa o IP do visitante que o Cloudflare informa");
ok(ipDaRequisicao(h({ "x-real-ip": "1.1.1.1" })) === "1.1.1.1", "com a opção ligada e sem o cabeçalho: volta ao X-Real-IP");
process.env.IP_PELO_CLOUDFLARE = "0";
ok(ipDaRequisicao(h({ "x-real-ip": "1.1.1.1", "cf-connecting-ip": "9.9.9.9" })) === "1.1.1.1", "IP_PELO_CLOUDFLARE=0 = desligado");

console.log(falhas ? `\nRESULTADO: ${falhas} falha(s).` : "\nRESULTADO: tudo passou.");
process.exitCode = falhas ? 1 : 0;
