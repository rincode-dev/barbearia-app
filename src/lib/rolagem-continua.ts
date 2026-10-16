// Rolagem contínua entre uma área com rolagem própria (ex.: grade da agenda) e a página.
// Celular e navegador "prendem" o gesto no primeiro elemento que rolou: ao chegar no fim
// da grade o dedo continuava arrastando e nada mexia — a página só rolava num toque novo.
// Aqui, quando a área já está no limite na direção do movimento, o resto do movimento
// vai para a página, ainda no mesmo gesto, com inércia ao soltar o dedo.
// Funções puras (testadas em scripts/testes/rolagem.mts) + o hook que liga os eventos.

export type Medidas = { scrollTop: number; clientHeight: number; scrollHeight: number };

// delta > 0 = conteúdo descendo (dedo subindo / roda para baixo).
// true quando a área não consegue mais rolar nessa direção e o movimento deve ir para a
// página. 1px de tolerância: com zoom/escala fracionada o fim fica em x,5.
export function deveRepassar({ scrollTop, clientHeight, scrollHeight }: Medidas, delta: number): boolean {
  if (delta > 0) return scrollTop + clientHeight >= scrollHeight - 1;
  if (delta < 0) return scrollTop <= 1;
  return false;
}

// Inércia depois de soltar: velocidade em px/ms, desacelerando a cada quadro (~60 fps).
export const ATRITO = 0.95;
export const VELOCIDADE_MINIMA = 0.02;

export function proximaVelocidade(v: number): number {
  const nova = v * ATRITO;
  return Math.abs(nova) < VELOCIDADE_MINIMA ? 0 : nova;
}
