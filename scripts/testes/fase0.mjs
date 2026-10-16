// Teste da Fase 0 do barbearia-app contra o container em 127.0.0.1:3002 e o banco de dev (PostgreSQL próprio).
// Loga pela API (sem digitar senha em navegador), reaproveita a sessão como cookie nas
// páginas do painel e testa as regras de RLS. Cria e remove seus próprios dados de teste.
import { randomBytes } from "node:crypto";
// Banco próprio (decisão 47 — M5): cliente no estilo do Supabase em cima do Postgres.
import { BASE, env, service, createClient, sessao, adminDoTeste, encerrarTestes } from "./_banco.mjs";
const sessaoComCookies = sessao;
// Admin de dev (TESTE_ADMIN_EMAIL/TESTE_ADMIN_SENHA) ou um admin temporário.
const { email: ADMIN_EMAIL, senha: ADMIN_SENHA } = await adminDoTeste();

// Rodar da raiz do projeto, com o container de dev no ar. Variáveis:
//   TESTE_BASE_URL (padrão http://127.0.0.1:3002), TESTE_ADMIN_EMAIL (padrão admin de dev),
//   TESTE_ADMIN_SENHA (opcional — sem ela, o teste usa um admin temporário).


let falhas = 0;
function ok(cond, descricao, extra = "") {
  console.log(`${cond ? "PASSOU" : "FALHOU"}  ${descricao}${extra ? `  (${extra})` : ""}`);
  if (!cond) falhas++;
}



async function pagina(caminho, cookie) {
  const r = await fetch(BASE + caminho, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: r.status, destino: r.headers.get("location"), html: r.status === 200 ? await r.text() : "" };
}

function clienteAutenticado(sb) {
  return sb; // o server client já carrega a sessão
}

const TEL_TESTE = "11900000" + String(Date.now()).slice(-3);
let colabId = null;

