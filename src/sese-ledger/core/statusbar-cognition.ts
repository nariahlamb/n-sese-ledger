// ===== 状态栏叙事快照窄适配（只读；台账单开不依赖此桥） =====
//
// 消费 n-sese-unified-statusbar 的 world-snapshot.ts 实际输出（快照 schema v2：结构化事件池），
// 不复制世界状态。桥：__ubWorldCognitionSnapshot.getSnapshot()。桥不可用即回退台账单开。
// v1（primary + references 的两段式候选）继续兼容：读入即转成 kind='arrival' 的事件池条目。
// 泄密红线：desc / hiddenGoal / goalProgress 一律不读、不保留（快照里即使有也不进台账）。

export const STATUSBAR_NARRATIVE_BRIDGE = '__ubWorldCognitionSnapshot';
/** 当前消费的快照 schema 版本（v2＝结构化事件池）。 */
export const STATUSBAR_NARRATIVE_SCHEMA = 2;
/** 兼容接受的旧快照版本（v1＝两段式 candidates）。 */
export const STATUSBAR_NARRATIVE_SCHEMA_V1 = 1;

/** 事件池上限（防御异常大数组；状态栏正常每轮几条）。 */
const EVENT_POOL_LIMIT = 12;
/** 每个角色最多带几条已知事实。 */
const KNOWN_FACTS_LIMIT = 5;

/** 结构化事件条目（状态栏 eventPool 的一项；只保留可供台前挑选的公开字段）。 */
export interface StatusbarEventItem {
  /** 事件 id（回执 pick/skip 与后续消费都用它）。 */
  id: string;
  /** 事件类型（arrival/ambient/thread/rumor…；状态栏给什么就记什么）。 */
  kind: string;
  title: string;
  /** 切入线索：表面可感知的由头（不剧透幕后隐情）。 */
  cue: string;
  /** 关联对象（角色名/地点名等）。 */
  refId?: string;
  region?: string;
  expiresAtDay?: string;
  /** 公开信息：可以被角色感知到的表面细节。 */
  publicInfo?: string;
  /** 出现理由（状态栏判定依据，供 AI 判断契合度）。 */
  reason?: string;
  /** 触发条件（不满足时不该推）。 */
  condition?: string;
  /** 认知边界：哪些角色知道/不知道。 */
  epistemicBoundary?: string;
  level?: number;
  threadDriven?: boolean;
}

/** 兼容投影：事件池的极简形态（旧消费面 / 日志 / 跨仓契约沿用）。 */
export interface StatusbarEventCandidate {
  id: string;
  title: string;
  hook: string;
}

export interface StatusbarNarrativeSnapshot {
  chatIdentity: string;
  knownFacts: Record<string, string[]>;
  ownsBlindSpotPrompt: boolean;
  /** 当前世界日期（状态栏 dateKey；缺项＝空串）。 */
  dateKey: string;
  /** 主角所在地区（状态栏 playerRegion；缺项＝空串）。 */
  playerRegion: string;
  /** 在场角色名（状态栏 onStageNames）。 */
  onStageNames: string[];
  /** 场景守护：blocked=true 时本轮不得接入外部事件。 */
  sceneGuard: { blocked: boolean; reason: string };
  /** 世界动态由状态栏自行投影（台账推进据此暂停该条目，防重复喂料）。 */
  worldbookDelegated: boolean;
  /** 结构化事件池（v2 直接读；v1 candidates 转 kind='arrival'）。 */
  eventPool: StatusbarEventItem[];
  /** 兼容投影（＝ eventPool 的 id/title/cue）。 */
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

/** 单条事件归一：只认公开字段（desc/hiddenGoal/goalProgress 等幕后字段一律不读）。 */
function normalizeEventItem(raw: unknown): StatusbarEventItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, any>;
  const id = cleanText(item.id ?? item.eventId, 120);
  const title = cleanText(item.title, 80);
  if (!id || !title) return null;
  const out: StatusbarEventItem = {
    id,
    kind: cleanText(item.kind, 24) || 'arrival',
    title,
    cue: cleanText(item.cue ?? item.hook ?? item.entryCue, 240),
  };
  const refId = cleanText(item.refId, 80);
  if (refId) out.refId = refId;
  const region = cleanText(item.region, 80);
  if (region) out.region = region;
  const expiresAtDay = cleanText(item.expiresAtDay, 32);
  if (expiresAtDay) out.expiresAtDay = expiresAtDay;
  const publicInfo = cleanText(item.publicInfo, 160);
  if (publicInfo) out.publicInfo = publicInfo;
  const reason = cleanText(item.reason, 120);
  if (reason) out.reason = reason;
  const condition = cleanText(item.condition, 120);
  if (condition) out.condition = condition;
  const epistemicBoundary = cleanText(item.epistemicBoundary, 160);
  if (epistemicBoundary) out.epistemicBoundary = epistemicBoundary;
  const level = Number(item.level);
  if (Number.isFinite(level)) out.level = Math.trunc(level);
  if (item.threadDriven === true) out.threadDriven = true;
  return out;
}

