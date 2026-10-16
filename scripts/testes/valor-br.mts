// Testes unitários de lerValorBR (sem banco, sem rede).
// Rodar da raiz: node --experimental-strip-types --no-warnings scripts/testes/valor-br.mts
// Regressão: as expressões regulares tinham perdido as barras invertidas, e todo valor com
// vírgula ("45,00" — o que o formulário de pagamento já traz preenchido) virava null.
import { lerValorBR } from "../../src/lib/os.ts";

let falhas = 0;
function ok(cond: boolean, descricao: string, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}

const casos: [string, number | null][] = [
  ["40", 40],
  ["45,00", 45],
  ["40,50", 40.5],
  ["20,5", 20.5],
  ["1.234,56", 1234.56],
  ["R$ 1.234,56", 1234.56],
  ["R$45,00", 45],
  [" 72,00 ", 72],
  ["10%", 10],
  ["12.5", 12.5],
  ["0,333", 0.33],
  ["", null],
  ["abc", null],
  ["R$", null],
];
for (const [entrada, esperado] of casos) {
  const obtido = lerValorBR(entrada);
  ok(obtido === esperado, `lerValorBR(${JSON.stringify(entrada)}) = ${esperado}`, `obtido ${obtido}`);
}

console.log(falhas ? `\nRESULTADO: ${falhas} falha(s).` : "\nRESULTADO: tudo passou.");
process.exitCode = falhas ? 1 : 0;
