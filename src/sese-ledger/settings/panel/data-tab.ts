import { el, esc, confirmDialog as askConfirm, openEditorDialog, type EditorDialogHandle } from './shared';
import type { TabCtx } from './shell';
import type { TableModel } from '../../core/book';
import { createDataWorkbench, dataCellLocked } from '../../core/data-workbench';

interface DataViewState { tableId: string; query: string; page: number; selected: Set<number>; storageId: string | null }
const viewStates = new WeakMap<object, DataViewState>();
const PAGE_SIZE = 30;
const DATA_CSS = `
.slw-data-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.slw-data-tools input{flex:1;min-width:120px}.slw-data-tools select{max-width:100%;min-width:130px}
.slw-data-status{color:var(--muted,#8b8676);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.slw-data-table{table-layout:fixed;min-width:0!important}.slw-data-table th,.slw-data-table td{overflow-wrap:anywhere}
.slw-data-table .slw-data-pick{width:44px}.slw-data-table .slw-data-id{width:70px}.slw-data-table .slw-data-actions{width:130px}
.slw-data-cell{display:block;text-align:left;width:100%;border:0;background:transparent;color:inherit;padding:0;cursor:pointer;font:inherit}
.slw-data-preview{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;max-height:5em}
.slw-data-table .slw-data-label{display:none}.slw-data-actions .slw-btn{padding:4px 8px;margin:0 4px 4px 0}
.slw-data-fields{display:grid;gap:14px}.slw-data-fields label{display:grid;gap:6px;color:var(--gold-dim,#c9b98a)}
.slw-data-fields textarea{min-height:90px;line-height:1.6;width:100%;color:var(--text,#dcd7cc)}
.slw-data-field-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.slw-data-editor-error{color:var(--danger,#e07a7a);white-space:pre-wrap;overflow-wrap:anywhere;flex-basis:100%}
.slw-data-full{width:calc(100vw - 24px)!important;height:calc(100dvh - 24px);max-height:calc(100dvh - 24px)!important;display:flex;flex-direction:column;gap:10px}
.slw-data-full textarea{flex:1;min-height:0;resize:none;line-height:1.7}.slw-data-full .slw-btns{flex-shrink:0}
.slw-data-view{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;user-select:text}
.slw-card-tables .slw-data-table,.slw-card-tables .slw-data-table tbody{display:block;width:100%}
.slw-card-tables .slw-data-table thead{display:none}.slw-card-tables .slw-data-table tr{display:block;margin-bottom:12px;border:1px solid var(--line2,rgba(232,217,176,.28));border-radius:8px;padding:8px}
.slw-card-tables .slw-data-table td{display:block!important;width:100%!important;border:0!important;padding:5px 4px!important}
.slw-card-tables .slw-data-table .slw-data-label{display:block;color:var(--gold-dim,#c9b98a);font-size:11px;margin-bottom:2px}
@media(max-width:700px){.slw-data-tools>*{max-width:100%}.slw-data-table,.slw-data-table tbody{display:block;width:100%}.slw-data-table thead{display:none}.slw-data-table tr{display:block;margin-bottom:12px;border:1px solid var(--line2,rgba(232,217,176,.28));border-radius:8px;padding:8px}.slw-data-table td{display:block!important;width:100%!important;border:0!important;padding:5px 4px!important}.slw-data-table .slw-data-label{display:block;color:var(--gold-dim,#c9b98a);font-size:11px;margin-bottom:2px}}
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
    <div class="slw-card"><h3>表格数据</h3>
      <p class="slw-data-status">手动修改归入保存时钉住的最新 AI 楼。删除或重生成该楼可能导致修改回退。草稿不会自动保存。</p>
      <div class="slw-data-tools">
        <select data-table aria-label="选择数据表"></select>
        <input data-search type="search" placeholder="搜索当前表全部字段" aria-label="搜索当前表">
        <button type="button" class="slw-btn" data-refresh>刷新数据</button>
        <button type="button" class="slw-btn primary" data-write data-add>新增一行</button>
        <button type="button" class="slw-btn danger" data-write data-delete-selected>删除勾选</button>
      </div>
      <p class="slw-data-status" role="status" aria-live="polite" data-status></p>
      <div data-list></div>
      <div class="slw-data-tools"><button type="button" class="slw-btn" data-prev>上一页</button><span data-page></span><button type="button" class="slw-btn" data-next>下一页</button></div>
    </div>`;
  pane.replaceChildren(root);
  const select = root.querySelector('[data-table]') as HTMLSelectElement;
  const search = root.querySelector('[data-search]') as HTMLInputElement;
  const list = root.querySelector('[data-list]') as HTMLElement;
  const status = root.querySelector('[data-status]') as HTMLElement;
  let current: TableModel | undefined;
  let pageIds: number[] = [];
  let pages = 1;
  let stale = false;
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

  function draw(): void {
    if (view.storageId !== rt.storageId()) { view.storageId = rt.storageId(); view.selected.clear(); view.page = 0; }
    displayedBook = rt.book(); displayedStorageId = rt.storageId();
    const tables = [...(rt.book()?.tables.values() || [])].sort((a, b) => a.orderNo - b.orderNo || a.tableId.localeCompare(b.tableId));
    if (!tables.some((t) => t.tableId === view.tableId)) { view.tableId = tables[0]?.tableId || ''; view.selected.clear(); }
    select.innerHTML = tables.map((t) => `<option value="${esc(t.tableId)}">${esc(t.name)} · ${t.rows.size} 行</option>`).join('');
    select.value = view.tableId;
    search.value = view.query;
    current = tables.find((t) => t.tableId === view.tableId);
    const q = view.query.trim().toLocaleLowerCase();
    const ids = current ? [...current.rows.keys()].sort((a, b) => a - b).filter((id) => !q || current!.rows.get(id)!.some((v) => String(v).toLocaleLowerCase().includes(q))) : [];
    for (const id of view.selected) if (!current?.rows.has(id)) view.selected.delete(id);
    pages = Math.max(1, Math.ceil(ids.length / PAGE_SIZE));
    view.page = Math.min(view.page, pages - 1);
    pageIds = ids.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);
    const headers = current?.headers || [];
    list.innerHTML = !current ? '<p class="slw-data-status">当前没有数据表，请先选择模板并等待台账就绪。</p>'
      : !ids.length ? '<p class="slw-data-status">没有匹配的数据。可清空搜索，或新增第一行。</p>'
      : `<table class="slw-tbl slw-data-table"><thead><tr><th class="slw-data-pick"><input type="checkbox" data-all aria-label="勾选本页全部行"></th><th class="slw-data-id">row_id</th>${headers.slice(1).map((h) => `<th scope="col">${esc(h)}</th>`).join('')}<th class="slw-data-actions">操作</th></tr></thead><tbody>${pageIds.map((id) => {
        const cells = current!.rows.get(id)!;
        return `<tr><td class="slw-data-pick"><input type="checkbox" data-pick="${id}" aria-label="勾选 row_id=${id}" ${view.selected.has(id) ? 'checked' : ''}></td><td><span class="slw-data-label">row_id</span>${id}</td>${headers.slice(1).map((h, i) => `<td><span class="slw-data-label">${esc(h)}</span><button type="button" class="slw-data-cell" data-view="${id}" data-col="${i + 1}" aria-label="完整查看 ${esc(h)}"><span class="slw-data-preview">${esc(String(cells[i + 1] ?? '').slice(0, 240)) || '—'}</span></button></td>`).join('')}<td class="slw-data-actions"><button type="button" class="slw-btn" data-write data-edit="${id}">编辑</button><button type="button" class="slw-btn danger" data-write data-delete="${id}">删除</button></td></tr>`;
      }).join('')}</tbody></table>`;
    (root.querySelector('[data-page]') as HTMLElement).textContent = `第 ${view.page + 1} / ${pages} 页 · 匹配 ${ids.length} 行 · 每页 ${PAGE_SIZE} 行`;
    (root.querySelector('[data-prev]') as HTMLButtonElement).disabled = view.page === 0;
    (root.querySelector('[data-next]') as HTMLButtonElement).disabled = view.page >= pages - 1;
    const all = list.querySelector('[data-all]') as HTMLInputElement | null;
    if (all) { all.checked = pageIds.length > 0 && pageIds.every((id) => view.selected.has(id)); all.indeterminate = !all.checked && pageIds.some((id) => view.selected.has(id)); }
    stale = false;
    status.textContent = rt.isWriteProtected() || rt.recoveryStatus().needed ? '台账处于只读保护或待恢复状态，请先到迁移页处理。' : '点击单元格可查看完整内容。勾选可跨页保留；保存只修改实际变更的字段。';
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
    modal.querySelector('[data-close]')!.addEventListener('click', finish);
    modal.querySelector('[data-apply]')?.addEventListener('click', () => { if (!busy()) { apply?.(area.value); finish(); } });
    mask.addEventListener('click', (e) => { if (e.target === mask) finish(); });
    modal.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
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
        return `<label><span class="slw-data-field-head"><span>${esc(h)}${locked ? ' · 已锁定' : ''}</span><button type="button" class="slw-btn" data-expand="${i}">${locked ? '完整查看' : '全屏编辑'}</button></span><textarea data-field="${i}" data-write data-locked="${locked ? '1' : '0'}" ${locked ? 'disabled' : ''}></textarea></label>`;
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

  select.addEventListener('change', () => { view.tableId = select.value; view.page = 0; view.selected.clear(); draw(); });
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
