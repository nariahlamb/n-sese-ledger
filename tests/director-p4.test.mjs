import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function loadTs(path) {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'esm',
    target: 'node22', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const director = await loadTs('src/sese-ledger/core/director.ts');
const bridge = await loadTs('src/sese-ledger/core/statusbar-cognition.ts');

/** v1 旧快照：两段式 candidates（primary + references）。 */
function rawV1Snapshot() {
  return {
    version: 1,
    chatIdentity: 'chat-a',
    chatKey: 'storage-chat-a',
    available: true,
    characters: {
      苏晴: { knownFacts: ['知道主角见过店长'] },
      李明: { knownFacts: ['知道约定在今晚'] },
    },
    restrictions: { protagonistOmniscienceForbidden: true, externalIntrusionBlocked: false },
    candidates: {
      primary: { eventId: 'arrival-1', title: '店长到访', entryCue: '门铃响后，熟悉的脚步停在桌边', desc: '完整幕后描述' },
      references: [{ eventId: 'reference-1', title: '码头来讯', entryCue: '一封短信送到柜台' }],
    },
  };
}

/** v2 快照：结构化事件池 + 时空/守护/委派标记。 */
function rawV2Snapshot(overrides = {}) {
  return {
    version: 2,
    chatIdentity: 'chat-a',
    available: true,
    dateKey: '2026-06-05',
    playerRegion: '星海商圈',
    onStageNames: ['苏晴'],
    sceneGuard: { blocked: false, reason: '' },
    worldbookDelegated: true,
    characters: { 苏晴: { knownFacts: ['知道主角见过店长'] } },
    restrictions: { protagonistOmniscienceForbidden: true, externalIntrusionBlocked: false },
    eventPool: [
      {
        id: 'arrive-1',
        kind: 'character_arrival',
        title: '店长到访',
        cue: '门铃响后，熟悉的脚步停在桌边',
        refId: '店长',
        region: '星海商圈',
        expiresAtDay: '2026-06-05',
        publicInfo: '提着一只旧工具箱',
        reason: '同在星海商圈',
        condition: '非私密对话',
        epistemicBoundary: '苏晴不知道他的来意',
        level: 2,
        threadDriven: true,
        // 幕后字段：必须一个都不进台账
        desc: '绝密完整描述：其实他已经联系好走私船',
        hiddenGoal: '绝密目标：当晚撤离',
        goalProgress: 80,
      },
      { id: 'rumor-2', kind: 'rumor', title: '码头风声', cue: '邻桌压低声音提到夜里的船' },
    ],
    ...overrides,
  };
}

function v2Context(overrides = {}) {
  return {
    userInput: '继续', lastPlot: '', lastPlotRaw: '', chronicleOverview: '', recentStory: '',
    statusbarSnapshot: bridge.normalizeStatusbarSnapshot(rawV2Snapshot(), 'chat-a'),
    ...overrides,
  };
}

test('两份内置预设：召回是 0～N 上限，不补位，不固定温柔/无条件主动，不凑盲点', async () => {
  for (const name of ['魔改召回', '极速纯召回']) {
    const preset = director.builtinDriverPreset(name);
    const text = JSON.stringify(preset);
    assert.match(text, /0～N/);
    assert.match(text, /同一组 AM/);
    assert.match(text, /召回 0 条/);
    assert.doesNotMatch(text, /必须达到\{\{召回数量\}\}|补足到|按照编号从大到小补充/);
    assert.doesNotMatch(text, /体现角色温柔的一面|角色按自身性格充分发挥主动性/);
    if (name === '魔改召回') {
      assert.match(text, /无盲点写“无认知盲点”，不得凑数或虚构/);
      assert.doesNotMatch(text, /盲点\/限制 1-3 条/);
    }
  }
});

test('v1 快照仍兼容：candidates 回退成 kind=arrival 的事件池；跨聊天/坏版本/坏格式回退', () => {
  const raw = rawV1Snapshot();
  const snapshot = bridge.normalizeStatusbarSnapshot(raw, 'chat-a');
  assert.deepEqual(snapshot.candidates, [
    { id: 'arrival-1', title: '店长到访', hook: '门铃响后，熟悉的脚步停在桌边' },
    { id: 'reference-1', title: '码头来讯', hook: '一封短信送到柜台' },
  ]);
  assert.deepEqual(snapshot.eventPool.map(e => [e.id, e.kind, e.cue]), [
    ['arrival-1', 'arrival', '门铃响后，熟悉的脚步停在桌边'],
    ['reference-1', 'arrival', '一封短信送到柜台'],
  ]);
  raw.characters.苏晴.knownFacts[0] = '外部篡改';
  raw.candidates.primary.entryCue = '外部篡改';
  assert.equal(snapshot.knownFacts.苏晴[0], '知道主角见过店长');
  assert.equal(snapshot.candidates[0].hook, '门铃响后，熟悉的脚步停在桌边');
  assert.equal(bridge.normalizeStatusbarSnapshot(rawV1Snapshot(), 'chat-b'), null);
  assert.equal(bridge.normalizeStatusbarSnapshot({ ...rawV1Snapshot(), version: 3 }, 'chat-a'), null);
  assert.equal(bridge.normalizeStatusbarSnapshot({ ...rawV1Snapshot(), characters: null }, 'chat-a'), null);
  assert.equal(bridge.normalizeStatusbarSnapshot({ ...rawV1Snapshot(), available: false }, 'chat-a'), null);
});

test('v2 快照：时空/守护/委派标记与结构化事件池全部保留，desc/hiddenGoal/goalProgress 一律丢弃', () => {
  const snapshot = bridge.normalizeStatusbarSnapshot(rawV2Snapshot(), 'chat-a');
  assert.ok(snapshot);
  assert.equal(snapshot.chatIdentity, 'chat-a');
  assert.equal(snapshot.dateKey, '2026-06-05');
  assert.equal(snapshot.playerRegion, '星海商圈');
  assert.deepEqual(snapshot.onStageNames, ['苏晴']);
  assert.deepEqual(snapshot.sceneGuard, { blocked: false, reason: '' });
  assert.equal(snapshot.worldbookDelegated, true);
  assert.equal(snapshot.eventPool.length, 2);
  assert.deepEqual(snapshot.eventPool[0], {
    id: 'arrive-1',
    kind: 'character_arrival',
    title: '店长到访',
    cue: '门铃响后，熟悉的脚步停在桌边',
    refId: '店长',
    region: '星海商圈',
    expiresAtDay: '2026-06-05',
    publicInfo: '提着一只旧工具箱',
    reason: '同在星海商圈',
    condition: '非私密对话',
    epistemicBoundary: '苏晴不知道他的来意',
    level: 2,
    threadDriven: true,
  });
  assert.deepEqual(snapshot.eventPool[1], { id: 'rumor-2', kind: 'rumor', title: '码头风声', cue: '邻桌压低声音提到夜里的船' });
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes('绝密完整描述'), 'v2 事件池不得携带 desc');
  assert.ok(!serialized.includes('绝密目标'), 'v2 事件池不得携带 hiddenGoal');
  assert.ok(!serialized.includes('goalProgress'));

  // 守护与委派
  const blocked = bridge.normalizeStatusbarSnapshot(rawV2Snapshot({ sceneGuard: { blocked: true, reason: '亲密场景' }, worldbookDelegated: false }), 'chat-a');
  assert.deepEqual(blocked.sceneGuard, { blocked: true, reason: '亲密场景' });
  assert.equal(blocked.worldbookDelegated, false);
  // 身份/版本仍是硬门槛
  assert.equal(bridge.normalizeStatusbarSnapshot(rawV2Snapshot(), 'chat-b'), null);
  assert.equal(bridge.normalizeStatusbarSnapshot({ ...rawV2Snapshot(), version: undefined }, 'chat-a'), null);
  assert.equal(bridge.normalizeStatusbarSnapshot({ ...rawV2Snapshot(), available: false }, 'chat-a'), null);
});

