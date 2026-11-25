import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

async function loadTs(path) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [path],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const bookMod = await loadTs('src/sese-ledger/core/book.ts');
const blueprintMod = await loadTs('src/sese-ledger/core/blueprint.ts');
const scribeMod = await loadTs('src/sese-ledger/core/scribe.ts');
const aiReqMod = await loadTs('src/sese-ledger/core/ai-request.ts');
const directorMod = await loadTs('src/sese-ledger/core/director.ts');

const standardTemplateJson = JSON.parse(
  fs.readFileSync(new URL('../src/sese-ledger/assets/standard-template.json', import.meta.url), 'utf8'),
);

function buildStandardBook() {
  const wb = blueprintMod.v2TemplateToWorkbook(standardTemplateJson);
  return bookMod.createBook(wb);
}

function insertRow(book, tableName, rowObj) {
  const table = bookMod.resolveTable(book, tableName);
  assert.ok(table, `缺少表 ${tableName}`);
  const rowId = bookMod.allocateRowId(table);
  const cells = table.headers.map((h, i) => (i === 0 ? String(rowId) : String(rowObj[h] ?? '')));
  table.rows.set(rowId, cells);
  return rowId;
}

test('标准模板已升级为 19 张表：新增角色心路档案表且放宽恋爱日记表准入说明', () => {
  const validated = blueprintMod.validateV2Template(standardTemplateJson);
  assert.equal(validated.ok, true, `模板校验失败: ${validated.errors.join('; ')}`);
  assert.equal(standardTemplateJson.tables.length, 19);

  const orders = standardTemplateJson.tables.map((t) => t.orderNo);
  assert.equal(new Set(orders).size, 19, '各表 orderNo 必须单调唯一无冲突');
  for (let i = 1; i < orders.length; i++) {
    assert.ok(orders[i] > orders[i - 1], `orderNo 未保持严格递增：${orders[i - 1]} -> ${orders[i]}`);
  }

  const diary = standardTemplateJson.tables.find((t) => t.tableId === 'sheet_romance_diary');
  assert.ok(diary);
  assert.equal(diary.name, '恋爱日记表');
  assert.deepEqual(diary.columns.map((c) => c.header), ['写作角色', '关联角色', '日记内容', '发生时间', '事件类型']);
  assert.equal(diary.readMode, 'none');
  assert.equal(diary.worldbook?.enabled, false);
  assert.match(diary.note, /恋爱对象表或重要角色表/);
  assert.match(diary.note, /主观心境切面/);
  assert.match(diary.triggerNotes?.insert || '', /恋爱对象表或重要角色表/);

  const mind = standardTemplateJson.tables.find((t) => t.tableId === scribeMod.MIND_PROFILE_TABLE_ID);
  assert.ok(mind);
  assert.equal(mind.name, scribeMod.MIND_PROFILE_TABLE_NAME);
  assert.equal(mind.groupId, 1);
  assert.equal(mind.orderNo, 10);
  assert.equal(mind.readMode, 'none');
  assert.deepEqual(mind.worldbook, {
    enabled: false,
    mode: 'keyword',
    keywordsColumn: '姓名',
    wrapTag: 'char_mind_profile',
    placement: { position: 'before_character_definition', order: 10002 },
  });
  assert.equal(mind.columns.length, 7);
  assert.ok(mind.columns.every((c) => c.type === 'text'));
  assert.deepEqual(
    mind.columns.map((c) => c.header),
    ['姓名', '人格底色与筹码', '已知事实与盲点', '四向关系认知', '个人进度与打算', '核心纠结与情绪惯性', '蝴蝶效应留痕'],
  );
  assert.equal(mind.columns[0].unique, true);
  assert.equal(mind.columns[0].notNull, true);
  assert.match(mind.note, /1000/);
  assert.match(mind.note, /EQUIV_BAN/);
  assert.match(mind.note, /Pool_1/);
  assert.match(mind.note, /退火与台阶机制/);
  assert.match(mind.note, /钻牛角尖/);

  const missionTable = standardTemplateJson.tables.find((t) => t.name === '瑟瑟任务表');
  assert.ok(missionTable);
  assert.equal(missionTable.tableId, 'sheet_k7gp2gbw7');
  assert.deepEqual(
    missionTable.columns.map((c) => c.header),
    ['任务名称', '任务描述', '任务目标', '完成情况'],
  );
  assert.match(missionTable.note, /1 条瑟瑟任务 \+ 4 条日常\/社交\/探索任务/);
  assert.match(missionTable.note, /严禁流水账/);
});

