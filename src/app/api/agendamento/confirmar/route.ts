import type { NextRequest } from "next/server";
import { codigoDeErro, comoSistema, mensagemDeErro } from "@/lib/db";
import { ErroAgendamento, ehUuid, horariosDisponiveis } from "@/lib/agendamento/disponibilidade";
import { ipDaRequisicao, registrarTentativa } from "@/lib/agendamento/limite";
import { normalizarTelefoneCliente, telefoneValido } from "@/lib/clientes/telefone";
import { dataHoraSP, instanteSP } from "@/lib/datas";
import { json, tratarErro } from "../resposta";

type Pedido = {
  servicos?: unknown;
  data?: unknown;
  barbeiro?: unknown;
  hora?: unknown;
  nome?: unknown;
  telefone?: unknown;
};

// Erros de regra levantados por criar_agendamento() (migration 20260924140000).
const MENSAGENS_BANCO: Record<string, string> = {
  NOME_INVALIDO: "Informe seu nome.",
  TELEFONE_INVALIDO: "Telefone inválido — informe DDD + número.",
  BARBEIRO_INDISPONIVEL: "Esse barbeiro não está disponível. Escolha outro.",
  SERVICOS_INVALIDOS: "Algum serviço mudou. Recarregue a página e escolha de novo.",
  LIMITE_AGENDAMENTOS:
    "Esse telefone já tem agendamentos em aberto. Para marcar mais, fale com a barbearia pelo WhatsApp.",
};

// POST /api/agendamento/confirmar — cria o agendamento. Nunca confia no navegador:
// recalcula a disponibilidade agora, e o banco confere barbeiro, serviços, preço, duração,
// limite por telefone e sobreposição (atômico).
export async function POST(request: NextRequest) {
  if (!registrarTentativa(ipDaRequisicao(request.headers))) {
    return json({ erro: "Muitas tentativas seguidas. Aguarde um pouco e tente de novo." }, 429);
  }

  let pedido: Pedido;
  try {
    pedido = (await request.json()) as Pedido;
  } catch {
    return json({ erro: "Pedido inválido." }, 400);
  }

  try {
    const servicos = Array.isArray(pedido.servicos) ? pedido.servicos.map(String) : [];
    const data = String(pedido.data ?? "");
    const barbeiroId = String(pedido.barbeiro ?? "");
    const hora = String(pedido.hora ?? "");
    const nome = String(pedido.nome ?? "").trim().slice(0, 80);
    const telefone = normalizarTelefoneCliente(String(pedido.telefone ?? ""));

    if (nome.length < 2) throw new ErroAgendamento("Informe seu nome.");
    if (!telefoneValido(telefone)) throw new ErroAgendamento("Telefone inválido — informe DDD + número.");
    if (!ehUuid(barbeiroId) || !/^\d{2}:\d{2}$/.test(hora)) throw new ErroAgendamento("Escolha barbeiro e horário.");

    const { ctx, barbeiro, horarios } = await horariosDisponiveis(servicos, data, barbeiroId);
    if (!horarios.includes(hora)) {
      return json({ erro: "Esse horário não está mais disponível. Escolha outro.", horarioIndisponivel: true }, 409);
    }

    const inicio = instanteSP(data, hora);
    try {
      await comoSistema(
        (tx) => tx`
          select public.criar_agendamento(
            p_cliente_nome => ${nome},
            p_cliente_telefone => ${telefone},
            p_barbeiro_id => ${barbeiro.id}::uuid,
            p_inicio => ${inicio.toISOString()}::timestamptz,
            p_servico_ids => ${ctx.servicos.map((s) => s.id)}::uuid[],
            p_origem => 'site')`
      );
    } catch (error) {
      // 23P01 = trava de sobreposição: outro cliente confirmou o mesmo horário antes.
      // 40P01 (deadlock) = mesma corrida; a fila por barbeiro no banco evita, isto é reserva.
      const codigo = codigoDeErro(error);
      if (codigo === "23P01" || codigo === "40P01") {
        return json({ erro: "Esse horário acabou de ser reservado. Escolha outro.", horarioIndisponivel: true }, 409);
      }
      const mensagem = MENSAGENS_BANCO[mensagemDeErro(error)];
      if (mensagem) return json({ erro: mensagem }, 400);
      throw error;
    }

    const fim = dataHoraSP(new Date(inicio.getTime() + ctx.duracaoTotal * 60_000));
    return json({
      agendamento: {
        nome,
        data,
        hora,
        horaFim: fim.hora,
        barbeiro: barbeiro.nome,
        servicos: ctx.servicos.map((s) => ({ nome: s.nome, preco: Number(s.preco), duracao: s.duracao_minutos })),
        duracaoTotal: ctx.duracaoTotal,
        valorTotal: ctx.valorTotal,
      },
    });
  } catch (erro) {
    return tratarErro(erro);
  }
}
