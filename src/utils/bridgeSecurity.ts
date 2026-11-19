/**
 * Segurança da ponte WebSocket - Versão Blindada e Compatível
 * Data: 18/11/2026
 */

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TOKEN_STORAGE_KEY = 'fluxo_bridge_token_v1';

// Variável para compatibilidade com scripts antigos (sempre desativada)
export const BRIDGE_ALLOW_NO_TOKEN = false;

let memoryToken: string | null = null;

/** Gera token aleatório seguro */
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

export const DEFAULT_BRIDGE_TOKEN = 'fluxo-renko-ponte-2026-chave-fixa-marcos';

/** Retorna o token atual (memória > localStorage > padrão fixo de segurança) */
export function getBridgeToken(): string {
  if (memoryToken && memoryToken.length >= 16) return memoryToken;

  try {
    const saved = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved && saved.length >= 16) {
      memoryToken = saved;
      return saved;
    }
  } catch { }

  // Fallback para o token oficial configurado na ponte do backend
  memoryToken = DEFAULT_BRIDGE_TOKEN;
  try { localStorage.setItem(TOKEN_STORAGE_KEY, DEFAULT_BRIDGE_TOKEN); } catch { }
  return DEFAULT_BRIDGE_TOKEN;
}

/** Define token manualmente */
export function setBridgeToken(token: string): string {
  memoryToken = token.trim();
  try { localStorage.setItem(TOKEN_STORAGE_KEY, memoryToken); } catch { }
  return memoryToken;
}

/** Limpa token salvo */
export function clearBridgeToken(): void {
  memoryToken = null;
  try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch { }
}

/** Rotaciona/Gera novo token (Exigido pelo DocumentationView.tsx) */
export function rotateBridgeToken(): string {
  const fresh = generateBridgeToken();
  memoryToken = fresh;
  try { localStorage.setItem(TOKEN_STORAGE_KEY, fresh); } catch { }
  console.log('[Segurança] Token rotacionado com sucesso.');
  return fresh;
}

/** Sincronização segura: busca o token gerado pelo backend local via /bridge_token.txt */
export async function syncBridgeTokenWithServer(): Promise<string> {
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const res = await fetch('/bridge_token.txt?t=' + Date.now());
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text && text.length >= 16) {
          memoryToken = text;
          try { localStorage.setItem(TOKEN_STORAGE_KEY, text); } catch {}
          return text;
        }
      }
    } catch {}
  }
  return getBridgeToken();
}

// Sincronização imediata no carregamento do módulo
if (typeof window !== 'undefined' && typeof fetch === 'function') {
  syncBridgeTokenWithServer().catch(() => {});
}

/** Máscara para exibição segura */
export function maskBridgeToken(token: string): string {
  if (!token) return '(sem token)';
  if (token.length <= 8) return `${token.slice(0, 2)}••••`;
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
}