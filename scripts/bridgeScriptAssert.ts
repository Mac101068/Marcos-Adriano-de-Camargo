// Regressão do script da ponte que a tela baixa: `npx tsx scripts/bridgeScriptAssert.ts`.
// O pythonScriptGenerator é um template de string gigante, então TypeScript válido não quer dizer
// Python válido: um merge ou uma edição mal costurada produz um script que o usuário baixa e a
// corretora recusa na primeira linha. Este assert regera o script, confere as travas que definem
// o modo de execução e valida a sintaxe com o interpretador Python sem gravar arquivos auxiliares.
import { spawnSync } from 'node:child_process';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
(globalThis as any).window = globalThis;
(globalThis as any).document = { createElement: () => ({ style: {}, click: () => {} }) };

const { generatePythonMT5Script } = await import('../src/utils/pythonScriptGenerator');
const { DEFAULT_EA_CONFIG } = await import('../src/services/eaConfigService');

const py = generatePythonMT5Script(DEFAULT_EA_CONFIG);
const falhas: string[] = [];

/** Alguma linha do script contém `texto` (compara ignorando espaços, por causa do template). */
const tem = (texto: string) => py.split('\n').some((l) => l.replace(/\s+/g, ' ').includes(texto));

// Prova de que este assert sabe falhar: um assert que nunca retornou erro não é prova de nada.
// Se a busca abaixo ACHAR o que não existe no template, é o `tem()` que está errado (e aí todos
// os checks seguintes viram decoração).
if (tem('CADEIA_QUE_NAO_EXISTE_NO_TEMPLATE_9c1f')) {
  falhas.push('a busca tem() está sempre verdadeira — o assert não detecta ausência de nada');
}
// E o contrário também: uma cadeia que SABEMOS estar lá tem que ser achada, senão o falso
// negativo assusta a cada merge e ninguém mais confia na saída.
if (!tem('def ordens_bloqueadas')) {
  falhas.push('a busca tem() não acha uma cadeia que está no template — comparação quebrada');
}

// O app é o único executor de estratégia; o loop de feed Python não pode abrir/gerir a mesma
// posição em paralelo. A ponte continua aceitando comandos autenticados do app.
const streamStart = py.indexOf('async def mt5_stream_loop():');
const streamEnd = py.indexOf('\nasync def main():', streamStart);
const streamLoop = streamStart >= 0 && streamEnd > streamStart ? py.slice(streamStart, streamEnd) : '';
if (!streamLoop) falhas.push('loop de ticks Python não encontrado para verificar a origem única de execução');
for (const duplicatePath of [
  'ORDER_MANAGER.execute_market_order(',
  'ORDER_MANAGER.execute_pyramid_confluence(',
  'ORDER_MANAGER.place_pullback_limit_order(',
  'ORDER_MANAGER.watch_closed_pyramids(',
]) {
  if (streamLoop.includes(duplicatePath)) {
    falhas.push(`loop Python ainda possui caminho de execução duplicado: ${duplicatePath}`);
  }
}
if (!tem('requested_symbol != SYMBOL')) {
  falhas.push('a ponte não exige correspondência exata entre símbolo do comando e símbolo configurado');
}
if (!tem('ORDER_MANAGER.check_and_clean_expired_pending(new_box["index"])')) {
  falhas.push('a ponte deixou de cancelar ordens LIMIT aceitas pelo app quando expiram');
}
if (!tem('"magic": p.get("magic", self.magic_number)')) {
  falhas.push('expiração de ordem LIMIT não preserva o magic que a criou');
}
const scopedPositionChecks = py.split('\n').filter((line) => line.includes('pos.symbol != self.symbol or pos.magic != expected_magic')).length;
if (scopedPositionChecks < 2) {
  falhas.push('parcial e alteração de stop não estão ambas isoladas por símbolo e magic');
}
if (!tem('if magic_filter is not None and pos.magic != magic_filter:')) {
  falhas.push('zeragem por robô não filtra posições pelo magic');
}

