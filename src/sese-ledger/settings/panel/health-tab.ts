import { el, esc } from './shared';
import type { TabCtx } from './shell';

export function renderHealthTab(ctx: TabCtx, pane: HTMLElement): void {
  const { deps, doc } = ctx;
  const health = deps.canonical?.fieldContracts?.health?.() || [];
  const registered = deps.canonical?.fieldContracts?.list?.() || [];
  const style = el(doc, 'style');
  style.textContent = `.slw-health-summary{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.slw-health-items{display:grid;gap:8px}.slw-health-item{border:1px solid var(--line,#e2d8cc);border-radius:10px;padding:12px;background:var(--panel2,#fff)}.slw-health-item.bad{border-color:var(--danger,#b95656)}.slw-health-item p{margin:5px 0}.slw-health-item code{overflow-wrap:anywhere}`;
  pane.appendChild(style);
  pane.appendChild(el(doc, 'div', { class: 'slw-card' }, `
    <h3>字段健康 <span class="desc">插件登记需要哪些表和列；改名只提示，不阻止，也不会让旧名字继续生效</span></h3>
    <div class="slw-row"><button class="slw-btn primary" id="slw-health-refresh">重新检查</button><span class="slw-muted">台账未就绪时只显示登记，不判定缺失。</span></div>
    <div class="slw-health-summary"><span class="slw-tag">${registered.length} 个插件</span><span class="slw-tag">${health.length} 项字段</span><span class="slw-tag ${health.some((x: any) => x.missing) ? 'warn' : ''}">${health.filter((x: any) => x.missing).length} 项当前缺失</span><span class="slw-tag ${health.some((x: any) => x.observedMissing) ? 'warn' : ''}">${health.filter((x: any) => x.observedMissing).length} 项运行时缺列</span></div>
    <div class="slw-annot">“当前缺失”来自账本结构；“运行时缺列”来自插件实际取数。清单和记录只保存在本次运行内，旧版台账不注册时显示空。必需字段缺失会影响对应功能；可选字段缺失表示该功能按插件原逻辑跳过。</div>`));
  const list = el(doc, 'div', { class: 'slw-health-items' });
  if (!registered.length) list.appendChild(el(doc, 'div', { class: 'slw-annot' }, '尚未收到插件字段登记。状态栏和小手机需要支持字段契约的版本；它们下次读表或切换聊天时会再次登记。'));
  for (const item of health) {
    const status = item.evaluated === false ? '未建账，尚未检查' : item.missing ? (!item.tablePresent ? '缺表' : '缺列') : '已找到';
    const classes = `slw-health-item ${item.missing || item.observedMissing ? 'bad' : ''}`;
    list.appendChild(el(doc, 'article', { class: classes }, `
      <b>${esc(item.label)} · ${esc(item.feature)}${item.required ? ' · 必需' : ' · 可选'}</b>
      <p><code>${esc(item.table)}${item.column ? ` · ${esc(item.column)}` : '（整表）'}</code>　${esc(status)}${item.required ? ' · 必需' : ' · 可选'}</p>
      ${item.observedMissing ? `<p class="slw-muted">本次账本曾报告缺失，累计 ${item.missingCount} 次。</p>` : ''}`));
  }
  pane.appendChild(list);
  pane.querySelector('#slw-health-refresh')!.addEventListener('click', () => ctx.refresh('health'));
}
