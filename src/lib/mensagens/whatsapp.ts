// Normaliza um telefone brasileiro em formato livre (com parênteses, traço, espaço)
// pro formato que o wa.me exige (só dígitos, com código do país). Sem validação
// rígida de DDD/tamanho — melhor tentar enviar com o que tem do que travar o botão.
export function normalizarTelefoneWhatsapp(telefone: string): string | null {
  const digitos = telefone.replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

export function construirLinkWhatsapp(telefone: string, mensagem: string): string | null {
  const numero = normalizarTelefoneWhatsapp(telefone);
  if (!numero) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}
