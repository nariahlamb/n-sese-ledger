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

const ACK_RAW = [
  '<world_cue>门铃响后，熟悉的脚步停在桌边</world_cue>',
  '<world_ack>',
  'pick: arrive-1 | world_cue | 与在场对话自然衔接',
  'skip: rumor-2、ghost-9 | 情绪专一，本轮压住',
  '</world_ack>',
].join('\n');

/** mode='floor'：尾部用户楼（策略1）；mode='box'：输入框未落楼（策略2 / 入口①）。 */
function fixture({ stableId = true, withIdentity = true, requestFailure = false, presetName = '极速纯召回', mode = 'floor', snapshot = null } = {}) {
  const request = deferred();
  const listeners = new Map();
  const events = {
    on(name, cb) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); },
    off(name, cb) { listeners.get(name)?.delete(cb); },
    async emit(name, ...args) { for (const cb of listeners.get(name) || []) await cb(...args); },
  };
  const user = { ...(stableId ? { uid: 'user-original' } : {}), is_user: true, mes: '原输入' };
  const chat = mode === 'floor' ? [{ is_user: false, mes: '旧正文' }, user] : [{ is_user: false, mes: '旧正文' }];
  let chatIdentity = 'character:card-a|chat:chat-a';
  const writes = [];
  const reports = [];
  const generated = [];
  const specs = [];
  let input = '原输入';
  let deleted = 0;
  const helper = { generate: async (options) => { generated.push(options); return 'host-generated'; } };
  const director = createDirectorRuntime({
    runtime: { isReady: () => true, book: () => null },
    getChat: () => chat,
    ...(withIdentity ? { getChatIdentity: () => chatIdentity } : {}),
    getStatusbarWindows: () => (snapshot ? [{ __ubWorldCognitionSnapshot: { getSnapshot: () => snapshot } }] : []),
    getTavernHelper: () => helper,
    getEventSource: () => events,
    getEventType: name => name,
    requestTask: spec => {
      specs.push(spec);
      return requestFailure ? Promise.reject(new Error('controlled failure')) : request.promise;
    },
    readDriverConfig: () => ({ enabled: true, presetName, presets: {} }),
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
  let lastEmit = Promise.resolve();
  const emit = (next = params) => { lastEmit = events.emit('GENERATION_AFTER_COMMANDS', 'normal', next, false); return lastEmit; };
  let running = Promise.resolve();
  if (mode === 'floor') running = emit(params);
  return {
    request, user, chat, writes, reports, params, generated, specs, helper, events, director,
    getDeleted: () => deleted,
    getInput: () => input,
    emit,
    setChatIdentity: value => { chatIdentity = value; },
    finish: async (raw = '<recall></recall>') => { request.resolve(raw); await (mode === 'floor' ? running : lastEmit); },
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

test('策略1：原始输出带 <world_ack> 时随用户楼写 sl_world_ack，且回执不进正文指令', async () => {
  const f = fixture({ presetName: '魔改召回' });
  await f.finish(ACK_RAW);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.user.sl_world_ack, {
    version: 1,
    chatIdentity: 'character:card-a|chat:chat-a',
    picked: { id: 'arrive-1', targetTag: 'world_cue', reason: '与在场对话自然衔接' },
    // 本轮没有状态栏快照（事件池不可知）→ 不做白名单过滤，回执原样保留
    skippedIds: ['rumor-2', 'ghost-9'],
    skippedReason: '情绪专一，本轮压住',
  });
  assert.match(f.user.mes, /<world_cue>门铃响后，熟悉的脚步停在桌边<\/world_cue>/);
  assert.doesNotMatch(f.user.mes, /world_ack|arrive-1|rumor-2/, '回执只落字段，不进正文指令');
  // 原始输出仍完整落 sl_plot_tasks（回执可回读诊断）
  assert.match(f.user.sl_plot_tasks['魔改召回'], /<world_ack>/);
  f.director.unbind();
});

test('无 <world_ack> 时不写 sl_world_ack 字段（旧预设零影响）', async () => {
  const f = fixture({ presetName: '魔改召回' });
  await f.finish('<world_cue>门铃响后</world_cue>');
  assert.equal('sl_world_ack' in f.user, false);
  assert.match(f.user.mes, /<world_cue>门铃响后<\/world_cue>/);
  f.director.unbind();
});

test('策略2：输入框未落楼时先写回指令，MESSAGE_SENT 落到用户楼后补自产标记与 sl_world_ack', async () => {
  const f = fixture({ presetName: '魔改召回', mode: 'box' });
  const running = f.emit();
  f.request.resolve(ACK_RAW);
  await running;
  assert.equal(f.params.prompt, f.getInput());
  assert.match(f.getInput(), /<world_cue>门铃响后/);

  const landed = { is_user: true, mes: f.getInput() };
  f.chat.push(landed);
  await f.events.emit('MESSAGE_SENT', f.chat.length - 1);
  assert.equal(landed._sl_processed, true);
  assert.equal(landed.sl_plot, f.getInput());
  assert.equal(landed.sl_world_ack.picked.id, 'arrive-1');
  assert.deepEqual(landed.sl_world_ack.skippedIds, ['rumor-2', 'ghost-9']);
  f.director.unbind();
});

test('入口①（TavernHelper.generate）：改写本轮输入位置，并在 MESSAGE_SENT 补 sl_world_ack', async () => {
  const f = fixture({ presetName: '魔改召回', mode: 'box' });
  assert.notEqual(f.helper.generate, undefined);
  const options = { type: 'normal', user_input: '原输入', injects: [{ content: '原输入' }] };
  const gated = f.helper.generate(options);
  f.request.resolve(ACK_RAW);
  assert.equal(await gated, 'host-generated');
  assert.equal(f.generated.length, 1, '原始 generate 仍被调用一次');
  const directive = options.injects[0].content;
  assert.match(directive, /<world_cue>门铃响后/);
  assert.notEqual(directive, '原输入');

  const landed = { is_user: true, mes: directive };
  f.chat.push(landed);
  await f.events.emit('MESSAGE_SENT', f.chat.length - 1);
  assert.equal(landed._sl_processed, true);
  assert.equal(landed.sl_world_ack.picked.targetTag, 'world_cue');
  assert.equal(landed.sl_world_ack.chatIdentity, 'character:card-a|chat:chat-a');
  f.director.unbind();
});

test('有状态栏快照时按本轮事件池过滤幻觉回执 id，并把 suspendWorldDigest 传给请求', async () => {
  const snapshot = {
    version: 2,
    available: true,
    chatIdentity: 'character:card-a|chat:chat-a',
    worldbookDelegated: true,
    characters: {},
    restrictions: {},
    eventPool: [{ id: 'arrive-1', kind: 'arrival', title: '店长到访', cue: '门铃响后，熟悉的脚步停在桌边' }],
  };
  const f = fixture({ presetName: '魔改召回', snapshot });
  await f.finish(ACK_RAW);
  assert.equal(f.specs.length, 1);
  assert.equal(f.specs[0].suspendWorldDigest, true);
  assert.equal(f.user.sl_world_ack.picked.id, 'arrive-1');
  assert.deepEqual(f.user.sl_world_ack.skippedIds, [], '池外的 rumor-2 / ghost-9 一律过滤');
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

test('策略1 用户楼含首尾空白或换行时仍能匹配并成功落楼（手机输入法兼容）', async () => {
  const request = deferred();
  const listeners = new Map();
  const events = {
    on(name, cb) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); },
    off(name, cb) { listeners.get(name)?.delete(cb); },
    async emit(name, ...args) { for (const cb of listeners.get(name) || []) await cb(...args); },
  };
  const user = { uid: 'u-trim', is_user: true, mes: '原输入 \n' };
  const chat = [{ is_user: false, mes: '旧正文' }, user];
  const writes = [];
  let deleted = 0;
  const director = createDirectorRuntime({
    runtime: { isReady: () => true, book: () => null },
    getChat: () => chat,
    getChatIdentity: () => 'character:card-a|chat:chat-trim',
    getStatusbarWindows: () => [],
    getTavernHelper: () => null,
    getEventSource: () => events,
    getEventType: name => name,
    requestTask: () => request.promise,
    readDriverConfig: () => ({ enabled: true, presetName: '极速纯召回', presets: {} }),
    saveDriverConfig() {},
    updateUserMessage: async (index, patch) => { writes.push({ index, patch }); user.mes = patch.mes; return true; },
    getInputBox: () => '原输入 \n',
    setInputBox() {},
    deleteLastMessage: async () => { deleted++; },
    clickSend: () => true,
    notifyProgress() {}, clearProgress() {}, warn() {}, report() {},
    now: () => 1000,
  });
  director.bind();
  director.__gate.lastIntentAt = 1000;
  const p = {};
  const r = events.emit('GENERATION_AFTER_COMMANDS', 'normal', p, false);
  request.resolve('<recall></recall>');
  await r;
  assert.equal(writes.length, 1);
  assert.equal(deleted, 0);
  assert.match(p.prompt, /本轮召回：/);
  director.unbind();
});
