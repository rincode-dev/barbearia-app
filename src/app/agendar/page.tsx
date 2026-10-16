import { redirect } from "next/navigation";

// O agendamento passou a acontecer na própria página inicial (decisão 41). Este endereço
// continua existindo para links antigos (/agendar e /agendar?servico=id) e só redireciona.
export default async function AgendarPage({ searchParams }: { searchParams: Promise<{ servico?: string }> }) {
  const { servico } = await searchParams;
  redirect(servico ? `/?servico=${encodeURIComponent(servico)}#servicos` : "/#servicos");
}
