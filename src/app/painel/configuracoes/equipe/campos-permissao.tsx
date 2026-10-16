// Campos de permissão compartilhados entre "novo acesso" e "editar": papel no sistema e
// se a pessoa atende clientes (o dono pode ser admin E barbeiro; um gerente pode ser
// admin sem atender) — docs/ARQUITETURA.md, decisão 15.
export function CamposPermissao({
  roleAtual = "colaborador",
  atendeAtual = true,
}: {
  roleAtual?: "admin" | "colaborador";
  atendeAtual?: boolean;
}) {
  return (
    <>
      <div>
        <label htmlFor="role" className="mb-1 block text-sm text-neutral-700">
          Permissão
        </label>
        <select
          id="role"
          name="role"
          defaultValue={roleAtual}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          <option value="colaborador">Barbeiro (acesso à própria rotina)</option>
          <option value="admin">Administrador (acesso completo)</option>
        </select>
      </div>

      <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          name="atende_como_barbeiro"
          defaultChecked={atendeAtual}
          className="h-4 w-4 rounded border-neutral-300 bg-surface accent-accent"
        />
        Atende clientes (aparece na agenda e no site)
      </label>
    </>
  );
}
