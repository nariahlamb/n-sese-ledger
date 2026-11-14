// ===== 剧情推进运行时：三入口接线 + 编排 =====
//
// 入口绑定（对齐原库三入口实证语义）：
// ① 酒馆助手 generate 包装：从 options 提取用户消息（injects[0].content > prompt > user_input），
//    规划成功后写回同一位置，再调原始 generate——宿主完全无感。
// ② GENERATION_AFTER_COMMANDS：用户楼已落（chat 尾=is_user）→ 策略1 改 params.prompt +
//    用户楼 mes + sl_plot 落点 + 消息更新事件；未落楼 → 策略2 写回输入框 + params.prompt。
// ③ 发送意图捕获（capture 阶段 pointerdown/keydown）供 12s TTL 判定。
// 防回环：5s 同文本去重（与①互斥）+ _sl_processed 会话标记 + sl_plot 自产字段 +
// quiet/automatic/regenerate 过滤 + 单飞互斥。

import {
  assembleFinalDirective,
  buildChronicleOverview,
  builtinDriverPreset,
  defaultDriverPreset,
  normalizeDriverPreset,
  isSelfProduced,
  markIntercept,
  readPlotFromMessage,
  readPlotRawFromMessage,
  rollDriverDice,
  runPlanningRequest,
  shouldProcessPlot,
  shouldSkipIntercept,
  SL_PLOT_FIELD,
  SL_PLOT_TASKS_FIELD,
  type DriverPreset,
  type DirectorTaskRequest,
} from './director';
import { stripWithContextConfig } from '../../unified-statusbar/core/context-strip';
import type { LedgerLogEvent } from './ledger-log';
import { describeErrorDetail } from './error-detail';
import type { LedgerRuntime } from './runtime';
import { readTableBlockValue, resolveTable } from './book';
import { readStatusbarNarrativeSnapshot } from './statusbar-cognition';

export interface DirectorRuntimeDeps {
  runtime: LedgerRuntime;
  getChat(): any[];
  /** 当前聊天稳定身份（chatId/getCurrentChatId + owner）；缺省时用对象+原文+数组身份兜底。 */
  getChatIdentity?(): string | null;
  /** 状态栏只读桥所在窗口（自身/parent/top）；缺省按浏览器全局检测。 */
  getStatusbarWindows?(): unknown[];
  getTavernHelper(): any;
  getEventSource(): { on(type: string, cb: (...args: any[]) => void): void; emit(type: string, ...args: any[]): void } | null;
  getEventType(name: 'GENERATION_AFTER_COMMANDS' | 'MESSAGE_UPDATED' | 'MESSAGE_SENT'): string | undefined;
  /** 1A 任务请求：结构头任务段 + 固定块/段混排 + 触发注入 + 扫描钩（受保 generateRaw）。 */
  requestTask(spec: DirectorTaskRequest, opts?: { signal?: AbortSignal }): Promise<string>;
  readDriverConfig(): { enabled: boolean; presetName: string; presets: Record<string, unknown> };
  saveDriverConfig(patch: { presetName?: string }): void;
  /** 用户楼字段落点：改消息 + 保存 + 通知。 */
  updateUserMessage(index: number, patch: Record<string, unknown>): Promise<boolean>;
  getInputBox(): string;
  setInputBox(text: string): void;
  /** 删除聊天最后一条消息（重置本轮用：先删用户楼及其后的 AI 楼，再重新发送）。 */
  deleteLastMessage(): Promise<void>;
  /** 点击发送按钮（重置本轮用）。返回 false = 找不到发送按钮/点击失败。 */
  clickSend(): boolean;
  /** 停止宿主当前生成（推进中止/失败＝本次发送作废；同数据库项目 stopTavernGeneration）。 */
  stopGeneration?(): void;
  /** 发送前环境检查（AI 生成中 / 编辑模式 / 发送按钮不可用）。缺省视为可用。 */
  canSend?(): { ok: boolean; reason?: string };
  /** 运行期普通提示（纯文本；重置成功等）。 */
  notify?(message: string): void;
  notifyProgress(text: string, onAbort: () => void): void;
  clearProgress(): void;
  warn(message: string): void;
  /** 运行日志上报（工作台「日志」页；planner 出错 / 重试耗尽时附完整原始 AI 输出，供展开研究）。 */
  report?(event: LedgerLogEvent): void;
  now(): number;
}

