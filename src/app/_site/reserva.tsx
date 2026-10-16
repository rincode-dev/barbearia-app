"use client";

/* eslint-disable @next/next/no-img-element -- fotos de serviço e de barbeiro vêm do
   Storage do estabelecimento (URL externa por barbearia). */

import { useEffect, useRef, useState } from "react";
import { DIAS_SEMANA, formatarDataBR, formatarDuracao, formatarPreco } from "@/lib/datas";
import { diaSemana } from "@/lib/agendamento/motor";
import type { ServicoPublico } from "@/lib/agendamento/catalogo";
import { IconeCheck, IconeDoServico, IconeRelogio, IconeSeta, TituloEditorial } from "./visual";

// Agendamento em uma página só (pedido do dono, 2026-09-25 — docs/ARQUITETURA.md, decisão 41):
// serviço → data → profissional → horário aparecem um abaixo do outro conforme o cliente
// escolhe, e o resumo fica fixo no rodapé. A disponibilidade continua 100% no servidor,
// pelas mesmas rotas /api/agendamento/* (decisão 24); a tela só pede de novo quando uma
// escolha anterior muda e descarta resposta que chegou fora de ordem.

type DiaOpcao = { data: string; disponivel: boolean };
type BarbeiroOpcao = { id: string; nome: string; fotoUrl: string | null; horarios: number };
type Confirmado = {
  nome: string;
  data: string;
  hora: string;
  horaFim: string;
  barbeiro: string;
  servicos: { nome: string; preco: number; duracao: number }[];
  duracaoTotal: number;
  valorTotal: number;
};
// Resposta guardada junto com a "chave" do pedido que a gerou: enquanto a chave atual for
// outra, a seção está carregando (sem setState dentro do efeito).
type Resposta<T> = { chave: string; dados: T; erro: string | null };

const CHAVE_CONTATO = "barbearia-app:contato";

function lerContatoSalvo(): { nome: string; telefone: string } {
  if (typeof window === "undefined") return { nome: "", telefone: "" };
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_CONTATO) ?? "null");
    return { nome: salvo?.nome ?? "", telefone: salvo?.telefone ?? "" };
  } catch {
    // armazenamento indisponível (aba anônima etc.) — segue sem lembrar
    return { nome: "", telefone: "" };
  }
}

async function buscar<T>(
  url: string,
  init?: RequestInit
): Promise<{ ok: true; dados: T } | { ok: false; erro: string; corpo?: Record<string, unknown> }> {
  try {
    const resposta = await fetch(url, { cache: "no-store", ...init });
    const corpo = await resposta.json();
    if (!resposta.ok) return { ok: false, erro: corpo.erro ?? "Algo deu errado.", corpo };
    return { ok: true, dados: corpo as T };
  } catch {
    return { ok: false, erro: "Sem conexão. Verifique a internet e tente de novo." };
  }
}

// Busca `url` sempre que `chave` muda (null = nada a buscar). Resposta de um pedido antigo
// é descartada.
function useConsulta<T>(chave: string | null, url: string, extrair: (corpo: unknown) => T) {
  const [resposta, setResposta] = useState<Resposta<T> | null>(null);
  const extrairRef = useRef(extrair);
  useEffect(() => {
    if (!chave) return;
    let valido = true;
    buscar<unknown>(url).then((r) => {
      if (!valido) return;
      setResposta(r.ok ? { chave, dados: extrairRef.current(r.dados), erro: null } : { chave, dados: null as T, erro: r.erro });
    });
    return () => {
      valido = false;
    };
  }, [chave, url]);
  const atual = chave && resposta?.chave === chave ? resposta : null;
  return { carregando: !!chave && !atual, dados: atual?.erro ? null : (atual?.dados ?? null), erro: atual?.erro ?? null };
}

const diaPorExtenso = (data: string) => {
  const dow = diaSemana(data);
  return dow === 0 || dow === 6 ? DIAS_SEMANA[dow] : `${DIAS_SEMANA[dow]}-feira`;
};
const ddmm = (data: string) => formatarDataBR(data).slice(0, 5);

