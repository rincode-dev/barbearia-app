// Testes unitários da grade horária da agenda (visão Dia), sem banco nem rede.
// Rodar da raiz: node --experimental-strip-types --no-warnings scripts/testes/grade.mts
import { montarGrade, minutosDoDia, posicaoInicial } from "../../src/app/painel/agenda/grade.ts";
import { instanteSP } from "../../src/lib/datas.ts";

let falhas = 0;
function ok(cond: boolean, descricao: string, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}
const iso = (data: string, hora: string) => instanteSP(data, hora).toISOString();
const DIA = "2026-09-25";
const item = (id: string, barbeiro: string, ini: string, fim: string, extra: Record<string, unknown> = {}) => ({
  id,
  barbeiro_id: barbeiro,
  barbeiro_nome: barbeiro === "R" ? "Rafael" : "João",
  inicio: iso(DIA, ini),
  fim: iso(DIA, fim),
  status: "agendado" as const,
  servicos: "Corte",
  pode_ver_detalhes: true,
  cliente_nome: `Cliente ${id}`,
  valor_total: 45,
  ...extra,
});

const g = montarGrade({
  data: DIA,
  itens: [
    item("a", "R", "10:00", "10:30"),
    item("b", "R", "14:00", "15:30"),
    item("c", "J", "14:00", "15:00", { pode_ver_detalhes: false, cliente_nome: null }),
    // Cancelado no mesmo horário de um ativo (a trava permite): lado a lado.
    item("d", "R", "14:30", "15:00", { status: "cancelado" }),
  ],
  barbeiros: [
    { id: "J", nome: "João" },
    { id: "R", nome: "Rafael" },
  ],
  funcionamento: [
    { inicio: "09:00:00", fim: "12:00:00" },
    { inicio: "13:00:00", fim: "20:00:00" },
  ],
  jornadas: [
    { profile_id: "R", inicio: "09:00:00", fim: "18:00:00" },
    { profile_id: "J", inicio: "13:00:00", fim: "20:00:00" },
  ],
  bloqueios: [{ profile_id: "R", inicio: iso(DIA, "16:00"), fim: iso(DIA, "17:00") }],
  euId: "R",
  admin: false,
});

ok(g.inicio === minutosDoDia("09:00") && g.fim === minutosDoDia("20:00"), "janela do dia: 09:00–20:00 (funcionamento/jornadas em horas cheias)");
ok(g.colunas.map((c) => c.id).join() === "R,J", "barbeiro logado vê a própria coluna primeiro");
const R = g.colunas[0];
const J = g.colunas[1];
ok(R.podeAgendar && !J.podeAgendar, "barbeiro só agenda na própria coluna");

const a = R.blocos.find((b) => b.id === "a")!;
ok(a.inicio === 600 && a.fim === 630 && a.duracao === "30 min" && a.faixa === "10:00–10:30", "bloco de 30 min: posição, faixa e duração");
const b = R.blocos.find((x) => x.id === "b")!;
ok(b.fim - b.inicio === 90 && b.duracao === "1h30", "bloco de 1h30 ocupa 90 min");

const foraR = R.fora.map((f) => `${f.inicio}-${f.fim}`);
ok(foraR.includes("720-780"), "almoço da barbearia (12–13) indisponível", foraR.join(" "));
ok(foraR.includes("960-1020"), "folga pontual do Rafael (16–17) indisponível");
ok(foraR.some((f) => f.startsWith("1080-")), "depois da jornada do Rafael (18:00) indisponível");
ok(!foraR.some((f) => { const [i, e] = f.split("-").map(Number); return i < 630 && e > 600; }), "10:00–10:30 dentro do expediente (livre para agendar)");
const foraJ = J.fora.map((f) => `${f.inicio}-${f.fim}`);
ok(foraJ.some((f) => f === "0-780"), "manhã do João (antes da jornada 13:00) indisponível", foraJ.join(" "));

