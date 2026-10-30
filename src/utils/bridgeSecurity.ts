/**
 * Segurança da ponte WebSocket (o script .py que roda no PC com MT5).
 *
 * A ponte escuta em 0.0.0.0:8765 na rede local. Sem token, QUALQUER dispositivo da
 * rede — ou qualquer site aberto no navegador — consegue abrir um WebSocket nessa
 * porta e mandar ordens na conta logada do terminal (WebSocket não obedece CORS).
 * Por isso o app e o script combinam um token: o app envia no primeiro frame
 * ({ action: 'AUTH', token }) e a ponte só entrega dados / aceita comandos depois.
 */

/** Alfabeto sem caracteres que quebram em shell/JSON/URL (mais chato de colar errado). */
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Token de 28 caracteres (~162 bits de entropia): impossível de adivinhar na rede. */
export function generateBridgeToken(): string {
  const bytes = new Uint8Array(28);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

/** Máscaras parciais para exibir o token na tela sem entregá-lo inteiro. */
export function maskBridgeToken(token: string): string {
  if (!token) return '(sem token — ponte em modo legado)';
  if (token.length <= 8) return `${token.slice(0, 2)}••••`;
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
}

const TOKEN_STORAGE_KEY = 'fluxo_bridge_token_v1';

/**
 * Token atual da ponte. Na primeira execução ele é criado e gravado sozinho, para
 * que o script baixado e o app saiam com o MESMO segredo sem trabalho manual.
 */
export function getBridgeToken(): string {
  try {
    const saved = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved) return saved;
    const fresh = generateBridgeToken();
    localStorage.setItem(TOKEN_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage indisponível (modo privado severo): usa em memória só nesta aba
    return generateBridgeToken();
  }
}

/** Grava um token digitado/colado (ex.: mesmo segredo em outro computador). */
export function setBridgeToken(token: string): string {
  const clean = token.trim();
  try {
    if (clean) localStorage.setItem(TOKEN_STORAGE_KEY, clean);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {}
  return clean;
}

/** Troca o segredo. Depois de girar, é preciso baixar o script .py de novo. */
export function rotateBridgeToken(): string {
  const fresh = generateBridgeToken();
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, fresh);
  } catch {}
  return fresh;
}
