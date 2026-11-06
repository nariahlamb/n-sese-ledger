import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

import { fileURLToPath } from 'node:url';

const bundled = await build({
  stdin: { contents: `export * from './src/sese-ledger/core/data-workbench.ts';
    export { createBook, applyOp, projectWorkbook, replayEntries } from './src/sese-ledger/core/book.ts';
    export { writeScope, activeAnchors, pruneEntriesByAnchors } from './src/sese-ledger/core/floor-scope.ts';
    export { renderDataTab } from './src/sese-ledger/settings/panel/data-tab.ts';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const template = (count = 3) => ({ mate: { type: 'chatSheets' }, sheet_demo: { uid: 'sheet_demo', name: '测试表', sourceData: {}, content: [
  ['row_id', '姓名', '备注'], ...Array.from({ length: count }, (_, i) => [String((i + 1) * 10), `名字${i + 1}`, `备注${i + 1}`]),
] } });

function fixture(count = 3) {
  let book = api.createBook(template(count));
  let chat = [{ is_user: false, id: 'ai-one', mes: '正文' }];
  let storageId = 'chat-a'; let busy = false; let protectedState = false; let settled = true; let revision = 1;
  let locks = { rows: [], cols: [], cells: [] };
  const updates = new Set(); const fills = new Set(); const commits = [];
  const runtime = {
    book: () => book, storageId: () => storageId, isReady: () => true,
    isChatSettled: () => settled, isWriteProtected: () => protectedState, recoveryStatus: () => ({ needed: false }), revision: () => revision,
    onTableUpdate(cb) { updates.add(cb); return () => updates.delete(cb); },
    commitOps(source, ops, opts) {
      commits.push({ source, ops, opts });
      const errors = [];
      for (const op of ops) { const result = api.applyOp(book, op); if (!result.ok) errors.push(result.error); }
      revision++;
      for (const cb of updates) cb(api.projectWorkbook(book));
      return { ok: !errors.length, errors, changedTables: ['sheet_demo'], entry: null };
    },
  };
  const canonical = {
    __legacyFace: { getTableLockState: () => locks },
    fill: { isRunning: () => busy, getState: () => ({ running: busy }), subscribe(cb) { fills.add(cb); cb(); return () => fills.delete(cb); } },
  };
  const workbench = api.createDataWorkbench({ runtime, getChat: () => chat, isBusy: () => busy, getLocks: () => locks });
  return {
    runtime, canonical, workbench, commits, updates, fills,
    get book() { return book; }, get table() { return book.tables.get('sheet_demo'); }, get chat() { return chat; },
    snapshot: (ids = [20]) => workbench.capture('sheet_demo', ids),
    setBusy(value) { busy = value; for (const cb of fills) cb(); },
    setLocks(value) { locks = { rows: [], cols: [], cells: [], ...value }; },
    switchChat() { storageId = 'chat-b'; chat = [{ is_user: false, id: 'other', mes: '其他聊天' }]; },
    replaceBook() { book = api.createBook(template(count)); },
    protect() { protectedState = true; }, unsettled() { settled = false; },
    emitUpdate() { revision++; for (const cb of updates) cb({}); },
  };
}

test('稳定 row_id 不受前行删除影响，只提交变更字段并归入捕获的 AI 楼', () => {
  const f = fixture(); const snapshot = f.snapshot();
  f.table.rows.delete(10);
  assert.equal(f.workbench.save(snapshot, 20, ['修改名字', '备注2']), true);
  assert.deepEqual(f.table.rows.get(20), ['20', '修改名字', '备注2']);
  assert.equal(f.table.rows.get(30)[1], '名字3');
  assert.equal(f.commits.length, 1);
  assert.deepEqual(f.commits[0].ops, [{ kind: 'cell', table: 'sheet_demo', rowId: 20, column: '姓名', value: '修改名字' }]);
  assert.equal(f.commits[0].source, 'bridge');
  assert.deepEqual(f.commits[0].opts.target, api.writeScope(f.chat));
});

test('批量删除去重且只调用一次 commitOps；新增行不复用旧 row_id', () => {
  const f = fixture();
  f.workbench.remove(f.snapshot([10, 30]), [10, 30, 10]);
  assert.equal(f.commits.length, 1); assert.equal(f.commits[0].ops.length, 2);
  f.workbench.save(f.snapshot([]), null, ['新行', '内容']);
  assert.equal(f.table.rows.has(31), true); assert.equal(f.table.rows.has(10), false);
});

test('无变化不提交；允许并发修改其他字段，保留其他字段最新值', () => {
  const f = fixture(); const snapshot = f.snapshot();
  f.table.rows.get(20)[2] = '其他操作更新';
  assert.equal(f.workbench.save(snapshot, 20, ['名字2', '备注2']), false);
  assert.equal(f.commits.length, 0);
  f.workbench.save(snapshot, 20, ['手动更新', '备注2']);
  assert.equal(f.table.rows.get(20)[2], '其他操作更新');
});

test('变更字段冲突拒绝整个提交，不写入先前已校验的字段', () => {
  const f = fixture(); const snapshot = f.snapshot();
  f.table.rows.get(20)[2] = '并发备注';
  assert.throws(() => f.workbench.save(snapshot, 20, ['新名字', '新备注']), /其他操作修改/);
  assert.equal(f.commits.length, 0); assert.equal(f.table.rows.get(20)[1], '名字2');
});

test('编辑或批删期间有行删除，拒绝提交且不改其他行', () => {
  const f = fixture(); const snapshot = f.snapshot([10, 20]);
  f.table.rows.delete(20);
  assert.throws(() => f.workbench.save(snapshot, 20, ['错误', '备注']), /已被删除/);
  assert.throws(() => f.workbench.remove(snapshot, [10, 20]), /已被删除/);
  assert.equal(f.commits.length, 0); assert.equal(f.table.rows.has(10), true);
});

for (const action of ['save', 'remove']) test(`${action} 提交前再次检查忙碌状态`, () => {
  const f = fixture(); const snapshot = f.snapshot(); f.setBusy(true);
  assert.throws(() => action === 'save' ? f.workbench.save(snapshot, 20, ['新名字', '备注2']) : f.workbench.remove(snapshot, [20]), /AI 正在填表/);
  assert.throws(() => f.snapshot(), /AI 正在填表/); assert.equal(f.commits.length, 0);
});

for (const kind of ['switch', 'book', 'columns', 'delete-floor', 'regenerate', 'new-tail', 'protected', 'unsettled']) test(`提交拒绝失效编辑：${kind}`, () => {
  const f = fixture(); const snapshot = f.snapshot();
  if (kind === 'switch') f.switchChat();
  if (kind === 'book') f.replaceBook();
  if (kind === 'columns') f.table.headers[1] = '新列名';
  if (kind === 'delete-floor') f.chat.pop();
  if (kind === 'regenerate') f.chat[0].mes = '重新生成';
  if (kind === 'new-tail') f.chat.push({ is_user: false, id: 'ai-two', mes: '新楼' });
  if (kind === 'protected') f.protect();
  if (kind === 'unsettled') f.unsettled();
  assert.throws(() => f.workbench.save(snapshot, 20, ['新名字', '备注2']));
  assert.equal(f.commits.length, 0);
});

test('新聊天没有 AI 楼时拒写，用户楼不能充当落点', () => {
  const f = fixture(); f.chat.splice(0, 1, { is_user: true, mes: '只有用户消息' });
  assert.throws(() => f.snapshot(), /没有可写入的 AI 楼层/); assert.equal(f.commits.length, 0);
});

test('锁按当前 content 索引重新检查，不把 row_id 当位置；批删不越过单元格锁', () => {
  const f = fixture(); const snapshot = f.snapshot([10, 20]);
  f.setLocks({ cells: ['2:1'] });
  assert.throws(() => f.workbench.save(snapshot, 20, ['新名字', '备注2']), /锁定/);
  assert.throws(() => f.workbench.remove(snapshot, [10, 20]), /受保护/); assert.equal(f.commits.length, 0);
  f.table.rows.delete(10);
  f.workbench.save(snapshot, 20, ['新名字', '备注2']);
  assert.equal(f.table.rows.get(20)[1], '新名字');
});

test('新增遵守列锁和固定行数；批删期间内容变化拒绝删除', () => {
  const f = fixture(); const snapshot = f.snapshot();
  f.setLocks({ cols: [1] });
  assert.throws(() => f.workbench.save(snapshot, null, ['名字', '备注']), /受保护/);
  f.setLocks({}); f.table.ddlInfo = { maxRowCount: 3 };
  assert.throws(() => f.workbench.save(snapshot, null, ['名字', '备注']), /最多 3 行/);
  f.table.rows.get(20)[2] = '已更新';
  assert.throws(() => f.workbench.remove(snapshot, [20]), /内容已变化/); assert.equal(f.commits.length, 0);
});

test('手动操作记录按目标锚点裁剪后可以重放恢复原值', () => {
  const f = fixture(); const seed = api.projectWorkbook(f.book);
  const snapshot = f.snapshot(); f.workbench.save(snapshot, 20, ['修改', '备注2']);
  const entry = { ops: f.commits[0].ops, at: f.commits[0].opts.target };
  const applied = api.createBook(seed); api.replayEntries(applied, [entry]);
  assert.equal(applied.tables.get('sheet_demo').rows.get(20)[1], '修改');
  const removed = new Set(api.activeAnchors(f.chat));
  const pruned = api.pruneEntriesByAnchors([entry], removed);
  const reverted = api.createBook(seed); api.replayEntries(reverted, pruned.kept);
  assert.equal(pruned.pruned.length, 1); assert.equal(reverted.tables.get('sheet_demo').rows.get(20)[1], '名字2');
});

function uiFixture(count = 65) {
  const f = fixture(count);
  const dom = new JSDOM('<body><div class="slw-root"><div class="slw-app"><div id="pane"></div></div></div></body>', { pretendToBeVisual: true });
  const pane = dom.window.document.querySelector('#pane');
  const deps = { runtime: f.runtime, canonical: f.canonical, window: dom.window, getChat: () => f.chat, warn() {}, refreshWorldbook() {} };
  const ctx = { deps, doc: dom.window.document };
  api.renderDataTab(ctx, pane);
  return { ...f, f, dom, pane, ctx, doc: dom.window.document,
    close() { pane.__slwCleanup?.(); dom.window.close(); } };
}

test('数据页分页只渲染 30 行，搜索保留选表和页码，订阅在重渲和清理时注销', () => {
  const u = uiFixture();
  try {
    assert.equal(u.pane.querySelectorAll('tbody tr').length, 30);
    assert.equal(u.updates.size, 1); assert.equal(u.fills.size, 1);
    u.pane.querySelector('[data-next]').click();
    api.renderDataTab(u.ctx, u.pane);
    assert.match(u.pane.querySelector('[data-page]').textContent, /第 2/);
    assert.equal(u.updates.size, 1); assert.equal(u.fills.size, 1);
    const search = u.pane.querySelector('[data-search]'); search.value = '名字65';
    search.dispatchEvent(new u.dom.window.Event('input'));
    assert.equal(u.pane.querySelectorAll('tbody tr').length, 1);
    api.renderDataTab(u.ctx, u.pane);
    assert.equal(u.pane.querySelector('[data-search]').value, '名字65');
    u.pane.__slwCleanup(); assert.equal(u.updates.size, 0); assert.equal(u.fills.size, 0);
  } finally { u.close(); }
});

test('编辑草稿不被填表/更新通知覆盖；忙碌只读、恢复后只提交变更字段', () => {
  const u = uiFixture();
  try {
    u.pane.querySelector('[data-edit="20"]').click();
    const field = u.doc.querySelector('[data-field="0"]'); field.value = '草稿';
    u.f.setBusy(true); u.f.emitUpdate();
    assert.equal(field.value, '草稿'); assert.equal(field.disabled, true);
    assert.equal(u.doc.querySelector('[data-save]').disabled, true);
    u.f.setBusy(false); assert.equal(field.disabled, false);
    u.doc.querySelector('[data-save]').click();
    assert.equal(u.f.table.rows.get(20)[1], '草稿'); assert.equal(u.commits.length, 1);
    assert.equal(u.doc.querySelector('[data-slw-editor]'), null);
  } finally { u.close(); }
});

test('完整查看不解析恶意 HTML，长文本完整保留；全屏编辑只回草稿不自动提交', () => {
  const u = uiFixture();
  try {
    const value = '<img src=x onerror="alert(1)">' + '长文本'.repeat(300);
    u.f.table.rows.get(10)[2] = value;
    u.pane.querySelector('[data-refresh]').click();
    assert.equal(u.pane.querySelector('img'), null);
    u.pane.querySelector('[data-view="10"][data-col="2"]').click();
    assert.equal(u.doc.querySelector('.slw-data-full textarea').value, value);
    assert.equal(u.doc.querySelector('.slw-data-full img'), null);
    u.doc.querySelector('[data-close]').click();
    u.pane.querySelector('[data-edit="10"]').click();
    u.doc.querySelector('[data-expand="1"]').click();
    u.doc.querySelector('.slw-data-full textarea').value = '全屏草稿';
    u.doc.querySelector('[data-apply]').click();
    assert.equal(u.doc.querySelector('[data-field="1"]').value, '全屏草稿');
    assert.equal(u.commits.length, 0);
    u.pane.__slwCleanup(); assert.equal(u.doc.querySelector('.slw-dialog-mask'), null);
  } finally { u.close(); }
});

test('切聊天后保存明确拒绝并保留草稿，不写入新聊天同 row_id 的行', () => {
  const u = uiFixture();
  try {
    u.pane.querySelector('[data-edit="20"]').click();
    u.doc.querySelector('[data-field="0"]').value = '旧聊天草稿';
    u.f.switchChat(); u.f.emitUpdate();
    u.doc.querySelector('[data-save]').click();
    assert.equal(u.commits.length, 0);
    assert.match(u.doc.querySelector('[role="alert"]').textContent, /切换/);
    assert.equal(u.doc.querySelector('[data-field="0"]').value, '旧聊天草稿');
  } finally { u.close(); }
});

test('真实运行时：手动行修改在目标 AI 楼被删除后按锚点裁掉并恢复原值', async () => {
  const result = await build({ absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), entryPoints: ['src/sese-ledger/core/runtime.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { createLedgerRuntime } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const chat = [{ is_user: true, id: 'u1' }, { is_user: false, id: 'a1', mes: '回复' }];
  const metadata = {};
  const files = new Map();
  const store = { async readJson(name) { return files.has(name) ? { found: true, value: files.get(name) } : { found: false }; }, async uploadJson(name, value) { files.set(name, JSON.parse(JSON.stringify(value))); return { ok: true }; } };
  const runtime = createLedgerRuntime({ host: { context: () => ({ chat, chatKey: 'c', characterId: 'char', host: { chat, chatMetadata: metadata, saveChatMetadata: async () => {} } }) }, files: store, index: { readIndex: async () => ({ chats: {} }), writeIndex: async () => {} }, standardTemplate: template(), previousChatExists: async () => false });
  await runtime.onChatChanged();
  await runtime.ensureSeeded();
  assert.equal(runtime.isReady(), true);
  const commit = runtime.commitOps('bridge', [{ kind: 'cell', table: 'sheet_demo', rowId: 10, column: '姓名', value: '手动测试' }]);
  assert.equal(commit.ok, true);
  assert.equal(runtime.book().tables.get('sheet_demo').rows.get(10)[1], '手动测试');
  const removed = runtime.pruneEntriesAtAnchors(new Set([commit.at.anchor]));
  assert.equal(removed.pruned, 1);
  assert.equal(runtime.book().tables.get('sheet_demo').rows.get(10)[1], '名字1');
  await runtime.flush();
  assert(files.size > 0);
});


test('真实运行时：结构快照记账，整层回退恢复表与行', async () => {
  const result = await build({ absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), entryPoints: ['src/sese-ledger/core/runtime.ts', 'src/sese-ledger/core/time-machine.ts'], outdir: 'out', bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  const load = name => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles.find(file => file.path.endsWith(`/${name}.js`)).text).toString('base64')}`);
  const { createLedgerRuntime } = await load('runtime');
  const { createTimeMachine } = await load('time-machine');
  const chat = [{ is_user: false, id: 'a1', mes: '回复' }];
  const files = new Map(); const metadata = {};
  const store = { async readJson(name) { return files.has(name) ? { found: true, value: files.get(name) } : { found: false }; }, async uploadJson(name, value) { files.set(name, JSON.parse(JSON.stringify(value))); return { ok: true }; } };
  const runtime = createLedgerRuntime({ host: { context: () => ({ chat, chatKey: 'c', characterId: 'char', host: { chat, chatMetadata: metadata, saveChatMetadata: async () => {} } }) }, files: store, index: { readIndex: async () => ({ chats: {} }), writeIndex: async () => {} }, standardTemplate: template(), previousChatExists: async () => false });
  await runtime.onChatChanged(); await runtime.ensureSeeded();
  const before = runtime.book().tables.get('sheet_demo').rows.get(10).slice();
  const next = JSON.parse(JSON.stringify((await import('node:util')).types ? { mate: {}, sheet_demo: { uid: 'sheet_demo', name: '改名表', content: [['row_id', '新姓名', '备注'], before, ['11', '新行', '内容']], sourceData: { note: '', ddl: '', insertNode: '', updateNode: '', deleteNode: '' }, orderNo: 1 } } : {}));
  assert.equal(runtime.commitStructureSnapshot(next).ok, true);
  assert(runtime.book().tables.has('sheet_demo'));
  const tm = createTimeMachine({ runtime, warn() {} });
  assert.equal(tm.timeline()[0].structureOnly, true);
  assert.equal(tm.veto(1, []), false);
  const removed = runtime.pruneEntriesAtAnchors(new Set([runtime.visibleEntries()[0].at.anchor]));
  assert(removed.pruned > 0);
  assert.equal(runtime.book().tables.get('sheet_demo').name, '测试表');
  assert.deepEqual(runtime.book().tables.get('sheet_demo').rows.get(10), before);
  await runtime.flush();
});


