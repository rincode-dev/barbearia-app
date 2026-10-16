import { Marca } from "@/components/marca";
import { getEstabelecimento } from "@/lib/estabelecimento";
import { FormularioLogin } from "./formulario-login";

export default async function LoginPage() {
  const { nome, logoUrl } = await getEstabelecimento();
  return <FormularioLogin marca={<Marca nome={nome} logoUrl={logoUrl} tamanho="lg" />} />;
}
