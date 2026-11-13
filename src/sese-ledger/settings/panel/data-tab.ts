import { el, esc, confirmDialog as askConfirm, openEditorDialog, type EditorDialogHandle } from './shared';
import type { TabCtx } from './shell';
import type { TableModel } from '../../core/book';
import { createDataWorkbench, dataCellLocked } from '../../core/data-workbench';

interface DataViewState { tableId: string; query: string; page: number; selected: Set<number>; storageId: string | null }
const viewStates = new WeakMap<object, DataViewState>();
const PAGE_SIZE = 30;

const LONG_HEADER_RE = /(经历|描述|详情|内心|纪要|备注|外观|设定|事件|背景|说明|内容|对话|记忆|服装|衣着|轨迹|总结|评语)/;
const SHORT_HEADER_RE = /^(姓名|角色|名称|物品名称|性别|年龄|生日|状态|当前状态|情绪|好感|好感度|关系|关系类型|数量|类型|价格|时间|当前时间|日期|地点|当前地点|等级|强度|阶段|阵营|职业|身高|体重|三围|部位|敏感度|调教值|淫乱度)$/;

function columnSizeClass(header: string, colIndex: number, rows: string[][]): 'col-short' | 'col-mid' | 'col-long' {
  const h = String(header || '').trim();
  if (LONG_HEADER_RE.test(h)) return 'col-long';
  let maxLen = h.length;
  for (let i = 0; i < rows.length; i++) {
    const len = String(rows[i]?.[colIndex] ?? '').trim().length;
    if (len > maxLen) maxLen = len;
    if (maxLen > 48) return 'col-long';
  }
  if (SHORT_HEADER_RE.test(h) && maxLen <= 16) return 'col-short';
  if (maxLen <= 14) return 'col-short';
  if (maxLen <= 36) return 'col-mid';
  return 'col-long';
}

