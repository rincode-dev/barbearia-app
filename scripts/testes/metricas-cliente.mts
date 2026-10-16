// Testes unitários das métricas da ficha do cliente (sem banco nem rede).
// Rodar da raiz: node --experimental-strip-types --no-warnings scripts/testes/metricas-cliente.mts
import { calcularMetricas, diasEntre } from "../../src/lib/clientes/metricas.ts";

let falhas = 0;
function ok(cond: boolean, descricao: string, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}
const HOJE = "2026-09-24";

ok(diasEntre("2026-12-31", "2027-01-01") === 1 && diasEntre("2028-02-28", "2028-03-01") === 2, "diferença de dias atravessa virada de ano e ano bissexto");

const vazio = calcularMetricas([], HOJE);
ok(vazio.ticketMedio === null && vazio.retornoMedioDias === null && vazio.diasSemRetornar === null && vazio.atrasoDias === null,
  "sem atendimento concluído: nada calculado (sem dividir por zero)");

const um = calcularMetricas([{ dia: "2026-08-03", valor: 45 }], HOJE);
ok(um.ticketMedio === 45 && um.retornoMedioDias === null && um.diasSemRetornar === 52,
  "um atendimento: ticket 45, retorno sem média, 'não retorna há 52 dias'", JSON.stringify(um));

// 3 visitas: 01/06, 08/07 (37 dias), 14/08 (37 dias) → a cada 37 dias; hoje = 41 dias depois.
const tres = calcularMetricas(
  [
    { dia: "2026-06-01", valor: 70 },
    { dia: "2026-07-08", valor: 45 },
    { dia: "2026-08-14", valor: 63.5 },
  ],
  HOJE
);
ok(tres.ticketMedio === 59.5, "ticket médio = (70 + 45 + 63,50) ÷ 3 = 59,50", String(tres.ticketMedio));
ok(tres.retornoMedioDias === 37, "retorna em média a cada 37 dias", String(tres.retornoMedioDias));
ok(tres.diasSemRetornar === 41 && tres.atrasoDias === null, "41 dias sem voltar (dentro da folga de 25%/7 dias): não é atraso");

const sumido = calcularMetricas(
  [
    { dia: "2026-05-01", valor: 45 },
    { dia: "2026-05-31", valor: 45 },
  ],
  HOJE
);
ok(sumido.retornoMedioDias === 30 && sumido.diasSemRetornar === 116 && sumido.atrasoDias === 86,
  "vem a cada 30 dias e sumiu há 116: 86 dias além do habitual", JSON.stringify(sumido));
ok(calcularMetricas([{ dia: "2026-05-01", valor: 45 }, { dia: "2026-05-31", valor: 45 }], HOJE, true).atrasoDias === null,
  "com horário já marcado, não aparece como atrasado");

const mesmoDia = calcularMetricas(
  [
    { dia: "2026-09-01", valor: 45 },
    { dia: "2026-09-01", valor: 15 },
    { dia: "2026-09-21", valor: 45 },
  ],
  HOJE
);
ok(mesmoDia.atendimentos === 3 && mesmoDia.visitas === 2 && mesmoDia.retornoMedioDias === 20 && mesmoDia.ticketMedio === 35,
  "dois atendimentos no mesmo dia = uma visita no retorno (20 dias), mas contam no ticket", JSON.stringify(mesmoDia));

const futuro = calcularMetricas([{ dia: "2026-09-25", valor: 85.5 }], HOJE);
ok(futuro.diasSemRetornar === 0, "atendido antes do dia marcado (data futura): 0 dia, nunca negativo");

const semOrdem = calcularMetricas(
  [
    { dia: "2026-08-14", valor: 1 },
    { dia: "2026-06-01", valor: 1 },
    { dia: "2026-07-08", valor: 1 },
  ],
  HOJE
);
ok(semOrdem.retornoMedioDias === 37 && semOrdem.diasSemRetornar === 41, "histórico fora de ordem: mesmo resultado");

console.log(falhas === 0 ? "\nRESULTADO: tudo passou." : `\nRESULTADO: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