test('v1 外部闯入被守护拦下时事件池为空；v2 事件池原样交给提示层判断', () => {
  const v1Blocked = bridge.normalizeStatusbarSnapshot({
    ...rawV1Snapshot(),
    restrictions: { protagonistOmniscienceForbidden: true, externalIntrusionBlocked: true },
  }, 'chat-a');
  assert.deepEqual(v1Blocked.eventPool, []);
  assert.deepEqual(v1Blocked.candidates, []);
  assert.equal(bridge.buildStatusbarCandidatePrompt(v1Blocked), '');

  const v2Blocked = bridge.normalizeStatusbarSnapshot(rawV2Snapshot({ sceneGuard: { blocked: true, reason: '私密场景' } }), 'chat-a');
  assert.equal(v2Blocked.eventPool.length, 2);
});

test('状态栏桥缺席/抛错/只提供写方法都不阻断单开，且不发生任何状态栏写调用', () => {
  let writeCalls = 0;
  const writer = { writeSnapshot: () => { writeCalls++; }, setCandidate: () => { writeCalls++; } };
  for (const win of [null, {}, { __ubWorldCognitionSnapshot: writer }, { __ubWorldCognitionSnapshot: { getSnapshot() { throw new Error('bad bridge'); } } }]) {
    const result = bridge.readStatusbarNarrativeSnapshot({ getWindows: () => [win], getChatIdentity: () => 'chat-a' });
    assert.equal(result, null);
  }
  assert.equal(writeCalls, 0);
});

