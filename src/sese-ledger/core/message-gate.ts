// ===== MESSAGE_RECEIVED 门控与物化等待（防同步抢读旧楼 & 非剧情事件误触发） =====

const SKIP_RECEIVED_TYPES = new Set([
  'first_message',
  'quiet',
  'impersonate',
  'command',
  'extension',
]);

/** 是否跳过该次 MESSAGE_RECEIVED：开场白及后台静默/模拟/命令/扩展插入消息不触发自动填表。 */
export function shouldSkipReceivedMessageType(type: unknown): boolean {
  if (typeof type !== 'string' || !type) return false;
  return SKIP_RECEIVED_TYPES.has(type.trim());
}

/** 判断指定消息对象是否已落定为非空 AI 楼层（排除用户楼与空占位）。 */
export function isMaterializedAiFloor(message: any): boolean {
  if (!message || typeof message !== 'object') return false;
  if (message.is_user === true) return false;
  return typeof message.mes === 'string' && message.mes.trim().length > 0;
}

export interface WaitMaterializationOptions {
  messageId: unknown;
  getChat: () => any[];
  isStale?: () => boolean;
  maxChecks?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type WaitMaterializationResult =
  | { ready: true; index: number | null; fallback?: boolean }
  | { ready: false; reason: 'stale' | 'not_ai' | 'unmaterialized' };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 退出当前同步事件栈并校验本轮 AI 楼层是否已写入 chat[]：
 * - 若 event 携带了非负整数下标 messageId，核对 chat[messageId] 已落定为非空 AI 回复；
 * - 若尚未写入或还是空串，做有界短轮询等待宿主收尾；
 * - 切聊天（isStale）立即放弃；发现目标下标其实是用户楼直接跳过。
 */
export async function waitForReceivedAiFloor(opts: WaitMaterializationOptions): Promise<WaitMaterializationResult> {
  const sleep = opts.sleep || defaultSleep;
  const maxChecks = Math.max(1, Math.trunc(opts.maxChecks ?? 5));
  const delayMs = Math.max(0, Math.trunc(opts.delayMs ?? 80));

  // 先让出一拍，等宿主及同轮其它扩展把消息同步收尾做完。
  await sleep(0);
  if (opts.isStale?.()) return { ready: false, reason: 'stale' };

  const rawId = typeof opts.messageId === 'number'
    ? opts.messageId
    : (typeof opts.messageId === 'string' && /^\d+$/.test(opts.messageId.trim()) ? Number(opts.messageId.trim()) : NaN);
  const hasExplicitIndex = Number.isInteger(rawId) && rawId >= 0;
  if (!hasExplicitIndex) {
    return { ready: true, index: null };
  }

  for (let check = 0; check < maxChecks; check++) {
    if (opts.isStale?.()) return { ready: false, reason: 'stale' };
    const chat = opts.getChat();
    if (Array.isArray(chat) && rawId < chat.length) {
      const msg = chat[rawId];
      if (msg?.is_user === true) return { ready: false, reason: 'not_ai' };
      if (isMaterializedAiFloor(msg)) return { ready: true, index: rawId };
    }
    if (check + 1 < maxChecks) await sleep(delayMs);
  }

  if (opts.isStale?.()) return { ready: false, reason: 'stale' };
  // 兜底：部分宿主可能传 1-based 或下标偏移，若尾楼已是非空 AI 回复且未指向用户楼则放行；否则视为尚未物化，不硬填旧楼。
  const chat = opts.getChat();
  if (Array.isArray(chat) && chat.length > 0) {
    const tailIdx = chat.length - 1;
    if (tailIdx >= rawId - 1 && isMaterializedAiFloor(chat[tailIdx])) {
      return { ready: true, index: tailIdx, fallback: true };
    }
  }
  return { ready: false, reason: 'unmaterialized' };
}
