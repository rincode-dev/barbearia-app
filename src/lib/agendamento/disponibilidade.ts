import "server-only";
import { connection } from "next/server";
import { comoSistema } from "@/lib/db";
import { getEstabelecimento, urlPublicaStorage } from "@/lib/estabelecimento";
import { hojeSP, instanteSP, somarDias } from "@/lib/datas";
import { horariosLivres, type FaixaSemana, type Intervalo } from "./motor";

// Camada que lê o banco e alimenta o motor (motor.ts). Roda só no servidor, com a chave
// de serviço: o site público não tem sessão, e jornadas/bloqueios/agendamentos não são
// legíveis por visitante. Nada daqui devolve dado de cliente — só horários.

export type ServicoEscolhido = { id: string; nome: string; preco: number; duracao_minutos: number };
export type BarbeiroElegivel = { id: string; nome: string; fotoUrl: string | null; jornada: FaixaSemana[] };

export type Contexto = {
  servicos: ServicoEscolhido[];
  duracaoTotal: number;
  valorTotal: number;
  barbeiros: BarbeiroElegivel[];
  funcionamento: FaixaSemana[];
  granularidade: number;
  inicioMinimo: number;
  primeiroDia: string;
  ultimoDia: string;
};

export class ErroAgendamento extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: string) => UUID.test(v);
export const ehData = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

// "painel" = sugestão de horários para encaixe pela equipe: sem antecedência mínima (o
// cliente pode estar no balcão agora) e sem limite de dias à frente. O site usa "site".
export type Modo = "site" | "painel";

// Serviços pedidos + quem pode atender TODOS eles + regras da barbearia.
export async function carregarContexto(servicoIds: string[], modo: Modo = "site"): Promise<Contexto> {
  await connection(); // sempre dados do momento, nunca do build
  const ids = [...new Set(servicoIds)];
  if (ids.length === 0 || ids.length > 10 || !ids.every(ehUuid)) {
    throw new ErroAgendamento("Escolha pelo menos um serviço.");
  }

  type LinhaBarbeiro = {
    id: string;
    nome: string;
    foto_path: string | null;
    servico_ids: string[];
    jornadas: FaixaSemana[];
  };
  const [[encontrados, linhasBarbeiros, funcionamento], barbearia] = await Promise.all([
    comoSistema(async (tx) => [
      await tx<ServicoEscolhido[]>`
        select id, nome, preco, duracao_minutos from public.servicos
        where id = any(${ids}::uuid[]) and ativo`,
      await tx<LinhaBarbeiro[]>`
        select p.id, p.nome, p.foto_path,
               coalesce((select array_agg(bs.servico_id) from public.barbeiro_servicos bs where bs.profile_id = p.id), '{}') as servico_ids,
               coalesce((select json_agg(json_build_object('dia_semana', j.dia_semana, 'inicio', j.inicio, 'fim', j.fim))
                         from public.jornadas j where j.profile_id = p.id), '[]') as jornadas
        from public.profiles p
        where p.ativo and p.atende_como_barbeiro
        -- Ordem definida pelo admin (o dono primeiro); empate = nome.
        order by p.ordem_site, p.nome`,
      await tx<FaixaSemana[]>`select dia_semana, inicio, fim from public.horarios_funcionamento`,
    ] as const),
    getEstabelecimento(),
  ]);

  if (encontrados.length !== ids.length) {
    throw new ErroAgendamento("Algum serviço escolhido não está mais disponível. Recarregue a página.");
  }
  // Mantém a ordem em que o cliente escolheu.
  const servicos = ids.map((id) => encontrados.find((s) => s.id === id)!);

  const barbeiros = linhasBarbeiros
    .filter((b) => ids.every((id) => b.servico_ids.includes(id)))
    .map((b) => ({ id: b.id, nome: b.nome, fotoUrl: urlPublicaStorage(b.foto_path), jornada: b.jornadas }));

  const primeiroDia = hojeSP();
  return {
    servicos,
    duracaoTotal: servicos.reduce((s, x) => s + x.duracao_minutos, 0),
    valorTotal: servicos.reduce((s, x) => s + Number(x.preco), 0),
    barbeiros,
    funcionamento: [...funcionamento],
    granularidade: barbearia.granularidadeMinutos,
    inicioMinimo: Date.now() + (modo === "site" ? barbearia.antecedenciaMinimaMinutos * 60_000 : 0),
    primeiroDia,
    ultimoDia: somarDias(primeiroDia, modo === "site" ? barbearia.janelaAgendamentoDias : 365),
  };
}

