// tests/ai-tool-shield.test.mjs
// 台账侧的出站兼容双验证：
//   1) host-config.presetToCustomApi：预设的 source 透传到 custom_api（'openai' 是宿主缺省，不写字段），
//      promptPostProcessing 归一后登记在 custom_api 对象上（WeakMap），缺省/非法回退 'semi'；
//   2) 台账 1A 结构（头破限 → expandLedgerItems 混排 user 段与固定块 → 尾破限）经出站「半严格」
//      规整后，首条非系统消息之后再无 system/developer（gpt-load / Gemini / Claude 等网关兼容）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

async function loadBundle(contents) {
  const result = await build({
    absWorkingDir: root,
    stdin: { contents, resolveDir: root, loader: 'ts', sourcefile: 'test-bundle.ts' },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

const mod = await loadBundle(`
  export * from './src/sese-ledger/core/host-config.ts';
  export * from './src/sese-ledger/core/ai-request.ts';
  export * from './src/unified-statusbar/core/jailbreak-config.ts';
  export * from './src/unified-statusbar/core/ai-tool-shield.ts';
  export * from './src/unified-statusbar/core/config-store.ts';
`);

/** 用内存外部偏好桩种入主项目配置（台账 host-config 只读同一份解析口径）。 */
function seedConfig() {
  const state = {
    apiMode: 'custom',
    activeApiPresetId: 'ap_legacy',
    customApiPresets: [
      {
        id: 'ap_legacy',
        name: '旧预设（无 source）',
        url: 'http://127.0.0.1:3001/v1',
        key: 'k1',
        model: 'gemini-2.5-flash',
        createdAt: 1,
      },
      {
        id: 'ap_native',
        name: '原生 Gemini',
        url: 'http://127.0.0.1:3001',
        key: 'k2',
        model: 'gemini-2.5-pro',
        source: 'makersuite',
        promptPostProcessing: 'strict',
        createdAt: 2,
      },
      {
        id: 'ap_openai',
        name: '显式 openai',
        url: 'http://127.0.0.1:3001/v1',
        key: 'k3',
        model: 'gpt-4o-mini',
        source: 'openai',
        promptPostProcessing: 'none',
        createdAt: 3,
      },
      {
        id: 'ap_bogus',
        name: '非法值',
        url: 'http://127.0.0.1:3001/v1',
        key: 'k4',
        model: 'x',
        source: 'bogus',
        promptPostProcessing: 'bogus',
        createdAt: 4,
      },
    ],
  };
  mod.configureConfigStorage('external', {
    load: async () => ({ state: 'ready', source: 'external' }),
    sync: async () => true,
    read: key => state[key],
    readAll: () => ({ ...state }),
    patch: async () => true,
    replaceAll: async () => true,
    patchCommit: async () => ({ ok: true, confirmed: true, retryable: false }),
    replaceCommit: async () => ({ ok: true, confirmed: true, retryable: false }),
    flush: async () => true,
    status: () => ({ state: 'ready', source: 'external' }),
  });
  mod.invalidateConfigCache();
}

test('host-config：预设 source 透传（openai 不写）与出站策略登记（缺省回退 semi）', () => {
  seedConfig();
  const warnings = [];
  const bridge = mod.createHostConfigBridge({ warn: message => warnings.push(message) });

  // 旧预设：缺 source / 缺 promptPostProcessing → 不写 source，策略回退 'semi'
  const legacy = bridge.resolve({ apiPresetId: 'ap_legacy', apiMode: 'follow' });
  assert.equal(legacy.mode, 'pinned');
  assert.equal('source' in legacy.customApi, false);
  assert.equal(mod.getCustomApiPostProcessingMode(legacy.customApi), 'semi');

  // 非 'openai' 源：原样透传，策略跟随预设
  const native = bridge.resolve({ apiPresetId: 'ap_native', apiMode: 'follow' });
  assert.equal(native.mode, 'pinned');
  assert.equal(native.customApi.source, 'makersuite');
  assert.equal(mod.getCustomApiPostProcessingMode(native.customApi), 'strict');

  // 显式 'openai'：同样不写 source（宿主缺省形态），策略 'none' 也要登记
  const explicitOpenai = bridge.resolve({ apiPresetId: 'ap_openai', apiMode: 'follow' });
  assert.equal('source' in explicitOpenai.customApi, false);
  assert.equal(mod.getCustomApiPostProcessingMode(explicitOpenai.customApi), 'none');

  // 非法值：归一成 openai（不写字段）与 semi
  const bogus = bridge.resolve({ apiPresetId: 'ap_bogus', apiMode: 'follow' });
  assert.equal('source' in bogus.customApi, false);
  assert.equal(mod.getCustomApiPostProcessingMode(bogus.customApi), 'semi');

  // 全局 custom 模式（未指定预设）：同一口径
  const global = bridge.resolve({});
  assert.equal(global.mode, 'custom');
  assert.equal('source' in global.customApi, false);
  assert.equal(mod.getCustomApiPostProcessingMode(global.customApi), 'semi');

  assert.deepEqual(warnings, []);
});

test('expandLedgerItems 混排 + 尾破限：scrubGenerateData(semi) 后首条非系统消息之后再无 system/developer', () => {
  seedConfig();
  const head = { role: 'system', content: '【结构头】台账出站兼容测试前缀（破限头）。'.repeat(3) };
  const items = [
    { kind: 'segment', role: 'user', content: '请按模板填写本轮表数据。' },
    { kind: 'block', block: 'dossier' },
    { kind: 'block', block: 'context' },
    { kind: 'block', block: 'scan' },
  ];
  const entries = mod.expandLedgerItems(items, {
    dossier: '【当前台账】\n| 姓名 |\n| --- |\n| 苏晴 |',
    context: '【当前正文】\n门铃响了。',
    scan: '以下为参考资料。',
  });
  const tail = mod.getJailbreakTailPrompts();
  assert.ok(tail.length > 0, '默认档尾部破限应至少一条');

  const asMessage = entry => (typeof entry === 'string'
    ? { role: 'system', content: `（原生槽位 ${entry}）` }
    : { role: entry.role, content: entry.content });
  const messages = [head, ...entries.map(asMessage), ...tail];
  const data = { messages: messages.map(message => ({ ...message })) };

  const fingerprint = mod.buildRequestFingerprint({ ordered_prompts: [head] });
  assert.ok(fingerprint && fingerprint.head, '结构头应产出可命中指纹');

  // 前提校验：原始序列确实违规（首条非系统消息之后仍有 system），否则本用例没有证明力
  const rawFirstConv = data.messages.findIndex(m => m.role !== 'system' && m.role !== 'developer');
  assert.ok(rawFirstConv > 0, '首条非系统消息不应在索引 0');
  assert.ok(
    data.messages.slice(rawFirstConv).some(m => m.role === 'system' || m.role === 'developer'),
    '原始序列应包含中段 system/developer（固定块与尾破限）',
  );

  const result = mod.scrubGenerateData(data, fingerprint, 'semi');
  assert.equal(result.touched, true);

  const firstConv = data.messages.findIndex(m => m.role !== 'system' && m.role !== 'developer');
  assert.ok(firstConv > 0);
  assert.equal(
    data.messages.slice(firstConv).some(m => m.role === 'system' || m.role === 'developer'),
    false,
    '首条非系统消息之后不得残留 system/developer',
  );
  // 结构头仍是 system；尾破限内容只是折叠进 user，未被丢弃
  assert.equal(data.messages[0].role, 'system');
  const tailProbe = tail[0].content.slice(0, 12);
  assert.ok(
    data.messages.slice(firstConv).some(m => typeof m.content === 'string' && m.content.includes(tailProbe)),
    '尾破限文本应保留在折叠后的 user 消息中',
  );
});