// 1. Trava de execução nas duas camadas, com a verdade única que o app consulta.
for (const [nome, busca] of [
  ['trava de ambiente', 'ORDERS_BLOCKED = os.environ.get('],
  ['modo replay acionável', 'REPLAY_MODE = False'],
  ['verdade única', 'def ordens_bloqueadas():'],
  ['rota do app', '"SET_REPLAY_MODE"'],
  ['broadcast p/ todas as telas', '"REPLAY_MODE_RESULT"'],
  ['procedência no ACCOUNT_INFO', '"ordersBlocked"'],
] as const) {
  if (!tem(busca)) falhas.push(`trava ausente no script gerado: ${nome} (${busca})`);
}

// 2. A trava segura ENTRADA e NUNCA saída. Um bloqueio amplo mata o botão de emergência e a
//    zeragem parcial — já foi bug real aqui, então isso fica como contrato, não como lembrança.
if (!tem('if action in ENTRY_ACTIONS and ordens_bloqueadas():')) {
  falhas.push('a guarda da trava não está restrita a ENTRY_ACTIONS (risco de bloquear saída/zeragem)');
}
for (const saida of ['CLOSE_POSITIONS', 'ORDER_PARTIAL_CLOSE', 'ORDER_MODIFY_SL']) {
  if (tem(`if action == "${saida}" and ordens_bloqueadas()`)) {
    falhas.push(`a trava bloqueia uma SAIDA (${saida}) -- isso é invariante quebrado`);
  }
}

// 3. ORDER_RESULT: quando o MT5 não executa, o motivo tem que voltar para a tela.
for (const [nome, busca] of [
  ['nota de execução', 'ORDER_EXEC_NOTE = {"msg": ""}'],
  ['devolução do motivo', '"type": "ORDER_RESULT"'],
] as const) {
  if (!tem(busca)) falhas.push(`procedência de ordem ausente no script gerado: ${nome}`);
}

// 4. Valide a sintaxe sem criar arquivos de scratch (o compile() do Python não executa o script
//    nem grava bytecode). Interpretador ausente é falha: nunca imprima um verde não verificado.
const candidatos = process.env.PYTHON
  ? [process.env.PYTHON] // escolhido na cara: se não existir, é falha; não se troca em silêncio
  : ['python3', 'python'];

let compilou = '';
const tentativas: string[] = [];
for (const candidato of candidatos) {
  const r = spawnSync(
    candidato,
    ['-c', "import sys; compile(sys.stdin.read(), '<generated-mt5-bridge>', 'exec')"],
    { encoding: 'utf8', input: py },
  );
  if (r.error) {
    // Só "não consegui nem começar" leva ao próximo candidato.
    const erro = r.error as NodeJS.ErrnoException;
    tentativas.push(`${candidato}: ${erro.code === 'ENOENT' ? 'não existe' : erro.message}`);
    continue;
  }
  if (r.status === 0) {
    compilou = candidato;
    break;
  }
  // Compilou e RECUSOU: isso é veredito sobre o template, não problema de ambiente.
  falhas.push(`Python recusou a sintaxe do script gerado (${candidato}):\n${r.stderr}`);
  break;
}

if (!compilou && !falhas.length) {
  falhas.push(
    `nenhum Python executável para validar a sintaxe — o script que o usuário baixou NÃO foi validado.\n` +
      `  tente com PYTHON=/caminho/do/python (ou rode do venv do projeto). Tentativas: ${tentativas.join(' | ') || candidatos.join(' | ')}`,
  );
}

const quemChecou = compilou
  ? (() => {
      const v = spawnSync(
        compilou,
        ['-c', 'import sys;print(".".join(map(str, sys.version_info[:3])))'],
        { encoding: 'utf8' },
      );
      return v.status === 0 && v.stdout.trim() ? `${compilou} (Python ${v.stdout.trim()})` : compilou;
    })()
  : '';

console.log(`script gerado: ${py.length} chars, ${py.split('\n').length} linhas`);
if (falhas.length) {
  for (const f of falhas) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(
  `TUDO VERDE: trava nos dois níveis, saídas liberadas, ordem única no app, símbolo validado, ` +
    `Python compile() aceitou o script — checado por ${quemChecou}.`,
);