test('computeUpdatePlan 默认摘除角色心路档案表，关闭隔离时可回退打包；selectMindFillTargets 按优先级排序截断', () => {
  const book = buildStandardBook();
  const chat = [{ is_user: true, mes: '开局' }, { is_user: false, mes: '正文1' }];
  const planIsolated = scribeMod.computeUpdatePlan(book, chat, {}, scribeMod.DEFAULT_SCHEDULE_GLOBALS);
  const isolatedIds = planIsolated.flatMap((g) => g.tableIds);
  assert.equal(isolatedIds.includes(scribeMod.MIND_PROFILE_TABLE_ID), false);

  const planCombined = scribeMod.computeUpdatePlan(
    book,
    chat,
    {},
    { ...scribeMod.DEFAULT_SCHEDULE_GLOBALS, isolatedMindFillEnabled: false },
  );
  assert.equal(planCombined.flatMap((g) => g.tableIds).includes(scribeMod.MIND_PROFILE_TABLE_ID), true);

  insertRow(book, '主角信息表', { 姓名: '林默' });
  insertRow(book, '恋爱对象表', { 姓名: '苏晴' });
  insertRow(book, '恋爱对象表', { 姓名: '温晚' });
  insertRow(book, '重要角色表', { 姓名: '林月' });
  insertRow(book, '重要角色表', { 姓名: '周澈' });
  insertRow(book, '重要角色表', { 姓名: '陆沉' });
  // 在场：温晚（未提及）、苏晴（提及 1 次）
  insertRow(book, '在场角色表', { 姓名: '温晚' });
  insertRow(book, '在场角色表', { 姓名: '苏晴' });
  // 路人甲未建档、林默为主角，均应排除
  insertRow(book, '在场角色表', { 姓名: '林默' });
  insertRow(book, '在场角色表', { 姓名: '路人甲' });

  const story = '林默推门而入，先看见苏晴站在窗边。随后手机亮起，周澈发来两条消息：周澈催促他快去实验室。林月没有出现。';
  // ① 在场且提及：苏晴；② 仅在场：温晚；③ 仅提及按频次降序：周澈(2次) > 林月(1次)；陆沉未出现忽略
  assert.deepEqual(scribeMod.selectMindFillTargets(book, story, 3), ['苏晴', '温晚', '周澈']);
  assert.deepEqual(scribeMod.selectMindFillTargets(book, story, 5), ['苏晴', '温晚', '周澈', '林月']);
  assert.deepEqual(scribeMod.selectMindFillTargets(book, story, 0), []);
});