/** 校验版本和聊天身份后返回独立数据；之后外部修改桥对象不影响本轮规划。
 *  v1（两段式 candidates）与 v2（eventPool）都接受：都要求 available===true 且 chatIdentity 严格相等。 */
export function normalizeStatusbarSnapshot(raw: unknown, chatIdentity: string | null): StatusbarNarrativeSnapshot | null {
  if (!chatIdentity || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, any>;
  const version = Number(source.version);
  if (version !== STATUSBAR_NARRATIVE_SCHEMA && version !== STATUSBAR_NARRATIVE_SCHEMA_V1) return null;
  if (source.available !== true || source.chatIdentity !== chatIdentity) return null;
  const characters = source.characters;
  if (characters !== undefined && (!characters || typeof characters !== 'object' || Array.isArray(characters))) return null;
  const knownFacts: Record<string, string[]> = {};
  for (const [name, character] of Object.entries(characters || {})) {
    const cleanName = cleanText(name, 80);
    if (!cleanName) return null;
    const facts = (character as any)?.knownFacts;
    if (!Array.isArray(facts)) continue;
    const cleanFacts = facts.map((f) => cleanText(f, 160)).filter(Boolean).slice(0, KNOWN_FACTS_LIMIT);
    if (cleanFacts.length) knownFacts[cleanName] = cleanFacts;
  }
  const restrictions = source.restrictions && typeof source.restrictions === 'object' ? source.restrictions : {};
  const guard = source.sceneGuard && typeof source.sceneGuard === 'object' ? source.sceneGuard : null;
  const blocked = guard ? guard.blocked === true : restrictions.externalIntrusionBlocked === true;
  const guardReason = cleanText(guard?.reason ?? restrictions.blockReason, 120);
  const dateKey = cleanText(source.dateKey, 32);
  const playerRegion = cleanText(source.playerRegion, 80);
  const onStageNames = Array.isArray(source.onStageNames)
    ? source.onStageNames.map((n: unknown) => cleanText(n, 80)).filter(Boolean).slice(0, 20)
    : [];
  const eventPool: StatusbarEventItem[] = [];
  const seen = new Set<string>();
  if (Array.isArray(source.eventPool)) {
    // v2：结构化事件池，直接读（状态栏已按日期/地区/在场/守护筛过）。
    for (const item of source.eventPool) {
      const event = normalizeEventItem(item);
      if (!event || seen.has(event.id)) continue;
      seen.add(event.id);
      eventPool.push(event);
      if (eventPool.length >= EVENT_POOL_LIMIT) break;
    }
  } else {
    // v1 回退：primary 是第一顺位，references 只当后台候选；外部闯入被守护拦下时整池为空。
    const sourceCandidates = source.candidates;
    if (!sourceCandidates || typeof sourceCandidates !== 'object' || Array.isArray(sourceCandidates)) return null;
    if (!Array.isArray(sourceCandidates.references)) return null;
    for (const item of [sourceCandidates.primary, ...sourceCandidates.references]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (restrictions.externalIntrusionBlocked === true) continue;
      // 只透传公开字段（normalizeEventItem 只读白名单键，desc/hiddenGoal 天然不进来）
      const event = normalizeEventItem({
        ...(item as Record<string, unknown>),
        id: (item as any).eventId ?? (item as any).id,
        kind: 'arrival',
        cue: (item as any).entryCue ?? (item as any).hook,
      });
      if (!event || seen.has(event.id)) continue;
      seen.add(event.id);
      eventPool.push(event);
      if (eventPool.length >= EVENT_POOL_LIMIT) break;
    }
  }
  return {
    chatIdentity,
    knownFacts,
    ownsBlindSpotPrompt: restrictions.protagonistOmniscienceForbidden === true,
    dateKey,
    playerRegion,
    onStageNames,
    sceneGuard: { blocked, reason: guardReason },
    worldbookDelegated: source.worldbookDelegated === true,
    eventPool,
    candidates: eventPool.map((event) => ({ id: event.id, title: event.title, hook: event.cue })),
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

/** 只给「状态栏桥接」预设补持久认知，不把状态栏正文/完整事件复制进台账请求。 */
export function buildStatusbarCognitionPrompt(snapshot: StatusbarNarrativeSnapshot): string {
  const rows = Object.entries(snapshot.knownFacts).map(([name, facts]) => `${name}：${facts.join('；')}`);
  const parts = ['<statusbar_cognition>',
    '以下为状态栏持久认知的只读快照，只用于 soul 的 SEG1；沿用其中已知事实，不把未知事实写成角色已知。'];
  if (snapshot.ownsBlindSpotPrompt) parts.push('状态栏已承担本轮主要盲点提示：不要另写一组重复盲点；SEG1 只补充这些已知事实无法覆盖且确有必要的限制，无补充写“无认知盲点”。');
  if (rows.length) parts.push('【角色已知事实】', ...rows);
  parts.push('</statusbar_cognition>');
  return parts.join('\n');
}

/** 结构化事件池提示（v2 主形态）：候选全体 + 严格挑选/限量/认知隔离/回执规则。
 *  事件池为空时返回空串，调用方保留台账单开的 chaos 原路径。 */
export function buildStatusbarEventPoolPrompt(snapshot: StatusbarNarrativeSnapshot): string {
  const pool = snapshot.eventPool;
  if (pool.length === 0) return '';
  const parts: string[] = ['<statusbar_events>',
    '以下为状态栏后台演化给出的「可选」事件池快照：每一条只是可以自然接住的由头，不是已经发生的事实，也不是必须采用的任务清单。'];
  const space: string[] = [];
  if (snapshot.dateKey) space.push(`日期：${snapshot.dateKey}`);
  if (snapshot.playerRegion) space.push(`主角地区：${snapshot.playerRegion}`);
  if (snapshot.onStageNames.length) space.push(`在场：${snapshot.onStageNames.join('、')}`);
  if (space.length) parts.push(`【当前时空】${space.join('；')}`);
  if (snapshot.sceneGuard.blocked) {
    const reason = snapshot.sceneGuard.reason ? `（${snapshot.sceneGuard.reason}）` : '';
    parts.push(`【守护】状态栏判定当前场景不适合外部闯入${reason}：本轮 <world_cue> 必须留空。`);
  }
  parts.push(`【事件池】共 ${pool.length} 条（[id] 只用于回执，不写进正文）`);
  for (const event of pool) {
    const details = [
      event.refId ? `对象：${event.refId}` : '',
      event.region ? `地区：${event.region}` : '',
      event.publicInfo ? `公开：${event.publicInfo}` : '',
      event.epistemicBoundary ? `边界：${event.epistemicBoundary}` : '',
      event.condition ? `条件：${event.condition}` : '',
    ].filter(Boolean);
    const kind = event.kind || 'arrival';
    parts.push(`[${event.id}] ${kind} | ${event.title} | ${event.cue || '（无切入线索）'} | ${details.join('；') || '（未标注）'}`);
  }
  parts.push('【挑选规则】',
    '1. 宁缺毋滥、严禁全推：先判断【当前输入】与【上轮正文】是否自然适合接入外部事件；若当前对话紧凑、情绪专一、sceneGuard.blocked 为真，或没有契合的条目，<world_cue> 必须留空。',
    '2. 限量与防撞车：每轮至多挑选 1 条主事件；若 <chaos> 本轮已触发全局意外/闯入，<world_cue> 不得再推第二条实景事件，至多 0–1 句轻背景风声，或直接留空。',
    '3. 认知隔离：只写表面可感知的切入由头（谁、以什么方式出现），不剧透幕后隐情，不替正文写死结局。',
    '4. 回执约束：在原始输出的最后另起 <world_ack>（不写进 <world_cue>，也不写进正文指令）：',
    '   pick: id | targetTag(world_cue 或 chaos) | 一句话理由（本轮没有选中可不写 pick 行，或写 pick: 无）',
    '   skip: id1, id2 | 一句话理由（本轮评估过但故意压住的 id）',
    '</statusbar_events>');
  return parts.join('\n');
}

/** 兼容别名：旧调用点仍按「候选提示」取名。 */
export function buildStatusbarCandidatePrompt(snapshot: StatusbarNarrativeSnapshot): string {
  return buildStatusbarEventPoolPrompt(snapshot);
}
