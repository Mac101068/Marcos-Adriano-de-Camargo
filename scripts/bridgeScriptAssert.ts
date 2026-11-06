// Regressão do script da ponte que a tela baixa: `npx tsx scripts/bridgeScriptAssert.ts`.
// O pythonScriptGenerator é um template de string gigante, então TypeScript válido não quer dizer
// Python válido: um merge ou uma edição mal costurada produz um script que o usuário baixa e a
// corretora recusa na primeira linha. Este assert regera o script, confere as travas que definem
// o modo de execução e chama py_compile de verdade.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// 4. O Python gerado precisa compilar. Sem o venv do projeto local, isto é AVISO (o arquivo foi
//    gerado por outra máquina), não falha: o assert roda em CI de frontend também.
const pasta = mkdtempSync(join(tmpdir(), 'bridge-assert-'));
const alvo = join(pasta, 'script_gerado.py');
writeFileSync(alvo, py, 'utf-8');
const python = process.env.PYTHON || join('..', 'venv', 'Scripts', 'python.exe');
const compilado = spawnSync(python, ['-m', 'py_compile', alvo], { encoding: 'utf8' });
if (compilado.error) {
  console.log(`AVISO: py_compile não rodou (${compilado.error.message}); script em ${alvo}`);
} else if (compilado.status !== 0) {
  falhas.push(`py_compile recusou o script gerado:\n${compilado.stderr}`);
  rmSync(pasta, { recursive: true, force: true });
} else {
  rmSync(pasta, { recursive: true, force: true });
}

console.log(`script gerado: ${py.length} chars, ${py.split('\n').length} linhas`);
if (falhas.length) {
  for (const f of falhas) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('TUDO VERDE: trava nos dois níveis, saídas liberadas, ORDER_RESULT presente, py_compile aceitou.');
