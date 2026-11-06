import { confirmDialog, downloadJsonFile } from './shared';
import type { TabCtx } from './shell';
import { previewTemplateChange, templatePreviewLines } from '../../core/template-preview';

/** 所有“把模板套到现有聊天”的入口共用：先显示副本上的结果，再执行原写入链。 */
export async function applyTemplateWithPreview(ctx: TabCtx, input: unknown, label: string): Promise<'applied' | 'cancelled' | 'failed'> {
  const { deps } = ctx;
  const book = deps.runtime.book();
  if (!book) { deps.warn('台账未就绪，无法预览模板影响'); return 'failed'; }
  const preview = previewTemplateChange(book, input, deps.canonical.fieldContracts);
  if (!preview.ok) { deps.warn(preview.errors.join('；') || '模板校验失败'); return 'failed'; }
  const lines = templatePreviewLines(preview);
  const destructive = preview.droppedRows.some(item => item.rows > 0) || preview.droppedColumnCells.some(item => item.cells > 0);
  const visible = lines.length > 120 ? [...lines.slice(0, 120), `另有 ${lines.length - 120} 项，导出备份后可核对。`] : lines;
  const message = `模板「${label}」切换预览（尚未修改账本）：\n\n${visible.join('\n')}\n\n${destructive ? '会丢弃数据：确认后将先发起当前账本备份下载，再套用模板。备份是账本 JSON，不包含聊天。' : '确认后套用模板。'}`;
  if (!await confirmDialog(deps, message, { title: '切换前预览', okText: destructive ? '备份并套用' : '套用模板', cancelText: '取消', danger: destructive })) return 'cancelled';
  if (destructive) {
    try {
      if (!downloadJsonFile(deps, `瑟瑟台账-切换前备份-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, deps.canonical.exportBook())) throw new Error('download not started');
    } catch (_e) {
      deps.warn('备份下载未能发起，已取消模板切换；账本未修改。');
      return 'failed';
    }
  }
  const result = await deps.canonical.applyBlueprint(input, { scope: 'chat' });
  if (result?.success === false) { deps.warn(result?.message || '模板套用失败'); return 'failed'; }
  return 'applied';
}

export async function confirmStructureImpacts(ctx: TabCtx, changes: { table: string; column?: string; toTable?: string; toColumn?: string; kind: 'rename' | 'delete' }[], action: string): Promise<boolean> {
  const impacts = ctx.deps.canonical?.fieldContracts?.impacts?.(changes) || [];
  if (!impacts.length) return true;
  const lines = impacts.slice(0, 100).map((x: any) => `${x.label} · ${x.feature}：${x.table}${x.column ? ` · ${x.column}` : ''}${x.to ? ` → ${x.to}；旧名不会自动可用` : '；对应表/列将被删除'}`);
  return confirmDialog(ctx.deps, `${action}会影响以下插件功能（只提示，仍可继续）：\n\n${lines.join('\n')}${impacts.length > 100 ? `\n另有 ${impacts.length - 100} 项。` : ''}`, { title: '字段影响提示', okText: '继续', cancelText: '返回修改' });
}

/** 表结构编辑在内存收敛前先确认；副本校验、插件影响和备份都不触碰当前账本。 */
export async function confirmStructurePreview(ctx: TabCtx, workbook: unknown, action: string): Promise<boolean> {
  const { deps } = ctx;
  const book = deps.runtime.book();
  if (!book) return false;
  const preview = previewTemplateChange(book, workbook, deps.canonical.fieldContracts);
  if (!preview.ok) { deps.warn(preview.errors.join('；') || '结构校验失败'); return false; }
  const lines = templatePreviewLines(preview);
  const destructive = preview.droppedRows.some(item => item.rows > 0) || preview.droppedColumnCells.some(item => item.cells > 0);
  if (!await confirmDialog(deps, `${action}预览（尚未修改账本）：\n\n${lines.slice(0, 120).join('\n')}${lines.length > 120 ? `\n另有 ${lines.length - 120} 项。` : ''}\n\n${destructive ? '确认后先发起账本备份下载，再保存结构。' : '确认后保存结构。'}`, { title: '结构修改确认', okText: destructive ? '备份并保存' : '保存', danger: destructive })) return false;
  if (destructive) {
    try {
      if (!downloadJsonFile(deps, `瑟瑟台账-结构修改前备份-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, deps.canonical.exportBook())) throw new Error('download not started');
    } catch (_e) {
      deps.warn('备份下载未能发起，已取消结构修改；账本未修改。');
      return false;
    }
  }
  return true;
}
