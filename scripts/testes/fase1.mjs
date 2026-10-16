// Teste da Fase 1 (cadastros) do barbearia-app: container em 127.0.0.1:3002 + banco de dev (PostgreSQL próprio).
// Cria e remove seus próprios dados; restaura o que alterar.
import { rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
// Banco próprio (decisão 47 — M5): cliente no estilo do Supabase em cima do Postgres.
import { BASE, service, anon, sessao, adminDoTeste, encerrarTestes } from "./_banco.mjs";
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

// PNG 1x1 válido
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const criados = { servicos: [], colab: null, arquivos: [], bloqueios: [] };
const { data: estOriginal } = await service.from("estabelecimento").select("*").single();
const { data: horariosOriginais } = await service.from("horarios_funcionamento").select("dia_semana, inicio, fim");

// O admin atende durante o teste (os dados de exemplo — scripts/dados-exemplo.mjs — podem
// deixá-lo como "não atende"); a configuração original volta no final.
const { data: atendeAdmin } = await service.from("profiles").select("id, atende_como_barbeiro").eq("email", ADMIN_EMAIL).single();
await service.from("profiles").update({ atende_como_barbeiro: true }).eq("id", atendeAdmin.id);

try {
  const admin = await sessao(ADMIN_EMAIL, ADMIN_SENHA);
  const { data: adminProfile } = await service.from("profiles").select("id").eq("email", ADMIN_EMAIL).single();

  // ---------- Páginas ----------
  for (const [caminho, texto] of [
    ["/painel/configuracoes", "Dados da barbearia"],
    ["/painel/configuracoes/barbearia", "Sobre a barbearia"],
    ["/painel/configuracoes/horarios", "Funcionamento da barbearia"],
    ["/painel/configuracoes/servicos", "Novo serviço"],
    [`/painel/configuracoes/equipe/${adminProfile.id}`, "Jornada semanal"],
  ]) {
    const p = await pagina(caminho, admin.cookie);
    ok(p.status === 200 && p.html.includes(texto), `admin abre ${caminho}`, `status ${p.status}`);
  }

  // ---------- Horário de funcionamento (RPC atômica) ----------
  const semana = [1, 2, 3, 4, 5].flatMap((d) => [
    { dia_semana: d, inicio: "09:00", fim: "12:00" },
    { dia_semana: d, inicio: "13:00", fim: "19:00" },
  ]).concat([{ dia_semana: 6, inicio: "08:00", fim: "14:00" }]);
  const r1 = await admin.sb.rpc("substituir_horarios_funcionamento", { p_faixas: semana });
  const { count: nFaixas } = await service.from("horarios_funcionamento").select("*", { count: "exact", head: true });
  ok(!r1.error && nFaixas === 11, "admin salva semana com intervalo de almoço", r1.error?.message ?? `${nFaixas} faixas`);

  const r2 = await admin.sb.rpc("substituir_horarios_funcionamento", {
    p_faixas: [{ dia_semana: 1, inicio: "09:00", fim: "12:00" }, { dia_semana: 1, inicio: "11:00", fim: "14:00" }],
  });
  const { count: nAposSobreposicao } = await service.from("horarios_funcionamento").select("*", { count: "exact", head: true });
  ok(!!r2.error && nAposSobreposicao === 11, "faixas sobrepostas são recusadas e nada é perdido", r2.error?.message);

  const r3 = await admin.sb.rpc("substituir_horarios_funcionamento", { p_faixas: [{ dia_semana: 2, inicio: "18:00", fim: "09:00" }] });
  ok(!!r3.error, "faixa com fim antes do início é recusada", r3.error?.message);

  const { data: horAnon } = await anon.from("horarios_funcionamento").select("dia_semana");
  ok((horAnon ?? []).length === 11, "visitante lê o horário de funcionamento (site)");

  // ---------- Barbeiro de teste ----------
  const senhaColab = randomBytes(12).toString("base64url");
  const emailColab = `teste.fase1.${Date.now()}@example.com`;
  const { data: novo } = await service.auth.admin.createUser({
    email: emailColab, password: senhaColab, email_confirm: true, user_metadata: { nome: "Barbeiro Fase1" },
  });
  criados.colab = novo.user.id;
  const colab = await sessao(emailColab, senhaColab);

  const r4 = await colab.sb.rpc("substituir_horarios_funcionamento", { p_faixas: [] });
  const { count: nAposColab } = await service.from("horarios_funcionamento").select("*", { count: "exact", head: true });
  ok(!!r4.error && nAposColab === 11, "barbeiro NÃO altera o funcionamento", r4.error?.message);
  const pColab = await pagina("/painel/configuracoes/servicos", colab.cookie);
  ok(pColab.status === 307, "barbeiro NÃO abre Serviços", `${pColab.status}`);

  // ---------- Serviços ----------
  const nomeServ = `Corte Teste ${Date.now()}`;
  const { data: serv, error: errServ } = await admin.sb
    .from("servicos").insert({ nome: nomeServ, preco: 40, duracao_minutos: 30 }).select("id").single();
  ok(!errServ, "admin cria serviço", errServ?.message);
  criados.servicos.push(serv.id);
  const { error: errDupServ } = await admin.sb.from("servicos").insert({ nome: nomeServ, preco: 10, duracao_minutos: 10 });
  ok(errDupServ?.code === "23505", "nome de serviço duplicado é barrado", errDupServ?.code);
  const { error: errServColab } = await colab.sb.from("servicos").insert({ nome: "Invasor", preco: 1, duracao_minutos: 10 });
  ok(!!errServColab, "barbeiro NÃO cria serviço", errServColab?.code);
  const { error: errPrecoNeg } = await admin.sb.from("servicos").insert({ nome: "Negativo", preco: -1, duracao_minutos: 10 });
  ok(!!errPrecoNeg, "preço negativo é barrado pelo banco", errPrecoNeg?.code);

  const { data: servInativo } = await admin.sb
    .from("servicos").insert({ nome: `Inativo ${Date.now()}`, preco: 15, duracao_minutos: 15, ativo: false }).select("id").single();
  criados.servicos.push(servInativo.id);
  const { data: servAnon } = await anon.from("servicos").select("id");
  const idsAnon = (servAnon ?? []).map((s) => s.id);
  ok(idsAnon.includes(serv.id) && !idsAnon.includes(servInativo.id), "visitante vê só serviços ativos");

  // ---------- Serviços por barbeiro ----------
  const rTodos = await admin.sb.rpc("atribuir_servico_a_todos", { p_servico_id: serv.id });
  const { data: quem } = await service.from("barbeiro_servicos").select("profile_id").eq("servico_id", serv.id);
  const quemIds = (quem ?? []).map((q) => q.profile_id);
  ok(!rTodos.error && quemIds.includes(adminProfile.id) && quemIds.includes(criados.colab),
    "\"todos os barbeiros realizam\" atribui a quem atende", rTodos.error?.message ?? `${quemIds.length} barbeiros`);
  const rDef = await admin.sb.rpc("definir_servicos_barbeiro", { p_profile_id: criados.colab, p_servico_ids: [] });
  const { count: nColab } = await service.from("barbeiro_servicos").select("*", { count: "exact", head: true }).eq("profile_id", criados.colab);
  ok(!rDef.error && nColab === 0, "admin redefine os serviços de um barbeiro");
  const rDefColab = await colab.sb.rpc("definir_servicos_barbeiro", { p_profile_id: criados.colab, p_servico_ids: [serv.id] });
  ok(!!rDefColab.error, "barbeiro NÃO define os próprios serviços", rDefColab.error?.message);

  // ---------- Jornada ----------
  const rJ = await admin.sb.rpc("substituir_jornada", {
    p_profile_id: criados.colab,
    p_faixas: [{ dia_semana: 1, inicio: "13:00", fim: "21:00" }, { dia_semana: 2, inicio: "13:00", fim: "21:00" }],
  });
  const { count: nJ } = await service.from("jornadas").select("*", { count: "exact", head: true }).eq("profile_id", criados.colab);
  ok(!rJ.error && nJ === 2, "admin salva jornada do barbeiro", rJ.error?.message);
  const rJ2 = await admin.sb.rpc("substituir_jornada", {
    p_profile_id: criados.colab,
    p_faixas: [{ dia_semana: 1, inicio: "09:00", fim: "13:00" }, { dia_semana: 1, inicio: "09:00", fim: "13:00" }],
  });
  const { count: nJ2 } = await service.from("jornadas").select("*", { count: "exact", head: true }).eq("profile_id", criados.colab);
  ok(!!rJ2.error && nJ2 === 2, "faixa repetida na jornada é recusada e a anterior fica intacta", rJ2.error?.message);

  // ---------- Bloqueios ----------
  const inicioNatal = "2026-12-25T03:00:00.000Z"; // 25/12 00:00 em SP
  const fimNatal = "2026-12-26T03:00:00.000Z";
  const { data: feriado, error: errFer } = await admin.sb.from("bloqueios")
    .insert({ tipo: "feriado", inicio: inicioNatal, fim: fimNatal, motivo: "Natal teste", criado_por: adminProfile.id })
    .select("id").single();
  ok(!errFer, "admin cadastra feriado da barbearia", errFer?.message);
  if (feriado) criados.bloqueios.push(feriado.id);
  const pHor = await pagina("/painel/configuracoes/horarios", admin.cookie);
  ok(pHor.html.includes("25/12/2026 (dia inteiro)") && pHor.html.includes("Natal teste"),
    "feriado aparece como \"25/12/2026 (dia inteiro)\" no fuso da barbearia");

  const { error: errIncoerente } = await admin.sb.from("bloqueios")
    .insert({ tipo: "feriado", profile_id: criados.colab, inicio: inicioNatal, fim: fimNatal, criado_por: adminProfile.id });
  ok(!!errIncoerente, "feriado não pode ser de um barbeiro só (coerência tipo × barbeiro)", errIncoerente?.code);
  const { data: folga, error: errFolga } = await admin.sb.from("bloqueios")
    .insert({ tipo: "bloqueio", profile_id: criados.colab, inicio: "2026-12-28T17:00:00.000Z", fim: "2026-12-28T19:00:00.000Z", criado_por: adminProfile.id })
    .select("id").single();
  ok(!errFolga, "admin cadastra bloqueio de horário do barbeiro", errFolga?.message);
  if (folga) criados.bloqueios.push(folga.id);
  const pBarb = await pagina(`/painel/configuracoes/equipe/${criados.colab}`, admin.cookie);
  ok(pBarb.html.includes("28/12/2026 14:00–16:00"), "bloqueio parcial aparece como \"28/12/2026 14:00–16:00\"");
  const { error: errBlqColab } = await colab.sb.from("bloqueios")
    .insert({ tipo: "folga", profile_id: criados.colab, inicio: inicioNatal, fim: fimNatal, criado_por: criados.colab });
  ok(!!errBlqColab, "barbeiro NÃO cadastra bloqueio", errBlqColab?.code);
  const { data: blqAnon } = await anon.from("bloqueios").select("id");
  ok((blqAnon ?? []).length === 0, "visitante NÃO lê bloqueios (motivos são internos)");

  // ---------- Fotos (pasta pública do app — decisão 47, M3) ----------
  const enviar = async (cookie, conteudo, tipo = "image/png", nome = "logo.png") => {
    const corpo = new FormData();
    corpo.append("pasta", "logo");
    corpo.append("arquivo", new Blob([conteudo], { type: tipo }), nome);
    const r = await fetch(`${BASE}/api/arquivos`, { method: "POST", body: corpo, headers: cookie ? { cookie } : {} });
    return { status: r.status, corpo: await r.json().catch(() => ({})) };
  };
  const up = await enviar(admin.cookie, PNG);
  ok(up.status === 200 && up.corpo.path, "admin envia imagem para a pasta pública", `${up.status} ${up.corpo.erro ?? ""}`);
  const pathLogo = up.corpo.path;
  if (pathLogo) criados.arquivos.push(pathLogo);
  const rPub = await fetch(`${BASE}/arquivos/publico/${pathLogo}`);
  ok(rPub.status === 200, "imagem abre pela URL pública, sem login", `${rPub.status}`);
  const upColab = await enviar(colab.cookie, PNG);
  ok(upColab.status === 403, "barbeiro NÃO envia imagem", String(upColab.status));
  const upAnon = await enviar(null, PNG);
  ok(upAnon.status === 401, "visitante NÃO envia imagem", String(upAnon.status));
  const upPdf = await enviar(admin.cookie, Buffer.from("%PDF-1.4"), "application/pdf", "x.pdf");
  ok(upPdf.status === 415, "recusa arquivo que não é imagem", String(upPdf.status));

  // Marca do cadastro aparece no site
  await admin.sb.from("estabelecimento").update({ nome: "Barbearia Teste Fase1", logo_path: pathLogo }).eq("id", 1);
  const site = await pagina("/");
  ok(site.html.includes("<title>Barbearia Teste Fase1</title>") && site.html.includes(pathLogo),
    "site mostra nome e logo cadastrados");
  const manif = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  ok(manif.icons?.[0]?.src?.includes(pathLogo), "app instalado usa o logo como ícone");
} catch (e) {
  falhas++;
  console.log("ERRO no teste:", e.message);
} finally {
  await service.from("profiles").update({ atende_como_barbeiro: atendeAdmin.atende_como_barbeiro }).eq("id", atendeAdmin.id);
  await service.from("estabelecimento").update({
    nome: estOriginal.nome, logo_path: estOriginal.logo_path,
  }).eq("id", 1);
  await service.from("horarios_funcionamento").delete().not("id", "is", null);
  if (horariosOriginais?.length) await service.from("horarios_funcionamento").insert(horariosOriginais);
  if (criados.bloqueios.length) await service.from("bloqueios").delete().in("id", criados.bloqueios);
  if (criados.servicos.length) await service.from("servicos").delete().in("id", criados.servicos);
  for (const p of criados.arquivos) rmSync(`dados/arquivos/publico/${p}`, { force: true });
  if (criados.colab) await service.auth.admin.deleteUser(criados.colab);
  const { count: p } = await service.from("profiles").select("*", { count: "exact", head: true });
  const { count: s } = await service.from("servicos").select("*", { count: "exact", head: true });
  const { count: h } = await service.from("horarios_funcionamento").select("*", { count: "exact", head: true });
  console.log(`\nLimpeza feita (profiles: ${p}, servicos: ${s}, faixas de funcionamento: ${h}).`);
  console.log(falhas === 0 ? "RESULTADO: tudo passou." : `RESULTADO: ${falhas} falha(s).`);
}
await encerrarTestes();
