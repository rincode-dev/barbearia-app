// Dados de EXEMPLO para testar o app no navegador (ambiente de desenvolvimento).
// Rodar da raiz do projeto:
//   node scripts/dados-exemplo.mjs                 → cria (barbearia, horários, serviços,
//                                                     2 barbeiros com jornada, 3 agendamentos)
//   node scripts/dados-exemplo.mjs --remover       → apaga o que este script criou
// Variável opcional: EXEMPLO_CRED_ARQUIVO = arquivo onde anotar as senhas dos barbeiros de
// exemplo (nunca no repositório).
//
// NUNCA rodar no banco de um cliente de verdade — só no de desenvolvimento.
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
// Banco próprio (decisão 47): o mesmo cliente dos testes, com o papel service_role.
import { service as db, encerrarTestes } from "./testes/_banco.mjs";

const DOMINIO = "exemplo.barbearia.test"; // marca os usuários criados por este script
const BARBEIROS = [
  { nome: "Rafael", email: `rafael@${DOMINIO}`, jornada: { 2: [["09:00", "18:00"]], 3: [["09:00", "18:00"]], 4: [["09:00", "18:00"]], 5: [["09:00", "18:00"]], 6: [["08:00", "16:00"]] } },
  { nome: "João", email: `joao@${DOMINIO}`, jornada: { 2: [["13:00", "20:00"]], 3: [["13:00", "20:00"]], 4: [["13:00", "20:00"]], 5: [["13:00", "20:00"]], 6: [["08:00", "14:00"]] } },
];
const SERVICOS = [
  { nome: "Corte", descricao: "Corte na tesoura ou máquina, com lavagem.", preco: 45, duracao_minutos: 30, ordem: 1 },
  { nome: "Barba", descricao: "Barba com toalha quente e navalha.", preco: 35, duracao_minutos: 30, ordem: 2 },
  { nome: "Corte + Barba", descricao: "O combo completo.", preco: 70, duracao_minutos: 60, ordem: 3 },
  { nome: "Sobrancelha", descricao: null, preco: 15, duracao_minutos: 15, ordem: 4 },
  { nome: "Pezinho", descricao: "Acabamento do contorno.", preco: 15, duracao_minutos: 15, ordem: 5 },
  { nome: "Platinado", descricao: "Descoloração completa. Consulte antes pelo WhatsApp.", preco: 150, duracao_minutos: 120, ordem: 6 },
];
const SO_RAFAEL = ["Platinado"];
const CLIENTES = [
  { nome: "Carlos Exemplo", telefone: "11900000001" },
  { nome: "Pedro Exemplo", telefone: "11900000002" },
  { nome: "Lucas Exemplo", telefone: "11900000003" },
];

function hojeSP() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function somarDias(data, n) {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
const diaSemana = (data) => new Date(`${data}T12:00:00Z`).getUTCDay();
const instante = (data, hora) => new Date(`${data}T${hora}:00-03:00`).toISOString();

async function remover() {
  const { data: clis } = await db.from("clientes").select("id").in("telefone", CLIENTES.map((c) => c.telefone));
  const ids = (clis ?? []).map((c) => c.id);
  if (ids.length) {
    await db.from("ordens_servico").delete().in("cliente_id", ids);
    await db.from("agendamentos").delete().in("cliente_id", ids);
    await db.from("clientes").delete().in("id", ids);
  }
  const { data: usuarios } = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const u of usuarios.users.filter((u) => u.email?.endsWith(`@${DOMINIO}`))) {
    // Agendamentos que outras pessoas criaram testando com esses barbeiros também saem.
    const { data: ags } = await db.from("agendamentos").select("id").eq("barbeiro_id", u.id);
    const agIds = (ags ?? []).map((a) => a.id);
    if (agIds.length) {
      await db.from("ordens_servico").delete().in("agendamento_id", agIds);
      await db.from("agendamentos").delete().in("id", agIds);
    }
    await db.from("bloqueios").delete().eq("profile_id", u.id);
    await db.auth.admin.deleteUser(u.id);
  }
  const nomes = SERVICOS.map((s) => s.nome);
  const { data: servs } = await db.from("servicos").select("id").in("nome", nomes);
  for (const s of servs ?? []) {
    // Serviço já usado em agendamento/OS de outra pessoa não é apagado: só desativado.
    const { error } = await db.from("servicos").delete().eq("id", s.id);
    if (error) await db.from("servicos").update({ ativo: false }).eq("id", s.id);
  }
  await db.from("horarios_funcionamento").delete().not("id", "is", null);
  await db.from("estabelecimento").update({
    nome: "Minha Barbearia", descricao: null, endereco: null, politica_cancelamento: null,
  }).eq("id", 1);
  const { data: admin } = await db.from("profiles").select("id").eq("role", "admin").order("created_at").limit(1).single();
  if (admin) await db.from("profiles").update({ atende_como_barbeiro: true }).eq("id", admin.id);
  console.log("Dados de exemplo removidos.");
}

