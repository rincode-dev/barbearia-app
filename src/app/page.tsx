/* eslint-disable @next/next/no-img-element -- logo vem do Storage do estabelecimento
   (URL externa por barbearia), não de /public. */

import type { Viewport } from "next";
import { getEstabelecimento } from "@/lib/estabelecimento";
import { horarioFuncionamento, periodosAbertosSite, servicosAgendaveis } from "@/lib/agendamento/catalogo";
import { diaSemana } from "@/lib/agendamento/motor";
import { DIAS_SEMANA, hojeSP, horaCurta } from "@/lib/datas";
import { construirLinkWhatsapp } from "@/lib/mensagens/whatsapp";
import { formatarTelefone } from "@/lib/clientes/telefone";
import { Reserva } from "./_site/reserva";
import { StatusFuncionamento } from "./_site/status-funcionamento";
import { IconeConversa, IconeLocal, IconeSeta, TituloEditorial } from "./_site/visual";

// Site público da barbearia (sem login) — requisitos do produto, item 2. Tudo vem do cadastro
// (Configurações); o que não estiver preenchido simplesmente não aparece. Topo = logo,
// status aberto/fechado e endereço; logo abaixo, o agendamento inteiro nesta mesma página
// (decisão 41). Horários, mapa e contatos ficam no fim. Visual "barbearia premium" (dark,
// editorial, vermelho só de destaque) — decisão 42.
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

// Barra do navegador do celular no mesmo preto da página (o painel segue com o do layout).
export const viewport: Viewport = { themeColor: "#0b0b0d" };

function Secao({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto w-full max-w-2xl scroll-mt-6 px-5 pt-14">
      {children}
    </section>
  );
}

