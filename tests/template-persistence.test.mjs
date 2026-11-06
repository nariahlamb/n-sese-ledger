import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import jquery from 'jquery';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../', import.meta.url));
const acceptancePath = process.env.LEDGER_ACCEPTANCE_TEMPLATE || new URL('../notes/templates/瑟瑟台账-模板预设-斯德哥摩尔特调.json', import.meta.url);
let source;
try { source = await readFile(acceptancePath); } catch (error) { if (process.env.LEDGER_ACCEPTANCE_TEMPLATE || error.code !== 'ENOENT') throw error; }
const actual = source && JSON.parse(source);
const compiled = await build({ absWorkingDir: root, entryPoints: ['src/sese-ledger/index.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' });
const code = compiled.outputFiles[0].text;
async function until(predicate, label) {
  for (let i = 0; i < 120; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail(label);
}
async function boot(state) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => {
    // jsdom 不支持完整 CSS；这不属于 JS 启动异常，也不能据此判断视觉正确。
    if (!String(error.message).includes('Could not parse CSS stylesheet')) errors.push(error.message);
  });
  vc.on('error', (...args) => errors.push(args.map(value => value?.message || String(value)).join(' ').slice(0, 600)));
  const dom = new JSDOM('<!doctype html><body><div id="extensions_settings"></div><div id="extensions_settings2"></div><div id="sheld"><div id="chat"></div></div><form id="send_form"></form></body>', {
    url: 'http://localhost:8000', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  });
  const win = dom.window;
  const events = new Map();
  let aiRequests = 0;
  let savedSettings;
  const files = state.files;
  const eventSource = {
    on(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    off(name, fn) { events.get(name)?.delete(fn); },
    once(name, fn) { const cb = (...args) => { this.off(name, cb); fn(...args); }; this.on(name, cb); },
    async emit(name, ...args) { for (const fn of events.get(name) || []) await fn(...args); },
  };
  const context = {
    chat: state.chat, chatId: '主验收聊天', characterId: 0, groupId: null, characters: [{ avatar: 'acceptance.png' }], chatMetadata: state.metadata,
    extensionSettings: structuredClone(state.settings), eventSource,
    eventTypes: new Proxy({}, { get: (_, name) => name }),
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    saveSettingsDebounced() { savedSettings = JSON.parse(JSON.stringify(context.extensionSettings)); },
    async saveMetadata() {}, name1: 'User', name2: '',
  };
  win.SillyTavern = { getContext: () => context };
  win.$ = win.jQuery = jquery(win);
  win.TextEncoder = TextEncoder;
  win.TextDecoder = TextDecoder;
  win.structuredClone = structuredClone;
  win.toastr = Object.fromEntries(['info', 'warning', 'error', 'success', 'clear', 'remove'].map(name => [name, () => win.$('<div>')]));
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  win.TavernHelper = {
    generateRaw: async () => { aiRequests++; throw new Error('模拟环境禁止 AI 请求'); },
    generate: async () => { aiRequests++; throw new Error('模拟环境禁止 AI 请求'); },
    injectPrompts() {}, uninjectPrompts() {}, stopGenerationById() {},
    getWorldbook: async () => [], replaceWorldbook: async () => {}, getWorldbookNames: () => [],
    getCharWorldbookNames: () => ({ primary: null, additional: [] }),
    getTavernRegexes: () => [], replaceTavernRegexes: async () => {},
    getVariables: () => ({}), getAllVariables: () => ({}),
    getCurrentCharacterName: () => '', getLastMessageId: () => -1,
    getChatMessages: () => context.chat, substitudeMacros: value => value,
  };
  win.fetch = async (input, options = {}) => {
    const url = new URL(String(input), win.location.href);
    let status = 200;
    let data = {};
    if (url.pathname.startsWith('/user/files/')) {
      const stored = files.get(url.pathname);
      if (stored === undefined) status = 404;
      else data = stored;
    } else if (url.pathname === '/api/files/upload') {
      const payload = JSON.parse(options.body);
      const file = `/user/files/${payload.name}`;
      files.set(file, JSON.parse(Buffer.from(payload.data, 'base64').toString('utf8')));
      data = { path: file };
    } else if (url.pathname === '/api/files/verify') {
      data = Object.fromEntries(JSON.parse(options.body).urls.map(file => [file, files.has(file)]));
    } else {
      // 不允许测试接触任何真实宿主、网络或用户资料。
      status = 404;
    }
    return { ok: status === 200, status, statusText: status === 404 ? 'Not Found' : 'OK', json: async () => data, text: async () => JSON.stringify(data) };
  };
  win.eval(code);
  await until(() => win.SeseLedgerAPI, '真实入口未注册');
  const api = win.SeseLedgerAPI;
  await until(() => Object.values(api.snapshot()).filter(x => x?.name).length === 18, '用户模板未建立18张表');
  return { win, context, api, errors, events,
    saved: () => structuredClone(savedSettings || context.extensionSettings),
    close: async () => { await win.__SL_DISPOSE__?.(); win.close(); },
  };
}

test('用户斯德哥摩尔特调：读写、结构保存、切换、取消与重载持久化', { skip: !source && '仅本地用户模板验收；设置 LEDGER_ACCEPTANCE_TEMPLATE 后运行', timeout: 20000 }, async () => {
  const originalHash = createHash('sha256').update(source).digest('hex');
  const preset = actual.name;
  const state = { settings: { sese_ledger_v1: { currentTemplatePreset: preset, templatePresets: { [preset]: { templateStr: JSON.stringify(actual), updatedAt: 1 } } } }, files: new Map(), metadata: {}, chat: [{ is_user: true, mes: '验收输入', id: 'u1' }, { is_user: false, mes: '验收回复', id: 'a1' }] };
  let app = await boot(state);
  try {
    const { api, win } = app;
    assert.equal(api.templateBinding.name(), preset);
    const key = Object.keys(api.snapshot()).find(key => api.snapshot()[key]?.name === '杂表');
    assert(key);
    const headers = api.snapshot()[key].content[0].slice(1);
    const row = Object.fromEntries(headers.map((header, i) => [header, `验收内容${i}`]));
    assert.equal(api.apply([{ kind: 'row_insert', table: key, row }]).ok, true);
    await api.__legacyFace.flushPendingSaves();
    win.document.querySelector('.slw-launcher').click();
    win.document.querySelector(`[data-edit="${key}"]`).click();
    win.document.querySelector('#slw-td-name').value = '验收杂表';
    win.document.querySelector('#slw-td-save').click();
    await until(() => win.document.querySelector('[data-slw-ask-ok]'), '结构预览未出现');
    win.document.querySelector('[data-slw-ask-ok]').click();
    await until(() => app.saved().sese_ledger_v1.templatePresets[preset].templateStr.includes('验收杂表'), '结构未写回所选模板');
    await api.__legacyFace.flushPendingSaves();
    state.settings = app.saved();
    await app.close(); app = await boot(state);
    assert.equal(app.api.snapshot()[key].name, '验收杂表');
    assert(Object.values(app.api.query('验收杂表', { columns: headers }).rows[0]).includes('验收内容0'));
    const switchTo = structuredClone(actual);
    switchTo.name = '主验收切换对照';
    switchTo.tables.find(table => table.name === '杂表').name = '对照杂表';
    const result = await app.api.templateBinding.apply(switchTo.name, switchTo, { preset: switchTo });
    assert.equal(result.ok, true, result.message);
    assert.equal(app.api.templateBinding.name(), switchTo.name);
    state.settings = app.saved();
    await app.close(); app = await boot(state);
    assert.equal(app.api.templateBinding.name(), switchTo.name);
    assert.equal(app.api.snapshot()[key].name, '对照杂表');
    app.win.document.querySelector('.slw-launcher').click();
    const select = app.win.document.querySelector('#slw-tpl-select');
    select.value = preset; select.dispatchEvent(new app.win.Event('change', { bubbles: true }));
    await until(() => app.win.document.querySelector('[data-slw-ask-cancel]'), '模板切换预览未出现');
    app.win.document.querySelector('[data-slw-ask-cancel]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.api.templateBinding.name(), switchTo.name);
    assert.equal(app.api.snapshot()[key].name, '对照杂表');
    const beforeImport = JSON.stringify(app.saved());
    select.value = '__import__'; select.dispatchEvent(new app.win.Event('change', { bubbles: true }));
    await until(() => app.win.document.querySelector('input[type="file"]'), '导入文件选择未出现');
    const fileInput = app.win.document.querySelector('input[type="file"]');
    Object.defineProperty(fileInput, 'files', { value: [{ text: async () => JSON.stringify(actual) }] });
    fileInput.dispatchEvent(new app.win.Event('change'));
    await until(() => app.win.document.querySelector('[data-slw-ask-ok]'), '转换报告未出现');
    app.win.document.querySelector('[data-slw-ask-ok]').click();
    await until(() => app.win.document.querySelector('[data-slw-ask-input]'), '导入命名未出现');
    app.win.document.querySelector('[data-slw-ask-input]').value = '应取消的导入';
    app.win.document.querySelector('[data-slw-ask-ok]').click();
    await until(() => app.win.document.querySelector('[data-slw-ask]')?.textContent.includes('切换前预览'), '导入影响预览未出现');
    app.win.document.querySelector('[data-slw-ask-cancel]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(JSON.stringify(app.saved()), beforeImport, '取消导入仍保存预设或变更了选择');
    assert.equal(app.api.snapshot()[key].name, '对照杂表');
    const loss = structuredClone(switchTo);
    loss.name = '备份验收';
    loss.tables.find(table => table.tableId === key).columns.pop();
    app.context.extensionSettings.sese_ledger_v1.templatePresets[loss.name] = { templateStr: JSON.stringify(loss), updatedAt: 3 };
    app.win.document.querySelector('[data-act="close"]').click();
    app.win.document.querySelector('.slw-launcher').click();
    let lossSelect = app.win.document.querySelector('#slw-tpl-select');
    lossSelect.value = loss.name; lossSelect.dispatchEvent(new app.win.Event('change', { bubbles: true }));
    await until(() => app.win.document.querySelector('[data-slw-ask-ok]')?.textContent.includes('备份'), '真实删列未要求备份');
    app.win.URL.createObjectURL = () => { throw new Error('模拟下载不可用'); };
    app.win.document.querySelector('[data-slw-ask-ok]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.api.templateBinding.name(), switchTo.name, '备份失败却改了模板选择');
    assert.equal(app.api.snapshot()[key].content[0].length, headers.length + 1, '备份失败却删除了列');
    let downloads = 0;
    app.win.URL.createObjectURL = () => 'blob:acceptance';
    app.win.URL.revokeObjectURL = () => {};
    app.win.HTMLAnchorElement.prototype.click = function () { downloads++; };
    lossSelect.value = loss.name; lossSelect.dispatchEvent(new app.win.Event('change', { bubbles: true }));
    await until(() => app.win.document.querySelector('[data-slw-ask-ok]'), '重试删列预览未出现');
    app.win.document.querySelector('[data-slw-ask-ok]').click();
    await until(() => app.api.templateBinding.name() === loss.name, '备份发起后未保存新模板');
    assert.equal(downloads, 1);
    assert.equal(app.api.snapshot()[key].content[0].length, headers.length);
    assert.equal((await app.api.templateBinding.apply(switchTo.name, switchTo)).ok, true);
    state.settings = app.saved();
    await app.close(); app = await boot(state);
    app.win.document.querySelector('.slw-launcher').click();
    const restoredSelect = app.win.document.querySelector('#slw-tpl-select');
    const filesBefore = structuredClone([...state.files]);
    restoredSelect.value = preset; restoredSelect.dispatchEvent(new app.win.Event('change', { bubbles: true }));
    await until(() => app.win.document.querySelector('[data-slw-ask-ok]'), '第二次预览未出现');
    app.context.chat = [{ is_user: false, mes: '另一个聊天', id: 'other' }];
    app.win.document.querySelector('[data-slw-ask-ok]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.api.templateBinding.name(), switchTo.name, '确认期间切聊却修改了选择');
    assert.deepEqual([...state.files], filesBefore, '确认期间切聊却写入了账本');
    assert.equal(createHash('sha256').update(await readFile(acceptancePath)).digest('hex'), originalHash, '主验收模板原件被修改');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
