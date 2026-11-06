import { createBook, projectWorkbook, resolveTable, type BookModel, type TableModel } from './book';
import { convergeBookToTemplate, normalizeTemplate, normalizeTemplateAny, type ConvergeReport } from './blueprint';
import type { FieldContractImpact, FieldContractRegistry } from './field-contracts';
import type { WorkbookJson } from './types';

export interface TemplatePreview {
  ok: boolean;
  errors: string[];
  report: ConvergeReport | null;
  droppedRows: { table: string; rows: number }[];
  droppedColumnCells: { table: string; column: string; cells: number }[];
  claimedRows: { table: string; from: string; to: string; rows: number }[];
  impacts: FieldContractImpact[];
}

export function normalizeTemplateForApply(rawInput: unknown): { ok: boolean; errors: string[]; workbook: WorkbookJson | null } {
  const input = rawInput && typeof rawInput === 'object' ? JSON.parse(JSON.stringify(rawInput)) : rawInput;
  if (input && typeof input === 'object' && (input as any).schemaVersion === 2) {
    const normalized = normalizeTemplateAny(input);
    return { ok: normalized.ok, errors: normalized.errors, workbook: normalized.workbook };
  }
  const raw = input as WorkbookJson | null;
  const keys = raw && typeof raw === 'object' ? Object.keys(raw).filter(key => key.startsWith('sheet_')) : [];
  if (keys.length && keys.every(key => (raw as any)[key]?.ledgerV2 && Array.isArray((raw as any)[key].ledgerV2.columns))) {
    const normalized = normalizeTemplate(raw);
    return { ok: normalized.ok, errors: normalized.errors, workbook: normalized.template };
  }
  const normalized = normalizeTemplateAny(input);
  return { ok: normalized.ok, errors: normalized.errors, workbook: normalized.workbook };
}

function nameOf(book: BookModel, key: string): string {
  return resolveTable(book, key)?.name || key;
}

function nonEmptyCells(table: TableModel | undefined, column: string): number {
  if (!table) return 0;
  const index = table.headers.indexOf(column);
  if (index < 0) return 0;
  let count = 0;
  for (const row of table.rows.values()) if (String(row[index] ?? '').trim()) count += 1;
  return count;
}

/** 收敛只发生在深拷贝账本；调用方展示结果前，当前账本没有写入或持久化副作用。 */
export function previewTemplateChange(book: BookModel, input: unknown, fields: FieldContractRegistry): TemplatePreview {
  const normalized = normalizeTemplateForApply(input);
  const empty: TemplatePreview = { ok: false, errors: normalized.errors, report: null, droppedRows: [], droppedColumnCells: [], claimedRows: [], impacts: [] };
  if (!normalized.ok || !normalized.workbook) return empty;
  const copy = createBook(JSON.parse(JSON.stringify(projectWorkbook(book))));
  const report = convergeBookToTemplate(copy, normalized.workbook);
  const droppedRows = report.droppedTables.map(key => ({ table: nameOf(book, key), rows: resolveTable(book, key)?.rows.size || 0 }));
  const droppedColumnCells = report.droppedColumns.flatMap(group => group.columns.map(column => ({
    table: group.table, column, cells: nonEmptyCells(resolveTable(book, group.table), column),
  })));
  const claimedRows = report.claimedRenames.map(item => ({ table: item.table, from: item.from, to: item.to,
    rows: resolveTable(book, item.tableId || item.table)?.rows.size || 0 }));
  const tableRenames = [...book.tables].flatMap(([key, table]) => {
    const target = copy.tables.get(key);
    return target && target.name !== table.name ? [{ table: table.name, toTable: target.name, kind: 'rename' as const }] : [];
  });
  const impacts = fields.impacts([
    ...tableRenames,
    ...report.droppedTables.map(key => ({ table: nameOf(book, key), kind: 'delete' as const })),
    ...report.droppedColumns.flatMap(group => group.columns.map(column => ({ table: group.table, column, kind: 'delete' as const }))),
    ...report.adoptedTables.filter(item => item.name !== nameOf(book, item.tableKey)).map(item => ({
      table: nameOf(book, item.tableKey), toTable: item.name, kind: 'rename' as const,
    })),
    ...report.claimedRenames.map(item => ({ table: item.table, column: item.from, toColumn: item.to, kind: 'rename' as const })),
  ]);
  return { ok: true, errors: [], report, droppedRows, droppedColumnCells, claimedRows, impacts };
}

export function templatePreviewLines(preview: TemplatePreview): string[] {
  if (!preview.report) return [];
  const r = preview.report;
  const lines: string[] = [];
  if (r.addedTables.length) lines.push(`新增 ${r.addedTables.length} 张表。`);
  if (r.adoptedTables.length) lines.push(`按表名认领 ${r.adoptedTables.length} 张已有表，保留原数据。`);
  for (const item of preview.droppedRows) lines.push(`删除表「${item.table}」：${item.rows} 行。`);
  for (const group of r.droppedColumns) {
    const counts = group.columns.map(column => `${column}（${preview.droppedColumnCells.find(x => x.table === group.table && x.column === column)?.cells || 0} 个非空格子）`);
    lines.push(`表「${group.table}」删除列：${counts.join('、')}。`);
  }
  for (const item of preview.claimedRows) lines.push(`列改名认领：${item.table} · ${item.from} → ${item.to}，${item.rows} 行数据保留。`);
  if (r.addedColumns.length) lines.push(`新增 ${r.addedColumns.reduce((sum, item) => sum + item.columns.length, 0)} 列（原数据保留）。`);
  for (const impact of preview.impacts) lines.push(`影响 ${impact.label} · ${impact.feature}：${impact.table}${impact.column ? ` · ${impact.column}` : ''}${impact.to ? ` → ${impact.to}；旧名不会自动可用` : '；将被删除'}。`);
  if (!lines.length) lines.push('表结构和插件字段依赖无变化。');
  return lines;
}