const DATA_CSS = `
.slw-data-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.slw-data-head h3{margin:0;font-size:14px;color:var(--gold);font-weight:600;display:flex;align-items:center;gap:8px}
.slw-data-head-hint{color:var(--muted,#8b8676);font-size:11.5px}
/* ── 顶部可滑动表标签栏（Table Tabs Ribbon） ── */
.slw-data-tabs-bar{position:relative;margin:0 0 12px;padding:4px;border-radius:10px;background:var(--bg,#1b1d24);border:1px solid var(--line);overflow:hidden}
.slw-data-tabs{display:flex;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;padding:2px 2px 4px;scroll-behavior:smooth;scrollbar-width:thin;-webkit-overflow-scrolling:touch;user-select:none}
.slw-data-tabs::-webkit-scrollbar{height:4px}
.slw-data-tabs::-webkit-scrollbar-track{background:transparent}
.slw-data-tabs::-webkit-scrollbar-thumb{background:var(--line2);border-radius:3px}
.slw-data-tab{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--muted,#8b8676);font:600 12.5px/1.3 inherit;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s,border-color .15s,box-shadow .15s}
.slw-data-tab:hover{color:var(--text,#dcd7cc);background:rgba(232,217,176,.06)}
.slw-data-tab.on{color:var(--gold,#e8d9b0);background:var(--panel2,#1d1f26);border-color:var(--line2,rgba(232,217,176,.28));box-shadow:0 2px 8px rgba(0,0,0,.22)}
.slw-data-tab-name{letter-spacing:.2px}
.slw-data-tab-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;border-radius:999px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;background:rgba(232,217,176,.10);color:var(--gold-dim,#c9b98a);border:1px solid rgba(232,217,176,.16)}
.slw-data-tab.on .slw-data-tab-badge{background:var(--gold,#e8d9b0);color:#1b1d24;border-color:transparent}
.slw-data-tab.is-empty .slw-data-tab-badge{opacity:.55;font-weight:500}
/* ── 工具栏与搜索 ── */
.slw-data-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.slw-data-select-fallback{display:none;max-width:100%;min-width:140px}
.slw-data-meta-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;background:var(--bg,#1b1d24);border:1px solid var(--line);color:var(--gold-dim,#c9b98a);font-size:12px;font-weight:600;white-space:nowrap}
.slw-data-search-wrap{flex:1;min-width:180px;display:flex;align-items:center;position:relative}
.slw-data-search-wrap input{width:100%;min-width:120px;padding:6px 11px;border-radius:7px;background:var(--bg,#1b1d24);border:1px solid var(--line2);color:var(--text);font:12.5px inherit}
.slw-data-search-wrap input:focus{outline:none;border-color:var(--gold)}
.slw-data-status-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.slw-data-status{margin:0;color:var(--muted,#8b8676);font-size:11.5px;white-space:pre-wrap;overflow-wrap:anywhere}
/* ── 横向可滑动数据表格容器 ── */
.slw-data-grid-wrap{position:relative;width:100%;overflow-x:auto;overflow-y:visible;border:1px solid var(--line2);border-radius:10px;background:var(--bg,#1b1d24);-webkit-overflow-scrolling:touch;scrollbar-width:thin}
.slw-data-grid-wrap.is-grabbing{cursor:grabbing;user-select:none}
.slw-data-grid-wrap::-webkit-scrollbar{height:10px;width:10px}
.slw-data-grid-wrap::-webkit-scrollbar-track{background:rgba(0,0,0,.12);border-radius:0 0 10px 10px}
.slw-data-grid-wrap::-webkit-scrollbar-thumb{background:var(--line2);border-radius:4px}
.slw-data-grid-wrap::-webkit-scrollbar-thumb:hover{background:var(--gold-dim)}
.slw-app table.slw-tbl.slw-data-table{table-layout:auto;width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
.slw-data-table thead th{position:sticky;top:0;z-index:2;background:var(--card,#2a2d38);color:var(--gold,#e8d9b0);font-weight:600;font-size:12px;letter-spacing:.3px;padding:9px 12px;border-bottom:1.5px solid var(--line2);border-right:1px solid var(--line);white-space:nowrap;text-align:left}
.slw-data-table thead th:last-child{border-right:0}
.slw-data-table tbody tr{background:var(--panel2,#1d1f26);transition:background .12s}
.slw-data-table tbody tr:nth-child(even){background:var(--panel,#23252e)}
.slw-data-table tbody tr:hover{background:rgba(232,217,176,.07)}
.slw-data-table tbody tr.is-selected{background:rgba(232,217,176,.12)}
.slw-data-table tbody td{padding:8px 12px;border-bottom:1px solid var(--line);border-right:1px solid rgba(232,217,176,.07);vertical-align:top;overflow-wrap:anywhere}
.slw-data-table tbody td:last-child{border-right:0}
.slw-data-table tbody tr:last-child td{border-bottom:0}
/* ── 智能列宽与首尾冻结列 ── */
.slw-data-table .slw-data-pick{width:42px;min-width:42px;max-width:42px;text-align:center;vertical-align:middle;padding:8px 6px}
.slw-data-table .slw-data-id{width:68px;min-width:68px;max-width:80px;font-family:ui-monospace,Consolas,monospace;font-weight:600;color:var(--gold-dim,#c9b98a);vertical-align:middle;white-space:nowrap}
.slw-data-table .col-short{min-width:120px;max-width:190px}
.slw-data-table .col-mid{min-width:185px;max-width:270px}
.slw-data-table .col-long{min-width:265px;max-width:390px}
.slw-data-table .slw-data-actions{width:124px;min-width:124px;white-space:nowrap;vertical-align:middle;text-align:right}
@media(min-width:701px){
  .slw-data-table th.slw-data-pick,.slw-data-table td.slw-data-pick{position:sticky;left:0;z-index:3;background:inherit}
  .slw-data-table th.slw-data-id,.slw-data-table td.slw-data-id{position:sticky;left:42px;z-index:3;background:inherit;box-shadow:2px 0 6px rgba(0,0,0,.14)}
  .slw-data-table thead th.slw-data-pick,.slw-data-table thead th.slw-data-id{z-index:4;background:var(--card,#2a2d38)}
  .slw-data-table th.slw-data-actions,.slw-data-table td.slw-data-actions{position:sticky;right:0;z-index:3;background:inherit;box-shadow:-2px 0 6px rgba(0,0,0,.14)}
  .slw-data-table thead th.slw-data-actions{z-index:4;background:var(--card,#2a2d38)}
}
.slw-data-cell{display:block;text-align:left;width:100%;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;padding:3px 5px;margin:-3px -5px;cursor:pointer;font:inherit;transition:background .12s,border-color .12s}
.slw-data-cell:hover{background:rgba(232,217,176,.08);border-color:var(--line2)}
.slw-data-preview{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55;max-height:4.7em}
.slw-data-preview.is-empty{color:var(--muted);opacity:.55;font-style:italic}
.slw-data-table .slw-data-label{display:none}
.slw-data-actions-inner{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end}
.slw-data-actions .slw-btn{padding:4px 9px;margin:0;font-size:12px}
.slw-data-empty{padding:36px 20px;text-align:center;color:var(--muted);font-size:12.5px;line-height:1.7}
.slw-data-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px;padding-top:8px}
.slw-data-pager{display:inline-flex;align-items:center;gap:8px}
/* ── 编辑弹窗多列网格 ── */
.slw-data-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px 16px}
.slw-data-fields label{display:flex;flex-direction:column;gap:6px;color:var(--gold-dim,#c9b98a);background:var(--panel2,#1d1f26);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.slw-data-fields label.is-long{grid-column:1 / -1}
.slw-data-fields textarea{min-height:88px;line-height:1.6;width:100%;color:var(--text,#dcd7cc);flex:1}
.slw-data-fields label.is-long textarea{min-height:120px}
.slw-data-field-head{display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:600;font-size:12.5px}
.slw-data-editor-error{color:var(--danger,#e07a7a);white-space:pre-wrap;overflow-wrap:anywhere;flex-basis:100%;margin:0}
.slw-data-full{width:calc(100vw - 24px)!important;height:calc(100dvh - 24px);max-height:calc(100dvh - 24px)!important;display:flex;flex-direction:column;gap:10px}
.slw-data-full textarea{flex:1;min-height:0;resize:none;line-height:1.7}.slw-data-full .slw-btns{flex-shrink:0}
.slw-data-view{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;user-select:text}
/* ── 日间奶油手账主题精细适配 ── */
html:not(.slw-theme-dark) .slw-data-tabs-bar{background:#f3ead9;border-color:var(--line2)}
html:not(.slw-theme-dark) .slw-data-tab:hover{background:rgba(232,165,176,.14);color:#4a3f36}
html:not(.slw-theme-dark) .slw-data-tab.on{background:#fffaf1;color:#b9586c;border-color:#e8a5b0;box-shadow:0 2px 6px rgba(160,110,90,.14)}
html:not(.slw-theme-dark) .slw-data-tab-badge{background:#ebe0cd;color:#6e5d4f;border-color:#d9c8ad}
html:not(.slw-theme-dark) .slw-data-tab.on .slw-data-tab-badge{background:#d87a8a;color:#fff;border-color:transparent}
html:not(.slw-theme-dark) .slw-data-meta-pill{background:#f3ead9;border-color:var(--line2);color:#6e5d4f}
html:not(.slw-theme-dark) .slw-data-search-wrap input{background:#fff;border-color:var(--line2);color:var(--text)}
html:not(.slw-theme-dark) .slw-data-search-wrap input:focus{border-color:#d87a8a}
html:not(.slw-theme-dark) .slw-data-grid-wrap{background:#fffaf1;border-color:var(--line2)}
html:not(.slw-theme-dark) .slw-data-table thead th{background:#f3ead9;color:#5c4938;border-bottom-color:var(--line2);border-right-color:var(--line)}
html:not(.slw-theme-dark) .slw-data-table tbody tr{background:#fffaf1}
html:not(.slw-theme-dark) .slw-data-table tbody tr:nth-child(even){background:#faf4e8}
html:not(.slw-theme-dark) .slw-data-table tbody tr:hover{background:#fdf0ed}
html:not(.slw-theme-dark) .slw-data-table tbody tr.is-selected{background:#fbe4e7}
html:not(.slw-theme-dark) .slw-data-table tbody td{border-bottom-color:var(--line);border-right-color:rgba(180,150,110,.16)}
html:not(.slw-theme-dark) .slw-data-cell:hover{background:rgba(232,165,176,.14);border-color:#e8a5b0}
html:not(.slw-theme-dark) .slw-data-fields label{background:#faf4e8;border-color:var(--line);color:#5c4938}
/* ── 窄屏手机端（<=700px）自动切换为卡片列表 ── */
@media(max-width:700px){
  .slw-data-select-fallback{display:block;flex:1 1 100%}
  .slw-data-tools>*{max-width:100%}
  .slw-data-grid-wrap{border:0;background:transparent;overflow-x:visible}
  .slw-app table.slw-tbl.slw-data-table,.slw-data-table tbody{display:block;width:100%;min-width:0!important}
  .slw-data-table thead{display:none}
  .slw-data-table tbody tr{display:block;margin-bottom:12px;border:1px solid var(--line2,rgba(232,217,176,.28));border-radius:10px;padding:10px}
  .slw-data-table tbody td,.slw-data-table .col-short,.slw-data-table .col-mid,.slw-data-table .col-long,.slw-data-table .slw-data-pick,.slw-data-table .slw-data-id,.slw-data-table .slw-data-actions{display:block!important;width:100%!important;min-width:0!important;max-width:none!important;border:0!important;padding:5px 4px!important;text-align:left!important;box-shadow:none!important;position:static!important}
  .slw-data-table .slw-data-label{display:block;color:var(--gold-dim,#c9b98a);font-size:11px;font-weight:600;margin-bottom:2px}
  .slw-data-actions-inner{justify-content:flex-start}
  .slw-data-fields{grid-template-columns:1fr}
}
`;

