// Nome do cookie de sessão. Arquivo à parte (sem banco) porque o proxy também usa —
// lá a checagem é só "tem cookie?"; a validação de verdade é no servidor (session.ts).
export const COOKIE_SESSAO = "barbearia_sessao";