test('物理隔离硬测试：苏晴与林月互不泄露秘密与日记，且剥除日记 span 标签，scanText 仅传单人姓名', () => {
  const book = buildStandardBook();
  insertRow(book, '恋爱对象表', { 姓名: '苏晴', 一句话介绍: 'SECRET_A_BASE_女总裁' });
  insertRow(book, '重要角色表', { 姓名: '林月', 一句话介绍: 'SECRET_B_BASE_卧底' });

  const rowA = insertRow(book, '角色心路档案表', {
    姓名: '苏晴',
    人格底色与筹码: 'SECRET_A_MIND_筹码在暗格里',
    核心纠结与情绪惯性: '上轮被主角敷衍后余怒未消',
  });
  insertRow(book, '角色心路档案表', {
    姓名: '林月',
    人格底色与筹码: 'SECRET_B_MIND_掌握匿名录音',
    核心纠结与情绪惯性: '怀疑对方已经察觉',
  });

  insertRow(book, '恋爱日记表', {
    写作角色: '苏晴',
    关联角色: '主角',
    日记内容: '<span class="handwritten">SECRET_A_DIARY_绝不低头</span>，今天只是试探。',
    发生时间: '2026-06-05 20:00',
    事件类型: '试探',
  });
  insertRow(book, '恋爱日记表', {
    写作角色: '林月',
    关联角色: '主角',
    日记内容: '<span class="censored">SECRET_B_DIARY_今晚动手</span>，盯紧仓库。',
    发生时间: '2026-06-05 21:00',
    事件类型: '潜伏',
  });

  const specA = scribeMod.buildIsolatedMindFillRequest(book, '苏晴', { storyText: '雨夜办公室对峙。' }, {});
  const textA = JSON.stringify(specA);
  assert.equal(specA.scanText, '苏晴');
  assert.match(textA, /SECRET_A_BASE_女总裁/);
  assert.match(textA, /SECRET_A_MIND_筹码在暗格里/);
  assert.match(textA, /SECRET_A_DIARY_绝不低头/);
  assert.ok(textA.includes(`|${rowA}|苏晴|`) || textA.includes(`${rowA}|苏晴|`));
  assert.doesNotMatch(textA, /<span/i);
  assert.doesNotMatch(textA, /SECRET_B_/);
  assert.doesNotMatch(textA, /林月/);

  const specB = scribeMod.buildIsolatedMindFillRequest(book, '林月', { storyText: '雨夜办公室对峙。' }, {});
  const textB = JSON.stringify(specB);
  assert.equal(specB.scanText, '林月');
  assert.match(textB, /SECRET_B_BASE_卧底/);
  assert.match(textB, /SECRET_B_MIND_掌握匿名录音/);
  assert.match(textB, /SECRET_B_DIARY_今晚动手/);
  assert.doesNotMatch(textB, /<span/i);
  assert.doesNotMatch(textB, /SECRET_A_/);
  assert.doesNotMatch(textB, /苏晴/);

  // 尚无心路档案行的新角色应投影为空，引导 INSERT
  insertRow(book, '重要角色表', { 姓名: '周澈', 一句话介绍: '新角色档案' });
  const specNew = scribeMod.buildIsolatedMindFillRequest(book, '周澈', { storyText: '周澈出场。' }, {});
  assert.match(specNew.blocks.dossier || '', /【已有数据】空/);
});

test('隔离校验护栏：拦截越权 UPDATE 他人行、INSERT 他人姓名、修改其他表或 DELETE', () => {
  const book = buildStandardBook();
  const rowA = insertRow(book, '角色心路档案表', { 姓名: '苏晴', 个人进度与打算: '查账' });
  const rowB = insertRow(book, '角色心路档案表', { 姓名: '林月', 个人进度与打算: '撤离' });

  // 合法 UPDATE 自己行
  const okUpdate = scribeMod.parseIsolatedMindFillOutput(
    book,
    '苏晴',
    `UPDATE 角色心路档案表 SET 个人进度与打算 = '先按兵不动' WHERE row_id = ${rowA};`,
  );
  assert.equal(okUpdate.errors.length, 0);
  assert.equal(okUpdate.ops.length, 1);

  // 合法 INSERT 自己姓名
  const okInsert = scribeMod.parseIsolatedMindFillOutput(
    book,
    '周澈',
    `INSERT INTO 角色心路档案表 (姓名, 个人进度与打算) VALUES ('周澈', '准备赴约');`,
  );
  assert.equal(okInsert.errors.length, 0);
  assert.equal(okInsert.ops.length, 1);

  // 越权 UPDATE 林月 row_id
  const badRow = scribeMod.parseIsolatedMindFillOutput(
    book,
    '苏晴',
    `UPDATE 角色心路档案表 SET 个人进度与打算 = '被篡改' WHERE row_id = ${rowB};`,
  );
  assert.equal(badRow.ops.length, 0);
  assert.ok(badRow.errors.some((e) => e.includes('越权')));

  // 越权 INSERT 他人姓名
  const badInsert = scribeMod.parseIsolatedMindFillOutput(
    book,
    '苏晴',
    `INSERT INTO 角色心路档案表 (姓名, 个人进度与打算) VALUES ('林月', '冒名写入');`,
  );
  assert.equal(badInsert.ops.length, 0);
  assert.ok(badInsert.errors.some((e) => e.includes('越权')));

  // 越权操作其他表
  const badTable = scribeMod.parseIsolatedMindFillOutput(
    book,
    '苏晴',
    `INSERT INTO 恋爱对象表 (姓名, 一句话介绍) VALUES ('苏晴', '越权写基础表');`,
  );
  assert.equal(badTable.ops.length, 0);
  assert.ok(badTable.errors.some((e) => e.includes('越权')));

  // 禁止 DELETE
  const badDelete = scribeMod.parseIsolatedMindFillOutput(
    book,
    '苏晴',
    `DELETE FROM 角色心路档案表 WHERE row_id = ${rowA};`,
  );
  assert.equal(badDelete.ops.length, 0);
  assert.ok(badDelete.errors.some((e) => e.includes('越权')));
});

