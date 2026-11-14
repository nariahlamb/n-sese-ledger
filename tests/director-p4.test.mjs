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

function rawSnapshot() {
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

const context = {
  userInput: '继续', lastPlot: '', lastPlotRaw: '', chronicleOverview: '', recentStory: '',
  statusbarSnapshot: bridge.normalizeStatusbarSnapshot(rawSnapshot(), 'chat-a'),
};

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

test('只读快照跨聊天/坏版本/坏格式回退；副本不共享原对象', () => {
  const raw = rawSnapshot();
  const snapshot = bridge.normalizeStatusbarSnapshot(raw, 'chat-a');
  assert.deepEqual(snapshot.candidates, [
    { id: 'arrival-1', title: '店长到访', hook: '门铃响后，熟悉的脚步停在桌边' },
    { id: 'reference-1', title: '码头来讯', hook: '一封短信送到柜台' },
  ]);
  raw.characters.苏晴.knownFacts[0] = '外部篡改';
  raw.candidates.primary.entryCue = '外部篡改';
  assert.equal(snapshot.knownFacts.苏晴[0], '知道主角见过店长');
  assert.equal(snapshot.candidates[0].hook, '门铃响后，熟悉的脚步停在桌边');
  assert.equal(bridge.normalizeStatusbarSnapshot(rawSnapshot(), 'chat-b'), null);
  assert.equal(bridge.normalizeStatusbarSnapshot({ ...rawSnapshot(), version: 2 }, 'chat-a'), null);
  assert.equal(bridge.normalizeStatusbarSnapshot({ ...rawSnapshot(), characters: null }, 'chat-a'), null);
  assert.equal(bridge.normalizeStatusbarSnapshot({ ...rawSnapshot(), available: false }, 'chat-a'), null);
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

test('内置魔改继承 knownFacts、去重盲点、候选限量；自定义预设保持原样', async () => {
  const preset = director.builtinDriverPreset('魔改召回');
  const specs = [];
  const result = await director.runPlanningRequest(preset, context, { requestTask: async spec => { specs.push(spec); return '<recall></recall>'; } });
  assert.deepEqual(result.errors, []);
  const text = specs[0].items.map(item => item.content || '').join('\n');
  assert.match(text, /苏晴：知道主角见过店长/);
  assert.match(text, /状态栏已承担本轮主要盲点提示/);
  assert.match(text, /事件：店长到访/);
  assert.match(text, /只采用以下一个合格的外部事件候选/);
  assert.match(text, /不另造事件/);
  assert.match(text, /chaos_char.*不要让它再引入第二个外部变量/);
  assert.doesNotMatch(text, /完整幕后描述|事件：已经发生/);

  const custom = director.normalizeDriverPreset({ ...preset, name: '我的自定义', promptGroup: [{ role: 'user', content: '只保留我的内容' }] });
  await director.runPlanningRequest(custom, context, { requestTask: async spec => { assert.equal(spec.items.some(item => String(item.content).includes('statusbar_')), false); return '<recall></recall>'; } });
});

test('无合格候选保留单开 chaos 原路径；纯净召回不受 P4 影响', async () => {
  const snapshot = bridge.normalizeStatusbarSnapshot({ ...rawSnapshot(), candidates: { primary: null, references: [] } }, 'chat-a');
  const preset = director.builtinDriverPreset('魔改召回');
  await director.runPlanningRequest(preset, { ...context, statusbarSnapshot: snapshot }, {
    requestTask: async spec => {
      const text = spec.items.map(item => item.content || '').join('\n');
      assert.doesNotMatch(text, /statusbar_candidate/);
      assert.match(text, /== 2\. 全局意外/);
      return '<recall></recall>';
    },
  });
  const pure = director.builtinDriverPreset('极速纯召回');
  await director.runPlanningRequest(pure, context, {
    requestTask: async spec => {
      assert.equal(spec.items.some(item => String(item.content).includes('statusbar_')), false);
      return '<recall></recall>';
    },
  });
});
