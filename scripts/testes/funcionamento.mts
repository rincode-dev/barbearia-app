// Testes unitários do status "Aberto / Fechado" do site (sem banco, sem rede).
// Rodar da raiz: node --experimental-strip-types --no-warnings scripts/testes/funcionamento.mts
import { periodosAbertos, statusFuncionamento, detalheStatus } from "../../src/lib/agendamento/funcionamento.ts";
import type { FaixaSemana } from "../../src/lib/agendamento/motor.ts";
import { instanteSP } from "../../src/lib/datas.ts";

let falhas = 0;
function ok(cond: boolean, descricao: string, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}

const t = (data: string, hora: string) => instanteSP(data, hora).getTime();
const SEX = "2026-09-25"; // sexta-feira
const SAB = "2026-09-26";
const TER = "2026-09-29";

// Como os dados de exemplo: ter–sex 09–12 e 13–20, sáb 08–16, dom e seg fechado.
const semana: FaixaSemana[] = [
  ...[2, 3, 4, 5].flatMap((d) => [
    { dia_semana: d, inicio: "09:00:00", fim: "12:00:00" },
    { dia_semana: d, inicio: "13:00:00", fim: "20:00:00" },
  ]),
  { dia_semana: 6, inicio: "08:00:00", fim: "16:00:00" },
];
const periodos = periodosAbertos(semana, [], SEX);
const texto = (agora: number) => {
  const s = statusFuncionamento(periodos, agora);
  return `${s.aberto ? "Aberto" : "Fechado"} | ${detalheStatus(s)}`;
};

ok(texto(t(SEX, "00:42")) === "Fechado | Abre Sex às 09:00", "madrugada de sexta: abre sex 09:00", texto(t(SEX, "00:42")));
ok(texto(t(SEX, "10:00")) === "Aberto | Fecha às 12:00", "manhã: fecha para o almoço às 12:00", texto(t(SEX, "10:00")));
ok(texto(t(SEX, "12:30")) === "Fechado | Abre Sex às 13:00", "almoço: reabre 13:00", texto(t(SEX, "12:30")));
ok(texto(t(SEX, "13:00")) === "Aberto | Fecha às 20:00", "exatamente na abertura já está aberto", texto(t(SEX, "13:00")));
ok(texto(t(SEX, "20:00")) === "Fechado | Abre Sáb às 08:00", "exatamente no fechamento já está fechado", texto(t(SEX, "20:00")));
ok(texto(t(SAB, "17:00")) === "Fechado | Abre Ter às 09:00", "sábado à tarde: pula domingo e segunda", texto(t(SAB, "17:00")));

// Faixas encostadas viram um período só.
const encostadas = periodosAbertos(
  [{ dia_semana: 5, inicio: "09:00", fim: "12:00" }, { dia_semana: 5, inicio: "12:00", fim: "18:00" }],
  [],
  SEX,
  0
);
ok(encostadas.length === 1 && detalheStatus(statusFuncionamento(encostadas, t(SEX, "10:00"))) === "Fecha às 18:00",
  "09–12 + 12–18: fecha às 18:00");

// Feriado de dia inteiro no sábado: sexta à noite aponta para terça.
const comFeriado = periodosAbertos(semana, [{ inicio: t(SAB, "00:00"), fim: t("2026-09-27", "00:00") }], SEX);
ok(detalheStatus(statusFuncionamento(comFeriado, t(SEX, "21:00"))) === "Abre Ter às 09:00", "feriado no sábado é pulado");

// Fechamento de meio período: aberto só até o início do bloqueio.
const meioPeriodo = periodosAbertos(semana, [{ inicio: t(TER, "15:00"), fim: t(TER, "20:00") }], TER, 0);
ok(detalheStatus(statusFuncionamento(meioPeriodo, t(TER, "14:00"))) === "Fecha às 15:00", "fechamento às 15:00 antecipa o 'fecha às'");

// Nada cadastrado.
const vazio = statusFuncionamento(periodosAbertos([], [], SEX), t(SEX, "10:00"));
ok(!vazio.aberto && detalheStatus(vazio) === null, "sem horário cadastrado: fechado, sem 'abre'");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