const c = J.blocos[0];
ok(c.cliente === null && c.href === null, "agendamento de colega: sem nome do cliente nem link");
const d = R.blocos.find((x) => x.id === "d")!;
ok(b.pistas === 2 && d.pistas === 2 && b.pista !== d.pista, "sobreposição (cancelado × ativo) vira duas pistas lado a lado");
ok(a.pistas === 1, "bloco sem sobreposição ocupa a largura toda");

// Feriado: barbearia inteira indisponível.
const feriado = montarGrade({
  data: DIA,
  itens: [],
  barbeiros: [{ id: "R", nome: "Rafael" }],
  funcionamento: [{ inicio: "09:00:00", fim: "18:00:00" }],
  jornadas: [{ profile_id: "R", inicio: "09:00:00", fim: "18:00:00" }],
  bloqueios: [{ profile_id: null, inicio: iso("2026-09-24", "00:00"), fim: iso("2026-09-26", "00:00") }],
  euId: "X",
  admin: true,
});
ok(feriado.colunas[0].fora.length === 1 && feriado.colunas[0].fora[0].inicio === 0 && feriado.colunas[0].fora[0].fim === 1440,
  "feriado de vários dias: o dia inteiro indisponível (cortado ao dia)");
ok(feriado.colunas[0].podeAgendar, "admin agenda em qualquer coluna (encaixe flexível)");

// Dia sem nada cadastrado.
const vazio = montarGrade({ data: DIA, itens: [], barbeiros: [], funcionamento: [], jornadas: [], bloqueios: [], euId: "X", admin: true });
ok(vazio.inicio === 480 && vazio.fim === 1200 && vazio.colunas.length === 0, "dia sem cadastro: janela padrão 08:00–20:00");

// Agendamento fora do expediente amplia a janela.
const tarde = montarGrade({
  data: DIA,
  itens: [item("e", "R", "20:30", "21:15")],
  barbeiros: [{ id: "R", nome: "Rafael" }],
  funcionamento: [{ inicio: "09:00:00", fim: "20:00:00" }],
  jornadas: [],
  bloqueios: [],
  euId: "R",
  admin: false,
});
ok(tarde.fim === 22 * 60, "encaixe às 20:30 estende a grade até 22:00");

// ---------------- Posição inicial da rolagem ----------------
// Grade `g`: 09:00–20:00; 1º atendimento ativo às 10:00 (o cancelado das 14:30 não conta).
ok(posicaoInicial(g, minutosDoDia("21:57")) === minutosDoDia("09:30"),
  "hoje às 21:57 (já fechou às 20:00): abre no 1º atendimento − 30 min, não no fim vazio do dia");
ok(posicaoInicial(g, minutosDoDia("07:10")) === minutosDoDia("09:30"), "hoje antes de abrir: 1º atendimento − 30 min");
ok(posicaoInicial(g, minutosDoDia("15:20")) === minutosDoDia("14:20"), "hoje com a barbearia aberta: agora − 1h (contexto acima)");
ok(posicaoInicial(g, minutosDoDia("09:20")) === minutosDoDia("09:00"), "agora logo após abrir: não passa do topo da grade");
ok(posicaoInicial(g, null) === minutosDoDia("09:30"), "outro dia: 1º atendimento − 30 min");
const soCancelado = montarGrade({
  data: DIA,
  itens: [item("x", "R", "15:00", "15:30", { status: "cancelado" })],
  barbeiros: [{ id: "R", nome: "Rafael" }],
  funcionamento: [{ inicio: "09:00:00", fim: "18:00:00" }],
  jornadas: [],
  bloqueios: [],
  euId: "R",
  admin: false,
});
ok(posicaoInicial(soCancelado, null) === minutosDoDia("09:00"), "dia só com cancelado: abre no início do expediente");

console.log(falhas === 0 ? "\nRESULTADO: tudo passou." : `\nRESULTADO: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
