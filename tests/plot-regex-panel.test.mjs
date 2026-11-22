import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

async function loadTs(path) {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'esm',
    target: 'node22', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const tpl = await loadTs('src/sese-ledger/core/plot-regex-template.ts');

function mountPanel({ input, tail, message, summaryRows = {} }) {
  const scripts = tpl.plotRegexScripts();
  const panelScript = scripts[0];
  assert.ok(!panelScript.replaceString.includes('<\\/script>'), 'replaceString 不得残留转义脚本结束标签');
  const html = tpl.plotPanelHtml()
    .replace('$1', input)
    .replace('$2', tail);
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/' });
  // 注意：JSDOM 内联 script 在解析期执行，因此把聊天上下文与 API 挂载到独立 iframe-parent 模拟后再重跑或先准备 window.parent
  return { dom, scripts };
}

function runPanelWithHost({ input, tail, message, summaryRows = {} }) {
  const html = tpl.plotPanelHtml()
    .replace('$1', input)
    .replace('$2', tail);
  const hostDom = new JSDOM('<!doctype html><html><body><div class="mes" mesid="1"><div class="mes_text">正文</div></div></body></html>', {
    url: 'http://localhost/',
  });
  hostDom.window.SillyTavern = {
    getContext: () => ({ chat: [{ is_user: false, mes: '开场' }, message] }),
  };
  hostDom.window.SeseLedgerAPI = {
    query: (_table, opts) => {
      const code = opts?.where?.['编码索引'];
      return summaryRows[code] ? { rows: [summaryRows[code]] } : { rows: [] };
    },
    driver: { resetRound: async () => ({ ok: true }) },
  };
  const panelDom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://localhost/',
    beforeParse(win) {
      Object.defineProperty(win, 'parent', { value: hostDom.window, configurable: true });
    },
  });
  const scripts = Array.from(panelDom.window.document.querySelectorAll('script')).filter((s) => !s.type);
  for (const s of scripts) {
    panelDom.window.eval(s.textContent || '');
  }
  return { hostDom, panelDom };
}