try {
  // ---------- Admin ----------
  const admin = await sessaoComCookies(ADMIN_EMAIL, ADMIN_SENHA);
  for (const [caminho, texto] of [
    ["/painel", "Próximos atendimentos"], // Início (Fase 5)
    ["/painel/clientes", "Clientes"],
    ["/painel/configuracoes", "Barbeiros e usuários"],
    ["/painel/configuracoes/equipe", "Admin (dev)"],
    ["/painel/financeiro", "Financeiro"],
  ]) {
    const p = await pagina(caminho, admin.cookie);
    ok(p.status === 200 && p.html.includes(texto), `admin abre ${caminho}`, `status ${p.status}`);
  }
  const abasAdmin = await pagina("/painel", admin.cookie);
  ok(abasAdmin.html.includes("Configurações") && abasAdmin.html.includes("Financeiro"), "admin vê abas Financeiro e Configurações");
  ok(!/Tattoo|Tatuagem/i.test(abasAdmin.html), "nenhuma menção ao modelo de tatuagem no painel");
  const login = await pagina("/login", admin.cookie);
  ok(login.status === 307 && login.destino?.endsWith("/painel"), "logado em /login volta pro /painel");

  // ---------- Barbeiro de teste (criado como a action criarMembro faz) ----------
  const senhaColab = randomBytes(12).toString("base64url");
  const emailColab = `teste.fase0.${Date.now()}@example.com`;
  const { data: criado, error: errCriar } = await service.auth.admin.createUser({
    email: emailColab, password: senhaColab, email_confirm: true, user_metadata: { nome: "Barbeiro Teste" },
  });
  ok(!errCriar, "cria usuário barbeiro pela Admin API", errCriar?.message);
  colabId = criado.user.id;
  const { data: perfilColab } = await service.from("profiles").select("role").eq("id", colabId).single();
  ok(perfilColab?.role === "colaborador", "2º usuário nasce como colaborador (não admin)");

  const colab = await sessaoComCookies(emailColab, senhaColab);
  const abasColab = await pagina("/painel", colab.cookie);
  ok(abasColab.status === 200 && !abasColab.html.includes("Configurações") && !abasColab.html.includes("Financeiro"),
    "barbeiro NÃO vê abas Financeiro/Configurações");
  for (const caminho of ["/painel/configuracoes", "/painel/configuracoes/equipe", "/painel/financeiro"]) {
    const p = await pagina(caminho, colab.cookie);
    ok(p.status === 307 && p.destino?.endsWith("/painel"), `barbeiro barrado em ${caminho}`, `${p.status} -> ${p.destino}`);
  }

  // ---------- RLS ----------
  const sbColab = clienteAutenticado(colab.sb);
  const { data: promovido } = await sbColab.from("profiles").update({ role: "admin" }).eq("id", colabId).select();
  const { data: aposPromocao } = await service.from("profiles").select("role").eq("id", colabId).single();
  ok(aposPromocao.role === "colaborador", "barbeiro NÃO consegue se promover a admin", `linhas: ${promovido?.length ?? 0}`);

  const { error: errNome } = await sbColab.from("profiles").update({ nome: "Barbeiro Teste Editado" }).eq("id", colabId);
  const { data: aposNome } = await service.from("profiles").select("nome").eq("id", colabId).single();
  ok(!errNome && aposNome.nome === "Barbeiro Teste Editado", "barbeiro edita o próprio nome");

  const { error: errEst } = await sbColab.from("estabelecimento").update({ nome: "Hackeado" }).eq("id", 1).select();
  const { data: est } = await service.from("estabelecimento").select("nome").single();
  ok(est.nome !== "Hackeado", "barbeiro NÃO altera dados da barbearia", errEst?.message);

  const { error: errCli } = await sbColab.from("clientes").insert({ nome: "Cliente Teste", telefone: TEL_TESTE, criado_por: colabId });
  ok(!errCli, "barbeiro cadastra cliente", errCli?.message);
  const { error: errDup } = await sbColab.from("clientes").insert({ nome: "Duplicado", telefone: TEL_TESTE, criado_por: colabId });
  ok(errDup?.code === "23505", "telefone duplicado é barrado pelo banco", errDup?.code);
  const { error: errOutro } = await sbColab.from("clientes").insert({ nome: "Em nome de outro", telefone: "11911112222", criado_por: criado.user.id === colabId ? (await service.from("profiles").select("id").eq("email", ADMIN_EMAIL).single()).data.id : colabId });
  ok(!!errOutro, "barbeiro NÃO cadastra cliente em nome de outro usuário", errOutro?.code);
  const { error: errTelRuim } = await sbColab.from("clientes").insert({ nome: "Tel ruim", telefone: "(11) 9", criado_por: colabId });
  ok(!!errTelRuim, "telefone fora do formato é barrado pelo banco", errTelRuim?.code);
  const { error: errDel } = await sbColab.from("clientes").delete().eq("telefone", TEL_TESTE);
  const { count: aindaExiste } = await service.from("clientes").select("*", { count: "exact", head: true }).eq("telefone", TEL_TESTE);
  ok(aindaExiste === 1, "ninguém apaga cliente fisicamente", errDel?.message);

  const listaCli = await pagina("/painel/clientes", colab.cookie);
  ok(listaCli.html.includes("Cliente Teste"), "cliente aparece na lista do painel");

  // ---------- Público (anon) ----------
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: estAnon } = await anon.from("estabelecimento").select("nome");
  ok(estAnon?.length === 1, "visitante lê os dados públicos da barbearia");
  const { data: cliAnon } = await anon.from("clientes").select("id");
  ok((cliAnon ?? []).length === 0, "visitante NÃO lê clientes");
  const { data: profAnon } = await anon.from("profiles").select("id");
  ok((profAnon ?? []).length === 0, "visitante NÃO lê usuários");

  // ---------- Desativação encerra sessão aberta ----------
  await service.from("profiles").update({ ativo: false }).eq("id", colabId);
  const desativado = await pagina("/painel", colab.cookie);
  ok(desativado.status === 307 && desativado.destino?.endsWith("/sair"), "barbeiro desativado com sessão aberta vai pro /sair", `${desativado.status} -> ${desativado.destino}`);
  const sair = await pagina("/sair", colab.cookie);
  ok(sair.status === 307 && sair.destino === "/login", "/sair manda pro /login do MESMO endereço (relativo, nunca localhost:3000)", `${sair.status} -> ${sair.destino}`);
  const aposSair = await pagina("/painel", colab.cookie);
  ok(aposSair.status === 307, "depois de sair, painel não abre mais com a sessão antiga", `${aposSair.status} -> ${aposSair.destino}`);
} catch (e) {
  falhas++;
  console.log("ERRO no teste:", e.message);
} finally {
  // Limpeza: nada de teste fica no banco de dev.
  await service.from("clientes").delete().eq("telefone", TEL_TESTE);
  if (colabId) await service.auth.admin.deleteUser(colabId);
  const { count } = await service.from("profiles").select("*", { count: "exact", head: true });
  console.log(`\nLimpeza feita (profiles restantes: ${count}).`);
  console.log(falhas === 0 ? "RESULTADO: tudo passou." : `RESULTADO: ${falhas} falha(s).`);
}
await encerrarTestes();
