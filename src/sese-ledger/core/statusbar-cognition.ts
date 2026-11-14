// ===== 状态栏叙事快照窄适配（只读；台账单开不依赖此桥） =====
//
// 消费 n-sese-unified-statusbar 的 world-snapshot.ts 实际输出，不复制世界状态。
// 桥：__ubWorldCognitionSnapshot.getSnapshot()。桥不可用即回退台账单开。

export const STATUSBAR_NARRATIVE_BRIDGE = '__ubWorldCognitionSnapshot';
export const STATUSBAR_NARRATIVE_SCHEMA = 1;

export interface StatusbarEventCandidate {
  id: string;
  title: string;
  hook: string;
}

export interface StatusbarNarrativeSnapshot {
  chatIdentity: string;
  knownFacts: Record<string, string[]>;
  ownsBlindSpotPrompt: boolean;
  candidates: StatusbarEventCandidate[];
}

interface StatusbarNarrativeBridge {
  version?: number;
  getSnapshot?: () => unknown;
}

export interface ReadStatusbarSnapshotDeps {
  getWindows(): unknown[];
  getChatIdentity(): string | null;
}

function clone(value: unknown): unknown {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch (_e) { /* JSON 兜底 */ }
  try { return JSON.parse(JSON.stringify(value)); } catch (_e) { return null; }
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** 校验版本和聊天身份后返回独立数据；之后外部修改桥对象不影响本轮规划。 */
export function normalizeStatusbarSnapshot(raw: unknown, chatIdentity: string | null): StatusbarNarrativeSnapshot | null {
  if (!chatIdentity || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, any>;
  if (source.version !== STATUSBAR_NARRATIVE_SCHEMA
    || source.available !== true
    || source.chatIdentity !== chatIdentity) return null;
  const characters = source.characters;
  if (!characters || typeof characters !== 'object' || Array.isArray(characters)) return null;
  const knownFacts: Record<string, string[]> = {};
  for (const [name, character] of Object.entries(characters)) {
    const cleanName = cleanText(name, 80);
    const facts = (character as any)?.knownFacts;
    if (!cleanName || !Array.isArray(facts)) return null;
    const cleanFacts = facts.map(f => cleanText(f, 160)).filter(Boolean).slice(0, 5);
    if (cleanFacts.length) knownFacts[cleanName] = cleanFacts;
  }
  const sourceCandidates = source.candidates;
  if (!sourceCandidates || typeof sourceCandidates !== 'object' || Array.isArray(sourceCandidates)) return null;
  if (!Array.isArray(sourceCandidates.references)) return null;
  const candidates: StatusbarEventCandidate[] = [];
  const seen = new Set<string>();
  // primary 是本轮唯一主入口；references 只保留为后台候选，不复制事件全文。
  for (const item of [sourceCandidates.primary, ...sourceCandidates.references]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (source.restrictions?.externalIntrusionBlocked === true) continue;
    const id = cleanText(item.eventId || item.id, 120);
    const title = cleanText(item.title, 80);
    const hook = cleanText(item.entryCue || item.hook, 240);
    if (!id || !title || !hook || seen.has(id)) continue;
    seen.add(id);
    candidates.push({ id, title, hook });
  }
  return {
    chatIdentity,
    knownFacts,
    ownsBlindSpotPrompt: source.restrictions?.protagonistOmniscienceForbidden === true,
    candidates,
  };
}

/** 只调用 getSnapshot 这一项只读能力；任何缺席、跨聊天、异常或坏格式都静默回退。 */
export function readStatusbarNarrativeSnapshot(deps: ReadStatusbarSnapshotDeps): StatusbarNarrativeSnapshot | null {
  try {
    const chatIdentity = deps.getChatIdentity();
    if (!chatIdentity) return null;
    for (const win of deps.getWindows()) {
      try {
        const bridge = (win as any)?.[STATUSBAR_NARRATIVE_BRIDGE] as StatusbarNarrativeBridge | undefined;
        if (!bridge || typeof bridge.getSnapshot !== 'function') continue;
        const raw = bridge.getSnapshot();
        return normalizeStatusbarSnapshot(clone(raw), chatIdentity);
      } catch (_e) { return null; }
    }
  } catch (_e) { /* 身份/窗口不可访问＝单开 */ }
  return null;
}

/** 只给内置魔改预设补持久认知，不把状态栏正文/完整事件复制进台账请求。 */
export function buildStatusbarCognitionPrompt(snapshot: StatusbarNarrativeSnapshot): string {
  const rows = Object.entries(snapshot.knownFacts).map(([name, facts]) => `${name}：${facts.join('；')}`);
  const parts = ['<statusbar_cognition>',
    '以下为状态栏持久认知的只读快照，只用于 soul 的 SEG1；沿用其中已知事实，不把未知事实写成角色已知。'];
  if (snapshot.ownsBlindSpotPrompt) parts.push('状态栏已承担本轮主要盲点提示：不要另写一组重复盲点；SEG1 只补充这些已知事实无法覆盖且确有必要的限制，无补充写“无认知盲点”。');
  if (rows.length) parts.push('【角色已知事实】', ...rows);
  parts.push('</statusbar_cognition>');
  return parts.join('\n');
}

/** 合格 pending 候选优先；没有候选时返回空，由调用方保留台账单开 chaos。 */
export function buildStatusbarCandidatePrompt(snapshot: StatusbarNarrativeSnapshot): string {
  const candidate = snapshot.candidates[0];
  if (!candidate) return '';
  return ['<statusbar_candidate>',
    '本轮只采用以下一个合格的外部事件候选；它是可承接的由头，不是已经发生的事实。',
    `事件：${candidate.title}`,
    `入口：${candidate.hook}`,
    ...snapshot.candidates.slice(1, 3).map(item => `极简参考（不另起主线）：${item.title}｜${item.hook}`),
    '若 chaos_bg 本轮触发全局意外，<chaos> 必须使用主入口，不另造事件；若 chaos_char 同时触发角色主动，不要让它再引入第二个外部变量。',
    '</statusbar_candidate>'].join('\n');
}
