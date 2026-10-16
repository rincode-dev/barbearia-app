import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { getEstabelecimento } from "@/lib/estabelecimento";
import { FormularioBarbearia } from "./formulario";

export default async function DadosBarbeariaPage() {
  await requireAdmin();
  const b = await getEstabelecimento();

  return (
    <main className="mx-auto max-w-3xl px-3 py-6 sm:px-4 sm:py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Dados da barbearia</h1>
        <Link href="/painel/configuracoes" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Configurações
        </Link>
      </div>
      <FormularioBarbearia
        dados={{
          nome: b.nome,
          descricao: b.descricao,
          logoUrl: b.logoUrl,
          endereco: b.endereco,
          telefone: b.telefone,
          whatsapp: b.whatsapp,
          instagram: b.instagram,
          mapaUrl: b.mapaUrl,
        }}
      />
    </main>
  );
}