/** 从用户楼最终指令里取回原输入（重置时 input 为空的兜底；message 或 mes 字符串均可）。 */
export function readUserInputFromMessage(message: unknown): string {
  const mes = typeof message === 'string'
    ? message
    : String((message as { mes?: unknown })?.mes ?? '');
  const m = mes.match(/<本轮用户输入>([\s\S]*?)<\/本轮用户输入>/);
  return m ? String(m[1]).trim() : '';
}

/** 规划结果：与数据库项目同口径区分「成功 / 用户中止 / 失败 / 不接管」。
 *  failed 与 aborted 都不得把用户原文当普通楼层发出去（策略1删楼回填、策略2取消本次发送）。 */
type PlanOutcome =
  | { status: 'planned'; finalDirective: string; outputs: Record<string, string> }
  | { status: 'aborted' }
  | { status: 'failed'; reason?: string }
  | { status: 'skipped' };

interface PlanningTarget {
  floorIndex: number | null;
  chat: any[] | null;
  chatIdentity: string | null;
  message: any | null;
  /** 宿主新用户消息没有通用稳定 id 字段；有 id/uid/messageId 时优先用于重新定位。 */
  stableId: string | null;
  originalText: string;
}

function readStableMessageId(message: any): string | null {
  for (const key of ['id', 'uid', 'messageId', 'message_id']) {
    const value = message?.[key];
    if (typeof value === 'string' && value) return `${key}:${value}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `${key}:${String(value)}`;
  }
  return null;
}

export function createDirectorRuntime(deps: DirectorRuntimeDeps) {
  const gate = { lastIntentAt: 0, lastIntercept: { text: '', ts: 0 } };
  let processing = false;
  let abortController: AbortController | null = null;
  let unbinders: (() => void)[] = [];
  let warnedInvalidPreset = false;
  /** 策略2规划出的本轮指令（等待 MESSAGE_SENT 落到用户楼后补自产标记）。 */
  let pendingSend: { text: string; outputs: Record<string, string>; target: PlanningTarget } | null = null;
  function currentChatIdentity(): string | null {
    try {
      const value = deps.getChatIdentity?.();
      return typeof value === 'string' && value ? value : null;
    } catch (_e) { return null; }
  }

  /** 在请求开始前钉住聊天与目标消息；没有 chatId 时仍保留数组/对象引用作保守兜底。 */
  function capturePlanningTarget(floorIndex: number | null, originalText: string): PlanningTarget {
    const chat = deps.getChat();
    const safeChat = Array.isArray(chat) ? chat : null;
    const index = floorIndex === null ? null : Math.trunc(floorIndex);
    const message = index !== null ? safeChat?.[index] || null : null;
    return {
      floorIndex: index,
      chat: safeChat,
      chatIdentity: currentChatIdentity(),
      message,
      stableId: readStableMessageId(message),
      originalText: String(originalText ?? '').trim(),
    };
  }

  function sameChat(target: PlanningTarget): boolean {
    const identity = currentChatIdentity();
    // 已提供身份必须相等；不能仅凭空身份让旧结果跨聊天通过。
    if (target.chatIdentity || identity) return !!target.chatIdentity && identity === target.chatIdentity;
    return Array.isArray(deps.getChat()) && deps.getChat() === target.chat;
  }

  function locatePlanningTarget(target: PlanningTarget, expectedText = target.originalText): { index: number; message: any } | null {
    if (!sameChat(target) || !target.message) return null;
    const chat = deps.getChat();
    if (!Array.isArray(chat) || chat !== target.chat) return null;
    const matches = (message: any): boolean => message === target.message
      && String(message?.mes || '').trim() === String(expectedText ?? '').trim()
      && (!target.stableId || readStableMessageId(message) === target.stableId);
    let index = target.floorIndex;
    let message = index !== null ? chat[index] : null;
    if (index === null || !matches(message)) {
      // 前面楼层被删除后可沿稳定 id 找回原对象；无 id 时只用对象+原文，绝不按同下标写别的对象。
      const found = target.stableId
        ? chat.findIndex(m => readStableMessageId(m) === target.stableId && matches(m))
        : chat.findIndex(matches);
      if (found < 0) return null;
      index = found;
      message = chat[found];
    }
    return { index: index!, message };
  }

  function statusbarWindows(): unknown[] {
    if (deps.getStatusbarWindows) return deps.getStatusbarWindows();
    const out: unknown[] = [];
    try {
      const w = (globalThis as any).window;
      if (w) out.push(w);
      if (w?.parent) out.push(w.parent);
      if (w?.top) out.push(w.top);
    } catch (_e) { /* cross-origin */ }
    return [...new Set(out)];
  }

  /** 策略2 取消本次发送后待恢复的输入原文（宿主清空输入框后写回；同数据库项目 cancelPendingSendKeepTextarea）。 */
  let pendingSendRestore: { text: string; seq: number } | null = null;
  let pendingRestoreSeq = 0;
  let pendingRestoreListener: { el: HTMLTextAreaElement; fn: () => void } | null = null;

  function detachRestoreListener(): void {
    if (!pendingRestoreListener) return;
    try { pendingRestoreListener.el.removeEventListener('input', pendingRestoreListener.fn); } catch (_e) { /* ignore */ }
    pendingRestoreListener = null;
  }

  /** 写回待恢复的原文（用户已重新输入时不覆盖）；seq 不符＝上一轮取消的监听/定时器，直接作废。 */
  function restorePendingSendText(seq?: number): void {
    const pending = pendingSendRestore;
    if (!pending) return;
    if (seq != null && pending.seq !== seq) return;
    pendingSendRestore = null;
    detachRestoreListener();
    if (String(deps.getInputBox() || '')) return;
    deps.setInputBox(pending.text);
  }

  /**
   * 把本次发送判为取消，但把用户原文留在输入框里（与数据库项目同一机制）：
   * 先清空输入框（宿主随后读到的将是空串，因此不会落成用户楼层），
   * 等宿主清空输入框派发 input 事件时再写回原文；宿主未按预期派发时用定时器兜底。
   * 顺序要求：先清空（此刻不登记待恢复，避免清空自己触发的 input 立刻回填），再登记原文。
   */
  function cancelPendingSendKeepTextarea(text: string): void {
    const original = String(text ?? '');
    if (!original.trim()) return;
    detachRestoreListener();
    pendingSendRestore = null;
    deps.setInputBox('');
    const seq = ++pendingRestoreSeq;
    pendingSendRestore = { text: original, seq };
    const textarea = hostDocument()?.getElementById('send_textarea') as HTMLTextAreaElement | null;
    const restoreChatIdentity = currentChatIdentity();
    if (textarea) {
      const fn = () => {
        if (restoreChatIdentity !== currentChatIdentity()) { pendingSendRestore = null; detachRestoreListener(); return; }
        restorePendingSendText(seq);
      };
      try {
        textarea.addEventListener('input', fn);
        pendingRestoreListener = { el: textarea, fn };
      } catch (_e) { /* DOM 不可用：只靠定时器兜底 */ }
    }
    // 兜底：宿主未派发 input 事件时恢复，避免用户输入丢失（与数据库项目同延时）。
    setTimeout(() => {
      if (restoreChatIdentity !== currentChatIdentity()) { pendingSendRestore = null; detachRestoreListener(); return; }
      restorePendingSendText(seq);
    }, 1000);
  }

  /** 策略1 中止/失败：本次发送作废——停生成、删掉刚落的用户楼（确认仍是原文）、原文退回输入框。 */
  async function discardLandedSend(target: PlanningTarget): Promise<void> {
    const originalText = target.originalText;
    try { deps.stopGeneration?.(); } catch (_e) { /* ignore */ }
    const chat = deps.getChat();
    const located = locatePlanningTarget(target);
    const last = Array.isArray(chat) && chat.length > 0 ? chat[chat.length - 1] : null;
    const stillOriginal = !!located && located.message === last && last?.is_user === true
      && Array.isArray(chat) && chat.length - 1 === located.index;
    if (stillOriginal) {
      try { await deps.deleteLastMessage(); } catch (_e) { /* 删除失败也回填原文，由用户手动处理 */ }
    }
    if (sameChat(target)) deps.setInputBox(originalText);
  }

  /** 自产用户楼的统一标记：两个落点（策略1的已落楼 / 策略2的待落楼）共用，防口径漂移。 */
  function processedPatch(directive: string, outputs: Record<string, string>): Record<string, unknown> {
    return {
      [SL_PLOT_FIELD]: directive,
      [SL_PLOT_TASKS_FIELD]: outputs,
      _sl_processed: true,
    };
  }

  function resolvePreset(): DriverPreset | null {
    const cfg = deps.readDriverConfig();
    if (!cfg.enabled) return null;
    // 内置目录优先（工作台下拉里的固定项）：预设名命中即用内置（同名用户预设不覆盖内置）
    const builtin = builtinDriverPreset(cfg.presetName);
    if (builtin) return builtin;
    const stored = cfg.presets?.[cfg.presetName];
    if (stored && typeof stored === 'object') {
      // 只认台账单任务格式预设；旧格式（多任务/原库 plotSettings 形态）一律不加载
      const normalized = normalizeDriverPreset(stored);
      if (normalized) return normalized;
      if (!warnedInvalidPreset) {
        warnedInvalidPreset = true;
        deps.warn(`推进预设「${cfg.presetName}」为旧格式或已损坏，已回退内置预设（旧预设不再支持导入，请在推进页用「从默认新建」重建）`);
      }
    }
    return defaultDriverPreset();
  }

  function buildContext(userInput: string, currentInputFloorIndex: number | null) {
    const chat = deps.getChat();
    const preset = resolvePreset();
    // 已有纪要（资料块【已有纪要】）：纪要表「编码索引 + 概览」全量
    let chronicleOverview = '（未找到纪要表）';
    const book = deps.runtime.book();
    if (book) {
      const table = resolveTable(book, '纪要表');
      if (table) chronicleOverview = buildChronicleOverview(table);
    }
    // 上轮推进（固定块【上轮推进结果】）：最近一个不是本次输入的用户楼
    // 两份来源都取：原始输出（sl_plot_tasks）＝标签真源（即便没进最终指令也读得到）；最终指令（sl_plot）＝回落
    let lastPlot = '';
    let lastPlotRaw = '';
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i]?.is_user !== true) continue;
      if (currentInputFloorIndex !== null && i === currentInputFloorIndex) continue;
      lastPlot = readPlotFromMessage(chat[i]);
      lastPlotRaw = readPlotRawFromMessage(chat[i]);
      break;
    }
    // 上轮正文（上下文块）：最近 N 条 AI 回复（只含 AI 回复；过主项目「上下文标签剥离」）
    const turns = Math.max(1, (preset?.contextTurnCount || 3));
    const recent: string[] = [];
    for (let i = chat.length - 1; i >= 0 && recent.length < turns; i--) {
      if (chat[i] && chat[i].is_user !== true && typeof chat[i].mes === 'string' && chat[i].mes) recent.unshift(chat[i].mes);
    }
      const recentStory = stripWithContextConfig(recent.join('\n\n'));
      return {
        userInput,
        lastPlot,
        lastPlotRaw,
        chronicleOverview,
        recentStory,
        rates: preset?.rates,
        // 骰点每轮投一次（同一轮的请求/重试共用同一组值；{{roll_bg}}/{{roll_charN}}/{{roll_fate}} 从这里取值）
        dice: rollDriverDice(),
        statusbarSnapshot: readStatusbarNarrativeSnapshot({ getWindows: statusbarWindows, getChatIdentity: currentChatIdentity }),
      };
    }

  /** 规划：单任务一次请求 → 组装最终指令。skipped=不接管（宿主原样发送）。 */
  async function plan(userInput: string, currentInputFloorIndex: number | null, capturedTarget?: PlanningTarget): Promise<PlanOutcome> {
    // 捕获必须先于 ensureSeeded/requestTask 的 await；过期结果只作废，不写进新聊天。
    const target = capturedTarget || capturePlanningTarget(currentInputFloorIndex, userInput);
    const preset = resolvePreset();
    if (!preset) return { status: 'skipped' };
    if (!deps.runtime.isReady()) {
      const ok = await deps.runtime.ensureSeeded();
      // 台账未就绪＝不接管本次发送（保持宿主原行为，避免存储故障时连普通聊天都发不出去）
      if (!ok) return { status: 'skipped' };
    }
    const ctx = buildContext(userInput, currentInputFloorIndex);
    abortController = new AbortController();
    const signal = abortController.signal;
    deps.notifyProgress('剧情推进规划中…（点击终止）', () => {
      abortController?.abort();
      deps.warn('已终止本次剧情推进');
    });
    try {
      const { raw, errors } = await runPlanningRequest(preset, ctx, {
        requestTask: deps.requestTask,
        // 表数据块：每次请求实时读当前账本（无缓存；取不到即返回空 → 该块不出条）
        resolveTableBlock: (cfg) => {
          const book = deps.runtime.book();
          return book ? readTableBlockValue(book, cfg) : '';
        },
        // 每次请求异常都单独进日志，带完整原文（状态码/响应体/cause/堆栈）——
        // 汇总那行只有最后一条摘要，排查网络/供应商错误要看这里。
        onRequestError: (error, attempt, maxAttempts) => {
          deps.report?.({
            level: 'error',
            message: `剧情推进 AI 请求失败（第 ${attempt}/${maxAttempts} 次）`,
            detail: describeErrorDetail(error),
          });
        },
      }, signal);
      if (signal.aborted) return { status: 'aborted' };
      if (!sameChat(target)) {
        deps.report?.({ level: 'warn', message: '剧情推进结果已作废：规划期间聊天发生变化' });
        return { status: 'skipped' };
      }
      // 空回复 / 请求异常 / 长度不足在 runPlanningRequest 里已按 maxRetries 重试；仍有 errors＝重试耗尽，判失败
      if (errors.length > 0 || !raw) {
        const reason = errors[errors.length - 1] || 'AI 未返回有效输出';
        const text = `剧情推进失败：${reason}`;
        deps.warn(text);
        deps.report?.({ level: 'error', message: text, detail: errors.join('\n'), raw });
        return { status: 'failed', reason };
      }
      const finalDirective = assembleFinalDirective({ preset, userInput, raw });
      // 组装不出变化＝不接管（与数据库项目 no_match/passthrough 同口径）
      if (!finalDirective.trim() || finalDirective.trim() === userInput.trim()) return { status: 'skipped' };
      // 原始输出落 sl_plot_tasks（键＝预设名），供回读诊断
      return { status: 'planned', finalDirective, outputs: raw ? { [preset.name]: raw } : {} };
    } finally {
      deps.clearProgress();
      abortController = null;
    }
  }

  /** 规划并落用户楼字段（sl_plot=聚合最终指令 / sl_plot_tasks=各任务原始输出）。 */
  async function planAndAttachToFloor(floorIndex: number | null, inputText: string, capturedTarget?: PlanningTarget): Promise<PlanOutcome> {
    const target = capturedTarget || capturePlanningTarget(floorIndex, inputText);
    const planned = await plan(inputText, target.floorIndex, target);
    if (planned.status !== 'planned') return planned;
    // await 后、真正写入前再查：编辑、删除、切聊天及宿主保存期间的变化都不能写错楼。
    const located = locatePlanningTarget(target);
    if (!located || located.message?.is_user !== true) {
      const text = '剧情推进结果已作废：目标用户楼已删除、编辑或移动';
      deps.warn(text);
      deps.report?.({ level: 'warn', message: text, raw: Object.values(planned.outputs || {}).join('\n\n') });
      return { status: 'skipped' };
    }
    const patch: Record<string, unknown> = {
      mes: planned.finalDirective,
      ...processedPatch(planned.finalDirective, planned.outputs),
    };
    const ok = await deps.updateUserMessage(located.index, patch);
    if (!ok) {
      const text = '剧情推进：用户楼写入失败（规划文本未落楼）';
      deps.warn(text);
      deps.report?.({ level: 'error', message: text, raw: Object.values(planned.outputs || {}).join('\n\n') });
    }
    return planned;
  }

  // ── 入口①：酒馆助手 generate 包装 ──
  function hookTavernHelperGenerate(): void {
    const th = deps.getTavernHelper();
    if (!th || typeof th.generate !== 'function' || (th as any).__sl_generate_hooked) return;
    const original = th.generate.bind(th);
    (th as any).__sl_generate_hooked = true;
    th.generate = async function (options: any, ...rest: any[]) {
      try {
        if (options && typeof options === 'object' && !options.should_stream && !processing) {
          const enabled = deps.readDriverConfig().enabled;
          const userMessage = options.injects?.[0]?.content || options.user_input || options.prompt;
          // 与入口②同一套触发门：自动/静默/再生/非新鲜用户回合一律放过，
          // 避免其他插件的 generate（摘要/翻译等）被误当成用户发送（F4）。
          const isUserSend = shouldProcessPlot({
            enabled,
            type: options.type,
            params: options,
            dryRun: options.dry_run,
            lastIntentAt: gate.lastIntentAt,
            now: deps.now(),
          });
          if (isUserSend && typeof userMessage === 'string' && userMessage.trim() && !shouldSkipIntercept(gate, userMessage, deps.now())) {
            markIntercept(gate, userMessage, deps.now());
            processing = true;
            let finalMessage: string | null = null;
            try {
              const target = capturePlanningTarget(null, userMessage);
            const planned = await plan(userMessage, null, target);
              finalMessage = planned.status === 'planned' ? planned.finalDirective : null;
            } finally {
              processing = false;
            }
            if (finalMessage) {
              if (options.injects?.[0]?.content) options.injects[0].content = finalMessage;
              else if (typeof options.prompt === 'string') options.prompt = finalMessage;
              else options.user_input = finalMessage;
            }
          }
        }
      } catch (_e) { /* 推进失败不阻断宿主生成 */ }
      return original(options, ...rest);
    };
    unbinders.push(() => {
      try {
        th.generate = original;
        delete (th as any).__sl_generate_hooked;
      } catch (_e) { /* ignore */ }
    });
  }

  // ── 入口②：GENERATION_AFTER_COMMANDS ──
  function hookAfterCommands(): void {
    const es = deps.getEventSource();
    const eventType = deps.getEventType('GENERATION_AFTER_COMMANDS');
    if (!es || !eventType) return;
    const handler = async (type: string | undefined, params: any, dryRun: boolean | undefined) => {
      try {
        if (params?._sl_processed_by_hook) return;
        if (processing) return;
        const cfg = deps.readDriverConfig();
        if (!shouldProcessPlot({ enabled: cfg.enabled, type, params, dryRun, lastIntentAt: gate.lastIntentAt, now: deps.now() })) return;
        const chat = deps.getChat();
        if (!Array.isArray(chat) || chat.length === 0) return;
        const lastIdx = chat.length - 1;
        const lastMsg = chat[lastIdx];
        const boxText = String(deps.getInputBox() || '');
        // 策略1只认「本轮」用户楼：尾部用户楼必须就是输入框里的这一条。
        // 删掉 AI 回复后尾部会露出上一条已推进过的用户楼——它的文本与输入框不一致，
        // 落到策略2按本轮输入框规划，不再把旧楼整段指令当成本轮输入重推。
        // 输入框为空时保持旧行为（兼容先落楼再触发的外部流程；自产楼仍由标记拦截）。
        const isCurrentUserFloor = lastMsg?.is_user === true
          && (!boxText.trim() || boxText.trim() === String(lastMsg.mes || '').trim());
        if (isCurrentUserFloor) {
          // 策略1：用户楼已落
          const messageText = String(lastMsg.mes || '');
          if (!messageText.trim()) return;
          if (lastMsg._sl_processed || isSelfProduced(lastMsg)) return;
          if (shouldSkipIntercept(gate, messageText, deps.now())) return; // 已被入口①处理
          markIntercept(gate, messageText, deps.now());
          processing = true;
          try {
            const target = capturePlanningTarget(lastIdx, messageText);
            const outcome = await planAndAttachToFloor(lastIdx, messageText, target);
            const located = locatePlanningTarget(target, outcome.status === 'planned' ? outcome.finalDirective : target.originalText);
            if (outcome.status === 'planned' && located) {
              params.prompt = outcome.finalDirective;
              deps.getEventSource()?.emit(deps.getEventType('MESSAGE_UPDATED') || 'message_updated', located.index);
            } else if (outcome.status === 'planned') {
              // 极小窗口：写入后事件发送前又编辑/切聊天，绝不把新结果发给当前生成。
              await discardLandedSend(target);
            } else if (outcome.status === 'aborted' || outcome.status === 'failed') {
              // 中止/失败＝本次发送作废（同数据库项目策略1）：停生成、删刚落的用户楼、原文退回输入框
              await discardLandedSend(target);
            }
          } finally {
            processing = false;
            // 消费发送意图：一次用户发送只规划一次（与策略2同口径）
            gate.lastIntentAt = 0;
          }
        } else {
          // 策略2：输入框未落楼
          if (!boxText.trim()) return;
          if (shouldSkipIntercept(gate, boxText, deps.now())) return;
          markIntercept(gate, boxText, deps.now());
          processing = true;
          try {
            const target = capturePlanningTarget(null, boxText);
            const outcome = await plan(boxText, null, target);
            if (outcome.status === 'planned' && sameChat(target)) {
              deps.setInputBox(outcome.finalDirective);
              params.prompt = outcome.finalDirective;
              // 等宿主把这条指令落到用户楼后补自产标记（MESSAGE_SENT）：
              // 否则删楼后露出的旧楼没有 _sl_processed/sl_plot，会被策略1当成新一轮再推一次。
              pendingSend = { text: outcome.finalDirective, outputs: outcome.outputs, target };
            } else if (outcome.status === 'aborted' || outcome.status === 'failed') {
              // 中止/失败＝取消本次发送（同数据库项目策略2）：宿主读到空输入框就不落用户楼，随后回填原文
              cancelPendingSendKeepTextarea(boxText);
              try { deps.stopGeneration?.(); } catch (_e) { /* ignore */ }
            }
          } finally {
            processing = false;
            // 消费发送意图，防同链路重复触发
            gate.lastIntentAt = 0;
          }
        }
      } catch (_e) { /* 推进失败不阻断宿主生成 */ }
    };
    es.on(eventType, handler);
    // 真注销（旧实例卸载路径）：ST eventSource 有 off 就摘；没有则随页面生命周期。
    unbinders.push(() => { try { (es as any).off?.(eventType, handler); } catch (_e) { /* 无 off 则随页面生命周期 */ } });
  }

  // ── 策略2的落楼补标记：宿主把本轮指令写进聊天后，补 _sl_processed/sl_plot/sl_plot_tasks ──
  // ST 的 sendMessageAsUser 会先 saveChat 再 emit MESSAGE_SENT，所以这里只改内存、不再额外落盘：
  // 本轮生成结束时的 saveChatConditional 会把标记一并持久化；生成被中止时标记至少在本会话内生效。
  function hookMessageSent(): void {
    const es = deps.getEventSource();
    const eventType = deps.getEventType('MESSAGE_SENT');
    if (!es || !eventType) return;
    const handler = (index: number) => {
      const pending = pendingSend;
      if (!pending) return;
      const chat = deps.getChat();
      const idx = Number(index);
      const msg = chat?.[idx];
      // 只认捕获时的聊天、尾部落点和完整指令；跨聊天的 MESSAGE_SENT 不补标记。
      const valid = sameChat(pending.target) && chat === pending.target.chat
        && Array.isArray(chat) && idx === chat.length - 1
        && msg?.is_user === true && String(msg.mes || '').trim() === pending.text.trim();
      pendingSend = null;
      if (!valid) return;
      // 宿主可能按 trim_spaces 修剪过文本；只有确认是本轮指令才补标记。
      Object.assign(msg, processedPatch(pending.text, pending.outputs));
    };
    es.on(eventType, handler);
    unbinders.push(() => { try { (es as any).off?.(eventType, handler); } catch (_e) { /* 无 off 则随页面生命周期 */ } });
  }

  // ── 入口③：发送意图捕获（capture，先于宿主发送逻辑；宿主 DOM 不可用时跳过） ──
  // parent.document 优先：#send_but/#send_textarea 在主页面，脚本 iframe 的裸 document 收不到这些事件
  // （node 测试无 window/document → 返回 null 跳过）。
  function hostDocument(): Document | null {
    try {
      const p = (globalThis as any).window?.parent;
      const d = p?.document as Document | undefined;
      if (d && typeof d.addEventListener === 'function') return d;
    } catch (_e) { /* cross-origin */ }
    try { if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') return document; } catch (_e) { /* ignore */ }
    return null;
  }

  function hookSendIntent(): void {
    const doc = hostDocument();
    if (!doc) return;
    const onPointerDown = (e: Event) => {
      try {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('#send_but')) gate.lastIntentAt = deps.now();
      } catch (_e) { /* ignore */ }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      try {
        const target = e.target as HTMLElement | null;
        if (e.key === 'Enter' && !e.shiftKey && target?.id === 'send_textarea') gate.lastIntentAt = deps.now();
      } catch (_e) { /* ignore */ }
    };
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('keydown', onKeyDown, true);
    unbinders.push(() => {
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('keydown', onKeyDown, true);
    });
  }

  /**
   * 重置本轮：删除最新用户楼及其后的全部 AI 楼，把原输入放回输入框，标记发送意图并点击发送，
   * 让剧情推进重新规划。整个序列由台账（父窗口）执行——从面板 iframe 调用时，删除当前楼会销毁
   * iframe，若序列在 iframe 内跑会中断在「只删楼不发送」。
   */
  async function resetRound(inputText: string): Promise<{ ok: boolean; deleted: number; reason?: string }> {
    if (processing) return { ok: false, deleted: 0, reason: '剧情推进正在运行，请稍后再重置' };
    const gateCheck = deps.canSend ? deps.canSend() : { ok: true };
    if (!gateCheck.ok) return { ok: false, deleted: 0, reason: gateCheck.reason || '当前无法发送' };
    const chat = deps.getChat();
    if (!Array.isArray(chat) || chat.length === 0) return { ok: false, deleted: 0, reason: '聊天记录为空' };
    let userIdx = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i]?.is_user === true) { userIdx = i; break; }
    }
    if (userIdx < 0) return { ok: false, deleted: 0, reason: '找不到本轮用户楼' };
    const text = String(inputText || '').trim() || readUserInputFromMessage(chat[userIdx]);
    if (!text) return { ok: false, deleted: 0, reason: '本轮用户输入为空' };

    const count = chat.length - userIdx;
    let deleted = 0;
    try {
      for (let i = 0; i < count; i++) {
        await deps.deleteLastMessage();
        deleted++;
      }
    } catch (_e) {
      return { ok: false, deleted, reason: `删除本轮消息失败（已删除 ${deleted} 条）` };
    }

    deps.setInputBox(text);
    // 给宿主一帧同步输入框状态，再标记发送意图并点击发送（意图 TTL 12s）。
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    gate.lastIntentAt = deps.now();
    let sent = false;
    try { sent = deps.clickSend(); } catch (_e) { sent = false; }
    if (!sent) return { ok: false, deleted, reason: '删除已完成，但发送失败（输入框已恢复，可手动发送）' };
    try { deps.notify?.(`已重置本轮：删除 ${deleted} 条消息，正在重新推进…`); } catch (_e) { /* ignore */ }
    return { ok: true, deleted };
  }

  return {
    bind() {
      hookSendIntent();
      hookTavernHelperGenerate();
      hookAfterCommands();
      hookMessageSent();
    },
    unbind() {
      abortController?.abort();
      pendingSend = null;
      for (const u of unbinders) { try { u(); } catch (_e) { /* ignore */ } }
      unbinders = [];
    },
    /** 手动触发（以最后用户楼或输入框为输入）。 */
    async runNow(): Promise<boolean> {
      if (processing) return false;
      const chat = deps.getChat();
      let floorIndex: number | null = null;
      for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user === true) { floorIndex = i; break; }
      }
      const input = floorIndex !== null ? String(chat[floorIndex].mes || '') : deps.getInputBox();
      if (!String(input).trim()) {
        deps.warn('剧情推进：找不到用户输入（无用户楼层且输入框为空）');
        return false;
      }
      processing = true;
      try {
        const outcome = await planAndAttachToFloor(floorIndex, String(input));
        return outcome.status === 'planned';
      } finally {
        processing = false;
      }
    },
    resetRound,
    /** 测试钩子。 */
    __gate: gate,
    __isProcessing: () => processing,
    __plan: plan,
    /** 测试钩子：立即执行策略2 的输入框原文回填（生产由 input 事件/1s 兜底触发）。 */
    __restorePendingSendNow: () => restorePendingSendText(),
  };
}
