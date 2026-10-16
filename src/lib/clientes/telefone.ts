// Telefone é armazenado só com dígitos (sem DDD formatado, parênteses, traço) pra
// a constraint de unicidade (`clientes_telefone_unique`) funcionar independente de
// como o usuário digitou — "(11) 98765-4321" e "11987654321" têm que colidir.
export function normalizarTelefoneCliente(telefone: string): string {
  return telefone.replace(/\D/g, "");
}

// Exibição: "(11) 98765-4321" / "(11) 3456-7890". Fora desses tamanhos, mostra como está.
export function formatarTelefone(telefone: string | null): string {
  if (!telefone) return "—";
  const d = telefone.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return telefone;
}

// DDD + número (10 ou 11 dígitos), aceitando também com DDI 55 na frente. Mesmo limite
// usado pelo agendamento online — o telefone é a chave de deduplicação do cliente.
export function telefoneValido(digitos: string): boolean {
  return /^(55)?[1-9][0-9][0-9]{8,9}$/.test(digitos);
}
