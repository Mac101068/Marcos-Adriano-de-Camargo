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

/**
 * CHAVE FIXA DA PONTE (decisão do operador, 07/11/2026).
 *
 * Antes o token era sorteado a cada geração do script: bastava eu regerar a ponte para o app
 * ficar com a chave velha e a conexão passar a ser recusada ("AUTH RECUSADO — token errado").
 * Agora a chave é esta constante, a mesma em todo build, e o `bridge_token.txt` só serve para
 * alinhar outra máquina da rede. Trocar a chave é trocar esta linha e regerar o script.
 *
 * A proteção continua a mesma de antes: sem esta chave a ponte não entrega tick nem aceita
 * ordem. Ela viaja no .py e no arquivo servido pelo app — nunca em chat ou e-mail.
 */
export const BRIDGE_FIXED_KEY = 'fluxo-renko-ponte-2026-chave-fixa-marcos';

/**
 * MODO SEM TOKEN (rede local confiável). A ponte continua aceitando a chave acima — e o app
 * continua mandando — mas, quando o operador liga este modo, a ponte NÃO recusa conexão sem
 * AUTH. Existe para o caso de outra máquina da rede não conseguir alinhar a chave.
 *
 * O que NÃO muda: a ponte só escuta enquanto o .py está rodando e o robô armado continua sendo
 * exigido para qualquer entrada. O que muda: qualquer dispositivo no mesmo Wi-Fi pode abrir a
 * porta e ler tick/conta. Por isso o padrão é `false` e o operador é avisado no console.
 */
export const BRIDGE_ALLOW_NO_TOKEN = false;

const TOKEN_STORAGE_KEY = 'fluxo_bridge_token_v1';

let memoryToken = BRIDGE_FIXED_KEY;

// Tenta sincronizar automaticamente o token com o arquivo servido pelo Vite/backend local
if (typeof window !== 'undefined' && typeof fetch === 'function') {
  fetch('/bridge_token.txt?t=' + Date.now())
    .then((r) => (r.ok ? r.text() : ''))
    .then((txt) => {
      const clean = txt.trim();
      // A chave fixa manda: um bridge_token.txt antigo não pode rebaixar a chave do app.
      if (clean && clean.length >= 16 && clean !== BRIDGE_FIXED_KEY) {
        console.warn('[ponte] bridge_token.txt diverge da chave fixa — mantendo a chave fixa.');
      }
      memoryToken = BRIDGE_FIXED_KEY;
      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, BRIDGE_FIXED_KEY);
      } catch {}
    })
    .catch(() => {});
}

/** Sincroniza ativamente o token local com o backend/Vite via /bridge_token.txt */
export async function syncBridgeTokenWithServer(): Promise<string> {
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const res = await fetch('/bridge_token.txt?t=' + Date.now());
      if (res.ok) {
        const txt = (await res.text()).trim();
        if (txt && txt.length >= 16) {
          memoryToken = txt;
          try {
            localStorage.setItem(TOKEN_STORAGE_KEY, txt);
          } catch {}
          return txt;
        }
      }
    } catch {}
  }
  return getBridgeToken();
}

/** Limpa o token salvo para forçar re-sincronização com o arquivo do servidor. */
export function clearBridgeToken(): void {
  memoryToken = '';
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {}
}

/**
 * Token atual da ponte. Na primeira execução ele é criado e gravado sozinho, para
 * que o script baixado e o app saiam com o MESMO segredo sem trabalho manual.
 */
export function getBridgeToken(): string {
  // Chave fixa primeiro: um token velho gravado no navegador nunca mais derruba a conexão.
  memoryToken = BRIDGE_FIXED_KEY;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, BRIDGE_FIXED_KEY);
  } catch {}
  return BRIDGE_FIXED_KEY;
}

function getBridgeTokenLegacy(): string {
  if (memoryToken && memoryToken.length >= 16) {
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, memoryToken);
    } catch {}
    return memoryToken;
  }
  try {
    const saved = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved && saved.length >= 16) return saved;
    const fresh = generateBridgeToken();
    localStorage.setItem(TOKEN_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage indisponível (modo privado severo): usa em memória só nesta aba
    return memoryToken || generateBridgeToken();
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
