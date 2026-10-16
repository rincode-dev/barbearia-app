"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatarTelefone } from "@/lib/clientes/telefone";

type Opcao = { id: string; nome: string; telefone: string | null };

/**
 * Busca de cliente por nome ou telefone. Autocomplete próprio (não usa <datalist>):
 * Safari/iOS não mostra a lista suspensa nativa do datalist. Guarda o id escolhido num
 * input escondido, que é o que o formulário envia.
 */
function semAcento(texto: string) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function ClienteCombobox({
  clientes,
  defaultClienteId,
  name = "cliente_id",
  onChange,
}: {
  clientes: Opcao[];
  defaultClienteId?: string;
  name?: string;
  onChange?: (clienteId: string) => void;
}) {
  const porId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const containerRef = useRef<HTMLDivElement>(null);
  const listaId = useId();

  const [texto, setTexto] = useState(defaultClienteId ? porId.get(defaultClienteId)?.nome ?? "" : "");
  const [clienteId, setClienteId] = useState(defaultClienteId ?? "");
  const [aberto, setAberto] = useState(false);

  // Sem diferenciar maiúsculas nem acentos: "joao" acha "João".
  const termo = semAcento(texto.trim());
  const digitos = termo.replace(/\D/g, "");
  const sugestoes = termo
    ? clientes
        .filter((c) => semAcento(c.nome).includes(termo) || (digitos.length >= 3 && c.telefone?.includes(digitos)))
        .slice(0, 8)
    : [];

  useEffect(() => {
    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, []);

  function definir(id: string) {
    setClienteId(id);
    onChange?.(id);
  }

  function escolher(c: Opcao) {
    setTexto(c.nome);
    definir(c.id);
    setAberto(false);
  }

  function aoDigitar(valor: string) {
    setTexto(valor);
    setAberto(true);
    // Nome digitado por inteiro (sem diferenciar maiúsculas nem acentos) ou o telefone
    // completo também escolhem o cliente, sem precisar clicar na sugestão.
    const nome = semAcento(valor.trim());
    const tel = valor.replace(/\D/g, "");
    const exato = clientes.find((c) => semAcento(c.nome) === nome || (tel.length >= 10 && c.telefone === tel));
    definir(exato?.id ?? "");
  }

  // A lista só abre quando há o que escolher: sem resultado, quem avisa é a mensagem
  // vermelha abaixo do campo; com a única sugestão já escolhida, fica a mensagem verde.
  const soOEscolhido = sugestoes.length === 1 && sugestoes[0].id === clienteId;
  const mostrarLista = aberto && termo.length > 0 && sugestoes.length > 0 && !soOEscolhido;
  const escolhido = clienteId ? porId.get(clienteId) : undefined;
  // Retorno imediato abaixo do campo: verde com os dados quando há cliente escolhido;
  // vermelho quando o texto não bate com nenhum cadastro.
  const situacao = !termo ? null : escolhido ? "encontrado" : sugestoes.length === 0 ? "nao-encontrado" : null;

  return (
    <div ref={containerRef} className="relative">
      <input
        value={texto}
        onChange={(e) => aoDigitar(e.target.value)}
        onFocus={() => setAberto(true)}
        placeholder="Nome ou telefone do cliente..."
        autoComplete="off"
        role="combobox"
        aria-expanded={mostrarLista}
        aria-controls={listaId}
        aria-autocomplete="list"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <input type="hidden" name={name} value={clienteId} />

      <ul
        id={listaId}
        role="listbox"
        hidden={!mostrarLista}
        className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-surface shadow-lg shadow-black/40"
      >
        {sugestoes.map((c) => (
          <li key={c.id} role="option" aria-selected={c.id === clienteId}>
            <button
              type="button"
              onClick={() => escolher(c)}
              className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm text-neutral-900 hover:bg-accent/10"
            >
              <span>{c.nome}</span>
              <span className="text-neutral-500">{formatarTelefone(c.telefone)}</span>
            </button>
          </li>
        ))}
      </ul>

      <div aria-live="polite" className="mt-1.5 min-h-5 text-xs">
        {situacao === "encontrado" && escolhido && (
          <div data-situacao-cliente="encontrado" className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-neutral-600">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-400" />
              Cliente encontrado.
            </span>
            <span>
              Nome: <span className="text-neutral-800">{escolhido.nome}</span>
            </span>
            {escolhido.telefone && (
              <span>
                Telefone: <span className="tabular-nums text-neutral-800">{formatarTelefone(escolhido.telefone)}</span>
              </span>
            )}
          </div>
        )}
        {situacao === "nao-encontrado" && (
          <span data-situacao-cliente="nao-encontrado" className="inline-flex items-center gap-1.5 font-medium text-red-400">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-400" />
            Cliente não encontrado.
          </span>
        )}
      </div>
    </div>
  );
}
