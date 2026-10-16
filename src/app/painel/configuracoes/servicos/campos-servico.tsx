import { CampoImagem } from "@/components/campo-imagem";

// Campos compartilhados entre "novo serviço" e "editar serviço".
export type ServicoEditavel = {
  nome: string;
  descricao: string | null;
  preco: number;
  duracao_minutos: number;
  ordem: number;
};

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function CamposServico({
  servico,
  fotoUrl = null,
  onEnviandoChange,
}: {
  servico?: ServicoEditavel;
  fotoUrl?: string | null;
  onEnviandoChange?: (enviando: boolean) => void;
}) {
  return (
    <>
      <div className="sm:col-span-2">
        <CampoImagem
          name="foto_path"
          pasta="servicos"
          urlAtual={fotoUrl}
          rotulo="Foto (opcional — miniatura na lista de serviços do site)"
          onEnviandoChange={onEnviandoChange}
        />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="nome" className="mb-1 block text-sm text-neutral-700">Nome</label>
        <input id="nome" name="nome" required defaultValue={servico?.nome} placeholder="Ex.: Corte + Barba" className={INPUT} />
      </div>
      <div>
        <label htmlFor="preco" className="mb-1 block text-sm text-neutral-700">Preço (R$)</label>
        <input
          id="preco"
          name="preco"
          required
          inputMode="decimal"
          defaultValue={servico ? servico.preco.toFixed(2).replace(".", ",") : ""}
          placeholder="40,00"
          className={INPUT}
        />
      </div>
      <div>
        <label htmlFor="duracao" className="mb-1 block text-sm text-neutral-700">Duração (minutos)</label>
        <input
          id="duracao"
          name="duracao_minutos"
          type="number"
          required
          min={5}
          max={600}
          step={5}
          defaultValue={servico?.duracao_minutos ?? 30}
          className={INPUT}
        />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="descricao" className="mb-1 block text-sm text-neutral-700">Descrição (opcional)</label>
        <textarea
          id="descricao"
          name="descricao"
          rows={2}
          defaultValue={servico?.descricao ?? ""}
          placeholder="Aparece no site, abaixo do nome."
          className={INPUT}
        />
      </div>
      <div>
        <label htmlFor="ordem" className="mb-1 block text-sm text-neutral-700">Ordem no site</label>
        <input id="ordem" name="ordem" type="number" defaultValue={servico?.ordem ?? 0} className={INPUT} />
        <p className="mt-1 text-xs text-neutral-400">Menor aparece primeiro.</p>
      </div>
    </>
  );
}