test('事件池提示段：结构化 [id] 类型/标题/切入线索/公开边界 + 宁缺毋滥/限量/认知隔离/回执规则', () => {
  const snapshot = bridge.normalizeStatusbarSnapshot(rawV2Snapshot(), 'chat-a');
  const text = bridge.buildStatusbarCandidatePrompt(snapshot);
  assert.match(text, /^<statusbar_events>/);
  assert.match(text, /<\/statusbar_events>$/);
  assert.match(text, /【当前时空】日期：2026-06-05；主角地区：星海商圈；在场：苏晴/);
  assert.match(text, /【事件池】共 2 条/);
  assert.match(text, /\[arrive-1\] character_arrival \| 店长到访 \| 门铃响后，熟悉的脚步停在桌边 \| .*公开：提着一只旧工具箱；边界：苏晴不知道他的来意；条件：非私密对话/);
  assert.match(text, /\[rumor-2\] rumor \| 码头风声 \| 邻桌压低声音提到夜里的船 \| （未标注）/);
  assert.match(text, /宁缺毋滥、严禁全推/);
  assert.match(text, /<world_cue> 必须留空/);
  assert.match(text, /每轮至多挑选 1 条主事件/);
  assert.match(text, /<chaos> 本轮已触发全局意外/);
  assert.match(text, /认知隔离/);
  assert.match(text, /<world_ack>/);
  assert.match(text, /pick: id \| targetTag\(world_cue 或 chaos\)/);
  assert.match(text, /skip: id1, id2/);
  assert.equal(bridge.buildStatusbarEventPoolPrompt(snapshot), text);
  assert.doesNotMatch(text, /绝密|hiddenGoal/);
});

test('守护拦下时提示段明写 world_cue 留空；事件池为空则不产生提示段', () => {
  const blocked = bridge.normalizeStatusbarSnapshot(rawV2Snapshot({ sceneGuard: { blocked: true, reason: '亲密场景' } }), 'chat-a');
  const text = bridge.buildStatusbarCandidatePrompt(blocked);
  assert.match(text, /【守护】状态栏判定当前场景不适合外部闯入（亲密场景）：本轮 <world_cue> 必须留空。/);

  const empty = bridge.normalizeStatusbarSnapshot({ ...rawV2Snapshot(), eventPool: [] }, 'chat-a');
  assert.equal(bridge.buildStatusbarCandidatePrompt(empty), '');
});

test('状态栏桥开关：内置魔改/模板占位自动判定，显式 true|false 优先', () => {
  assert.equal(director.isStatusbarBridgeEnabled(director.builtinDriverPreset('魔改召回')), true);
  assert.equal(director.isStatusbarBridgeEnabled(director.builtinDriverPreset('极速纯召回')), false);
  const base = { name: '自定义', systemPrompt: '', promptGroup: [{ role: 'user', content: 'x' }] };
  assert.equal(director.isStatusbarBridgeEnabled(director.normalizeDriverPreset({ ...base, finalDirectiveTemplate: 'A\n{{world_cue}}' })), true);
  assert.equal(director.isStatusbarBridgeEnabled(director.normalizeDriverPreset({ ...base, finalDirectiveTemplate: 'A' })), false);
  assert.equal(director.isStatusbarBridgeEnabled(director.normalizeDriverPreset({ ...base, finalDirectiveTemplate: 'A', statusbarBridge: true })), true);
  assert.equal(director.isStatusbarBridgeEnabled(
    director.normalizeDriverPreset({ ...director.builtinDriverPreset('魔改召回'), statusbarBridge: false }),
  ), false);
  assert.equal(director.isStatusbarBridgeEnabled(null), false);
});