async function criar() {
  const { data: jaTem } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (jaTem.users.some((u) => u.email?.endsWith(`@${DOMINIO}`))) {
    console.log("Já existem dados de exemplo. Rode com --remover antes de criar de novo.");
    process.exit(1);
  }

  await db.from("estabelecimento").update({
    nome: "Barbearia Exemplo",
    descricao: "Corte, barba e cuidado masculino. Agende online em menos de um minuto.",
    endereco: "Av. Paulista, 1000 - Bela Vista, São Paulo - SP",
    antecedencia_minima_minutos: 60,
    janela_agendamento_dias: 30,
    granularidade_minutos: 15,
    politica_cancelamento: "Precisa desmarcar? Avise com pelo menos 2 horas de antecedência.",
  }).eq("id", 1);

  // Terça a sexta 09–12 e 13–20 (almoço); sábado 08–16; domingo e segunda fechado.
  await db.from("horarios_funcionamento").delete().not("id", "is", null);
  await db.from("horarios_funcionamento").insert([
    ...[2, 3, 4, 5].flatMap((d) => [
      { dia_semana: d, inicio: "09:00", fim: "12:00" },
      { dia_semana: d, inicio: "13:00", fim: "20:00" },
    ]),
    { dia_semana: 6, inicio: "08:00", fim: "16:00" },
  ]);

  const { data: servicos, error: errServ } = await db.from("servicos").insert(SERVICOS).select("id, nome");
  if (errServ) throw new Error(`serviços: ${errServ.message} (já existe serviço com esse nome? rode --remover)`);

  // O admin fica como "não atende" (gerência): o site mostra só os barbeiros.
  const { data: admin } = await db.from("profiles").select("id").eq("role", "admin").order("created_at").limit(1).single();
  await db.from("profiles").update({ atende_como_barbeiro: false }).eq("id", admin.id);

  const credenciais = [];
  const ids = {};
  for (const b of BARBEIROS) {
    const senha = randomBytes(9).toString("base64url");
    const { data, error } = await db.auth.admin.createUser({ email: b.email, password: senha, email_confirm: true, user_metadata: { nome: b.nome } });
    if (error) throw new Error(`${b.email}: ${error.message}`);
    ids[b.nome] = data.user.id;
    credenciais.push(`${b.nome}: ${b.email} / ${senha}`);
    await db.from("jornadas").insert(
      Object.entries(b.jornada).flatMap(([dia, faixas]) => faixas.map(([inicio, fim]) => ({ profile_id: data.user.id, dia_semana: Number(dia), inicio, fim })))
    );
    await db.from("barbeiro_servicos").insert(
      servicos.filter((s) => b.nome === "Rafael" || !SO_RAFAEL.includes(s.nome)).map((s) => ({ profile_id: data.user.id, servico_id: s.id }))
    );
  }

  // 3 agendamentos nos próximos dias úteis (terça a sábado), pra agenda não nascer vazia.
  const idServ = (nome) => servicos.find((s) => s.nome === nome).id;
  const proximosDias = [];
  for (let d = 1; proximosDias.length < 2 && d < 10; d++) {
    const data = somarDias(hojeSP(), d);
    if ([2, 3, 4, 5, 6].includes(diaSemana(data))) proximosDias.push(data);
  }
  const agendar = [
    { cliente: CLIENTES[0], barbeiro: "Rafael", data: proximosDias[0], hora: "10:00", servicos: ["Corte"] },
    { cliente: CLIENTES[1], barbeiro: "João", data: proximosDias[0], hora: "14:00", servicos: ["Corte + Barba"] },
    { cliente: CLIENTES[2], barbeiro: "Rafael", data: proximosDias[1], hora: "09:00", servicos: ["Barba", "Sobrancelha"] },
  ];
  for (const a of agendar) {
    const { error } = await db.rpc("criar_agendamento", {
      p_cliente_nome: a.cliente.nome, p_cliente_telefone: a.cliente.telefone, p_barbeiro_id: ids[a.barbeiro],
      p_inicio: instante(a.data, a.hora), p_servico_ids: a.servicos.map(idServ), p_origem: "site",
    });
    if (error) throw new Error(`agendamento ${a.cliente.nome}: ${error.message}`);
  }

  if (process.env.EXEMPLO_CRED_ARQUIVO) {
    appendFileSync(process.env.EXEMPLO_CRED_ARQUIVO, `\n\nbarbeiros de EXEMPLO (banco de dev da barbearia):\n${credenciais.join("\n")}\n`);
    console.log(`Senhas dos barbeiros anotadas em ${process.env.EXEMPLO_CRED_ARQUIVO}`);
  }
  console.log(`Criado: "Barbearia Exemplo", horários ter–sáb, ${servicos.length} serviços, 2 barbeiros (Rafael, João), 3 agendamentos (${proximosDias.join(", ")}).`);
}

await (process.argv.includes("--remover") ? remover() : criar());
await encerrarTestes();
