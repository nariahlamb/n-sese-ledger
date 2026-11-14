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

const { createDirectorRuntime } = await loadTs('src/sese-ledger/core/director-runtime.ts');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function fixture({ stableId = true, withIdentity = true, requestFailure = false } = {}) {
  const request = deferred();
  const listeners = new Map();
  const events = {
    on(name, cb) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); },
    off(name, cb) { listeners.get(name)?.delete(cb); },
    async emit(name, ...args) { for (const cb of listeners.get(name) || []) await cb(...args); },
  };
  const user = { ...(stableId ? { uid: 'user-original' } : {}), is_user: true, mes: '原输入' };
  const chat = [{ is_user: false, mes: '旧正文' }, user];
  let chatIdentity = 'character:card-a|chat:chat-a';
  const writes = [];
  const reports = [];
  let input = '原输入';
  let deleted = 0;
  const director = createDirectorRuntime({
    runtime: { isReady: () => true, book: () => null },
    getChat: () => chat,
    ...(withIdentity ? { getChatIdentity: () => chatIdentity } : {}),
    getStatusbarWindows: () => [],
    getTavernHelper: () => null,
    getEventSource: () => events,
    getEventType: name => name,
    requestTask: () => requestFailure ? Promise.reject(new Error('controlled failure')) : request.promise,
    readDriverConfig: () => ({ enabled: true, presetName: '极速纯召回', presets: {} }),
    saveDriverConfig() {},
    updateUserMessage: async (index, patch) => {
      writes.push({ index, message: chat[index], patch });
      if (chat[index]) Object.assign(chat[index], patch);
      return true;
    },
    getInputBox: () => input,
    setInputBox: text => { input = text; },
    deleteLastMessage: async () => { chat.pop(); deleted++; },
    clickSend: () => true,
    notifyProgress() {}, clearProgress() {}, warn() {}, report: event => reports.push(event),
    now: () => 1000,
  });
  director.bind();
  director.__gate.lastIntentAt = 1000;
  const params = {};
  const running = events.emit('GENERATION_AFTER_COMMANDS', 'normal', params, false);
  return {
    request, user, chat, writes, reports, params, running, director,
    getDeleted: () => deleted,
    getInput: () => input,
    emit: params => events.emit('GENERATION_AFTER_COMMANDS', 'normal', params, false),
    setChatIdentity: value => { chatIdentity = value; },
    finish: async (raw = '<recall></recall>') => { request.resolve(raw); await running; },
  };
}

test('deferred 规划成功后仍写原用户楼并更新本轮 prompt', async () => {
  const f = fixture();
  await f.finish();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].message, f.user);
  assert.equal(f.user.sl_plot.includes('<本轮用户输入>\n原输入\n</本轮用户输入>'), true);
  assert.match(f.params.prompt, /本轮召回：/);
  assert.equal(f.params.prompt, f.user.mes);
  f.director.unbind();
});

test('await 期间删除前楼后沿稳定 ID 找原对象，不用旧下标写新楼', async () => {
  const f = fixture();
  f.chat.shift();
  await f.finish();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].index, 0);
  assert.equal(f.writes[0].message, f.user);
  assert.equal(f.user._sl_processed, true);
  f.director.unbind();
});

test('await 期间目标被删除或编辑均不写，旧结果不进入 params.prompt', async () => {
  for (const action of ['delete', 'edit']) {
    const f = fixture();
    if (action === 'delete') f.chat.pop();
    else f.user.mes = '用户已编辑';
    await f.finish();
    assert.equal(f.writes.length, 0, action);
    assert.equal(f.params.prompt, undefined, action);
    f.director.unbind();
  }
});

test('await 期间切聊天即作废旧结果；缺身份时对象替换也不能通过兜底', async () => {
  const switched = fixture();
  switched.setChatIdentity('character:card-a|chat:chat-b');
  await switched.finish();
  assert.equal(switched.writes.length, 0);
  assert.equal(switched.reports.some(e => e.message.includes('聊天发生变化')), true);
  switched.director.unbind();

  const replaced = fixture({ stableId: false, withIdentity: false });
  replaced.chat[1] = { is_user: true, mes: '原输入' };
  await replaced.finish();
  assert.equal(replaced.writes.length, 0);
  replaced.director.unbind();
});

test('失败/中止的清理也复核目标，绝不删除新楼', async () => {
  const failing = fixture({ requestFailure: true });
  const running = failing.emit({});
  failing.user.mes = '用户已编辑';
  await running;
  assert.equal(failing.getDeleted(), 0);
  failing.director.unbind();

  const switched = fixture({ requestFailure: true });
  const runningSwitch = switched.emit({});
  switched.setChatIdentity('character:card-a|chat:chat-b');
  await runningSwitch;
  assert.equal(switched.getDeleted(), 0);
  assert.equal(switched.getInput(), '原输入');
  switched.director.unbind();
});
