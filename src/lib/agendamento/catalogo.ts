import "server-only";
import { connection } from "next/server";
import { comoSistema } from "@/lib/db";
import { urlPublicaStorage } from "@/lib/estabelecimento";
import { hojeSP } from "@/lib/datas";
import type { FaixaSemana, Intervalo } from "./motor";
import { periodosAbertos } from "./funcionamento";

// connection(): catálogo e horários são lidos a cada visita, nunca congelados no build —
// senão o site mostraria os preços do dia do build (e o build nem tem banco).

export type ServicoPublico = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  duracao_minutos: number;
  fotoUrl: string | null;
};

// Serviços que o site mostra: ativos E feitos por pelo menos um barbeiro ativo que atende
// (um serviço sem ninguém pra fazer não pode ser agendado — melhor nem aparecer).
export async function servicosAgendaveis(): Promise<ServicoPublico[]> {
  await connection();
  const linhas = await comoSistema(
    (tx) => tx<(Omit<ServicoPublico, "fotoUrl"> & { foto_path: string | null })[]>`
      select s.id, s.nome, s.descricao, s.preco, s.duracao_minutos, s.foto_path
      from public.servicos s
      where s.ativo
        and exists (
          select 1 from public.barbeiro_servicos bs
          join public.profiles p on p.id = bs.profile_id
          where bs.servico_id = s.id and p.ativo and p.atende_como_barbeiro
        )
      order by s.ordem, s.nome`
  );
  return linhas.map(({ foto_path, ...s }) => ({ ...s, fotoUrl: urlPublicaStorage(foto_path) }));
}

export async function horarioFuncionamento(): Promise<FaixaSemana[]> {
  await connection();
  return [...(await comoSistema((tx) => tx<FaixaSemana[]>`select dia_semana, inicio, fim from public.horarios_funcionamento order by inicio`))];
}

// Períodos abertos dos próximos 14 dias (funcionamento − feriados/fechamentos da
// barbearia) para o status "Aberto / Fechado" do site. Só os bloqueios da barbearia
// inteira (profile_id nulo) entram — folga de barbeiro não fecha a barbearia.
// Devolve também o instante da consulta: é o "agora" do primeiro desenho do status.
export async function periodosAbertosSite(funcionamento: FaixaSemana[]): Promise<{ periodos: Intervalo[]; agora: number }> {
  await connection();
  const agora = Date.now();
  const linhas = await comoSistema(
    (tx) => tx<{ inicio: string; fim: string }[]>`
      select inicio, fim from public.bloqueios
      where profile_id is null and fim > ${new Date(agora).toISOString()}`
  );
  const feriados = linhas.map((b) => ({ inicio: new Date(b.inicio).getTime(), fim: new Date(b.fim).getTime() }));
  return { periodos: periodosAbertos(funcionamento, feriados, hojeSP()), agora };
}
