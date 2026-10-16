import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { comoUsuario, mensagemDeErro } from "@/lib/db";
import { getEstabelecimento } from "@/lib/estabelecimento";
import { TIPOS_MENSAGEM, VARIAVEIS, type VariaveisMensagem } from "@/lib/mensagens/preencher";
import { urlDoSite } from "@/lib/mensagens/servidor";
import { FormularioMensagem } from "./formulario";

// Textos de WhatsApp (requisitos do produto, itens 24 e 25): 6 tipos fixos, só o texto muda.
export default async function MensagensPage() {
  const { userId } = await requireAdmin();
  type Template = { tipo: string; conteudo: string; conteudo_padrao: string };
  let templates: Template[] = [];
  let error: { message: string } | null = null;
  try {
    templates = [
      ...(await comoUsuario(
        userId,
        (tx) => tx<Template[]>`select tipo, conteudo, conteudo_padrao from public.mensagens_templates`
      )),
    ];
  } catch (e) {
    error = { message: mensagemDeErro(e) };
  }
  const [barbearia, site] = await Promise.all([getEstabelecimento(), urlDoSite()]);
  const porTipo = new Map(templates.map((t) => [t.tipo, t]));

  // Prévia com dados reais da barbearia e um cliente/horário de exemplo.
  const exemplo: VariaveisMensagem = {
    ...Object.fromEntries(VARIAVEIS.map((v) => [v.chave, v.exemplo])),
    barbearia: barbearia.nome,
    endereco: barbearia.endereco ?? "",
    site,
  };
  const semDado = barbearia.endereco ? [] : [{ chave: "endereco", onde: "Dados da barbearia" }];

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-3 py-6 sm:px-4 sm:py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Mensagens</h1>
        <Link href="/painel/configuracoes" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Configurações
        </Link>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-surface p-4 text-sm text-neutral-600 shadow-lg shadow-black/20 sm:p-5">
        <p>
          Os botões de WhatsApp da agenda e da OS abrem o WhatsApp com estes textos já preenchidos — é só conferir e
          enviar. Use as variáveis abaixo (com as chaves) para inserir os dados do agendamento:
        </p>
        <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
          {VARIAVEIS.map((v) => (
            <li key={v.chave}>
              <code className="text-neutral-900">{`{${v.chave}}`}</code> — {v.descricao}
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="text-sm text-red-400">Não foi possível carregar as mensagens: {error.message}</p>}

      {TIPOS_MENSAGEM.map((t) => {
        const linha = porTipo.get(t.tipo);
        if (!linha) return null;
        return (
          <FormularioMensagem
            key={t.tipo}
            tipo={t.tipo}
            rotulo={t.rotulo}
            quando={t.quando}
            conteudo={linha.conteudo}
            padrao={linha.conteudo_padrao}
            exemplo={exemplo}
            semDado={semDado}
          />
        );
      })}
    </main>
  );
}
