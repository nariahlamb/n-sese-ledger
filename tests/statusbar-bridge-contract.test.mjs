// 跨仓协议测试（只读）：状态栏 world-engine 真实输出 → 台账 statusbar-cognition 窄适配 → 内置魔改预设。
// 不复制任何一侧的世界状态/预算逻辑，只验证两侧实际字段与生命周期契约。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

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
      assert.doesNotMatch(text, /<statusbar_candidate>/);
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
  assert.match(seen, /<statusbar_candidate>/);
  assert.match(seen, /事件：码头对账/);
  assert.match(seen, /入口：阿青抱着旧账本走进院子/);
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