test('人工修改先整批校验必填和唯一约束，新增也拒绝重复唯一值', () => {
  const f = fixture();
  f.table.ddlInfo = { maxRowCount: 0, columns: [
    { header: '姓名', notNull: true, unique: true }, { header: '备注', notNull: true, unique: false },
  ] };
  const before = api.projectWorkbook(f.book);
  assert.throws(() => f.workbench.save(f.snapshot(), 20, ['名字1', '备注2']), /唯一列不能重复/);
  assert.throws(() => f.workbench.save(f.snapshot(), 20, ['', '备注2']), /必填列/);
  assert.throws(() => f.workbench.save(f.snapshot(), 20, ['先校验通过的姓名', '']), /必填列/);
  assert.throws(() => f.workbench.save(f.snapshot([]), null, ['名字1', '新增备注']), /唯一列不能重复/);
  assert.throws(() => f.workbench.save(f.snapshot([]), null, ['', '新增备注']), /必填列/);
  assert.throws(() => f.workbench.save(f.snapshot([]), null, ['新增姓名', '']), /必填列/);
  assert.equal(f.commits.length, 0);
  assert.equal(f.table.rowIdHighWater, 30);
  assert.deepEqual(api.projectWorkbook(f.book), before);
  assert.equal(f.workbench.save(f.snapshot([]), null, ['新增姓名', '新增备注']), true);
  assert.deepEqual(f.table.rows.get(31), ['31', '新增姓名', '新增备注']);
});

