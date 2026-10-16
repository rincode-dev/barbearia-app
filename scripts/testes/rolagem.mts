// Testes unitários da rolagem contínua (grade da agenda → página). Sem navegador.
// Rodar da raiz: node --experimental-strip-types --no-warnings scripts/testes/rolagem.mts
import { deveRepassar, proximaVelocidade, VELOCIDADE_MINIMA } from "../../src/lib/rolagem-continua.ts";

let falhas = 0;
function ok(cond: boolean, descricao: string) {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}`);
  if (!cond) falhas++;
}

const area = (scrollTop: number) => ({ scrollTop, clientHeight: 500, scrollHeight: 1500 });

ok(!deveRepassar(area(300), 10), "no meio, descendo: a grade rola");
ok(!deveRepassar(area(300), -10), "no meio, subindo: a grade rola");
ok(deveRepassar(area(1000), 10), "no fim da grade, descendo: vai para a página");
ok(!deveRepassar(area(1000), -10), "no fim da grade, subindo: a grade volta");
ok(deveRepassar(area(0), -10), "no topo da grade, subindo: vai para a página");
ok(!deveRepassar(area(0), 10), "no topo da grade, descendo: a grade rola");
ok(deveRepassar(area(999.5), 10), "fim com meio pixel (zoom) conta como fim");
ok(!deveRepassar(area(1000), 0), "sem movimento: nada a repassar");
ok(deveRepassar({ scrollTop: 0, clientHeight: 500, scrollHeight: 400 }, 10), "grade que cabe inteira: tudo vai para a página");

let v = 2;
let quadros = 0;
while (v !== 0 && quadros < 1000) {
  const nova = proximaVelocidade(v);
  if (nova !== 0 && Math.abs(nova) >= Math.abs(v)) break;
  v = nova;
  quadros++;
}
ok(v === 0 && quadros < 200, `inércia desacelera e para (${quadros} quadros)`);
ok(proximaVelocidade(-VELOCIDADE_MINIMA) === 0, "abaixo da velocidade mínima para na hora");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
