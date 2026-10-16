// Testes unitários do motor de disponibilidade (sem banco, sem rede).
// Rodar da raiz: node --experimental-strip-types --no-warnings scripts/testes/motor.mts
import { horariosLivres, subtrair, intersectar, diaSemana, type FaixaSemana } from "../../src/lib/agendamento/motor.ts";
import { instanteSP } from "../../src/lib/datas.ts";

let falhas = 0;
function ok(cond: boolean, descricao: string, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}

const SEG = "2026-10-05"; // segunda-feira
const t = (data: string, hora: string) => instanteSP(data, hora).getTime();
const semanaToda = (inicio: string, fim: string): FaixaSemana[] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, inicio, fim }));

const base = {
  data: SEG,
  granularidadeMinutos: 15,
  inicioMinimo: 0,
  funcionamento: semanaToda("09:00", "19:00"),
  jornada: semanaToda("09:00", "19:00"),
  indisponiveis: [],
};

ok(diaSemana(SEG) === 1, "2026-10-05 é segunda");

// --- Exemplo da especificação (item 7) ---
const ocupado1400 = [{ inicio: t(SEG, "14:00"), fim: t(SEG, "14:45") }];
const h60 = horariosLivres({ ...base, duracaoMinutos: 60, indisponiveis: ocupado1400 });
ok(!h60.includes("14:30"), "ocupado 14:00–14:45 + serviço de 1h → 14:30 NÃO é oferecido");
ok(!h60.includes("13:15"), "13:15 não (terminaria 14:15, dentro do ocupado)");
ok(h60.includes("13:00"), "13:00 sim (termina 14:00, encostando no ocupado)");
ok(h60.includes("14:45"), "14:45 sim (começa quando o ocupado termina)");
ok(!h60.includes("14:00") && !h60.includes("14:15"), "14:00 e 14:15 não");

// --- Fim do expediente ---
ok(h60[h60.length - 1] === "18:00", "último início de 1h num dia até 19:00 é 18:00", h60[h60.length - 1]);
const h30 = horariosLivres({ ...base, duracaoMinutos: 30 });
ok(h30[0] === "09:00" && h30[h30.length - 1] === "18:30", "30min: de 09:00 a 18:30");
ok(h30.length === 39, "30min em 10h de 15 em 15 = 39 inícios", String(h30.length));

// --- Interseção funcionamento × jornada e intervalo de almoço ---
const almoco = horariosLivres({
  ...base,
  duracaoMinutos: 60,
  funcionamento: [1, 2, 3, 4, 5].flatMap((d) => [
    { dia_semana: d, inicio: "09:00", fim: "12:00" },
    { dia_semana: d, inicio: "13:00", fim: "19:00" },
  ]),
  jornada: [{ dia_semana: 1, inicio: "10:00", fim: "21:00" }],
});
ok(almoco[0] === "10:00", "começa quando a jornada começa (10:00), não quando a barbearia abre", almoco[0]);
ok(almoco.includes("11:00") && !almoco.includes("11:15") && !almoco.includes("12:00"), "não atravessa o almoço (12:00–13:00)");
ok(almoco.includes("13:00"), "volta às 13:00");
ok(almoco[almoco.length - 1] === "18:00", "termina no fechamento da barbearia (19:00), não na jornada (21:00)");

// --- Dia fechado / folga fixa ---
ok(horariosLivres({ ...base, duracaoMinutos: 30, jornada: [{ dia_semana: 2, inicio: "09:00", fim: "18:00" }] }).length === 0,
  "barbeiro sem jornada na segunda → nenhum horário");
ok(horariosLivres({ ...base, duracaoMinutos: 30, funcionamento: [] }).length === 0, "barbearia fechada → nenhum horário");

// --- Feriado de dia inteiro e bloqueio parcial ---
const feriado = [{ inicio: t(SEG, "00:00"), fim: t("2026-10-06", "00:00") }];
ok(horariosLivres({ ...base, duracaoMinutos: 30, indisponiveis: feriado }).length === 0, "feriado de dia inteiro → nada");
const consulta = [{ inicio: t(SEG, "15:00"), fim: t(SEG, "17:00") }];
const hc = horariosLivres({ ...base, duracaoMinutos: 30, indisponiveis: consulta });
ok(hc.includes("14:30") && !hc.includes("14:45") && !hc.includes("16:30") && hc.includes("17:00"), "bloqueio 15:00–17:00 respeitado");

// --- Antecedência mínima ---
const agora1030 = t(SEG, "10:30");
const ha = horariosLivres({ ...base, duracaoMinutos: 30, inicioMinimo: agora1030 + 60 * 60_000 });
ok(ha[0] === "11:30", "agora 10:30 + 1h de antecedência → primeiro horário 11:30", ha[0]);

// --- Granularidade ---
const g30 = horariosLivres({ ...base, duracaoMinutos: 45, granularidadeMinutos: 30 });
ok(g30.every((h) => h.endsWith(":00") || h.endsWith(":30")), "granularidade 30 → só :00 e :30");
ok(g30[g30.length - 1] === "18:00", "45min com granularidade 30 → último 18:00 (18:30 terminaria 19:15)");

// --- Vários ocupados e serviço longo ---
const cheio = [
  { inicio: t(SEG, "09:00"), fim: t(SEG, "10:00") },
  { inicio: t(SEG, "11:30"), fim: t(SEG, "12:00") },
  { inicio: t(SEG, "12:45"), fim: t(SEG, "18:00") },
];
const h90 = horariosLivres({ ...base, duracaoMinutos: 90, indisponiveis: cheio });
ok(h90.includes("10:00") && !h90.includes("10:15") && !h90.includes("12:00"), "90min só cabe às 10:00 (até 11:30) antes das 18:00", h90.join(","));

// --- Utilitários ---
ok(JSON.stringify(subtrair([{ inicio: 0, fim: 10 }], [{ inicio: 3, fim: 5 }])) === JSON.stringify([{ inicio: 0, fim: 3 }, { inicio: 5, fim: 10 }]), "subtrair no meio");
ok(subtrair([{ inicio: 0, fim: 10 }], [{ inicio: 10, fim: 12 }]).length === 1, "encostar não subtrai");
ok(intersectar([{ inicio: 0, fim: 10 }], [{ inicio: 5, fim: 20 }])[0].fim === 10, "interseção");

console.log(falhas === 0 ? "\nRESULTADO: tudo passou." : `\nRESULTADO: ${falhas} falha(s).`);
