// 跨仓协议测试（只读）：状态栏 world-engine 真实输出 → 台账 statusbar-cognition 窄适配 → 内置魔改预设。
// 不复制任何一侧的世界状态/预算逻辑，只验证两侧实际字段与生命周期契约。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const ledgerRoot = fileURLToPath(new URL('..', import.meta.url));
const statusbarRoot = path.resolve(ledgerRoot, '../n-sese-unified-statusbar');

async function load(absEntry, absWorkingDir) {
  const out = await build({
    absWorkingDir,
    entryPoints: [absEntry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}

const ledgerBridge = await load('src/sese-ledger/core/statusbar-cognition.ts', ledgerRoot);
const director = await load('src/sese-ledger/core/director.ts', ledgerRoot);
const sbTypes = await load('src/unified-statusbar/core/world-engine/world-types.ts', statusbarRoot);
const sbSnapshot = await load('src/unified-statusbar/core/world-engine/world-snapshot.ts', statusbarRoot);
const sbIntrusion = await load('src/unified-statusbar/core/world-engine/world-intrusion.ts', statusbarRoot);
const sbWorldbook = await load('src/unified-statusbar/core/world-engine/world-worldbook.ts', statusbarRoot);
const sbWorldWindow = await (async () => {
  const prevWin = globalThis.window;
  const prevDoc = globalThis.document;
  const dom = new JSDOM('<!doctype html><body></body>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    return await load('src/unified-statusbar/renderers/world-window.ts', statusbarRoot);
  } finally {
    if (prevWin === undefined) delete globalThis.window;
    else globalThis.window = prevWin;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
})();
const sbAnchor = await load('src/unified-statusbar/core/external-story-store.ts', statusbarRoot);

const CHAT_KEY = 'chat_uuid_1';
const CHAT_IDENTITY = 'character:qing.png|chat:story_chat_100';
const TODAY = '2026-06-05';

function rawIntrusion(overrides = {}) {
  return {
    id: 'in_10',
    kind: 'character_arrival',
    refId: '阿青',
    title: '码头对账',
    hook: '阿青抱着旧账本走进院子',
    desc: '绝密完整描述：阿青其实已经联系好走私船，今晚准备撤离。',
    dateKey: TODAY,
    status: 'pending',
    aiTriggered: true,
    revision: 1,
    publicInfo: '神色略显疲惫',
    reason: '同在星海商圈',
    condition: '主角非私密对话',
    region: '星海商圈',
    expiresAtDay: TODAY,
    delivery: { eventId: 'in_10', revision: 1, chatKey: CHAT_KEY },
    ...overrides,
  };
}

function baseState(intrusions = [rawIntrusion()]) {
  return {
    ...sbTypes.emptyWorldState(),
    lastEvolveDateKey: TODAY,
    profiles: {
      阿青: {
        name: '阿青',
        onStage: false,
        activity: '在码头等风信',
        plans: '带账本来找主角',
        hiddenGoal: '秘密替父亲翻案（绝密不可泄露）',
        goalProgress: 80,
        goalProgressText: '已收集三份证据',
        relation: '故交',
        knownFacts: ['知道：账本缺了一页（亲历）', '不知道：主角已收到密信'],
        updatedAt: TODAY,
        lastEvolveRound: 3,
      },
      路人甲: { name: '路人甲', onStage: false, activity: '在城外砍柴', plans: '', updatedAt: TODAY, lastEvolveRound: 1 },
    },
    pendingIntrusions: intrusions,
  };
}

function snapshotOf(state, rt = {}) {
  const bridge = sbSnapshot.createWorldCognitionBridge({
    getChatKey: () => CHAT_KEY,
    getChatIdentity: () => CHAT_IDENTITY,
    isStorageReady: () => true,
    isWorldEnabled: () => true,
    loadState: () => state,
    getDateKey: () => TODAY,
    getRuntimeContext: () => ({ dateKey: TODAY, playerRegion: '星海商圈', onStageNames: [], ...rt }),
  });
  return bridge.getSnapshot();
}

function ledgerRead(raw) {
  return ledgerBridge.normalizeStatusbarSnapshot(raw, CHAT_IDENTITY);
}

test('跨仓：状态栏真实快照 → 台账窄适配读到同一聊天身份下的认知与候选（主入口 + 参考）', () => {
  const snap = snapshotOf(baseState([
    rawIntrusion(),
    rawIntrusion({
      id: 'in_11',
      title: '后院暗语',
      hook: '阿青在门廊下轻敲三下木柱',
      revision: 1,
      desc: '绝密参考描述：这是接头暗号。',
      delivery: { eventId: 'in_11', revision: 1, chatKey: CHAT_KEY },
    }),
  ]));

  // 状态栏实际字段（台账消费面）
  assert.equal(snap.version, sbTypes.WORLD_SNAPSHOT_VERSION);
  assert.equal(snap.available, true);
  assert.equal(snap.chatIdentity, CHAT_IDENTITY);
  assert.equal(snap.candidates.primary.refId, '阿青');
  assert.ok(Array.isArray(snap.candidates.references));
  assert.equal(snap.candidates.references.length, 1, '每轮最多 1 主入口 + 2 极简参考');
  assert.equal(snap.restrictions.maxPrimaryCandidate, 1);
  assert.equal(snap.restrictions.maxReferenceCandidates, 2);
  assert.equal(snap.restrictions.protagonistOmniscienceForbidden, true);
  assert.equal(snap.restrictions.externalIntrusionBlocked, false);

  const normalized = ledgerRead(snap);
  assert.ok(normalized, '台账必须能读状态栏真实输出，否则双开等于单开');
  assert.equal(normalized.chatIdentity, CHAT_IDENTITY);
  // v1 两段式候选一律回退成 kind='arrival' 的事件池条目（v2 直接给 eventPool 时读原字段）
  assert.equal(normalized.eventPool[0].kind, 'arrival');
  assert.equal(normalized.eventPool[0].id, 'in_10');
  assert.deepEqual(normalized.knownFacts.阿青, ['知道：账本缺了一页（亲历）', '不知道：主角已收到密信']);
  assert.equal(normalized.ownsBlindSpotPrompt, true);
  assert.equal(normalized.candidates[0].id, 'in_10', '主入口排第一');
  assert.equal(normalized.candidates[0].title, '码头对账');
  assert.equal(normalized.candidates[0].hook, '阿青抱着旧账本走进院子');
  assert.equal(normalized.candidates[1].id, 'in_11', '参考候选随协议进入规划素材');

  const serialized = JSON.stringify(snap) + JSON.stringify(normalized);
  assert.ok(!serialized.includes('绝密完整描述'), '桥与适配层都不得携带 pending 完整 desc');
  assert.ok(!serialized.includes('秘密替父亲翻案'), '桥与适配层都不得携带 hiddenGoal');
});

test('跨仓：世界书「世界动态」投影用同一候选视图，主入口/参考分区且不出 desc', () => {
  const state = baseState([
    rawIntrusion(),
    rawIntrusion({ id: 'in_11', title: '后院暗语', hook: '阿青在门廊下轻敲三下木柱', desc: '绝密参考描述：这是接头暗号。' }),
  ]);
  const view = sbIntrusion.selectIntrusionCandidates(state, {
    dateKey: TODAY,
    playerRegion: '星海商圈',
    onStageNames: [],
    sceneGuard: { blocked: false, reason: '' },
  });
  const content = sbWorldbook.buildWorldDigestContent(state.frontDigest || '', view);
  assert.match(content, /〔自然入镜·主入口〕/);
  assert.match(content, /阿青抱着旧账本走进院子/);
  assert.match(content, /〔自然入镜·参考〕/);
  assert.match(content, /阿青在门廊下轻敲三下木柱/);
  assert.ok(!content.includes('绝密完整描述'));
  assert.ok(!content.includes('绝密参考描述'));
});

test('跨仓：草稿预留不消费候选（仍 pending 且继续进候选池），正文实际承接后才 acted', () => {
  const offered = sbIntrusion.markIntrusionCandidatesOffered(baseState(), {
    blocked: false,
    blockReason: '',
    primary: { id: 'in_10' },
    references: [],
    backgroundAntiCollision: [],
  }, { chatKey: CHAT_KEY, floor: 5, anchor: 'a_5', swipeId: 0 });

  const offeredSnap = snapshotOf(offered);
  // 快照候选以 eventId 作为事件键（台账侧同时认 eventId/id）
  assert.equal(offeredSnap.candidates.primary.eventId, 'in_10');
  assert.equal(offeredSnap.candidates.primary.delivery.offeredAtFloor, 5);
  assert.equal(offeredSnap.candidates.primary.delivery.offeredSwipeId, 0);

  // 草稿：仅记 draftPreparedAt，status 保持 pending
  const drafted = sbIntrusion.prepareIntrusionDraft(offered, 'in_10', { chatKey: CHAT_KEY, floor: 6, anchor: 'a_6' });
  const draftedItem = drafted.pendingIntrusions.find(i => i.id === 'in_10');
  assert.equal(draftedItem.status, 'pending', '草稿绝不能被消费为 acted');
  assert.ok(draftedItem.delivery.draftPreparedAt);
  assert.equal(snapshotOf(drafted).candidates.primary.eventId, 'in_10', '草稿未发仍应作为候选继续提供');

  // 只写了草稿但 AI 正文没有承接：仍不能消费
  const noAdopt = sbIntrusion.confirmIntrusionAdoptionFromFloor(drafted, {
    chatKey: CHAT_KEY, floor: 7, anchor: 'a_7', swipeId: 0,
    aiText: '她低头翻着账目，没有说话。', userText: '阿青抱着旧账本走进院子',
  });
  assert.deepEqual(noAdopt.confirmedIds, []);

  // 正文实际承接：命中角色名 + 入口线索 + 到场提示
  const adopted = sbIntrusion.confirmIntrusionAdoptionFromFloor(drafted, {
    chatKey: CHAT_KEY, floor: 7, anchor: 'a_7', swipeId: 0,
    aiText: '院门被推开，阿青抱着旧账本走进院子，风尘仆仆地站定了。',
    userText: '阿青抱着旧账本走进院子',
  });
  assert.deepEqual(adopted.confirmedIds, ['in_10']);
  assert.equal(adopted.state.pendingIntrusions[0].status, 'acted');
  assert.equal(snapshotOf(adopted.state).candidates.primary, null, '已承接事件不再进候选池');
});

test('跨仓：删楼 / Swipe 回退让 acted 复活为 pending，并重新进入台账候选', () => {
  // 用真实锚点算法给聊天夹具算锚点，避免自造字符串掩盖回退判定
  const aiMsg = { is_user: false, mes: '院门被推开，阿青抱着旧账本走进院子，风尘仆仆地站定了。', swipe_id: 0, id: 'msg_7' };
  const anchor = sbAnchor.selectedMessageAnchor(aiMsg, 3);
  const adopted = sbIntrusion.confirmIntrusionAdoptionFromFloor(baseState(), {
    chatKey: CHAT_KEY, floor: 3, anchor, swipeId: 0,
    aiText: aiMsg.mes,
    userText: '阿青抱着旧账本走进院子',
  });
  assert.equal(adopted.confirmedIds.length, 1);

  const keptChat = [
    { is_user: true, mes: '开场', id: 'msg_1' },
    { is_user: false, mes: '无关', id: 'msg_2' },
    { is_user: false, mes: '无关', id: 'msg_3' },
  ];
  const stillThere = sbIntrusion.reconcileIntrusionsWithChat(adopted.state, [...keptChat, aiMsg], CHAT_KEY);
  assert.deepEqual(stillThere.rolledBackIds, [], '楼层与 swipe 都在时不得误回退');

  // 删楼
  const deleted = sbIntrusion.reconcileIntrusionsWithChat(adopted.state, keptChat, CHAT_KEY);
  assert.deepEqual(deleted.rolledBackIds, ['in_10']);
  assert.equal(deleted.state.pendingIntrusions[0].status, 'pending');
  assert.equal(snapshotOf(deleted.state).candidates.primary.eventId, 'in_10', '回退后应重新可被承接');
  assert.ok(ledgerRead(snapshotOf(deleted.state)), '回退后台账仍能读到候选');

  // Swipe 切走（同楼同锚点，只有变体变了）
  const swiped = sbIntrusion.reconcileIntrusionsWithChat(adopted.state, [
    ...keptChat,
    { ...aiMsg, swipe_id: 1 },
  ], CHAT_KEY);
  assert.deepEqual(swiped.rolledBackIds, ['in_10']);
});

test('跨仓：候选过期即出池，台账侧不产生候选段（保留单开 chaos）', async () => {
  const expired = baseState([rawIntrusion({ expiresAtDay: '2026-06-04' })]);
  const expiredSnap = snapshotOf(expired);
  assert.equal(expiredSnap.available, true);
  assert.equal(expiredSnap.candidates.primary, null);
  const normalized = ledgerRead(expiredSnap);
  assert.ok(normalized, '过期候选不应让整份快照失效，认知部分仍可用');
  assert.deepEqual(normalized.candidates, []);
  assert.equal(ledgerBridge.buildStatusbarCandidatePrompt(normalized), '');

  const swept = sbIntrusion.sweepExpiredIntrusions(expired, TODAY);
  assert.deepEqual(swept.missed.map(m => m.id), ['in_10']);
  assert.equal(swept.state.pendingIntrusions.length, 0);
  assert.match(swept.state.profiles.阿青.experiences[0].text, /原本拟议/);

  const preset = director.builtinDriverPreset('魔改召回');
  await director.runPlanningRequest(preset, {
    userInput: '继续', lastPlot: '', lastPlotRaw: '', chronicleOverview: '', recentStory: '',
    statusbarSnapshot: normalized,
  }, {
    requestTask: async spec => {
      const text = spec.items.map(i => i.content || '').join('\n');
      assert.doesNotMatch(text, /<statusbar_events>/);
      assert.match(text, /<statusbar_cognition>/);
      return '<recall></recall>';
    },
  });
});

test('跨仓：状态栏真实快照进内置魔改规划（认知 + 唯一主入口，不泄 desc/hiddenGoal）', async () => {
  const snap = snapshotOf(baseState());
  const normalized = ledgerRead(snap);
  assert.ok(normalized);
  const preset = director.builtinDriverPreset('魔改召回');
  let seen = '';
  await director.runPlanningRequest(preset, {
    userInput: '继续', lastPlot: '', lastPlotRaw: '', chronicleOverview: '', recentStory: '',
    statusbarSnapshot: normalized,
  }, {
    requestTask: async spec => { seen = spec.items.map(i => i.content || '').join('\n'); return '<recall></recall>'; },
  });
  assert.match(seen, /<statusbar_cognition>/);
  assert.match(seen, /阿青：知道：账本缺了一页（亲历）；不知道：主角已收到密信/);
  assert.match(seen, /状态栏已承担本轮主要盲点提示/);
  assert.match(seen, /<statusbar_events>/);
  assert.match(seen, /\[in_10\] arrival \| 码头对账 \| 阿青抱着旧账本走进院子/);
  assert.match(seen, /宁缺毋滥、严禁全推/);
  assert.match(seen, /每轮至多挑选 1 条主事件/);
  assert.match(seen, /<world_ack>/);
  assert.doesNotMatch(seen, /绝密完整描述|秘密替父亲翻案|已收集三份证据/);
});

test('跨仓：亲密/私密场景由状态栏拦下外部闯入，台账同步不喂候选', () => {
  const snap = snapshotOf(baseState(), { nsfwActive: true });
  assert.equal(snap.restrictions.externalIntrusionBlocked, true);
  const normalized = ledgerRead(snap);
  assert.ok(normalized);
  assert.deepEqual(normalized.candidates, []);
  assert.deepEqual(normalized.knownFacts.阿青, ['知道：账本缺了一页（亲历）', '不知道：主角已收到密信']);
});

test('跨仓：聊天身份不一致 / 状态栏不可用时两侧都退回单开', () => {
  const snap = snapshotOf(baseState());
  assert.equal(ledgerBridge.normalizeStatusbarSnapshot(snap, 'character:other.png|chat:story_chat_100'), null);
  const unavailable = sbSnapshot.createWorldCognitionBridge({
    getChatKey: () => CHAT_KEY,
    getChatIdentity: () => CHAT_IDENTITY,
    isStorageReady: () => false,
    isWorldEnabled: () => true,
    loadState: () => baseState(),
    getDateKey: () => TODAY,
    getRuntimeContext: () => ({ dateKey: TODAY }),
  }).getSnapshot();
  assert.equal(unavailable.available, false);
  assert.equal(ledgerRead(unavailable), null);
});

test('跨仓 v2：状态栏事件池 → 台账推进挑选与 sl_world_ack → 状态栏确认/冷却与删楼回退闭环', async () => {
  const state = {
    ...baseState([
      rawIntrusion(),
      rawIntrusion({
        id: 'in_11',
        refId: '路人甲',
        title: '茶馆口信',
        hook: '路人甲在柜台前轻敲两下竹板',
        desc: '绝密：其实他是来试探账房虚实的。',
        region: '城外',
      }),
    ]),
    rumors: [
      {
        id: 'rumor_1',
        topic: '码头罢工风声',
        content: '码头脚夫今早聚集讨说法',
        level: 'heard',
        progress: 40,
        dissipation: 90,
        createdAt: TODAY,
        region: '星海商圈',
      },
    ],
    seeds: [
      {
        id: 'seed_1',
        title: '暗账风波',
        status: 'active',
        level: 2,
        visibility: 'public',
        catalyst: '有人在码头翻找旧货单',
        region: '星海商圈',
        actorIds: ['阿青'],
        expiresAtDay: '2026-06-10',
        missedOutcome: '绝密错过后果',
        createdAtDay: TODAY,
        revision: 1,
      },
    ],
    guidance: {
      signals: [
        { voice: 'ambient', sourceId: 'clock', text: '午后阴云压低，街市行人脚步匆匆' },
      ],
    },
  };

  let currentRound = 10;
  const bridge = sbSnapshot.createWorldCognitionBridge({
    getChatKey: () => CHAT_KEY,
    getChatIdentity: () => CHAT_IDENTITY,
    isStorageReady: () => true,
    isWorldEnabled: () => true,
    loadState: () => state,
    getDateKey: () => TODAY,
    getRuntimeContext: () => ({ dateKey: TODAY, playerRegion: '星海商圈', onStageNames: [], nsfwActive: false }),
    getCurrentRound: () => currentRound,
    isWorldbookDelegated: () => true,
  });

  const snap = bridge.getSnapshot();
  assert.equal(snap.version, 2);
  assert.equal(snap.worldbookDelegated, true);
  assert.ok(snap.eventPool.some(e => e.kind === 'arrival' && e.id === 'in_10'));
  assert.ok(snap.eventPool.some(e => e.kind === 'encounter' && e.id === 'seed_1'));
  assert.ok(snap.eventPool.some(e => e.kind === 'rumor' && e.id === 'rumor_1'));
  assert.ok(snap.eventPool.some(e => e.kind === 'ambient'));
  assert.ok(!JSON.stringify(snap).includes('绝密错过后果'));

  const normalized = ledgerRead(snap);
  assert.ok(normalized);
  assert.equal(normalized.worldbookDelegated, true);
  assert.equal(normalized.eventPool.length, snap.eventPool.length);

  // 台账推进请求：suspendWorldDigest 为 true；输出 <world_cue> + <world_ack>
  const preset = director.builtinDriverPreset('魔改召回');
  let capturedSpec = null;
  const planRes = await director.runPlanningRequest(preset, {
    userInput: '去码头转转', lastPlot: '', lastPlotRaw: '', chronicleOverview: '', recentStory: '',
    statusbarSnapshot: normalized,
  }, {
    requestTask: async spec => {
      capturedSpec = spec;
      return '<recall></recall><world_cue>街头传来码头脚夫聚众讨说法的议论。</world_cue><world_ack>pick: rumor_1 | world_cue | 主角正要去码头\nskip: in_10 | 先留白不让阿青直接露面</world_ack>';
    },
  });
  assert.equal(capturedSpec.suspendWorldDigest, true);
  const validIds = new Set(normalized.eventPool.map(e => e.id));
  const ack = director.extractWorldAck(planRes.raw, validIds, CHAT_IDENTITY);
  assert.ok(ack);
  assert.equal(ack.picked.id, 'rumor_1');
  assert.deepEqual(ack.skippedIds, ['in_10']);

  // 最终指令包含 world_cue 但不包含 world_ack
  const directive = director.assembleFinalDirective({ preset, userInput: '去码头转转', raw: planRes.raw });
  assert.match(directive, /<world_cue>街头传来码头脚夫聚众讨说法的议论。<\/world_cue>/);
  assert.doesNotMatch(directive, /world_ack|skip:|pick:/);

  // 状态栏消费回执：rumor_1 进 4 轮冷却，in_10 进 2 轮降权（不删事件）
  const aiMsg = { is_user: false, mes: '你刚走到码头边，就听见几个脚夫在议论工钱。', swipe_id: 0, id: 'msg_10' };
  const anchor = sbAnchor.selectedMessageAnchor(aiMsg, 1);
  const cooledState = sbIntrusion.applyWorldAckReceipt(state, ack, {
    chatKey: CHAT_KEY,
    round: currentRound,
    floor: 1,
    anchor,
    swipeId: 0,
    liveChatIdentity: CHAT_IDENTITY,
  });
  assert.equal(cooledState.eventCooldowns.rumor_1.untilRound, 14);
  assert.equal(cooledState.eventCooldowns.in_10.untilRound, 12);

  // 下一轮事件池自动跳过冷却中的 rumor_1，而 in_10 仅降权仍在队列中
  currentRound = 11;
  const nextPool = sbSnapshot.createWorldCognitionBridge({
    getChatKey: () => CHAT_KEY,
    getChatIdentity: () => CHAT_IDENTITY,
    isStorageReady: () => true,
    isWorldEnabled: () => true,
    loadState: () => cooledState,
    getDateKey: () => TODAY,
    getRuntimeContext: () => ({ dateKey: TODAY, playerRegion: '星海商圈', onStageNames: [], nsfwActive: false }),
    getCurrentRound: () => currentRound,
    isWorldbookDelegated: () => true,
  }).getSnapshot().eventPool;
  assert.equal(nextPool.some(e => e.id === 'rumor_1'), false, '刚推过的传闻在冷却期内不再重复入池');
  assert.equal(nextPool.some(e => e.id === 'in_10'), true, '被跳过的入镜仍在池内不被删');

  // Swipe 切走后冷却回退，rumor_1 重新入池
  const rolledBack = sbIntrusion.reconcileIntrusionsWithChat(cooledState, [
    { is_user: true, mes: '去码头转转', id: 'msg_9' },
    { ...aiMsg, swipe_id: 1 },
  ], CHAT_KEY);
  assert.equal(rolledBack.state.eventCooldowns, undefined);

  // 双开收敛下世界书只留 acted 余波+极短暗流，但状态栏 UI（frontSectionsFromState）仍完整显示
  const delegatedWb = sbWorldbook.buildWorldDigestContent(
    '【世界动态 2026-06-05】\n〔此地此刻〕\n- 此地此刻不应直出\n〔风闻轶事〕\n【传闻·码头罢工风声】不该全推\n〔世界暗流〕\n- 商路暗潮（正在发生）',
    sbIntrusion.selectIntrusionCandidates(state, { dateKey: TODAY, playerRegion: '星海商圈', onStageNames: [] }),
    { delegatedToDriver: true, actedEchoes: ['老周·送茶：把茶放到桌上顺便说了码头停工的消息'] },
  );
  assert.match(delegatedWb, /〔近期入镜余波〕/);
  assert.match(delegatedWb, /〔世界暗流〕/);
  assert.doesNotMatch(delegatedWb, /此地此刻不应直出|不该全推|自然入镜/);
  const uiFront = sbWorldWindow.frontSectionsFromState(state, TODAY, '星海商圈');
  assert.equal(uiFront.arrivals.length, 2, '状态栏 UI 必须完整保留待定入镜');
  assert.equal(uiFront.rumors.length, 1, '状态栏 UI 必须完整保留台前传闻');
});
