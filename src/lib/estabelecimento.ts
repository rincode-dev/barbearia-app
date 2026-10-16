import { cache } from "react";
import { connection } from "next/server";
import { comoVisitante } from "@/lib/db";

// Marca e regras da barbearia vêm do banco (tabela `estabelecimento`, linha única) —
// nunca fixas no código (docs/ARQUITETURA.md, decisão 6): o mesmo código atende qualquer
// barbearia hospedada na plataforma.
export type Estabelecimento = {
  nome: string;
  descricao: string | null;
  logoUrl: string | null;
  endereco: string | null;
  telefone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  mapaUrl: string | null;
  antecedenciaMinimaMinutos: number;
  janelaAgendamentoDias: number;
  granularidadeMinutos: number;
  politicaCancelamento: string | null;
};

const PADRAO: Estabelecimento = {
  nome: "Barbearia",
  descricao: null,
  logoUrl: null,
  endereco: null,
  telefone: null,
  whatsapp: null,
  instagram: null,
  mapaUrl: null,
  antecedenciaMinimaMinutos: 60,
  janelaAgendamentoDias: 30,
  granularidadeMinutos: 15,
  politicaCancelamento: null,
};

// Logo e fotos ficam na pasta pública do app (informação pública da barbearia, exibida
// no site sem login), servidas por /arquivos/publico/... (decisão 47 — M3).
export function urlPublicaStorage(path: string | null): string | null {
  if (!path) return null;
  return `/arquivos/publico/${path}`;
}

// `cache`: layout, página e metadata do mesmo request compartilham uma única consulta.
// connection(): lido a cada visita, nunca congelado no build (o build nem tem banco).
export const getEstabelecimento = cache(async (): Promise<Estabelecimento> => {
  await connection();
  const [data] = await comoVisitante(
    (tx) => tx`
      select nome, descricao, logo_path, endereco, telefone, whatsapp, instagram, mapa_url,
             antecedencia_minima_minutos, janela_agendamento_dias, granularidade_minutos, politica_cancelamento
      from public.estabelecimento where id = 1`
  );

  if (!data) return PADRAO;

  return {
    nome: data.nome,
    descricao: data.descricao,
    logoUrl: urlPublicaStorage(data.logo_path),
    endereco: data.endereco,
    telefone: data.telefone,
    whatsapp: data.whatsapp,
    instagram: data.instagram,
    mapaUrl: data.mapa_url,
    antecedenciaMinimaMinutos: data.antecedencia_minima_minutos,
    janelaAgendamentoDias: data.janela_agendamento_dias,
    granularidadeMinutos: data.granularidade_minutos,
    politicaCancelamento: data.politica_cancelamento,
  };
});
