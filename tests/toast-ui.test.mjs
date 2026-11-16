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
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

test('fill-notify：进度 toast 注入半透明紧凑与大 × 兜底样式，点右侧安全热区只关闭不终止', async () => {
  const { createProgressToast } = await loadTs('src/sese-ledger/core/fill-notify.ts');
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="toast-container"></div></body></html>', { url: 'http://localhost' });
  const prev = { MouseEvent: globalThis.MouseEvent };
  globalThis.MouseEvent = dom.window.MouseEvent;
  try {
    let terminated = 0;
    let lastOpts = null;
    const toastr = {
      info(msg, title, opts) {
        lastOpts = opts;
        const el = dom.window.document.createElement('div');
        el.className = 'toast toast-info ' + (opts?.extraClasses || '');
        const closeBtn = dom.window.document.createElement('button');
        closeBtn.className = 'toast-close-button';
        closeBtn.textContent = '×';
        closeBtn.getBoundingClientRect = () => ({ left: 220, top: 2, right: 250, bottom: 32, width: 30, height: 30 });
        closeBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          el.remove();
        });
        el.addEventListener('click', () => {
          opts?.onclick?.();
        });
        const msgDiv = dom.window.document.createElement('div');
        msgDiv.className = 'toast-message';
        msgDiv.textContent = msg;
        el.append(closeBtn, msgDiv);
        dom.window.document.getElementById('toast-container').appendChild(el);
        return { 0: el };
      },
      clear(h) { h?.[0]?.remove?.(); },
    };

    const pt = createProgressToast({ getToastr: () => toastr });
    pt.show('填表中…（点击终止）', { onClick: () => { terminated++; } });
    assert(String(lastOpts?.extraClasses || '').includes('sl-progress-toast'));

    const fallback = dom.window.document.getElementById('sl-progress-toast-fallback-css');
    assert(fallback, '单开台账时应注入进度 toast 兜底样式');
    const css = fallback.textContent || '';
    assert(css.includes('rgba(30,36,48,.62)'));
    assert(css.includes('width:30px !important; height:30px !important'));

    const toastEl = dom.window.document.querySelector('#toast-container .toast');
    const closeBtn = toastEl.querySelector('.toast-close-button');
    assert.equal(closeBtn.getAttribute('aria-label'), '只关闭通知（任务在后台继续）');

    // 点关闭按钮左侧缓冲边沿：转为关闭，绝不误触终止
    toastEl.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 215, clientY: 36 }));
    assert.equal(terminated, 0);
    assert.equal(dom.window.document.querySelectorAll('#toast-container .toast').length, 0);

    // 重新弹出后点正文本体：触发终止
    pt.show('填表中…（点击终止）', { onClick: () => { terminated++; } });
    const toastEl2 = dom.window.document.querySelector('#toast-container .toast');
    toastEl2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 40, clientY: 16 }));
    assert.equal(terminated, 1);
  } finally {
    globalThis.MouseEvent = prev.MouseEvent;
    dom.window.close();
  }
});
