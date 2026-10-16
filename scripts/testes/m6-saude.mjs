// Contingência (segunda VPS) — o que o vigia usa do app: rota /api/saude.
// Rodar da raiz do projeto, com o container no ar. TESTE_BASE_URL (padrão http://127.0.0.1:3002).
// O comportamento com banco réplica (banco: "replica", relógio parado) é testado no ensaio
// da réplica, que sobe um segundo Postgres.
const BASE = process.env.TESTE_BASE_URL || "http://127.0.0.1:3002";

let falhas = 0;
function ok(cond, descricao, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}

const inicio = Date.now();
const r = await fetch(`${BASE}/api/saude`);
const corpo = await r.json();
const ms = Date.now() - inicio;
ok(r.status === 200 && corpo.ok === true, "saúde: 200 com o banco no ar", JSON.stringify(corpo));
ok(corpo.banco === "principal", "banco local é o principal (aceita gravação)");
ok(r.headers.get("cache-control") === "no-store", "resposta nunca vem de cache");
ok(Object.keys(corpo).sort().join(",") === "banco,ok", "não expõe nada além de ok/banco");
ok(ms < 2000, "responde rápido", `${ms} ms`);

const semLogin = await fetch(`${BASE}/api/saude`, { redirect: "manual", headers: { cookie: "" } });
ok(semLogin.status === 200, "não pede login (o vigia não tem sessão)");

console.log(falhas ? `\nRESULTADO: ${falhas} falha(s).` : "\nRESULTADO: tudo passou.");
process.exitCode = falhas ? 1 : 0;