test('runScheduledFill：常规组先落账，隔离通道并发更新且单角色失败仅报 warn 不阻塞常规组', async () => {
  assert.equal(scribeMod.isIsolatedMindFillEnabled(undefined), true);
  assert.equal(scribeMod.isIsolatedMindFillEnabled({ isolatedMindFillEnabled: false }), false);
  assert.equal(scribeMod.resolveMindFillMaxChars(undefined), 3);
  assert.equal(scribeMod.resolveMindFillMaxChars({ isolatedMindFillMaxChars: 0 }), 0);
  assert.equal(scribeMod.resolveMindFillMaxChars({ isolatedMindFillMaxChars: 99 }), 5);

  const book = buildStandardBook();
  insertRow(book, '恋爱对象表', { 姓名: '苏晴' });
  insertRow(book, '重要角色表', { 姓名: '林月' });
  insertRow(book, '在场角色表', { 姓名: '苏晴' });
  insertRow(book, '在场角色表', { 姓名: '林月' });

  const chat = [
    { is_user: true, mes: '进屋' },
    { is_user: false, mes: '苏晴和林月都在客厅里对峙。' },
  ];
  let schedule = {};
  const committed = [];
  const reports = [];
  const runtime = {
    isReady: () => true,
    ensureSeeded: async () => true,
    book: () => book,
    getSchedule: () => ({ ...schedule }),
    patchSchedule: async (next) => { schedule = { ...next }; return true; },
    flush: async () => true,
    notifyFillStart: () => {},
    commitOps: (source, ops, opts) => {
      committed.push({ source, ops, opts });
      for (const op of ops) bookMod.applyOp(book, op);
      return { ok: true, changedTables: [], errors: [], at: opts?.target };
    },
  };

  const summary = await scribeMod.runScheduledFill({
    runtime,
    getChat: () => chat,
    readSettings: () => ({ autoFillEnabled: true, fillMaxAttempts: 1, isolatedMindFillEnabled: true, isolatedMindFillMaxChars: 3 }),
    report: (ev) => reports.push(ev),
    requestFill: async (spec) => {
      if (spec.scanText === '苏晴') {
        return `INSERT INTO 角色心路档案表 (姓名, 核心纠结与情绪惯性) VALUES ('苏晴', '警惕林月的目的');`;
      }
      if (spec.scanText === '林月') {
        throw new Error('林月通道模拟超时');
      }
      // 常规组返回一个简单的全局数据更新
      return '';
    },
  });

  assert.equal(summary.skipped, false);
  assert.equal(summary.errors.length, 0, '单角色隔离失败不得塞进常规致命 error');
  assert.ok(reports.some((r) => r.level === 'warn' && r.message.includes('林月')));

  const mindTable = bookMod.resolveTable(book, scribeMod.MIND_PROFILE_TABLE_NAME);
  assert.equal(mindTable.rows.size, 1);
  const firstRow = [...mindTable.rows.values()][0];
  assert.equal(firstRow[1], '苏晴');
  assert.ok(schedule[scribeMod.MIND_PROFILE_TABLE_ID] >= 1);
});