export function renderDataTab(ctx: TabCtx, pane: HTMLElement): void {
  const { deps, doc } = ctx;
  const rt = deps.runtime;
  const previousCleanup = (pane as any).__slwCleanup;
  if (typeof previousCleanup === 'function') previousCleanup();
  let state = viewStates.get(rt);
  if (!state) {
    state = { tableId: '', query: '', page: 0, selected: new Set(), storageId: rt.storageId() };
    viewStates.set(rt, state);
  }
  const view = state;
  if (view.storageId !== rt.storageId()) {
    view.storageId = rt.storageId();
    view.selected.clear();
    view.page = 0;
  }
  let alive = true;
  let editor: EditorDialogHandle | null = null;
  let nested: HTMLElement | null = null;
  const unsubscribers: (() => void)[] = [];
  const getChat = () => deps.getChat();
  const busy = () => !!(deps.canonical?.fill?.isRunning?.() || deps.canonical?.fill?.getState?.()?.running);
  const getLocks = (id: string) => deps.canonical?.__legacyFace?.getTableLockState?.(id) || null;
  const workbench = createDataWorkbench({ runtime: rt, getChat, isBusy: busy, getLocks });
  const root = el(doc, 'div', { class: 'slw-data' });
  root.innerHTML = `<style>${DATA_CSS}</style>
    <div class="slw-card">
      <div class="slw-data-head">
        <h3>表格数据</h3>
        <span class="slw-data-head-hint">手动修改归入保存时钉住的最新 AI 楼；草稿不会自动保存</span>
      </div>
      <div class="slw-data-tabs-bar">
        <div class="slw-data-tabs" data-table-tabs role="tablist" aria-label="数据表标签栏"></div>
      </div>
      <div class="slw-data-tools">
        <select data-table class="slw-data-select-fallback" aria-label="选择数据表"></select>
        <span class="slw-data-meta-pill" data-table-meta></span>
        <div class="slw-data-search-wrap">
          <input data-search type="search" placeholder="搜索当前表全部字段…" aria-label="搜索当前表">
        </div>
        <button type="button" class="slw-btn" data-refresh>刷新数据</button>
        <button type="button" class="slw-btn primary" data-write data-add>＋ 新增一行</button>
        <button type="button" class="slw-btn danger" data-write data-delete-selected>删除勾选</button>
      </div>
      <div class="slw-data-status-bar">
        <p class="slw-data-status" role="status" aria-live="polite" data-status></p>
      </div>
      <div class="slw-data-grid-wrap" data-list></div>
      <div class="slw-data-foot">
        <div class="slw-data-pager">
          <button type="button" class="slw-btn sm" data-prev>← 上一页</button>
          <span class="slw-muted" data-page></span>
          <button type="button" class="slw-btn sm" data-next>下一页 →</button>
        </div>
        <span class="slw-muted">提示：表头栏与数据表格均支持鼠标滚轮直接左右滑动（滑到边界自动续滚页面），也支持按住拖动</span>
      </div>
    </div>`;
  pane.replaceChildren(root);
  const tabsBox = root.querySelector('[data-table-tabs]') as HTMLElement;
  const select = root.querySelector('[data-table]') as HTMLSelectElement;
  const metaPill = root.querySelector('[data-table-meta]') as HTMLElement;
  const search = root.querySelector('[data-search]') as HTMLInputElement;
  const list = root.querySelector('[data-list]') as HTMLElement;
  const status = root.querySelector('[data-status]') as HTMLElement;
  let current: TableModel | undefined;
  let pageIds: number[] = [];
  let pages = 1;
  let stale = false;
  let suppressGridClickUntil = 0;
  let displayedBook = rt.book();
  let displayedStorageId = rt.storageId();
  const valid = () => alive && root.isConnected;
  const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
  function fail(e: unknown): void { status.textContent = errorText(e); deps.warn(errorText(e)); }
  function refreshWorldbook(): void {
    void Promise.resolve(deps.refreshWorldbook()).catch((e) => deps.warn('数据已写入，世界书刷新失败：' + errorText(e)));
  }
  function syncReadOnly(): void {
    if (!alive) return;
    const readOnly = busy() || !rt.isReady() || !rt.isChatSettled() || rt.isWriteProtected() || rt.recoveryStatus().needed;
    root.querySelectorAll<HTMLButtonElement>('[data-write]').forEach((b) => { b.disabled = readOnly || !current; });
    const batch = root.querySelector('[data-delete-selected]') as HTMLButtonElement;
    batch.disabled = readOnly || !view.selected.size;
    batch.textContent = `删除勾选${view.selected.size ? ` (${view.selected.size})` : ''}`;
    editor?.root.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('[data-write]').forEach((field) => {
      field.disabled = readOnly || field.dataset.locked === '1';
    });
    nested?.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('[data-write]').forEach((field) => { field.disabled = readOnly; });
    if (busy()) status.textContent = 'AI 正在填表，当前仅可查看；编辑草稿保留，填表结束后请核对再保存。';
    else if (stale) status.textContent = '台账数据已更新。可刷新列表；打开的编辑草稿不会被覆盖，保存时会再次检查冲突。';
  }

  function switchTable(tableId: string): void {
    if (!tableId || tableId === view.tableId) return;
    view.tableId = tableId;
    view.page = 0;
    view.selected.clear();
    draw();
    try {
      const activeBtn = tabsBox.querySelector<HTMLElement>('.slw-data-tab.on');
      activeBtn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    } catch (_e) { /* ignore */ }
  }

  function draw(): void {
    if (view.storageId !== rt.storageId()) { view.storageId = rt.storageId(); view.selected.clear(); view.page = 0; }
    displayedBook = rt.book(); displayedStorageId = rt.storageId();
    const tables = [...(rt.book()?.tables.values() || [])].sort((a, b) => a.orderNo - b.orderNo || a.tableId.localeCompare(b.tableId));
    if (!tables.some((t) => t.tableId === view.tableId)) { view.tableId = tables[0]?.tableId || ''; view.selected.clear(); }

    tabsBox.innerHTML = tables.map((t) => {
      const isOn = t.tableId === view.tableId;
      const isEmpty = t.rows.size === 0;
      return `<button type="button" role="tab" aria-selected="${isOn ? 'true' : 'false'}" class="slw-data-tab${isOn ? ' on' : ''}${isEmpty ? ' is-empty' : ''}" data-table-tab="${esc(t.tableId)}"><span class="slw-data-tab-name">${esc(t.name)}</span><span class="slw-data-tab-badge">${t.rows.size}</span></button>`;
    }).join('');

    select.innerHTML = tables.map((t) => `<option value="${esc(t.tableId)}">${esc(t.name)} · ${t.rows.size} 行</option>`).join('');
    select.value = view.tableId;
    search.value = view.query;
    current = tables.find((t) => t.tableId === view.tableId);
    const headers = current?.headers || [];
    const dataColCount = Math.max(0, headers.length - 1);
    metaPill.textContent = current ? `${current.name} · ${dataColCount} 个字段 · ${current.rows.size} 行` : '暂无数据表';

    const q = view.query.trim().toLocaleLowerCase();
    const ids = current ? [...current.rows.keys()].sort((a, b) => a - b).filter((id) => !q || current!.rows.get(id)!.some((v) => String(v).toLocaleLowerCase().includes(q))) : [];
    for (const id of view.selected) if (!current?.rows.has(id)) view.selected.delete(id);
    pages = Math.max(1, Math.ceil(ids.length / PAGE_SIZE));
    view.page = Math.min(view.page, pages - 1);
    pageIds = ids.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);
    const pageRows = current ? pageIds.map((id) => current!.rows.get(id) || []) : [];
    const colClasses = headers.slice(1).map((h, i) => columnSizeClass(h, i + 1, pageRows));

    list.innerHTML = !current ? '<div class="slw-data-empty"><p class="slw-data-status">当前没有数据表，请先选择模板并等待台账就绪。</p></div>'
      : !ids.length ? '<div class="slw-data-empty"><p class="slw-data-status">当前表暂无匹配数据。可清空搜索框，或点击右上角「＋ 新增一行」。</p></div>'
      : `<table class="slw-tbl slw-data-table"><thead><tr><th class="slw-data-pick"><input type="checkbox" class="check" data-all aria-label="勾选本页全部行"></th><th class="slw-data-id">row_id</th>${headers.slice(1).map((h, i) => `<th scope="col" class="${colClasses[i]}">${esc(h)}</th>`).join('')}<th class="slw-data-actions">操作</th></tr></thead><tbody>${pageIds.map((id) => {
        const cells = current!.rows.get(id)!;
        const picked = view.selected.has(id);
        return `<tr class="${picked ? 'is-selected' : ''}"><td class="slw-data-pick"><input type="checkbox" class="check" data-pick="${id}" aria-label="勾选 row_id=${id}" ${picked ? 'checked' : ''}></td><td class="slw-data-id"><span class="slw-data-label">row_id</span>#${id}</td>${headers.slice(1).map((h, i) => {
          const rawVal = String(cells[i + 1] ?? '');
          const hasVal = rawVal.trim().length > 0;
          return `<td class="${colClasses[i]}"><span class="slw-data-label">${esc(h)}</span><button type="button" class="slw-data-cell" data-view="${id}" data-col="${i + 1}" title="点击查看「${esc(h)}」完整内容" aria-label="完整查看 ${esc(h)}"><span class="slw-data-preview${hasVal ? '' : ' is-empty'}">${hasVal ? esc(rawVal.slice(0, 240)) : '—'}</span></button></td>`;
        }).join('')}<td class="slw-data-actions"><div class="slw-data-actions-inner"><button type="button" class="slw-btn" data-write data-edit="${id}">编辑</button><button type="button" class="slw-btn danger" data-write data-delete="${id}">删除</button></div></td></tr>`;
      }).join('')}</tbody></table>`;
    (root.querySelector('[data-page]') as HTMLElement).textContent = `第 ${view.page + 1} / ${pages} 页 · 匹配 ${ids.length} 行 · 每页 ${PAGE_SIZE} 行`;
    (root.querySelector('[data-prev]') as HTMLButtonElement).disabled = view.page === 0;
    (root.querySelector('[data-next]') as HTMLButtonElement).disabled = view.page >= pages - 1;
    const all = list.querySelector('[data-all]') as HTMLInputElement | null;
    if (all) { all.checked = pageIds.length > 0 && pageIds.every((id) => view.selected.has(id)); all.indeterminate = !all.checked && pageIds.some((id) => view.selected.has(id)); }
    stale = false;
    status.textContent = rt.isWriteProtected() || rt.recoveryStatus().needed ? '台账处于只读保护或待恢复状态，请先到迁移页处理。' : '点击任意单元格可查看全文；勾选支持跨页保留，保存时仅提交实际改动的字段。';
    syncReadOnly();
  }

  function checkDisplayed(): void {
    if (displayedBook !== rt.book() || displayedStorageId !== rt.storageId() || (current && rt.book()?.tables.get(current.tableId) !== current)) {
      throw new Error('聊天或表格已变化，请先刷新数据。');
    }
  }

  function fullField(label: string, value: string, apply?: (value: string) => void): void {
    if (nested) return;
    const mask = el(doc, 'div', { class: 'slw-dialog-mask' });
    const modal = el(doc, 'div', { class: 'slw-dialog' });
    mask.appendChild(modal); doc.body.appendChild(mask);
    const close = () => mask.remove();
    nested = modal;
    modal.classList.add('slw-data-full');
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', label);
    modal.innerHTML = `<h3>${esc(label)}</h3><textarea aria-label="${esc(label)}" ${apply ? 'data-write' : 'readonly'}></textarea><div class="slw-btns">${apply ? '<button type="button" class="slw-btn primary" data-write data-apply>保留到草稿</button>' : ''}<button type="button" class="slw-btn" data-close>${apply ? '取消' : '关闭'}</button></div>`;
    const area = modal.querySelector('textarea')!;
    area.value = value;
    const previousFocus = doc.activeElement as HTMLElement | null;
    const finish = () => { close(); nested = null; previousFocus?.focus(); };
    let closing = false;
    const requestClose = async () => {
      if (closing) return;
      closing = true;
      try {
        if (apply && area.value !== value && !await askConfirm(deps, '放弃尚未保留的全屏草稿？')) return;
        if (mask.isConnected) finish();
      } finally { closing = false; }
    };
    modal.querySelector('[data-close]')!.addEventListener('click', () => { void requestClose(); });
    modal.querySelector('[data-apply]')?.addEventListener('click', () => { if (!busy()) { apply?.(area.value); finish(); } });
    mask.addEventListener('click', (e) => { if (e.target === mask) void requestClose(); });
    modal.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void requestClose(); }
      if (e.key === 'Tab') {
        const fields = [...modal.querySelectorAll<HTMLElement>('textarea:not(:disabled),button:not(:disabled)')];
        const first = fields[0]; const last = fields[fields.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    });
    syncReadOnly(); area.focus();
  }

  function edit(rowId: number | null): void {
    if (!current || editor) return;
    try {
      checkDisplayed();
      const snapshot = workbench.capture(current.tableId, rowId === null ? [] : [rowId]);
      const values = snapshot.headers.slice(1).map((_, i) => rowId === null ? '' : String(snapshot.rows.get(rowId)?.[i + 1] ?? ''));
      const content = el(doc, 'div', { class: 'slw-data-fields' });
      content.innerHTML = snapshot.headers.slice(1).map((h, i) => {
        const locked = rowId !== null && dataCellLocked(snapshot.table, rowId, i + 1, getLocks(snapshot.table.tableId));
        const isLong = LONG_HEADER_RE.test(h) || (values[i] && values[i].length > 50);
        return `<label class="${isLong ? 'is-long' : ''}"><span class="slw-data-field-head"><span>${esc(h)}${locked ? ' · 已锁定' : ''}</span><button type="button" class="slw-btn sm" data-expand="${i}">${locked ? '完整查看' : '全屏编辑'}</button></span><textarea data-field="${i}" data-write data-locked="${locked ? '1' : '0'}" ${locked ? 'disabled' : ''}></textarea></label>`;
      }).join('');
      const fields = [...content.querySelectorAll<HTMLTextAreaElement>('[data-field]')];
      fields.forEach((f, i) => { f.value = values[i]; });
      const actions = el(doc, 'div');
      actions.innerHTML = '<p class="slw-data-editor-error" role="alert"></p><button type="button" class="slw-btn" data-cancel>取消</button><button type="button" class="slw-btn primary" data-write data-save>保存修改</button>';
      const handle = openEditorDialog(deps, {
        title: rowId === null ? `新增 · ${snapshot.table.name}` : `编辑 · ${snapshot.table.name} · row_id=${rowId}`,
        subtitle: `修改归入 AI 第 ${snapshot.target.aiFloor} 楼；草稿不会自动保存。`, content, actions,
        beforeClose: () => fields.some((f, i) => f.value !== values[i]) ? askConfirm(deps, '放弃尚未保存的草稿？') : true,
        onClosed: () => { editor = null; nested?.closest('.slw-dialog-mask')?.remove(); nested = null; },
      });
      editor = handle;
      content.querySelectorAll<HTMLButtonElement>('[data-expand]').forEach((b) => b.addEventListener('click', () => {
        const i = Number(b.dataset.expand); const f = fields[i];
        fullField(snapshot.headers[i + 1], f.value, f.dataset.locked === '1' || busy() ? undefined : (v) => { f.value = v; });
      }));
      actions.querySelector('[data-cancel]')!.addEventListener('click', () => handle.requestClose());
      actions.querySelector('[data-save]')!.addEventListener('click', () => {
        if (!valid()) return;
        try {
          const changed = workbench.save(snapshot, rowId, fields.map((f) => f.value));
          handle.close(true); draw();
          status.textContent = changed ? '修改已写入台账。删除或重生成对应 AI 楼可能导致修改回退。' : '没有字段变化。';
          if (changed) refreshWorldbook();
        } catch (e) { (actions.querySelector('[role="alert"]') as HTMLElement).textContent = errorText(e); syncReadOnly(); }
      });
      syncReadOnly(); fields[0]?.focus();
    } catch (e) { fail(e); }
  }

  async function remove(ids: number[]): Promise<void> {
    if (!current || !ids.length) return;
    try {
      checkDisplayed();
      const snapshot = workbench.capture(current.tableId, ids);
      if (!await askConfirm(deps, `删除「${current.name}」中勾选的 ${ids.length} 行？此操作归入最新 AI 楼。`)) return;
      if (!valid()) return;
      workbench.remove(snapshot, ids);
      ids.forEach((id) => view.selected.delete(id));
      draw(); status.textContent = `已删除 ${ids.length} 行。`; refreshWorldbook();
    } catch (e) { fail(e); }
  }

  tabsBox.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-table-tab]');
    if (!btn) return;
    switchTable(btn.dataset.tableTab || '');
  });
  tabsBox.addEventListener('wheel', (e: WheelEvent) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && tabsBox.scrollWidth > tabsBox.clientWidth) {
      tabsBox.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });

  // 表格区域滚轮横向滚动（电脑模式：表头/Shift 必横滑，表体优先横滑并在左右边界自动放行纵向滚页）
  list.addEventListener('wheel', (e: WheelEvent) => {
    const win = doc.defaultView || deps.window;
    if ((win?.innerWidth ?? 1024) <= 700 || root.closest('.slw-card-tables, .slw-card-doc, .slw-phone-doc')) return;
    const maxScrollLeft = list.scrollWidth - list.clientWidth;
    if (maxScrollLeft <= 1) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const delta = e.deltaY;
    if (!delta) return;
    const atLeft = list.scrollLeft <= 0 && delta < 0;
    const atRight = list.scrollLeft >= maxScrollLeft - 1 && delta > 0;
    const inHeader = !!(e.target as HTMLElement | null)?.closest?.('thead');
    if (e.shiftKey || inHeader || (!atLeft && !atRight)) {
      list.scrollLeft = Math.min(maxScrollLeft, Math.max(0, list.scrollLeft + delta));
      e.preventDefault();
    }
  }, { passive: false });

  // 表格容器鼠标横向拖拽滑动（Grab-to-scroll）
  let gridDragActive = false;
  let gridDragMoved = false;
  let gridStartX = 0;
  let gridStartScrollLeft = 0;
  list.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input,select,textarea,[data-edit],[data-delete]')) return;
    if (list.scrollWidth <= list.clientWidth) return;
    gridDragActive = true;
    gridDragMoved = false;
    gridStartX = e.clientX;
    gridStartScrollLeft = list.scrollLeft;
  });
  list.addEventListener('pointermove', (e: PointerEvent) => {
    if (!gridDragActive) return;
    const dx = e.clientX - gridStartX;
    if (!gridDragMoved && Math.abs(dx) > 6) {
      gridDragMoved = true;
      list.classList.add('is-grabbing');
    }
    if (gridDragMoved) {
      list.scrollLeft = gridStartScrollLeft - dx;
    }
  });
  const endGridDrag = (): void => {
    if (!gridDragActive) return;
    gridDragActive = false;
    list.classList.remove('is-grabbing');
    if (gridDragMoved) {
      suppressGridClickUntil = Date.now() + 250;
      gridDragMoved = false;
    }
  };
  list.addEventListener('pointerup', endGridDrag);
  list.addEventListener('pointercancel', endGridDrag);
  list.addEventListener('mouseleave', endGridDrag);

  select.addEventListener('change', () => { switchTable(select.value); });
  search.addEventListener('input', () => { view.query = search.value; view.page = 0; draw(); });
  root.querySelector('[data-refresh]')!.addEventListener('click', draw);
  root.querySelector('[data-add]')!.addEventListener('click', () => edit(null));
  root.querySelector('[data-delete-selected]')!.addEventListener('click', () => { void remove([...view.selected]); });
  root.querySelector('[data-prev]')!.addEventListener('click', () => { view.page = Math.max(0, view.page - 1); draw(); });
  root.querySelector('[data-next]')!.addEventListener('click', () => { view.page = Math.min(pages - 1, view.page + 1); draw(); });
  list.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.hasAttribute('data-all')) pageIds.forEach((id) => { if (input.checked) view.selected.add(id); else view.selected.delete(id); });
    else if (input.hasAttribute('data-pick')) { const id = Number(input.dataset.pick); if (input.checked) view.selected.add(id); else view.selected.delete(id); }
    draw();
  });
  list.addEventListener('click', (e) => {
    if (Date.now() < suppressGridClickUntil) return;
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.hasAttribute('data-edit')) edit(Number(button.dataset.edit));
    else if (button.hasAttribute('data-delete')) void remove([Number(button.dataset.delete)]);
    else if (button.hasAttribute('data-view') && current) {
      try { checkDisplayed(); } catch (e) { fail(e); return; }
      const id = Number(button.dataset.view); const col = Number(button.dataset.col);
      const row = rt.book()?.tables.get(current.tableId)?.rows.get(id);
      if (!row) { fail(new Error('该行已删除，请刷新数据。')); return; }
      fullField(`${current.headers[col]} · row_id=${id}`, String(row[col] ?? ''));
    }
  });
  draw();
  unsubscribers.push(rt.onTableUpdate(() => { if (valid()) { stale = true; syncReadOnly(); } }));
  const unsubscribeFill = deps.canonical?.fill?.subscribe?.(() => { if (valid()) syncReadOnly(); });
  if (typeof unsubscribeFill === 'function') unsubscribers.push(unsubscribeFill);
  (pane as any).__slwCleanup = () => {
    alive = false;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    editor?.close(true);
    nested?.closest('.slw-dialog-mask')?.remove(); nested = null;
  };
}
