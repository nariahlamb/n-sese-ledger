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

const { shouldSkipReceivedMessageType, waitForReceivedAiFloor } = await loadTs('src/sese-ledger/core/message-gate.ts');
const { splitPlanByBatchSize } = await loadTs('src/sese-ledger/core/scribe.ts');

test('shouldSkipReceivedMessageType 跳过非剧情生成类型并放行正常对话', () => {
  for (const type of ['first_message', 'quiet', 'impersonate', 'command', 'extension']) {
    assert.equal(shouldSkipReceivedMessageType(type), true, type);
  }
  for (const type of [undefined, '', 'normal', 'swipe', 'continue', 'regenerate']) {
    assert.equal(shouldSkipReceivedMessageType(type), false, String(type));
  }
});

test('waitForReceivedAiFloor 等待延迟物化的本轮 AI 正文后再放行', async () => {
  const chat = [
    { is_user: false, mes: '上一轮旧正文' },
    { is_user: true, mes: '本轮用户输入' },
    { is_user: false, mes: '' },
  ];
  let checks = 0;
  const res = await waitForReceivedAiFloor({
    messageId: 2,
    getChat: () => {
      checks++;
      if (checks >= 2) chat[2].mes = '刚生成的本轮正文';
      return chat;
    },
    maxChecks: 4,
    delayMs: 1,
    sleep: async () => {},
  });
  assert.deepEqual(res, { ready: true, index: 2 });
});

test('waitForReceivedAiFloor 目标未物化且无新增尾楼时拒绝落退到旧楼层', async () => {
  const chat = [
    { is_user: false, mes: '更前面一轮的正文' },
    { is_user: true, mes: '本轮用户输入' },
  ];
  const res = await waitForReceivedAiFloor({
    messageId: 2,
    getChat: () => chat,
    maxChecks: 3,
    delayMs: 0,
    sleep: async () => {},
  });
  assert.deepEqual(res, { ready: false, reason: 'unmaterialized' });
});

test('waitForReceivedAiFloor 指向用户楼或等待期间切聊天均立即拦截', async () => {
  const resUser = await waitForReceivedAiFloor({
    messageId: 0,
    getChat: () => [{ is_user: true, mes: '用户发言' }],
    sleep: async () => {},
  });
  assert.deepEqual(resUser, { ready: false, reason: 'not_ai' });

  let stale = false;
  const resStale = await waitForReceivedAiFloor({
    messageId: 1,
    getChat: () => [{ is_user: true, mes: '用户' }, { is_user: false, mes: '' }],
    isStale: () => stale,
    maxChecks: 3,
    sleep: async (ms) => { if (ms > 0) stale = true; },
  });
  assert.deepEqual(resStale, { ready: false, reason: 'stale' });
});

test('splitPlanByBatchSize 按 batchSize 切分超批窗口，避免多轮积压糊在同一请求', () => {
  const plan = [
    {
      key: '1|5|1|0|2|0,2,4,6,8',
      tableIds: ['t1', 't2'],
      tableNames: ['主角信息表', '在场角色表'],
      indices: [0, 2, 4, 6, 8],
      batchSize: 2,
      groupId: 1,
      groupName: '角色组',
    },
    {
      key: '2|5|1|0|3|8',
      tableIds: ['t3'],
      tableNames: ['纪要表'],
      indices: [8],
      batchSize: 3,
      groupId: 2,
      groupName: '基础组',
    },
  ];
  const split = splitPlanByBatchSize(plan);
  assert.equal(split.length, 4);
  assert.deepEqual(split.slice(0, 3).map(g => g.indices), [[0, 2], [4, 6], [8]]);
  assert.deepEqual(split[3].indices, [8]);
  assert.equal(split[3].key, '2|5|1|0|3|8');
});
