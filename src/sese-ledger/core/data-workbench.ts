import type { BookModel, TableModel } from './book';
import type { LedgerRuntime, LedgerWriteTarget } from './runtime';
import type { LedgerOp } from './types';
import type { SheetLockState } from './guards';
import { ledgerAnchorFor, writeScope } from './floor-scope';

export interface DataWorkbenchDeps {
  runtime: LedgerRuntime;
  getChat(): any[];
  isBusy(): boolean;
  getLocks(tableId: string): SheetLockState | null;
}

export interface DataSnapshot {
  storageId: string;
  book: BookModel;
  table: TableModel;
  headers: string[];
  rows: Map<number, string[]>;
  chat: any[];
  target: LedgerWriteTarget;
  targetMessage: any;
  targetText: string;
  revision: number;
}

function targetText(message: any): string {
  return JSON.stringify([message?.mes, message?.swipe_id, message?.swipes]);
}

export function dataCellLocked(table: TableModel, rowId: number, col: number, locks: SheetLockState | null): boolean {
  if (!locks) return false;
  const ids = [...table.rows.keys()].sort((a, b) => a - b);
  const row = ids.indexOf(rowId) + 1;
  return locks.rows.includes(row) || locks.cols.includes(col) || locks.cells.includes(`${row}:${col}`);
}

export function createDataWorkbench(deps: DataWorkbenchDeps) {
  const rt = deps.runtime;

  function writable(): void {
    if (deps.isBusy()) throw new Error('AI 正在填表，当前仅可查看；请在填表结束后重试。');
    if (!rt.isChatSettled()) throw new Error('聊天正在切换，请刷新数据后重试。');
    if (!rt.isReady() || !rt.book() || !rt.storageId()) throw new Error('台账尚未就绪，请刷新数据后重试。');
    if (rt.isWriteProtected() || rt.recoveryStatus().needed) throw new Error('台账处于只读保护或待恢复状态，请先处理后重试。');
  }

  function capture(tableId: string, rowIds: number[] = []): DataSnapshot {
    writable();
    const book = rt.book()!;
    const table = book.tables.get(tableId);
    if (!table) throw new Error('该表已不存在，请刷新数据。');
    if (table.headers[0] !== 'row_id' || new Set(table.headers).size !== table.headers.length) {
      throw new Error('表头缺少唯一的 row_id 或存在重复列名，请先修复表结构。');
    }
    const chat = deps.getChat();
    const target = writeScope(chat);
    if (!target) throw new Error('当前聊天没有可写入的 AI 楼层；请先生成一条 AI 消息。');
    const targetMessage = chat.find((m, i) => ledgerAnchorFor(m, i) === target.anchor);
    const rows = new Map<number, string[]>();
    for (const id of rowIds) {
      const row = table.rows.get(id);
      if (!row) throw new Error(`row_id=${id} 已被删除，请刷新数据。`);
      rows.set(id, row.slice());
    }
    return {
      storageId: rt.storageId()!, book, table, headers: table.headers.slice(), rows,
      chat, target, targetMessage, targetText: targetText(targetMessage), revision: rt.revision(),
    };
  }

  function validate(snapshot: DataSnapshot): TableModel {
    writable();
    if (rt.storageId() !== snapshot.storageId || rt.book() !== snapshot.book || deps.getChat() !== snapshot.chat) {
      throw new Error('聊天或账本已切换，请刷新数据并重新编辑；草稿尚未写入。');
    }
    const table = rt.book()!.tables.get(snapshot.table.tableId);
    if (!table || table !== snapshot.table || JSON.stringify(table.headers) !== JSON.stringify(snapshot.headers)) {
      throw new Error('表或列结构已变化，请刷新数据并重新编辑；草稿尚未写入。');
    }
    const chat = deps.getChat();
    const scope = writeScope(chat);
    const message = chat.find((m, i) => ledgerAnchorFor(m, i) === snapshot.target.anchor);
    if (!scope || scope.anchor !== snapshot.target.anchor || message !== snapshot.targetMessage || targetText(message) !== snapshot.targetText) {
      throw new Error('目标 AI 楼层已删除、重生成或尾楼已变化，请刷新数据后重试。');
    }
    return table;
  }

  function submit(snapshot: DataSnapshot, ops: LedgerOp[]): boolean {
    validate(snapshot);
    if (!ops.length) return false;
    const result = rt.commitOps('bridge', ops, { target: snapshot.target });
    if (!result.ok) throw new Error(result.errors.join('；') || '保存失败，请刷新后重试。');
    return true;
  }

  function save(snapshot: DataSnapshot, rowId: number | null, values: string[]): boolean {
    const table = validate(snapshot);
    if (values.length !== snapshot.headers.length - 1) throw new Error('列数已变化，请刷新数据。');
    const locks = deps.getLocks(table.tableId);
    if (rowId === null) {
      const limit = table.ddlInfo?.maxRowCount || 0;
      if (limit > 0 && table.rows.size >= limit) throw new Error(`该表最多 ${limit} 行，不能继续增行。`);
      const nextRowIndex = table.rows.size + 1;
      if (locks && (locks.rows.includes(nextRowIndex) || locks.cols.length || locks.cells.some((c) => c.startsWith(`${nextRowIndex}:`)))) {
        throw new Error('新行涉及受保护的行、列或单元格，请先解除对应锁定。');
      }
      const row = Object.fromEntries(snapshot.headers.slice(1).map((name, i) => [name, String(values[i] ?? '')]));
      return submit(snapshot, [{ kind: 'row_insert', table: table.tableId, row }]);
    }
    const before = snapshot.rows.get(rowId);
    const current = table.rows.get(rowId);
    if (!before || !current) throw new Error(`row_id=${rowId} 已被删除，请刷新数据；不会写入其他行。`);
    const ops: LedgerOp[] = [];
    values.forEach((value, i) => {
      const col = i + 1;
      const next = String(value ?? '');
      if (next === String(before[col] ?? '')) return;
      if (dataCellLocked(table, rowId, col, locks)) throw new Error(`「${snapshot.headers[col]}」已锁定，不能修改。`);
      if (String(current[col] ?? '') !== String(before[col] ?? '')) {
        throw new Error(`「${snapshot.headers[col]}」已被其他操作修改，请刷新后核对；草稿尚未写入。`);
      }
      ops.push({ kind: 'cell', table: table.tableId, rowId, column: snapshot.headers[col], value: next });
    });
    return submit(snapshot, ops);
  }

  function remove(snapshot: DataSnapshot, rowIds: number[]): boolean {
    const table = validate(snapshot);
    const locks = deps.getLocks(table.tableId);
    const ids = [...new Set(rowIds)];
    const positions = new Map([...table.rows.keys()].sort((a, b) => a - b).map((id, i) => [id, i + 1]));
    for (const id of ids) {
      const before = snapshot.rows.get(id);
      const current = table.rows.get(id);
      if (!before || !current) throw new Error(`row_id=${id} 已被删除，请刷新后重新勾选。`);
      if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error(`row_id=${id} 内容已变化，请刷新后核对再删除。`);
      const position = positions.get(id)!;
      if (locks && (locks.rows.includes(position) || locks.cols.some((col) => col >= 0 && col < table.headers.length)
        || locks.cells.some((cell) => { const [row, col] = cell.split(':').map(Number); return row === position && col >= 0 && col < table.headers.length; }))) {
        throw new Error(`row_id=${id} 包含受保护的内容，不能删除。`);
      }
    }
    return submit(snapshot, ids.map((rowId) => ({ kind: 'row_delete', table: table.tableId, rowId })));
  }

  return { capture, save, remove };
}
