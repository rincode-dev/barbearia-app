"use client";

// Seleção de barbeiro do Financeiro: aplica ao trocar (sem botão), mantendo o período
// escolhido — os campos escondidos do formulário levam período e datas.
export function SelectBarbeiro({
  barbeiros,
  valor,
  className,
}: {
  barbeiros: { id: string; nome: string; ativo: boolean }[];
  valor: string;
  className: string;
}) {
  return (
    <select
      name="barbeiro"
      defaultValue={valor}
      aria-label="Barbeiro"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={className}
    >
      <option value="">Todos os barbeiros</option>
      {barbeiros.map((b) => (
        <option key={b.id} value={b.id}>
          {b.nome}
          {b.ativo ? "" : " (desativado)"}
        </option>
      ))}
    </select>
  );
}