test('剧情推进面板：适配 v2 格式（NSFW、match 召回依据、world_cue、sl_world_ack）并支持日间奶油手账/夜间 TokyoNight Storm 切换', () => {
  const css = tpl.plotPanelHtml();
  assert.match(css, /rgba\(36, 40, 59|#7aa2f7/, '夜间样式须采用 TokyoNight Storm 主色');
  assert.match(css, /#f7f1e6/, '日间样式须采用奶油手账纸底色');
  assert.match(css, /#b9586c/, '日间样式须采用奶油手账樱粉强调色');

  const input = '去码头看看风声';
  const tail = [
    '<recall>AM0002</recall>',
    '<soul>',
    'nsfw',
    '【主角】不知道阿青今晚准备乘船离开',
    '【阿青】无认知盲点 | 无 | 主动：在灯下压低声音问你要不要跟她走',
    '</soul>',
    '<chaos>',
    '走向：中性变数',
    '突发意外：巡夜伙计提着灯笼从巷口经过',
    '</chaos>',
    '<world_cue>码头茶棚有人议论脚夫停工讨薪的事。</world_cue>',
    '<spot>星海商圈-南码头,老城茶馆</spot>',
  ].join('\n');

  const message = {
    is_user: true,
    mes: '<本轮用户输入>\n' + input + '\n</本轮用户输入>\n' + tail,
    sl_plot_tasks: {
      '魔改召回': [
        '<match>',
        'AM0002 | 交代了码头欠薪风波的起因',
        '</match>',
        '<chaos_bg>chaos_bg=62</chaos_bg>',
        '<chaos_char>阿青=88</chaos_char>',
      ].join('\n'),
    },
    sl_world_ack: {
      version: 1,
      chatIdentity: 'c1',
      picked: { id: 'rumor_1', targetTag: 'world_cue', reason: '主角正要去码头' },
      skippedIds: ['in_10'],
      skippedReason: '先留白',
    },
  };

  const { hostDom, panelDom } = runPanelWithHost({
    input,
    tail,
    message,
    summaryRows: {
      AM0002: { '时间跨度': '三日前', '纪要': '码头商行拖欠脚夫工钱。', '重要对话': '工头：再拖三天就停工。' },
    },
  });

  try {
    const doc = panelDom.window.document;
    const root = doc.getElementById('slp');
    assert.ok(root);
    assert.match(root.textContent, /NSFW/);
    assert.match(root.textContent, /后台入戏/);
    assert.match(root.textContent, /主动：|在灯下压低声音问你要不要跟她走/);
    assert.match(root.textContent, /混沌 88/);

    // 切到「召回」页签并点击 AM0002：必须同时显示 <match> 召回依据和纪要
    const recallTab = Array.from(doc.querySelectorAll('.slp-tab')).find((b) => b.textContent.includes('召回'));
    recallTab.click();
    const amBtn = doc.querySelector('.slp-am');
    amBtn.click();
    assert.match(doc.querySelector('.slp-reason').textContent, /交代了码头欠薪风波的起因/);
    assert.match(doc.querySelector('.slp-summary').textContent, /码头商行拖欠脚夫工钱/);

    // 切到「动态」页签：显示后台切入 + picked id/reason + 全局意外 + 混沌条 + 压住提示
    const dynTab = Array.from(doc.querySelectorAll('.slp-tab')).find((b) => b.textContent.includes('动态'));
    dynTab.click();
    const viewText = doc.querySelector('.slp-view').textContent;
    assert.match(viewText, /后台切入/);
    assert.match(viewText, /rumor_1/);
    assert.match(viewText, /主角正要去码头/);
    assert.match(viewText, /码头茶棚有人议论脚夫停工讨薪的事/);
    assert.match(viewText, /巡夜伙计提着灯笼从巷口经过/);
    assert.match(viewText, /62 \/ 100/);
    assert.match(viewText, /本轮已压住 1 条后台候选：先留白/);

    // 主题切换：夜间 Storm <-> 日间奶油手账，持久化到 localStorage
    const themeBtn = Array.from(doc.querySelectorAll('.slp-tool')).find((b) => /Storm|手账/.test(b.textContent));
    const wasLight = root.classList.contains('light');
    themeBtn.click();
    assert.equal(root.classList.contains('light'), !wasLight);
    assert.equal(panelDom.window.localStorage.getItem('sese_ledger_plot_panel_theme'), wasLight ? 'dark' : 'light');
  } finally {
    panelDom.window.close();
    hostDom.window.close();
  }
});

test('剧情推进面板：RAW 含 thinking 内未闭合 <match>/<chaos_bg>/<world_ack> 时仍精确提取面板字段', () => {
  const input = '推门进屋';
  const tail = '<recall>AM0001</recall><soul>【主角】无认知盲点</soul><spot>客厅</spot>';
  const rawWithThinking = [
    '<thinking>',
    '先写一段思考：<match>草稿乱写，而且忘了闭合',
    '这里还提到了 <chaos_bg>999 与 <world_ack> 跳过',
    '</thinking>',
    '<match>',
    'AM0001 | 交代客厅钥匙来历',
    '</match>',
    '<chaos_bg>chaos_bg=35</chaos_bg>',
    '<world_ack>',
    'skip: in_1 | 室内安静',
    '</world_ack>',
  ].join('\n');
  const { hostDom, panelDom } = runPanelWithHost({
    input,
    tail,
    message: {
      is_user: true,
      mes: '<本轮用户输入>\n' + input + '\n</本轮用户输入>\n' + tail,
      sl_plot_tasks: { '魔改召回': rawWithThinking },
    },
    summaryRows: { AM0001: { '时间跨度': '昨日', '纪要': '拿到客厅备用钥匙。', '重要对话': '' } },
  });
  try {
    const doc = panelDom.window.document;
    const recallTab = Array.from(doc.querySelectorAll('.slp-tab')).find((b) => b.textContent.includes('召回'));
    recallTab.click();
    doc.querySelector('.slp-am').click();
    assert.match(doc.querySelector('.slp-reason').textContent, /交代客厅钥匙来历/);
    assert.doesNotMatch(doc.querySelector('.slp-reason').textContent, /草稿乱写/);
    const dynTab = Array.from(doc.querySelectorAll('.slp-tab')).find((b) => b.textContent.includes('动态'));
    dynTab.click();
    const viewText = doc.querySelector('.slp-view').textContent;
    assert.match(viewText, /35 \/ 100/);
    assert.match(viewText, /本轮已压住 1 条后台候选：室内安静/);
  } finally {
    panelDom.window.close();
    hostDom.window.close();
  }
});

test('剧情推进面板：无 world_cue / sl_world_ack / match 时安全降级不报错', () => {
  const { hostDom, panelDom } = runPanelWithHost({
    input: '你好',
    tail: '<soul>【主角】无认知盲点</soul>',
    message: { is_user: true, mes: '<本轮用户输入>你好</本轮用户输入><soul>【主角】无认知盲点</soul>' },
  });
  try {
    const doc = panelDom.window.document;
    assert.match(doc.getElementById('slp').textContent, /你好/);
    assert.equal(doc.querySelector('.slp-sec-title').textContent, '人物');
    assert.equal(doc.querySelectorAll('.slp-tab').length, 0);
  } finally {
    panelDom.window.close();
    hostDom.window.close();
  }
});
