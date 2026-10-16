// Datas e horas sempre no fuso da barbearia (docs/ARQUITETURA.md, decisão 4). O servidor
// roda em UTC; nunca usar Date local (getHours, toISOString().slice(0,10), etc.) pra
// decidir "que dia é" ou "que horas são" na barbearia.
export const FUSO = "America/Sao_Paulo";

export const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number };

function partesNoFuso(instante: Date): Partes {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)!.value);
  return { ano: v("year"), mes: v("month"), dia: v("day"), hora: v("hour"), minuto: v("minute"), segundo: v("second") };
}

// Diferença (em minutos) entre o relógio do fuso e UTC naquele instante.
function offsetMinutos(instante: Date): number {
  const p = partesNoFuso(instante);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return Math.round((comoUtc - instante.getTime()) / 60000);
}

// "2026-12-25" + "14:30" (hora de parede na barbearia) → instante absoluto.
export function instanteSP(data: string, hora = "00:00"): Date {
  const [ano, mes, dia] = data.split("-").map(Number);
  const [h, m] = hora.split(":").map(Number);
  const palpite = new Date(Date.UTC(ano, mes - 1, dia, h, m));
  // Duas passadas: acerta o offset mesmo se um dia o fuso voltar a ter horário de verão.
  const primeiro = new Date(palpite.getTime() - offsetMinutos(palpite) * 60000);
  return new Date(palpite.getTime() - offsetMinutos(primeiro) * 60000);
}

// Data (AAAA-MM-DD) e hora (HH:MM) de parede na barbearia para um instante.
export function dataHoraSP(instante: Date): { data: string; hora: string } {
  const p = partesNoFuso(instante);
  const dd = (n: number) => String(n).padStart(2, "0");
  return { data: `${p.ano}-${dd(p.mes)}-${dd(p.dia)}`, hora: `${dd(p.hora)}:${dd(p.minuto)}` };
}

export function hojeSP(): string {
  return dataHoraSP(new Date()).data;
}

// Aritmética de calendário pura (sem fuso): "2026-12-31" + 1 = "2027-01-01".
export function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return d.toISOString().slice(0, 10);
}

export function formatarDataBR(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

// "09:00:00" (coluna time do Postgres) → "09:00".
export function horaCurta(hora: string): string {
  return hora.slice(0, 5);
}

export function formatarPreco(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatarDuracao(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
