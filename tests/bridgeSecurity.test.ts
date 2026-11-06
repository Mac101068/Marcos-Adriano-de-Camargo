import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
  },
});

const {
  generateBridgeToken,
  getBridgeToken,
  isValidBridgeToken,
  maskBridgeToken,
  rotateBridgeToken,
  setBridgeToken,
  syncBridgeTokenWithServer,
} =
  await import('../src/utils/bridgeSecurity');
const { DEFAULT_EA_CONFIG } = await import('../src/services/eaConfigService');
const { generatePythonMT5Script } = await import('../src/utils/pythonScriptGenerator');

const TEST_TOKEN = 'AbCdEfGhJkMnPqRsTuVwXyZ23456';

test('bridge token uses the expected length and unambiguous alphabet', () => {
  const token = generateBridgeToken();
  assert.equal(token.length, 28);
  assert.match(token, /^[A-HJ-NP-Za-km-z2-9]+$/);
  assert.equal(isValidBridgeToken(token), true);
  assert.equal(isValidBridgeToken('<!doctype html>'), false);
});

test('bridge token storage supports set, retrieval, generation, and rotation', () => {
  storage.clear();
  assert.equal(getBridgeToken().length, 28);
  const generated = getBridgeToken();
  assert.equal(storage.get('fluxo_bridge_token_v1'), generated);

  assert.equal(setBridgeToken(`  ${TEST_TOKEN}  `), TEST_TOKEN);
  assert.equal(getBridgeToken(), TEST_TOKEN);

  const rotated = rotateBridgeToken();
  assert.equal(rotated.length, 28);
  assert.notEqual(rotated, TEST_TOKEN);
  assert.equal(getBridgeToken(), rotated);
});

test('invalid saved or server-fallback content is never used as a bridge token', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  globalThis.fetch = async () =>
    new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });

  try {
    storage.set('fluxo_bridge_token_v1', '<!doctype html><html></html>');
    const token = await syncBridgeTokenWithServer();

    assert.equal(isValidBridgeToken(token), true);
    assert.equal(storage.get('fluxo_bridge_token_v1'), token);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('generated MT5 bridge pins the configured token and enforces authentication', () => {
  storage.clear();
  setBridgeToken(TEST_TOKEN);
  const script = generatePythonMT5Script(DEFAULT_EA_CONFIG);

  assert.ok(script.includes(`AUTH_TOKEN = "${TEST_TOKEN}"`));
  assert.ok(script.includes('REQUIRE_AUTH = len(AUTH_TOKEN) > 0'));
  assert.ok(script.includes('secrets.compare_digest(provided, AUTH_TOKEN)'));
  assert.ok(script.includes('ORDERS_BLOCKED = os.environ.get('));
  assert.ok(script.includes('if action in ENTRY_ACTIONS and ordens_bloqueadas():'));
});

test('bridge token masking does not expose the complete token', () => {
  assert.equal(maskBridgeToken(''), '(sem token — ponte em modo legado)');
  assert.equal(maskBridgeToken('short'), '(token inválido)');
  assert.equal(maskBridgeToken(TEST_TOKEN), 'AbCd••••••••3456');
});