test('只检查本次修改，不因无关历史必填或唯一违规阻止修改其他格', () => {
  const f = fixture();
  f.table.ddlInfo = { maxRowCount: 0, columns: [
    { header: '姓名', notNull: true, unique: true }, { header: '备注', notNull: false, unique: false },
  ] };
  f.table.rows.get(10)[1] = '';
  f.table.rows.get(30)[1] = '名字2';
  assert.equal(f.workbench.save(f.snapshot(), 20, ['名字2', '只修改备注']), true);
  assert.equal(f.table.rows.get(20)[2], '只修改备注');
  assert.deepEqual(f.commits[0].ops, [{ kind: 'cell', table: 'sheet_demo', rowId: 20, column: '备注', value: '只修改备注' }]);
});

for (const dismiss of ['Escape', 'cancel', 'mask']) test('全屏脏草稿关闭保护：' + dismiss, async () => {
  const u = uiFixture();
  try {
    u.pane.querySelector('[data-edit="20"]').click();
    const parent = u.doc.querySelector('[data-field="0"]');
    parent.value = '主编辑草稿';
    u.doc.querySelector('[data-expand="0"]').click();
    const modal = u.doc.querySelector('.slw-data-full');
    const area = modal.querySelector('textarea');
    area.value = '全屏唯一草稿';
    const close = () => {
      if (dismiss === 'Escape') area.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (dismiss === 'cancel') modal.querySelector('[data-close]').click();
      else modal.closest('.slw-dialog-mask').click();
    };
    close();
    assert(u.doc.querySelector('[data-slw-ask]'));
    u.doc.querySelector('[data-slw-ask-cancel]').click();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(modal.isConnected, true);
    assert.equal(area.value, '全屏唯一草稿');
    assert.equal(parent.value, '主编辑草稿');
    assert(u.doc.querySelector('[data-slw-editor]'));
    close();
    assert(u.doc.querySelector('[data-slw-ask]'));
    u.doc.querySelector('[data-slw-ask-ok]').click();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(modal.isConnected, false);
    assert.equal(parent.value, '主编辑草稿');
    assert(u.doc.querySelector('[data-slw-editor]'));
    assert.equal(u.commits.length, 0);
  } finally { u.close(); }
});