test('normalizeDriverPreset 原样保留 statusbarBridge（true/false/缺省都不改写）', () => {
  const base = { name: '自定义', systemPrompt: '', promptGroup: [{ role: 'user', content: 'x' }], finalDirectiveTemplate: '{{本轮输入}}' };
  assert.equal(director.normalizeDriverPreset({ ...base, statusbarBridge: true }).statusbarBridge, true);
  assert.equal(director.normalizeDriverPreset({ ...base, statusbarBridge: false }).statusbarBridge, false);
  assert.equal('statusbarBridge' in director.normalizeDriverPreset(base), false);
  assert.equal('statusbarBridge' in director.normalizeDriverPreset({ ...base, statusbarBridge: 'yes' }), false);
});

test('extractWorldAck：容错冒号/picked/skipped/顿号，幻觉 id 过滤，空回执返回 null', () => {
  const valid = new Set(['arrive-1', 'rumor-2']);
  const full = director.extractWorldAck(
    '<world_ack>\npick: arrive-1 | world_cue | 与在场对话自然衔接\nskip: rumor-2、ghost-9 | 情绪专一，本轮压住\n</world_ack>',
    valid,
    'chat-a',
  );
  assert.deepEqual(full, {
    version: 1,
    chatIdentity: 'chat-a',
    picked: { id: 'arrive-1', targetTag: 'world_cue', reason: '与在场对话自然衔接' },
    skippedIds: ['rumor-2'],
    skippedReason: '情绪专一，本轮压住',
  });

  const tolerant = director.extractWorldAck(
    '<world_ack>\nPicked：arrive-1｜chaos｜撞车让位\nSkipped: rumor-2\n</world_ack>',
    valid,
  );
  assert.deepEqual(tolerant.picked, { id: 'arrive-1', targetTag: 'chaos', reason: '撞车让位' });
  assert.deepEqual(tolerant.skippedIds, ['rumor-2']);
  assert.equal(tolerant.chatIdentity, '');

  // 幻觉 pick 整条作废；只剩合法 skip 时仍返回回执
  const ghostOnly = director.extractWorldAck('<world_ack>\npick: ghost-1 | world_cue | 编的\n</world_ack>', valid);
  assert.equal(ghostOnly, null);
  const mixed = director.extractWorldAck('<world_ack>\npick: ghost-1 | world_cue | 编的\nskip: arrive-1\n</world_ack>', valid);
  assert.equal(mixed.picked, null);
  assert.deepEqual(mixed.skippedIds, ['arrive-1']);

  // 不写 pick 行 / pick 无 都算没有选中
  assert.equal(director.extractWorldAck('<world_ack>\npick: 无\n</world_ack>', valid), null);
  assert.equal(director.extractWorldAck('<world_ack>\nskip: 无 | 没有契合条目\n</world_ack>', valid), null);
  assert.equal(director.extractWorldAck('<recall></recall>', valid), null);
  // 未给 validIds 时不做白名单过滤
  assert.equal(director.extractWorldAck('<world_ack>pick: any-id | world_cue</world_ack>').picked.id, 'any-id');
});

test('assembleFinalDirective：空 world_cue 不留下多余空行，非空时正常落标签', () => {
  const preset = director.normalizeDriverPreset({
    name: '自定义', systemPrompt: '', promptGroup: [{ role: 'user', content: 'x' }],
    tags: 'chaos,world_cue,spot',
    finalDirectiveTemplate: '{{本轮输入}}\n{{chaos}}\n{{world_cue}}\n候选前往地点：\n{{spot}}。',
  });
  const withoutCue = director.assembleFinalDirective({
    preset, userInput: '推门进去', raw: '<chaos>突发</chaos><spot>码头,货舱</spot>',
  });
  assert.equal(withoutCue, '推门进去\n<chaos>突发</chaos>\n候选前往地点：\n<spot>码头,货舱</spot>。');
  assert.doesNotMatch(withoutCue, /\n\n/);

  const withCue = director.assembleFinalDirective({
    preset, userInput: '推门进去', raw: '<chaos></chaos><world_cue>门铃响后，熟悉的脚步停在桌边</world_cue><spot>码头</spot>',
  });
  assert.equal(withCue, '推门进去\n<world_cue>门铃响后，熟悉的脚步停在桌边</world_cue>\n候选前往地点：\n<spot>码头</spot>。');

  // 用户输入里的空行不被压缩
  const multiline = director.assembleFinalDirective({
    preset: director.normalizeDriverPreset({
      name: '自定义', systemPrompt: '', promptGroup: [{ role: 'user', content: 'x' }],
      tags: 'world_cue', finalDirectiveTemplate: '{{本轮输入}}\n{{world_cue}}\n尾',
    }),
    userInput: '第一段\n\n\n第二段', raw: '',
  });
  assert.equal(multiline, '第一段\n\n\n第二段\n尾');
});

