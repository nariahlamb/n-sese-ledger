import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['src/sese-ledger/core/template-preview.ts', 'src/sese-ledger/core/book.ts', 'src/sese-ledger/core/field-contracts.ts'], bundle: true, write: false, format: 'esm', platform: 'node', outdir: 'out', logLevel: 'silent' });
const load = name => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles.find(file => file.path.endsWith(`/${name}.js`)).text).toString('base64')}`);
const { previewTemplateChange, templatePreviewLines } = await load('template-preview');
const { createBook, projectWorkbook } = await load('book');
const { createFieldContractRegistry } = await load('field-contracts');

function fixture(withEmotion = true) {
  return { mate: { type: 'chatSheets' }, sheet_1: { uid: 'sheet_1', name: '在场角色表', orderNo: 1, sourceData: {},
    content: [['row_id', '姓名', ...(withEmotion ? ['情绪'] : [])], ['1', '小满', ...(withEmotion ? ['开心'] : [])]],
    ledgerV2: { tableId: 'sheet_1', name: '在场角色表', orderNo: 1, groupId: 1, readMode: 'all',
      columns: [{ header: '姓名', type: 'text' }, ...(withEmotion ? [{ header: '情绪', type: 'text' }] : [])],
      worldbook: { enabled: false }, triggerNotes: {} } } };
}

test('预览在副本计算，报告丢列、非空格子与三插件字段影响', () => {
  const book = createBook(fixture());
  const original = JSON.stringify(projectWorkbook(book));
  const fields = createFieldContractRegistry(() => book);
  fields.register('n-sese-unified-statusbar', '瑟瑟灵感状态栏', [
    { table: '在场角色表', column: '情绪', feature: '立绘表情', required: false },
    { table: '在场角色表', column: '情绪', feature: '地图', required: false },
  ]);
  fields.register('n-sese-phone', '瑟瑟小手机', [{ table: '在场角色表', column: '情绪', feature: '通讯录', required: false }]);
  const preview = previewTemplateChange(book, fixture(false), fields);
  const lines = templatePreviewLines(preview).join('\n');
  assert.equal(preview.ok, true, preview.errors.join('；'));
  assert.deepEqual(preview.report.droppedColumns, [{ table: '在场角色表', columns: ['情绪'] }]);
  assert.deepEqual(preview.droppedColumnCells, [{ table: '在场角色表', column: '情绪', cells: 1 }]);
  for (const text of ['立绘表情', '地图', '瑟瑟小手机', '在场角色表', '情绪', '1 个非空格子']) assert(lines.includes(text));
  assert.equal(JSON.stringify(projectWorkbook(book)), original);
});

test('字段登记去重、缺列去重计数与改名删除影响', () => {
  const book = createBook(fixture());
  const fields = createFieldContractRegistry(() => book);
  fields.register('plugin', '插件', [{ table: '在场角色表', column: '情绪', feature: '功能' }, { table: '在场角色表', column: '情绪', feature: '功能' }]);
  assert.equal(fields.list().length, 1);
  assert.equal(fields.list()[0].items.length, 1);
  fields.reportMissing('plugin', '在场角色表', '情绪', '功能');
  fields.reportMissing('plugin', '在场角色表', '情绪', '功能');
  assert.equal(fields.health()[0].missing, false);
  assert.equal(fields.health()[0].missingCount, 2);
  assert.equal(fields.impacts([{ table: '在场角色表', column: '情绪', toColumn: '心情', kind: 'rename' }])[0].to, '心情');
  assert.equal(fields.impacts([{ table: '在场角色表', kind: 'delete' }]).length, 1);
  assert.equal(fields.impacts([{ table: '别的表', kind: 'delete' }]).length, 0);
});

test('真实“生活化 → 去情绪”模板预览指出情绪列；本地模板缺失时显式跳过', async t => {
  let from, to;
  try {
    from = JSON.parse(await readFile(new URL('../notes/templates/瑟瑟生活化.json', import.meta.url), 'utf8'));
    to = JSON.parse(await readFile(new URL('../notes/templates/瑟瑟生活化-去情绪.json', import.meta.url), 'utf8'));
  } catch { t.skip('本地用户模板未提供，不用Git或宿主路径替代'); return; }
  const { normalizeTemplateForApply } = await load('template-preview');
  const normalizedFrom = normalizeTemplateForApply(from);
  const book = createBook(normalizedFrom.workbook);
  const table = [...book.tables.values()].find(item => item.name === '在场角色表');
  table.rows.set(1, table.headers.map(header => header === '情绪' ? '开心' : '夹具'));
  const original = JSON.stringify(projectWorkbook(book));
  const fields = createFieldContractRegistry(() => book);
  fields.register('n-sese-unified-statusbar', '瑟瑟灵感状态栏', [{ table: '在场角色表', column: '情绪', feature: '立绘表情 / 地图', required: false }]);
  fields.register('n-sese-phone', '瑟瑟小手机', [{ table: '在场角色表', column: '情绪', feature: '通讯录', required: false }]);
  const preview = previewTemplateChange(book, to, fields);
  assert(preview.droppedColumnCells.some(item => item.table === '在场角色表' && item.column === '情绪'));
  assert(preview.impacts.some(item => item.feature.includes('立绘')));
  assert(preview.impacts.some(item => item.pluginId === 'n-sese-phone'));
  assert.equal(JSON.stringify(projectWorkbook(book)), original);
});

test('模板归一化不改调用方对象；字段注册保留两插件签名', () => {
  const input = { schemaVersion: 2, name: '测试', groups: [{ id: 1, name: '组1', frequency: 1 }], tables: [{ tableId: 'sheet_1', name: '在场角色表', groupId: 1, readMode: 'trigger', columns: [{ header: '姓名', type: 'text' }], worldbook: { enabled: true, mode: 'keyword', keywordsColumn2: '不存在' } }] };
  const before = JSON.stringify(input);
  const book = createBook(fixture());
  previewTemplateChange(book, input, createFieldContractRegistry(() => book));
  assert.equal(JSON.stringify(input), before);
  const fields = createFieldContractRegistry(() => book);
  fields.register([{ table: '在场角色表', column: '姓名', feature: '台账工作台', required: true }]);
  assert.equal(fields.list()[0].pluginId, 'n-sese-ledger');
});

test('整表改名也报告列消费者；未建账不判缺失，多功能诊断分别计数', async () => {
  const { createFieldContractRegistry } = await load('field-contracts');
  const { normalizeTemplateForApply, previewTemplateChange } = await load('template-preview');
  const { createBook } = await load('book');
  let book = null;
  const fields = createFieldContractRegistry(() => book);
  fields.register('bar', '状态栏', [{ table: '在场角色表', column: '姓名', feature: '立绘' }, { table: '在场角色表', column: '姓名', feature: '地图' }]);
  assert(fields.health().every(item => item.evaluated === false && item.missing === false));
  book = createBook(normalizeTemplateForApply(fixture()).workbook);
  fields.reportMissing('bar', '在场角色表', '姓名', '立绘');
  fields.reportMissing('bar', '在场角色表', '姓名', '地图');
  assert.deepEqual(fields.health().map(item => item.missingCount), [1, 1]);
  const next = fixture();
  next.sheet_1.name = '改名后的表';
  next.sheet_1.ledgerV2.name = '改名后的表';
  const preview = previewTemplateChange(book, next, fields);
  assert.equal(preview.ok, true);
  assert.equal(preview.impacts.length, 2);
  assert(preview.impacts.every(item => item.kind === 'rename' && item.to === '改名后的表'));
  fields.reportMissing('bar', '在场角色表');
  assert.deepEqual(fields.health().map(item => item.missingCount), [2, 2]);
});