test('全屏无修改直接关闭，确认放弃时取消不影响随后保留到草稿', async () => {
  const u = uiFixture();
  try {
    u.pane.querySelector('[data-edit="20"]').click();
    const parent = u.doc.querySelector('[data-field="0"]');
    u.doc.querySelector('[data-expand="0"]').click();
    u.doc.querySelector('.slw-data-full [data-close]').click();
    assert.equal(u.doc.querySelector('.slw-data-full'), null);
    assert.equal(u.doc.querySelector('[data-slw-ask]'), null);
    u.doc.querySelector('[data-expand="0"]').click();
    u.doc.querySelector('.slw-data-full textarea').value = '确认后继续编辑';
    u.doc.querySelector('.slw-data-full [data-close]').click();
    u.doc.querySelector('[data-slw-ask-cancel]').click();
    await Promise.resolve(); await Promise.resolve();
    u.doc.querySelector('.slw-data-full [data-apply]').click();
    assert.equal(parent.value, '确认后继续编辑');
    assert.equal(u.doc.querySelector('.slw-data-full'), null);
    assert(u.doc.querySelector('[data-slw-editor]'));
    assert.equal(u.commits.length, 0);
  } finally { u.close(); }
});

test('真实运行时：人工必填和唯一违规不入账，合法修改才落一条流水', async () => {
  const result = await build({ absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), entryPoints: ['src/sese-ledger/core/runtime.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { createLedgerRuntime } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const source = template();
  source.sheet_demo.ledgerV2 = { tableId: 'sheet_demo', name: '测试表', orderNo: 0, groupId: 1, worldbook: { enabled: false }, columns: [
    { header: '姓名', type: 'text', unique: true, notNull: true }, { header: '备注', type: 'text', unique: false, notNull: true },
  ] };
  const chat = [{ is_user: false, id: 'manual-a1', mes: '正文' }];
  const files = new Map(); const metadata = {};
  const store = { async readJson(name) { return files.has(name) ? { found: true, value: files.get(name) } : { found: false }; }, async uploadJson(name, value) { files.set(name, JSON.parse(JSON.stringify(value))); return { ok: true }; } };
  const runtime = createLedgerRuntime({ host: { context: () => ({ chat, chatKey: 'c', characterId: 'char', host: { chat, chatMetadata: metadata, saveChatMetadata: async () => {} } }) }, files: store, index: { readIndex: async () => ({ chats: {} }), writeIndex: async () => {} }, standardTemplate: source, previousChatExists: async () => false });
  await runtime.onChatChanged(); await runtime.ensureSeeded();
  const wb = api.createDataWorkbench({ runtime, getChat: () => chat, isBusy: () => false, getLocks: () => null });
  assert.equal(runtime.book().tables.get('sheet_demo').ddlInfo.columns.find(c => c.header === '姓名').unique, true);
  const before = api.projectWorkbook(runtime.book());
  assert.throws(() => wb.save(wb.capture('sheet_demo', [20]), 20, ['名字1', '备注2']), /唯一列不能重复/);
  assert.throws(() => wb.save(wb.capture('sheet_demo', [20]), 20, ['新名字', '']), /必填列/);
  assert.throws(() => wb.save(wb.capture('sheet_demo'), null, ['名字1', '新备注']), /唯一列不能重复/);
  assert.equal(runtime.visibleEntries().length, 0);
  assert.deepEqual(api.projectWorkbook(runtime.book()), before);
  assert.equal(wb.save(wb.capture('sheet_demo', [20]), 20, ['合法新名字', '备注2']), true);
  assert.equal(runtime.visibleEntries().length, 1);
  await runtime.flush();
  const entries = [...files.values()].flatMap(value => value.entries || []);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].ops, [{ kind: 'cell', table: 'sheet_demo', rowId: 20, column: '姓名', value: '合法新名字' }]);
});