test('buildMindBriefBlock 与 plot-preset-magic-recall 含/不含 radar 的提示词组装', () => {
  const book = buildStandardBook();
  assert.equal(directorMod.buildMindBriefBlock(book, ['苏晴'], '正文', '输入'), '');

  insertRow(book, '恋爱对象表', { 姓名: '苏晴' });
  insertRow(book, '重要角色表', { 姓名: '林月' });
  insertRow(book, '角色心路档案表', {
    姓名: '苏晴',
    人格底色与筹码: '嘴硬心细，手里握着旧合同',
    已知事实与盲点: '不知道林月已经换了钥匙',
    核心纠结与情绪惯性: '对昨晚爽约仍存心结',
    个人进度与打算: '长计划：' + '查账'.repeat(420),
  });
  insertRow(book, '恋爱日记表', {
    写作角色: '苏晴',
    关联角色: '主角',
    日记内容: '<span class="emphasis">绝不能再心软</span>，先把协议核清楚。',
    发生时间: '2026-06-05 22:00',
    事件类型: '独白',
  });

  const brief = directorMod.buildMindBriefBlock(book, ['苏晴'], '林月站在楼梯口。', '继续追问');
  assert.match(brief, /^【角色心路与心境切片】/);
  assert.match(brief, /【苏晴】/);
  assert.match(brief, /绝不能再心软/);
  assert.doesNotMatch(brief, /<span/i);
  assert.doesNotMatch(brief, /【林月】/, '7 维与日记均为空的角色不应输出空块');
  const suChunk = brief.slice(brief.indexOf('【苏晴】'));
  assert.ok(suChunk.length <= 750, `单人摘要超限：${suChunk.length}`);

  // expandLedgerItems 空串跳过，有内容输出
  const skippedExpanded = aiReqMod.expandLedgerItems([{ kind: 'block', block: 'mindBrief' }], { mindBrief: '' });
  assert.equal(skippedExpanded.length, 0);
  const keptExpanded = aiReqMod.expandLedgerItems([{ kind: 'block', block: 'mindBrief' }], { mindBrief: brief });
  assert.equal(keptExpanded.length, 1);
  assert.equal(keptExpanded[0].role, 'system');

  const preset = directorMod.builtinDriverPreset('魔改召回');
  assert.equal(preset.promptGroup.some((m) => m.block === 'mindBrief'), true);
  assert.ok(directorMod.splitTags(preset.tags).includes('radar'));
  assert.match(preset.promptGroup[0].content, /止损与台阶法则/);
  assert.match(preset.promptGroup[0].content, /克制标点与反热血漫腔/);
  assert.match(preset.finalDirectiveTemplate, /尖锐但给台阶/);
  assert.match(preset.finalDirectiveTemplate, /克制感叹号（！）/);

  const baseRaw = [
    '<recall>AM0001</recall>',
    '<soul>【主角】无认知盲点\n【苏晴】不知道钥匙被换 | 保持戒备</soul>',
    '<chaos_bg>chaos_bg=10</chaos_bg>',
    '<chaos_char>苏晴=15</chaos_char>',
    '<spot>客厅</spot>',
  ].join('\n');

  const withoutRadar = directorMod.assembleFinalDirective({
    preset,
    userInput: '你好',
    raw: baseRaw + '\n<radar>无</radar>',
  });
  assert.doesNotMatch(withoutRadar, /<radar>|\{\{radar\}\}/);
  assert.doesNotMatch(withoutRadar, /\n\n\n/, '无 radar 时不得留下多余连续空行');

  const withRadar = directorMod.assembleFinalDirective({
    preset,
    userInput: '你好',
    raw: baseRaw + '\n<radar>【苏晴】以为危机只在合同，未察觉门锁已换</radar>',
  });
  assert.match(withRadar, /<radar>【苏晴】以为危机只在合同，未察觉门锁已换<\/radar>/);
});

test('魔改召回已退居幕后辅助分析定位，不越权接管正文角色锚与走向裁定', () => {
  const preset = directorMod.builtinDriverPreset('魔改召回');
  assert.doesNotMatch(preset.promptGroup[0].content, /你是本轮剧情的推演导演/);
  assert.match(preset.promptGroup[0].content, /幕后辅助分析师/);
  assert.doesNotMatch(preset.finalDirectiveTemplate, /以下内容须在正文中自然遵从演绎/);
  assert.match(preset.finalDirectiveTemplate, /以下为后台辅助分析与记忆参考（非强制指令/);
  assert.match(preset.finalDirectiveTemplate, /由正文角色锚与推演自主裁定/);
});