export default async function SiteBarbeariaPage({ searchParams }: { searchParams: Promise<{ servico?: string }> }) {
  const [{ servico }, barbearia, servicos, funcionamento] = await Promise.all([
    searchParams,
    getEstabelecimento(),
    servicosAgendaveis(),
    horarioFuncionamento(),
  ]);
  const { periodos, agora } = await periodosAbertosSite(funcionamento);
  const hoje = diaSemana(hojeSP());

  const linkWhatsapp = barbearia.whatsapp
    ? construirLinkWhatsapp(barbearia.whatsapp, `Olá! Vim pelo site da ${barbearia.nome}.`)
    : null;
  const linkMapa =
    barbearia.mapaUrl ??
    (barbearia.endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(barbearia.endereco)}` : null);
  const linkWhatsappAgendamento = barbearia.whatsapp
    ? construirLinkWhatsapp(barbearia.whatsapp, `Olá! Tenho uma dúvida sobre o meu agendamento na ${barbearia.nome}.`)
    : null;
  const podeAgendar = servicos.length > 0;

  return (
    // has-[[data-resumo]]: com o resumo fixo aberto, o fim da página não fica atrás dele.
    <main className={`group/pagina flex min-h-screen flex-col bg-carvao text-giz has-[[data-resumo]]:pb-44`}>
      {/* Topo: apresentação da marca — logo à esquerda, status e endereço à direita. */}
      <header className="group/topo relative isolate overflow-hidden border-b border-linha bg-carvao">
        {/* Fundo: brilho na cor do status (verde aberto, vermelho fechado — troca suave quando o
            status muda) + textura fina de metal escovado + vinheta. */}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(90%_120%_at_100%_0%,rgba(255,59,64,0.16),transparent_60%)] transition-opacity duration-700 group-has-[[data-aberto]]/topo:opacity-0" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(90%_120%_at_100%_0%,rgba(52,211,153,0.16),transparent_60%)] opacity-0 transition-opacity duration-700 group-has-[[data-aberto]]/topo:opacity-100" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-[0.05] bg-[repeating-linear-gradient(135deg,#fff_0_1px,transparent_1px_9px)]" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-24 bg-gradient-to-t from-carvao to-transparent" />

        {/* Até 379px (celular pequeno) fica empilhado; a partir daí, logo e informações lado a lado. */}
        <div className="mx-auto grid w-full max-w-2xl grid-cols-1 items-center gap-6 px-5 py-9 min-[380px]:grid-cols-[minmax(0,0.95fr)_1px_minmax(0,1.05fr)] min-[380px]:gap-4 sm:gap-10 sm:py-16">
          {/* Sem animação aqui: animar o h1 isolaria a mistura (mix-blend) do logo com o fundo. */}
          <h1 className="flex min-w-0 justify-center">
            {barbearia.logoUrl ? (
              <img
                src={barbearia.logoUrl}
                alt={barbearia.nome}
                // lighten: logo em JPG com fundo preto se funde ao fundo do topo em vez de virar um quadrado.
                className="max-h-32 w-auto max-w-[70%] object-contain mix-blend-lighten min-[380px]:max-h-36 min-[380px]:max-w-full sm:max-h-56"
              />
            ) : (
              // Sem logo cadastrado: o nome faz o papel de marca.
              <span className="break-words text-center font-display text-2xl font-black uppercase leading-none tracking-tight sm:text-4xl">
                {barbearia.nome}
              </span>
            )}
          </h1>

          <span aria-hidden="true" className="hidden h-full min-h-28 w-px bg-gradient-to-b from-transparent via-linha to-transparent min-[380px]:block" />

          <div className="mx-auto min-w-0 animate-surgir space-y-4 [animation-delay:80ms] min-[380px]:mx-0 sm:space-y-5">
            <StatusFuncionamento periodos={periodos} agoraServidor={agora} />
            {barbearia.endereco && (
              <p className="flex items-start gap-2.5 text-[0.95rem] leading-snug text-giz/85 max-[379px]:justify-center max-[379px]:text-center sm:text-lg">
                <IconeLocal className="mt-0.5 h-[1.1rem] w-[1.1rem] shrink-0 text-nevoa" />
                {linkMapa ? (
                  <a
                    href={linkMapa}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-words transition-colors hover:text-giz hover:underline hover:decoration-brasa hover:underline-offset-4"
                  >
                    {barbearia.endereco}
                  </a>
                ) : (
                  <span className="break-words">{barbearia.endereco}</span>
                )}
              </p>
            )}
            {barbearia.endereco && (
              // Leva ao mapa da seção "Como chegar", no fim da página.
              <a
                href="#contato"
                className="-mt-2 inline-flex items-center gap-1.5 pl-[1.75rem] text-xs font-semibold uppercase tracking-[0.18em] text-brasa transition-opacity hover:opacity-80 max-[379px]:flex max-[379px]:justify-center max-[379px]:pl-0 sm:-mt-3 sm:text-[0.8rem]"
              >
                Como chegar
                <IconeSeta className="h-3.5 w-3.5 rotate-90" />
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl px-5">
        {podeAgendar ? (
          <Reserva
            servicos={servicos}
            servicoInicial={servicos.some((s) => s.id === servico) ? servico : undefined}
            linkWhatsapp={linkWhatsappAgendamento}
            politicaCancelamento={barbearia.politicaCancelamento}
          />
        ) : (
          <p className="mt-12 rounded-xl border border-linha bg-grafite p-6 text-center text-nevoa">
            Agendamento online em breve.
          </p>
        )}
      </div>

      {funcionamento.length > 0 && (
        <Secao id="horarios">
          <TituloEditorial rotulo="Funcionamento" titulo="Horários da" destaque="semana" compacto />
          <ul className="overflow-hidden rounded-xl border border-linha bg-grafite text-[0.95rem]">
            {ORDEM_DIAS.map((dia) => {
              const faixas = funcionamento.filter((f) => f.dia_semana === dia);
              const ehHoje = dia === hoje;
              return (
                <li
                  key={dia}
                  className={`flex justify-between gap-4 border-b border-linha px-4 py-3 last:border-b-0 ${ehHoje ? "bg-chumbo" : ""}`}
                >
                  <span className={ehHoje ? "font-semibold text-giz" : "text-nevoa"}>
                    {DIAS_SEMANA[dia]}
                    {ehHoje && <span className="ml-2 text-xs font-medium uppercase tracking-widest text-brasa">hoje</span>}
                  </span>
                  <span className={`text-right ${faixas.length ? "text-giz" : "text-nevoa/70"}`}>
                    {faixas.length
                      ? faixas.map((f) => `${horaCurta(f.inicio)}–${horaCurta(f.fim)}`).join(" · ")
                      : "Fechado"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Secao>
      )}

      {(barbearia.endereco || linkWhatsapp || barbearia.telefone || barbearia.instagram) && (
        <Secao id="contato">
          <TituloEditorial rotulo="Localização" titulo="Como" destaque="chegar" compacto />
          <div className="space-y-3">
            {barbearia.endereco && (
              <div className="overflow-hidden rounded-xl border border-linha bg-grafite">
                <iframe
                  title={`Mapa — ${barbearia.nome}`}
                  src={`https://www.google.com/maps?q=${encodeURIComponent(barbearia.endereco)}&output=embed`}
                  // Mapa em tons escuros para não destoar da página.
                  className="h-56 w-full border-0 [filter:grayscale(1)_invert(0.92)_contrast(0.9)]"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
                <div className="flex items-center justify-between gap-3 p-4 text-[0.95rem]">
                  <span className="min-w-0 break-words text-giz/85">{barbearia.endereco}</span>
                  {linkMapa && (
                    <a
                      href={linkMapa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-sm font-semibold text-brasa transition-opacity hover:opacity-80"
                    >
                      Abrir no mapa
                    </a>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {linkWhatsapp && (
                <a
                  href={linkWhatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-emerald-500/40 px-4 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10"
                >
                  WhatsApp
                </a>
              )}
              {barbearia.telefone && (
                <a
                  href={`tel:${barbearia.telefone.replace(/\D/g, "")}`}
                  className="rounded-lg border border-linha px-4 py-2.5 text-sm text-giz/85 transition-colors hover:border-nevoa hover:text-giz"
                >
                  Ligar {formatarTelefone(barbearia.telefone)}
                </a>
              )}
              {barbearia.instagram && (
                <a
                  href={`https://instagram.com/${barbearia.instagram}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-linha px-4 py-2.5 text-sm text-giz/85 transition-colors hover:border-nevoa hover:text-giz"
                >
                  @{barbearia.instagram}
                </a>
              )}
            </div>
          </div>
        </Secao>
      )}

      {barbearia.politicaCancelamento && (
        <Secao id="cancelamento">
          <div className="border-l-2 border-brasa pl-4">
            <p className="text-[0.7rem] font-medium uppercase tracking-[0.32em] text-nevoa">Cancelamentos</p>
            <p className="mt-1.5 text-[0.95rem] text-giz/85">{barbearia.politicaCancelamento}</p>
          </div>
        </Secao>
      )}

      {/* WhatsApp flutuante no canto, acompanha a rolagem. Com o resumo do agendamento
          aberto no rodapé, sobe para ficar acima dele. */}
      {linkWhatsapp && (
        <a
          href={linkWhatsapp}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Falar no WhatsApp"
          title="Falar no WhatsApp"
          className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-20 flex h-14 w-14 animate-surgir items-center justify-center rounded-full bg-[#25d366] text-white shadow-[0_10px_28px_-8px_rgba(0,0,0,0.8)] transition-[bottom,transform] duration-300 hover:scale-105 active:scale-95 group-has-[[data-resumo]]/pagina:bottom-[calc(12.5rem+env(safe-area-inset-bottom))] group-has-[[data-resumo]]/pagina:h-12 group-has-[[data-resumo]]/pagina:w-12 sm:right-6"
        >
          <IconeConversa className="h-7 w-7" />
        </a>
      )}

      {/* Sem link para a equipe: o painel é acessado digitando /login (não aparece para o cliente). */}
      <div aria-hidden="true" className="mt-auto pb-12" />
    </main>
  );
}