function periodoDoHorario(h: string): "Manhã" | "Tarde" | "Noite" {
  if (h < "12:00") return "Manhã";
  if (h < "18:00") return "Tarde";
  return "Noite";
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function Secao({
  id,
  rotulo,
  titulo,
  destaque,
  secaoRef,
  children,
}: {
  id: string;
  rotulo: string;
  titulo: string;
  destaque: string;
  secaoRef?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}) {
  return (
    // scroll-mb: ao rolar até a seção, ela para acima do resumo fixo do rodapé.
    <section id={id} ref={secaoRef} aria-labelledby={`${id}-titulo`} className="animate-surgir scroll-mt-4 scroll-mb-52 pt-12">
      <TituloEditorial id={`${id}-titulo`} rotulo={rotulo} titulo={titulo} destaque={destaque} compacto />
      {children}
    </section>
  );
}

// Esqueleto enquanto a seção carrega: mesmas proporções do conteúdo, sem pular a tela.
function Carregando({ forma }: { forma: "linha" | "grade" }) {
  return (
    <div role="status" aria-label="Carregando" className={forma === "linha" ? "flex gap-2 overflow-hidden" : "grid grid-cols-4 gap-2"}>
      {Array.from({ length: forma === "linha" ? 5 : 8 }, (_, i) => (
        <span
          key={i}
          className={`animate-pulse rounded-lg bg-grafite ${forma === "linha" ? "h-[5.25rem] w-[4.5rem] shrink-0" : "h-11"}`}
        />
      ))}
    </div>
  );
}

function Erro({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-[0.95rem] text-brasa">
      {children}
    </p>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-linha px-4 py-5 text-center text-[0.95rem] text-nevoa">{children}</p>;
}

// Chip de escolha (data e horário): vermelho cheio quando marcado.
const chip = (marcado: boolean) =>
  `border transition-[background-color,border-color,color,transform] duration-150 active:scale-95 ${
    marcado
      ? "border-brasa bg-brasa text-white shadow-[0_6px_20px_-8px_rgba(255,59,64,0.7)]"
      : "border-linha bg-grafite text-giz hover:border-nevoa/50 hover:bg-chumbo"
  }`;

export function Reserva({
  servicos,
  servicoInicial,
  linkWhatsapp,
  politicaCancelamento,
}: {
  servicos: ServicoPublico[];
  servicoInicial?: string;
  linkWhatsapp: string | null;
  politicaCancelamento: string | null;
}) {
  const [selecionados, setSelecionados] = useState<string[]>(servicoInicial ? [servicoInicial] : []);
  const [data, setData] = useState<string | null>(null);
  const [barbeiroId, setBarbeiroId] = useState<string | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  // Muda quando um horário é tomado por outra pessoa: força buscar a lista de novo.
  const [recarga, setRecarga] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);

  const [dadosAbertos, setDadosAbertos] = useState(false);
  const [nome, setNome] = useState(() => lerContatoSalvo().nome);
  const [telefone, setTelefone] = useState(() => lerContatoSalvo().telefone);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState<Confirmado | null>(null);

  const refData = useRef<HTMLElement>(null);
  const refBarbeiro = useRef<HTMLElement>(null);
  const refHorario = useRef<HTMLElement>(null);
  const refTopo = useRef<HTMLDivElement>(null);
  const refDias = useRef<HTMLDivElement>(null);

  const qs = selecionados.length ? `servicos=${selecionados.join(",")}` : null;

  // 1) Datas: dependem só dos serviços. Só as que têm horário livre aparecem.
  const datas = useConsulta<DiaOpcao[]>(qs, `/api/agendamento/datas?${qs}`, (c) =>
    (c as { datas: DiaOpcao[] }).datas.filter((d) => d.disponivel)
  );
  // 2) Barbeiros: serviços + data. Só quem tem horário livre no dia aparece.
  const chaveBarbeiros = qs && data ? `${qs}&data=${data}` : null;
  const barbeiros = useConsulta<BarbeiroOpcao[]>(chaveBarbeiros, `/api/agendamento/barbeiros?${chaveBarbeiros}`, (c) =>
    (c as { barbeiros: BarbeiroOpcao[] }).barbeiros.filter((b) => b.horarios > 0)
  );
  // 3) Horários: serviços + data + barbeiro.
  const chaveHorarios = chaveBarbeiros && barbeiroId ? `${chaveBarbeiros}&barbeiro=${barbeiroId}&r=${recarga}` : null;
  const horarios = useConsulta<string[]>(chaveHorarios, `/api/agendamento/horarios?${chaveHorarios}`, (c) =>
    (c as { horarios: string[] }).horarios
  );

  // Escolhas que deixaram de valer depois de uma resposta nova (ex.: trocou o serviço e o
  // barbeiro não faz o novo) são descartadas na hora de exibir e de enviar.
  const dataValida = data && datas.dados?.some((d) => d.data === data) ? data : null;
  const barbeiroValido = dataValida && barbeiroId ? (barbeiros.dados?.find((b) => b.id === barbeiroId) ?? null) : null;
  const horaValida = barbeiroValido && hora && horarios.dados?.includes(hora) ? hora : null;

  const escolhidos = selecionados.map((id) => servicos.find((s) => s.id === id)).filter((s): s is ServicoPublico => !!s);
  const total = escolhidos.reduce((s, x) => s + x.preco, 0);
  const duracao = escolhidos.reduce((s, x) => s + x.duracao_minutos, 0);
  const completo = escolhidos.length > 0 && !!dataValida && !!barbeiroValido && !!horaValida;

  // Leva a próxima seção para a vista (acima do resumo fixo) assim que ela termina de
  // carregar — antes disso ela só tem "Carregando..." e a rolagem pararia curta.
  const [rolarPara, setRolarPara] = useState<"data" | "barbeiro" | "horario" | null>(null);
  const pronto = { data: !datas.carregando, barbeiro: !barbeiros.carregando, horario: !horarios.carregando };
  const prontoAlvo = rolarPara ? pronto[rolarPara] : false;
  useEffect(() => {
    if (!rolarPara || !prontoAlvo) return;
    const alvo = { data: refData, barbeiro: refBarbeiro, horario: refHorario }[rolarPara].current;
    if (!alvo) return;
    const quadro = requestAnimationFrame(() => {
      alvo.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setRolarPara(null);
    });
    return () => cancelAnimationFrame(quadro);
  }, [rolarPara, prontoAlvo]);

  function alternarServico(id: string) {
    setAviso(null);
    if (selecionados.length === 0) setRolarPara("data");
    setSelecionados((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  function escolherData(d: string) {
    setAviso(null);
    setData(d);
    setRolarPara("barbeiro");
  }

  function escolherBarbeiro(id: string) {
    setAviso(null);
    setBarbeiroId(id);
    setRolarPara("horario");
  }

  function rolarDias(sentido: 1 | -1) {
    const trilho = refDias.current;
    if (trilho) trilho.scrollBy({ left: sentido * trilho.clientWidth * 0.8, behavior: "smooth" });
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!completo || !barbeiroValido) return;
    setErroEnvio(null);
    const digitos = telefone.replace(/\D/g, "");
    if (nome.trim().length < 2) return setErroEnvio("Informe seu nome.");
    if (digitos.length < 10 || digitos.length > 13) return setErroEnvio("Informe o telefone com DDD.");

    setEnviando(true);
    const r = await buscar<{ agendamento: Confirmado }>("/api/agendamento/confirmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servicos: selecionados, data: dataValida, barbeiro: barbeiroValido.id, hora: horaValida, nome, telefone }),
    });
    setEnviando(false);
    if (!r.ok) {
      // Horário tomado por outra pessoa enquanto o cliente preenchia: fecha a janela,
      // atualiza a lista e pede outro horário.
      if (r.corpo?.horarioIndisponivel) {
        setDadosAbertos(false);
        setHora(null);
        setRecarga((n) => n + 1);
        setAviso(r.erro);
        refHorario.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      return setErroEnvio(r.erro);
    }
    try {
      localStorage.setItem(CHAVE_CONTATO, JSON.stringify({ nome: nome.trim(), telefone }));
    } catch {
      // sem armazenamento — tudo bem
    }
    setDadosAbertos(false);
    setConfirmado(r.dados.agendamento);
    requestAnimationFrame(() => refTopo.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function novoAgendamento() {
    setConfirmado(null);
    setSelecionados([]);
    setData(null);
    setBarbeiroId(null);
    setHora(null);
    setAviso(null);
  }

  if (confirmado) {
    return (
      <div ref={refTopo} className="animate-surgir scroll-mt-4 pt-12">
        <TituloEditorial rotulo="Tudo certo" titulo="Agendamento" destaque="confirmado" />
        <p className="-mt-2 mb-5 text-[0.95rem] text-nevoa">
          Obrigado, {confirmado.nome.split(" ")[0]}! Seu horário está reservado.
        </p>
        <div className="rounded-xl border border-linha border-l-2 border-l-brasa bg-grafite p-5">
          <p className="font-display text-xl font-bold text-giz">
            {DIAS_SEMANA[diaSemana(confirmado.data)]}, {formatarDataBR(confirmado.data)}
          </p>
          <p className="mt-0.5 font-display text-lg font-semibold text-brasa">
            {confirmado.hora} – {confirmado.horaFim}
          </p>
          <p className="mt-3 text-[0.95rem] text-giz/85">
            {confirmado.servicos.map((s) => s.nome).join(" + ")} com {confirmado.barbeiro}
          </p>
          <p className="mt-1 text-sm text-nevoa">
            {formatarPreco(confirmado.valorTotal)} · {formatarDuracao(confirmado.duracaoTotal)}
          </p>
        </div>
        {linkWhatsapp && (
          <a
            href={linkWhatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 block rounded-lg border border-emerald-500/40 py-3.5 text-center text-[0.95rem] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10"
          >
            Precisa mudar algo? Fale no WhatsApp
          </a>
        )}
        <button
          type="button"
          onClick={novoAgendamento}
          className="mt-3 block w-full py-3 text-center text-sm text-nevoa transition-colors hover:text-giz"
        >
          Fazer outro agendamento
        </button>
      </div>
    );
  }

  return (
    <div ref={refTopo}>
      {/* Serviços */}
      <section id="servicos" aria-labelledby="servicos-titulo" className="scroll-mt-4 pt-12">
        <TituloEditorial
          id="servicos-titulo"
          rotulo="Nossos serviços"
          titulo="Escolha seu"
          destaque="serviço"
          descricao="Qualidade, estilo e cuidado em cada detalhe."
        />
        <ul className="space-y-3">
          {servicos.map((s, i) => {
            const marcado = selecionados.includes(s.id);
            return (
              <li key={s.id} className="animate-surgir" style={{ animationDelay: `${Math.min(i, 6) * 45}ms` }}>
                <button
                  type="button"
                  onClick={() => alternarServico(s.id)}
                  aria-pressed={marcado}
                  className={`group flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 active:scale-[0.985] sm:gap-4 sm:p-3 ${
                    marcado
                      ? "border-brasa bg-brasa/[0.07] shadow-[0_0_0_1px_var(--color-brasa),0_12px_32px_-16px_rgba(255,59,64,0.55)]"
                      : "border-linha bg-grafite hover:border-nevoa/40 hover:bg-chumbo"
                  }`}
                >
                  <span className="relative h-[4.75rem] w-[4.75rem] shrink-0 overflow-hidden rounded-lg border border-linha bg-chumbo sm:h-24 sm:w-24">
                    {s.fotoUrl ? (
                      // Foto em tons baixos (linguagem da página); ganha cor ao passar/selecionar.
                      <img
                        src={s.fotoUrl}
                        alt=""
                        className={`h-full w-full object-cover transition-[filter,transform] duration-300 group-hover:scale-105 group-hover:grayscale-0 ${
                          marcado ? "grayscale-0" : "grayscale-[70%]"
                        }`}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#2c2d33,#141417_70%)] text-nevoa/80 transition-colors group-hover:text-giz">
                        <IconeDoServico nome={s.nome} className="h-8 w-8 sm:h-9 sm:w-9" />
                      </span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1 py-0.5">
                    <span className="block font-display text-[1.05rem] font-bold leading-tight text-giz sm:text-lg">{s.nome}</span>
                    {s.descricao && (
                      <span className="mt-1 line-clamp-2 block text-[0.85rem] leading-snug text-nevoa sm:text-[0.9rem]">{s.descricao}</span>
                    )}
                    <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.9rem]">
                      <IconeDoServico nome={s.nome} className="hidden h-4 w-4 text-nevoa min-[380px]:block" />
                      <span aria-hidden="true" className="hidden h-4 w-px bg-brasa min-[380px]:block" />
                      <span className={`font-bold tabular-nums ${marcado ? "text-brasa" : "text-giz"}`}>{formatarPreco(s.preco)}</span>
                      <span className="flex items-center gap-1 text-nevoa">
                        <IconeRelogio className="h-4 w-4" />
                        {formatarDuracao(s.duracao_minutos)}
                      </span>
                    </span>
                  </span>

                  <span
                    aria-hidden="true"
                    className={`mr-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors sm:h-10 sm:w-10 ${
                      marcado ? "border-brasa bg-brasa text-white" : "border-nevoa/40 text-giz group-hover:border-giz"
                    }`}
                  >
                    {marcado ? (
                      <IconeCheck key="check" className="h-4 w-4 animate-marcar" />
                    ) : (
                      <IconeSeta className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {servicos.length > 1 && <p className="mt-3 text-sm text-nevoa">Pode escolher mais de um.</p>}
      </section>

      {/* Data */}
      {escolhidos.length > 0 && (
        <Secao id="data" rotulo="Quando" titulo="Escolha a" destaque="data" secaoRef={refData}>
          {datas.carregando ? (
            <Carregando forma="linha" />
          ) : datas.erro ? (
            <Erro>{datas.erro}</Erro>
          ) : !datas.dados?.length ? (
            <Vazio>Não há horários livres nos próximos dias para esses serviços.</Vazio>
          ) : (
            <div className="relative">
              <div ref={refDias} className="-mx-5 flex snap-x gap-2 overflow-x-auto scroll-px-5 px-5 pb-2 [scrollbar-width:none]">
                {datas.dados.map((d) => {
                  const marcado = d.data === dataValida;
                  const [, mes, dia] = d.data.split("-");
                  return (
                    <button
                      key={d.data}
                      type="button"
                      onClick={() => escolherData(d.data)}
                      aria-pressed={marcado}
                      aria-label={`${diaPorExtenso(d.data)}, ${formatarDataBR(d.data)}`}
                      className={`w-[4.5rem] shrink-0 snap-start rounded-lg py-2.5 text-center ${chip(marcado)}`}
                    >
                      <span className={`block text-[0.7rem] font-semibold uppercase tracking-[0.18em] ${marcado ? "text-white/85" : "text-nevoa"}`}>
                        {DIAS_SEMANA[diaSemana(d.data)].slice(0, 3)}
                      </span>
                      <span className="block font-display text-2xl font-bold leading-tight tabular-nums">{dia}</span>
                      <span className={`block text-[0.7rem] uppercase tracking-widest ${marcado ? "text-white/85" : "text-nevoa"}`}>
                        {MESES[Number(mes) - 1]}
                      </span>
                    </button>
                  );
                })}
              </div>
              {datas.dados.length > 5 && (
                <div className="mt-2 hidden justify-end gap-2 sm:flex">
                  {([-1, 1] as const).map((sentido) => (
                    <button
                      key={sentido}
                      type="button"
                      onClick={() => rolarDias(sentido)}
                      aria-label={sentido < 0 ? "Datas anteriores" : "Próximas datas"}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-linha text-giz transition-colors hover:border-giz"
                    >
                      <IconeSeta className={`h-4 w-4 ${sentido < 0 ? "rotate-180" : ""}`} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Secao>
      )}

      {/* Profissional */}
      {escolhidos.length > 0 && dataValida && (
        <Secao id="profissional" rotulo="Com quem" titulo="Escolha o" destaque="profissional" secaoRef={refBarbeiro}>
          {barbeiros.carregando ? (
            <Carregando forma="linha" />
          ) : barbeiros.erro ? (
            <Erro>{barbeiros.erro}</Erro>
          ) : !barbeiros.dados?.length ? (
            <Vazio>Nenhum profissional com horário livre neste dia. Escolha outra data.</Vazio>
          ) : (
            <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-2 pt-2 [scrollbar-width:none]">
              {barbeiros.dados.map((b) => {
                const marcado = b.id === barbeiroValido?.id;
                const [primeiro, ...resto] = b.nome.trim().split(/\s+/);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => escolherBarbeiro(b.id)}
                    aria-pressed={marcado}
                    aria-label={b.nome}
                    className="group w-[5.75rem] shrink-0 text-center transition-transform active:scale-95"
                  >
                    <span
                      className={`relative block h-[5.75rem] w-[5.75rem] rounded-xl p-[2px] transition-colors ${
                        marcado ? "bg-brasa" : "bg-linha group-hover:bg-nevoa/50"
                      }`}
                    >
                      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[10px] bg-chumbo font-display text-3xl font-bold text-nevoa">
                        {b.fotoUrl ? (
                          <img
                            src={b.fotoUrl}
                            alt=""
                            className={`h-full w-full object-cover transition-[filter] duration-300 group-hover:grayscale-0 ${marcado ? "" : "grayscale-[40%]"}`}
                          />
                        ) : (
                          primeiro.slice(0, 1).toUpperCase()
                        )}
                      </span>
                      {marcado && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 animate-marcar items-center justify-center rounded-full border-2 border-carvao bg-brasa text-white">
                          <IconeCheck className="h-3 w-3" />
                        </span>
                      )}
                    </span>
                    <span className={`mt-2 block truncate text-[0.95rem] font-semibold leading-tight ${marcado ? "text-giz" : "text-giz/90"}`}>
                      {primeiro}
                    </span>
                    {resto.length > 0 && <span className="block truncate text-sm leading-tight text-nevoa">{resto.join(" ")}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </Secao>
      )}

      {/* Horários */}
      {escolhidos.length > 0 && barbeiroValido && (
        <Secao id="horarios-disponiveis" rotulo="Que horas" titulo="Horários" destaque="disponíveis" secaoRef={refHorario}>
          {aviso && (
            <p role="status" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[0.95rem] text-amber-300">
              {aviso}
            </p>
          )}
          {horarios.carregando ? (
            <Carregando forma="grade" />
          ) : horarios.erro ? (
            <Erro>{horarios.erro}</Erro>
          ) : !horarios.dados?.length ? (
            <Vazio>Sem horários livres com esse profissional neste dia. Escolha outro.</Vazio>
          ) : (
            <div className="space-y-5">
              {(["Manhã", "Tarde", "Noite"] as const).map((periodo) => {
                const lista = horarios.dados!.filter((h) => periodoDoHorario(h) === periodo);
                if (!lista.length) return null;
                return (
                  <div key={periodo}>
                    <h3 className="mb-2.5 flex items-center gap-3 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-nevoa">
                      {periodo}
                      <span aria-hidden="true" className="h-px flex-1 bg-linha" />
                    </h3>
                    <div className="grid grid-cols-4 gap-2">
                      {lista.map((h) => {
                        const marcado = h === horaValida;
                        return (
                          <button
                            key={h}
                            type="button"
                            onClick={() => {
                              setAviso(null);
                              setHora(h);
                            }}
                            aria-pressed={marcado}
                            className={`rounded-lg py-2.5 text-[0.95rem] font-semibold tabular-nums ${chip(marcado)}`}
                          >
                            {h}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Secao>
      )}

      {/* Resumo fixo no rodapé (data-resumo: a página reserva espaço para ele). */}
      {escolhidos.length > 0 && (
        <div data-resumo className="fixed inset-x-0 bottom-0 z-20 animate-subir border-t border-linha bg-carvao/90 backdrop-blur-md">
          <div className="mx-auto w-full max-w-2xl px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <div className="min-w-0 text-sm leading-snug">
              <p className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-nevoa">
                Seu agendamento
                <span aria-hidden="true" className="h-px w-6 bg-brasa" />
              </p>
              <p className="mt-1 truncate font-display text-[0.95rem] font-bold text-giz">{escolhidos.map((s) => s.nome).join(" + ")}</p>
              <p className="truncate text-nevoa">
                {dataValida ? (
                  <span className="text-giz/85">
                    {ddmm(dataValida)} • {diaPorExtenso(dataValida)}
                    {horaValida && <span className="font-semibold text-giz"> · {horaValida}</span>}
                  </span>
                ) : (
                  "Escolha a data"
                )}
                {dataValida && (
                  <span className={barbeiroValido ? "text-giz/85" : ""}>
                    {" · "}
                    {barbeiroValido ? barbeiroValido.nome : "Escolha o profissional"}
                  </span>
                )}
                {barbeiroValido && !horaValida && " · Escolha o horário"}
              </p>
            </div>
            <button
              type="button"
              disabled={!completo}
              onClick={() => {
                setErroEnvio(null);
                setDadosAbertos(true);
              }}
              className="mt-3 flex w-full flex-col items-center rounded-lg bg-brasa py-2.5 text-white shadow-[0_10px_30px_-12px_rgba(255,59,64,0.8)] transition-[background-color,transform,opacity] duration-150 hover:bg-brasa-forte active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-chumbo disabled:text-nevoa disabled:shadow-none"
            >
              <span className="font-display text-[0.95rem] font-bold uppercase tracking-[0.12em]">Agendar atendimento</span>
              <span className="text-[0.8rem] font-medium tabular-nums opacity-90">
                {formatarPreco(total)} · {formatarDuracao(duracao)}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Nome e telefone — janela sobre a própria página, só no fim. */}
      {dadosAbertos && completo && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/70 backdrop-blur-[2px] sm:items-center"
          onClick={() => !enviando && setDadosAbertos(false)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="dados-titulo"
            onSubmit={confirmar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg animate-subir space-y-4 rounded-t-2xl border border-linha bg-grafite p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:animate-surgir sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-nevoa">Último passo</p>
                <h2 id="dados-titulo" className="mt-1 font-display text-2xl font-extrabold uppercase tracking-tight text-giz">
                  Seus <span className="text-brasa">dados</span>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDadosAbertos(false)}
                disabled={enviando}
                aria-label="Fechar"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-linha text-xl leading-none text-nevoa transition-colors hover:border-giz hover:text-giz"
              >
                ×
              </button>
            </div>
            <p className="rounded-lg border border-linha bg-carvao/60 px-3.5 py-3 text-sm leading-relaxed text-giz/85">
              <span className="font-semibold text-giz">{escolhidos.map((s) => s.nome).join(" + ")}</span>
              <br />
              {ddmm(dataValida!)} às {horaValida} com {barbeiroValido!.nome} ·{" "}
              <span className="font-semibold text-brasa">{formatarPreco(total)}</span>
            </p>
            <div>
              <label htmlFor="nome" className="mb-1.5 block text-sm font-medium text-giz/85">
                Nome
              </label>
              <input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                autoComplete="name"
                autoFocus
                required
                className="w-full rounded-lg border border-linha bg-carvao px-3.5 py-3 text-giz transition-colors placeholder:text-nevoa/60 focus:border-brasa focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="telefone" className="mb-1.5 block text-sm font-medium text-giz/85">
                Telefone / WhatsApp
              </label>
              <input
                id="telefone"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(11) 98765-4321"
                required
                className="w-full rounded-lg border border-linha bg-carvao px-3.5 py-3 text-giz transition-colors placeholder:text-nevoa/60 focus:border-brasa focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-nevoa">Sem cadastro nem senha. Usamos só para falar sobre o seu horário.</p>
            </div>
            {politicaCancelamento && <p className="text-xs leading-relaxed text-nevoa">{politicaCancelamento}</p>}
            {erroEnvio && <Erro>{erroEnvio}</Erro>}
            <button
              type="submit"
              disabled={enviando}
              className="w-full rounded-lg bg-brasa py-3.5 font-display text-[0.95rem] font-bold uppercase tracking-[0.12em] text-white transition-[background-color,transform] hover:bg-brasa-forte active:scale-[0.99] disabled:opacity-60"
            >
              {enviando ? "Confirmando..." : "Confirmar agendamento"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
