import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('..', import.meta.url));

async function loadBundle(code, sourcefile = 'ledger-bg-isolation.ts') {
  const result = await build({
    absWorkingDir: root,
    stdin: { contents: code, resolveDir: root, loader: 'ts', sourcefile },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

test('LEDGER_FILL_NATIVE_SLOTS 剔除 dialogue_examples 与 chat_history；expandLedgerItems 区分 fill 与 driver', async () => {
  const mod = await loadBundle(`export * from './src/sese-ledger/core/ai-request.ts';`);
  assert.equal(mod.LEDGER_NATIVE_SLOTS.includes('chat_history'), false);
  assert.equal(mod.LEDGER_NATIVE_SLOTS.includes('dialogue_examples'), true);
  assert.equal(mod.LEDGER_FILL_NATIVE_SLOTS.includes('chat_history'), false);
  assert.equal(mod.LEDGER_FILL_NATIVE_SLOTS.includes('dialogue_examples'), false);
  assert.deepEqual([...mod.LEDGER_FILL_NATIVE_SLOTS], [
    'world_info_before',
    'persona_description',
    'char_description',
    'char_personality',
    'scenario',
    'world_info_after',
  ]);

  const fillExpanded = mod.expandLedgerItems(
    [{ kind: 'block', block: 'scan' }],
    { scan: '设定参考' },
    { nativeSlots: mod.LEDGER_FILL_NATIVE_SLOTS },
  );
  assert.equal(fillExpanded.includes('dialogue_examples'), false);
  assert.equal(fillExpanded.includes('world_info_before'), true);

  const driverExpanded = mod.expandLedgerItems(
    [{ kind: 'block', block: 'scan' }],
    { scan: '设定参考' },
  );
  assert.equal(driverExpanded.includes('dialogue_examples'), true);
});

test('createLedgerAiTransport：fill 用 LEDGER_FILL_NATIVE_SLOTS + 挂四层世界书净化；driver 保留 dialogue_examples', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  const prevWin = globalThis.window;
  const listeners = new Map();
  let lastRequest = null;

  dom.window.SillyTavern = {
    getContext: () => ({
      eventSource: { on(evt, fn) { listeners.set(evt, fn); } },
    }),
  };
  dom.window.TavernHelper = {
    getCharWorldbookNames: () => ({ primary: '主书', additional: ['附加美化书'] }),
    getWorldbook: async (name) => name === '附加美化书' ? [{ uid: 2, comment: '附加设定', content: 'x' }] : [],
    injectPrompts: () => {},
    generateRaw: async (req) => {
      lastRequest = req;
      const payload = {
        globalLore: [{ uid: 9, world: '全局书', comment: '#状态栏', content: '全局垃圾' }],
        characterLore: [
          { uid: 1, world: '主书', comment: '角色设定-苏晴', content: '主设定' },
          { uid: 2, world: '主书', comment: 'CoT思维链', content: '正文思维链' },
          { uid: 3, world: '主书', comment: '<场景美化>', position: { role: 'assistant' }, content: 'HTML' },
          { uid: 4, world: '主书', comment: 'SeseLedger-状态表：主角', content: '台账投影' },
          { uid: 5, world: '附加美化书', comment: '附加设定', content: '附加垃圾' },
        ],
        chatLore: [],
        personaLore: [],
      };
      await listeners.get('worldinfo_entries_loaded')?.(payload);
      lastRequest._payloadAfterHook = payload;
      return 'ok';
    },
  };
  globalThis.window = dom.window;

  try {
    const mod = await loadBundle(`
      export * from './src/sese-ledger/core/host-ai.ts';
      export * from './src/sese-ledger/core/ai-request.ts';
      export * from './src/unified-statusbar/core/worldbook-entry.ts';
    `);
    mod.__setBackgroundIsolationForTests({
      blockGlobalLore: true,
      blockAdditionalLore: true,
      dropAssistantLore: true,
      useBuiltinKeywords: true,
      allowedBooks: [],
    });

    const transport = mod.createLedgerAiTransport({ resolveCustomApi: () => undefined });
    await transport.request({
      apiPurpose: 'fill',
      suspendLedgerFamily: true,
      items: [{ kind: 'block', block: 'scan' }],
      blocks: { scan: '仅参考设定' },
      scanText: '剧情正文',
    });

    assert.equal(lastRequest.max_chat_history, 0);
    assert.equal(lastRequest.ordered_prompts.includes('dialogue_examples'), false);
    assert.equal(lastRequest.ordered_prompts.includes('chat_history'), false);
    assert.deepEqual(lastRequest._payloadAfterHook.globalLore, []);
    assert.deepEqual(lastRequest._payloadAfterHook.characterLore.map(e => e.comment), ['角色设定-苏晴']);

    await transport.request({
      apiPurpose: 'driver',
      suspendLedgerFamily: false,
      items: [{ kind: 'block', block: 'scan' }],
      blocks: { scan: '推进参考' },
      scanText: '剧情正文',
    });
    assert.equal(lastRequest.ordered_prompts.includes('dialogue_examples'), true);
    assert.deepEqual(
      lastRequest._payloadAfterHook.characterLore.map(e => e.comment),
      ['角色设定-苏晴', 'SeseLedger-状态表：主角'],
    );
  } finally {
    globalThis.window = prevWin;
    dom.window.close();
  }
});