test('内置魔改继承 knownFacts、去重盲点、事件池整段进请求；自定义预设无 {{world_cue}} 不追加', async () => {
  const preset = director.builtinDriverPreset('魔改召回');
  const specs = [];
  const result = await director.runPlanningRequest(preset, v2Context(), {
    requestTask: async spec => { specs.push(spec); return '<recall></recall>'; },
  });
  assert.deepEqual(result.errors, []);
  const text = specs[0].items.map(item => item.content || '').join('\n');
  assert.match(text, /苏晴：知道主角见过店长/);
  assert.match(text, /状态栏已承担本轮主要盲点提示/);
  assert.match(text, /<statusbar_events>/);
  assert.match(text, /\[arrive-1\] character_arrival \| 店长到访/);
  assert.match(text, /宁缺毋滥、严禁全推/);
  assert.doesNotMatch(text, /绝密完整描述|事件：已经发生/);
  // worldbookDelegated=true → 暂停世界动态条目（防重复喂料）
  assert.equal(specs[0].suspendWorldDigest, true);

  const custom = director.normalizeDriverPreset({
    ...preset, name: '我的自定义', statusbarBridge: false,
    promptGroup: [{ role: 'user', content: '只保留我的内容' }],
  });
  await director.runPlanningRequest(custom, v2Context(), {
    requestTask: async spec => {
      assert.equal(spec.items.some(item => String(item.content).includes('statusbar_')), false);
      return '<recall></recall>';
    },
  });
});

test('自定义预设显式开桥或模板占位 {{world_cue}} 时同样吃到事件池（不再按预设名硬编码）', async () => {
  const preset = director.normalizeDriverPreset({
    name: '我的自定义',
    systemPrompt: '',
    promptGroup: [{ role: 'user', content: '自定义内容' }],
    tags: 'world_cue',
    finalDirectiveTemplate: '{{本轮输入}}\n{{world_cue}}',
  });
  let seen = '';
  await director.runPlanningRequest(preset, v2Context(), {
    requestTask: async spec => { seen = spec.items.map(i => i.content || '').join('\n'); return '<world_cue>门铃</world_cue>'; },
  });
  assert.match(seen, /<statusbar_cognition>/);
  assert.match(seen, /<statusbar_events>/);
});

test('无事件池保留单开 chaos 原路径；委派标记为假时不暂停世界动态；极速纯召回不受影响', async () => {
  const noPool = bridge.normalizeStatusbarSnapshot({ ...rawV2Snapshot(), eventPool: [], worldbookDelegated: false }, 'chat-a');
  const preset = director.builtinDriverPreset('魔改召回');
  await director.runPlanningRequest(preset, { ...v2Context(), statusbarSnapshot: noPool }, {
    requestTask: async spec => {
      const text = spec.items.map(item => item.content || '').join('\n');
      assert.doesNotMatch(text, /<statusbar_events>/);
      assert.match(text, /== 2\. 全局意外/);
      assert.equal(spec.suspendWorldDigest, false);
      return '<recall></recall>';
    },
  });

  const pure = director.builtinDriverPreset('极速纯召回');
  await director.runPlanningRequest(pure, v2Context(), {
    requestTask: async spec => {
      assert.equal(spec.items.some(item => String(item.content).includes('statusbar_')), false);
      return '<recall></recall>';
    },
  });

  // 完全没有快照：不带 suspendWorldDigest 字段（不改旧请求形状）
  await director.runPlanningRequest(preset, { ...v2Context(), statusbarSnapshot: undefined }, {
    requestTask: async spec => {
      assert.equal('suspendWorldDigest' in spec, false);
      return '<recall></recall>';
    },
  });
});

test('内置魔改资产已声明 statusbarBridge 与 world_cue 占位/标签', () => {
  const preset = director.builtinDriverPreset('魔改召回');
  assert.equal(preset.statusbarBridge, true);
  assert.deepEqual(director.splitTags(preset.tags), ['recall', 'spot', 'soul', 'chaos', 'chaos_bg', 'chaos_char', 'world_cue']);
  assert.match(preset.finalDirectiveTemplate, /\{\{chaos\}\}\n\{\{world_cue\}\}\n候选前往地点：/);
  assert.ok(!director.splitTags(preset.tags).includes('world_ack'), 'world_ack 不进 tags');
});
