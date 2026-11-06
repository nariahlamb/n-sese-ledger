import { confirmDialog, downloadJsonFile } from './shared';
import type { TabCtx } from './shell';
import { previewTemplateChange, templatePreviewLines } from '../../core/template-preview';
import { projectWorkbook } from '../../core/book';

export function captureTemplateState(ctx: TabCtx): () => boolean {
  const { deps } = ctx;
  const book = deps.runtime.book();
  const storageId = deps.runtime.storageId();
  const chat = deps.getChat();
  const revision = deps.runtime.revision();
  const selected = deps.canonical.templateBinding?.name?.();
  const content = book ? JSON.stringify(projectWorkbook(book)) : '';
  return () => !!book && deps.runtime.book() === book && deps.runtime.storageId() === storageId
    && deps.getChat() === chat && deps.runtime.revision() === revision
    && deps.canonical.templateBinding?.name?.() === selected
    && JSON.stringify(projectWorkbook(book)) === content
    && deps.runtime.isChatSettled() && !deps.runtime.isWriteProtected() && !deps.canonical.fill?.isRunning?.();
}

function stillCurrent(ctx: TabCtx, check: () => boolean): boolean {
  if (check()) return true;
  ctx.deps.warn('聊天、台账或模板已变化，或正在填表。本次操作未执行，请重新打开后确认。');
  return false;
}

function backup(ctx: TabCtx, label: string): boolean {
  try {
    if (downloadJsonFile(ctx.deps, `瑟瑟台账-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, ctx.deps.canonical.exportBook())) return true;
  } catch (_e) { /* 导出失败与下载失败均不得继续写入。 */ }
  ctx.deps.warn('备份下载未能发起，本次操作已取消；账本未修改。');
  return false;
}

export async function applyTemplateWithPreview(ctx: TabCtx, input: unknown, label: string, preset?: unknown): Promise<'applied' | 'cancelled' | 'failed'> {
  const { deps } = ctx;
  const isCurrent = captureTemplateState(ctx);
  if (!stillCurrent(ctx, isCurrent)) return 'failed';
  const preview = previewTemplateChange(deps.runtime.book()!, input, deps.canonical.fieldContracts);
  if (!preview.ok) { deps.warn(preview.errors.join('；') || '模板校验失败'); return 'failed'; }
  const lines = templatePreviewLines(preview);
  const destructive = preview.droppedRows.some(item => item.rows > 0) || preview.droppedColumnCells.some(item => item.cells > 0);
  const visible = lines.length > 120 ? [...lines.slice(0, 120), `另有 ${lines.length - 120} 项，导出备份后可核对。`] : lines;
  const message = `模板「${label}」切换预览（尚未修改账本）：\n\n${visible.join('\n')}\n\n${destructive ? '会丢弃数据：确认后先发起账本 JSON 备份下载，再套用模板。请确认下载已保存；备份不包含聊天。' : '确认后套用并保存模板选择。'}`;
  if (!await confirmDialog(deps, message, { title: '切换前预览', okText: destructive ? '备份并套用' : '套用模板', cancelText: '取消', danger: destructive })) return 'cancelled';
  if (!stillCurrent(ctx, isCurrent)) return 'failed';
  if (destructive && !backup(ctx, '切换前备份')) return 'failed';
  if (!stillCurrent(ctx, isCurrent)) return 'failed';
  const result = await deps.canonical.templateBinding.apply(label, input, { preset });
  if (result?.ok !== true) { deps.warn(result?.message || '模板套用失败'); return 'failed'; }
  return 'applied';
}

export async function confirmStructureImpacts(ctx: TabCtx, changes: { table: string; column?: string; toTable?: string; toColumn?: string; kind: 'rename' | 'delete' }[], action: string): Promise<boolean> {
  const isCurrent = captureTemplateState(ctx);
  if (!stillCurrent(ctx, isCurrent)) return false;
  const impacts = ctx.deps.canonical?.fieldContracts?.impacts?.(changes) || [];
  if (!impacts.length) return true;
  const lines = impacts.slice(0, 100).map((x: any) => `${x.label} · ${x.feature}：${x.table}${x.column ? ` · ${x.column}` : ''}${x.to ? ` → ${x.to}；旧名不会自动可用` : '；对应表/列将被删除'}`);
  const accepted = await confirmDialog(ctx.deps, `${action}会影响以下插件功能（只提示，仍可继续）：\n\n${lines.join('\n')}${impacts.length > 100 ? `\n另有 ${impacts.length - 100} 项。` : ''}`, { title: '字段影响提示', okText: '继续', cancelText: '返回修改' });
  return accepted && stillCurrent(ctx, isCurrent);
}

export async function confirmStructurePreview(ctx: TabCtx, workbook: unknown, action: string): Promise<boolean> {
  const { deps } = ctx;
  const isCurrent = captureTemplateState(ctx);
  if (!stillCurrent(ctx, isCurrent)) return false;
  const preview = previewTemplateChange(deps.runtime.book()!, workbook, deps.canonical.fieldContracts);
  if (!preview.ok) { deps.warn(preview.errors.join('；') || '结构校验失败'); return false; }
  const lines = templatePreviewLines(preview);
  const destructive = preview.droppedRows.some(item => item.rows > 0) || preview.droppedColumnCells.some(item => item.cells > 0);
  if (!await confirmDialog(deps, `${action}预览（尚未修改账本）：\n\n${lines.slice(0, 120).join('\n')}${lines.length > 120 ? `\n另有 ${lines.length - 120} 项。` : ''}\n\n${destructive ? '确认后先发起账本备份下载，再保存结构。' : '确认后保存结构。'}`, { title: '结构修改确认', okText: destructive ? '备份并保存' : '保存', danger: destructive })) return false;
  if (!stillCurrent(ctx, isCurrent)) return false;
  if (destructive && !backup(ctx, '结构修改前备份')) return false;
  return stillCurrent(ctx, isCurrent);
}
