/**
 * Formata um epoch em ms como `HH:MM:SS.mmm` no FUSO LOCAL do navegador.
 *
 * Por que existe: a fita (Time & Trades) vinha mostrando o `timeStr` que a PONTE MT5 manda, e esse
 * string é gerado no fuso da MÁQUINA do MT5/Windows (que pode estar em UTC). O eixo de tempo do
 * gráfico, porém, é `new Date(timestamp).toLocaleTimeString(...)` — fuso do navegador. Resultado:
 * T&A em 20:44 e gráfico em 17:44 no mesmo tick (offset de 3 h = BRT). Derivar o `timeStr` do
 * `timestamp` local alinha as duas leituras e mantém a precisão de milissegundo da fita, não
 * importa o relógio do servidor.
 */
export function formatTickTimeStr(timestamp: number): string {
  const d = new Date(timestamp);
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