// Tudo que ocupa a agenda de cada barbeiro no período: feriados da barbearia, folgas e
// bloqueios dele, e agendamentos ativos dele. `ignorar` = o próprio agendamento que está
// sendo reagendado (o horário atual dele não conta como ocupado).
async function carregarOcupacao(barbeiroIds: string[], deData: string, ateData: string, ignorar: string | null = null) {
  const de = instanteSP(deData, "00:00").toISOString();
  const ate = instanteSP(somarDias(ateData, 1), "00:00").toISOString();
  type Linha = { profile_id?: string | null; barbeiro_id?: string; inicio: string; fim: string };
  const [bloqueios, agendamentos] = await comoSistema(async (tx) => [
    await tx<Linha[]>`select profile_id, inicio, fim from public.bloqueios where inicio < ${ate} and fim > ${de}`,
    await tx<Linha[]>`
      select barbeiro_id, inicio, fim from public.agendamentos
      where barbeiro_id = any(${barbeiroIds}::uuid[])
        and status not in ('cancelado', 'nao_compareceu')
        and (${ignorar}::uuid is null or id <> ${ignorar}::uuid)
        and inicio < ${ate} and fim > ${de}`,
  ]);

  const intervalo = (r: { inicio: string; fim: string }): Intervalo => ({
    inicio: new Date(r.inicio).getTime(),
    fim: new Date(r.fim).getTime(),
  });
  const gerais = bloqueios.filter((b) => b.profile_id === null).map(intervalo);
  const porBarbeiro = new Map<string, Intervalo[]>();
  for (const id of barbeiroIds) {
    porBarbeiro.set(id, [
      ...gerais,
      ...bloqueios.filter((b) => b.profile_id === id).map(intervalo),
      ...agendamentos.filter((a) => a.barbeiro_id === id).map(intervalo),
    ]);
  }
  return porBarbeiro;
}

function horariosDoBarbeiro(ctx: Contexto, barbeiro: BarbeiroElegivel, data: string, ocupacao: Intervalo[]) {
  return horariosLivres({
    data,
    duracaoMinutos: ctx.duracaoTotal,
    granularidadeMinutos: ctx.granularidade,
    inicioMinimo: ctx.inicioMinimo,
    funcionamento: ctx.funcionamento,
    jornada: barbeiro.jornada,
    indisponiveis: ocupacao,
  });
}

function validarData(ctx: Contexto, data: string) {
  if (!ehData(data) || data < ctx.primeiroDia || data > ctx.ultimoDia) {
    throw new ErroAgendamento("Data fora do período de agendamento.");
  }
}

// Passo "data": todos os dias da janela, marcando os que têm pelo menos um horário com
// algum barbeiro que faz todos os serviços escolhidos.
export async function datasDisponiveis(servicoIds: string[]) {
  const ctx = await carregarContexto(servicoIds);
  const ocupacao = await carregarOcupacao(ctx.barbeiros.map((b) => b.id), ctx.primeiroDia, ctx.ultimoDia);
  const datas: { data: string; disponivel: boolean }[] = [];
  for (let d = ctx.primeiroDia; d <= ctx.ultimoDia; d = somarDias(d, 1)) {
    const disponivel = ctx.barbeiros.some((b) => horariosDoBarbeiro(ctx, b, d, ocupacao.get(b.id) ?? []).length > 0);
    datas.push({ data: d, disponivel });
  }
  return { ctx, datas };
}

// Passo "barbeiro": quem faz todos os serviços, com quantos horários tem no dia.
export async function barbeirosDisponiveis(servicoIds: string[], data: string) {
  const ctx = await carregarContexto(servicoIds);
  validarData(ctx, data);
  const ocupacao = await carregarOcupacao(ctx.barbeiros.map((b) => b.id), data, data);
  return ctx.barbeiros.map((b) => ({
    id: b.id,
    nome: b.nome,
    fotoUrl: b.fotoUrl,
    horarios: horariosDoBarbeiro(ctx, b, data, ocupacao.get(b.id) ?? []).length,
  }));
}

// Passo "horário": inícios livres do barbeiro no dia, para a duração total escolhida.
export async function horariosDisponiveis(
  servicoIds: string[],
  data: string,
  barbeiroId: string,
  modo: Modo = "site",
  ignorarAgendamento: string | null = null
) {
  const ctx = await carregarContexto(servicoIds, modo);
  validarData(ctx, data);
  const barbeiro = ctx.barbeiros.find((b) => b.id === barbeiroId);
  if (!barbeiro) throw new ErroAgendamento("Esse barbeiro não realiza todos os serviços escolhidos.");
  const ocupacao = await carregarOcupacao([barbeiro.id], data, data, ignorarAgendamento);
  return { ctx, barbeiro, horarios: horariosDoBarbeiro(ctx, barbeiro, data, ocupacao.get(barbeiro.id) ?? []) };
}
