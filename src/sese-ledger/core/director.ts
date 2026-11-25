// ===== 剧情推进（driver）=====
//
// 功能语义对齐原库实证有效的机制（规格 §7），实现与命名全新：
// - 三入口等价覆盖：①酒馆助手 generate 钩子（改写 injects[0].content/prompt/user_input 三选一）
//   ②GENERATION_AFTER_COMMANDS 策略1（用户楼已落：改 params.prompt + 用户楼 mes + 保存）
//   ③策略2（未落楼：写回输入框 + params.prompt）；regenerate / 进行中 / 静默生成跳过。
// - 三重防回环：12 秒新鲜回合 TTL（发送意图捕获）+ 5 秒同文本去重 + 自产文本标记
//   （台账写回的用户楼带 sl_plot 字段=自产；_sl_processed 会话内标记去重）。
// - **预设＝单任务**：提示词段/标签/重试直接挂在预设上（多任务多阶段形态已整条删除，只认单任务形状）。
//   内置两份预设＝资产文件（见文件下半）。
// - 输出标签由预设自定（extractTag 每标签取最后一次出现）：最终指令模板里的 {{标签}} 替换为
//   <标签>内容</标签>；模板未占位的标签不输出（单一标签清单，无「标签摘取/提取写入标签」之分）。
// - 前端投骰：数据库的 `<random id=…>` + `$random:xxx` 由插件前端预投；台账等价物＝本层每轮投一次
//   真随机骰（rollBg / rollChar1~5 / rollFate），预设文本用 {{roll_bg}}/{{roll_charN}}/{{roll_fate}} 取值
//   ——AI 仍不得自行投骰。
// - 纪要召回激活（兼容锚）：资料块【已有纪要】喂全量 AM 码与概览 → 召回标签输出已有 AM 码 →
//   最终指令含 <recall>AM0001, …</recall> 位于正文用户消息 → 宿主世界书绿灯命中纪要条目 keys。
// - 落点：用户楼 sl_plot / sl_plot_tasks（真数据库时代的 qrf_plot 由「应用迁移」平移成 sl_plot，运行时不回读旧字段）。
// - 1A 同构（V2 1A 化）：结构头（破限＋反八股＋预设说明）→ 固定块/段混排（参考资料块/资料块/
//   上下文块/上轮推进结果块/表数据块 + 用户段；段与块均可 hidden 跳过）→ 结构尾（尾部破限）；
//   触发注入素材＝上轮正文＋本轮输入。
// - **不再支持导入旧预设**：只认台账自己的新格式（format 标记 + schemaVersion）。

import type { LedgerBlockContents, LedgerPromptItem, LedgerPromptItemSpec, LedgerTableBlockConfig } from './ai-request';
import { resolveTable, type BookModel, type TableModel } from './book';
import { describeErrorSummary } from './error-detail';
import magicRecallAsset from '../assets/plot-preset-magic-recall.json';
import pureRecallAsset from '../assets/plot-preset-pure-recall.json';
import { buildStatusbarCandidatePrompt, buildStatusbarCognitionPrompt, type StatusbarNarrativeSnapshot } from './statusbar-cognition';
import { stripContextTags } from '../../unified-statusbar/core/context-strip';

/** 预设内的提示词项（存储形态；hidden=true 的段/块不进请求，顺序位保留）。 */
export type DriverPromptMessage = LedgerPromptItemSpec;

/** 匹配替换参数（随预设保存；{{召回数量}} 是可选召回的 0～N 上限，不要求按编号补满）。 */
export interface DriverRates {
  /** {{意外倾向}}＝全局意外走向倾向（数据库 sulv1）。 */
  rateMain?: number;
  /** {{意外频率}}＝全局意外触发频率（数据库 sulv2）。 */
  ratePersonal?: number;
  /** {{主动频率}}＝角色主动触发频率（数据库 sulv3）。 */
  rateErotic?: number;
  /** {{氛围频率}}＝环境氛围触发频率（数据库 sulv4）。 */
  rateCuckold?: number;
  /** {{召回数量}}＝召回记忆的 0～N 上限；没有相关纪要时可以是 0 条（数据库 zhaohui 的台账名）。 */
  recallCount?: number;
}

export const DEFAULT_DRIVER_RATES: Required<DriverRates> = { rateMain: 1, ratePersonal: 1, rateErotic: 1, rateCuckold: 1, recallCount: 25 };

/** rates 归一化（缺省补数据库默认值 1/1/1/1/25）。 */
export function normalizeRates(rates: DriverRates | undefined | null): Required<DriverRates> {
  const out = { ...DEFAULT_DRIVER_RATES };
  if (!rates || typeof rates !== 'object') return out;
  for (const key of Object.keys(DEFAULT_DRIVER_RATES) as (keyof DriverRates)[]) {
    const v = Number((rates as any)[key]);
    if (Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

/** 推进预设（**单任务**：提示词段/标签/重试等直接挂在预设上）。 */
export interface DriverPreset {
  name: string;
  /** 结构头任务段（拼在破限头之后）；内置魔改召回为空串（角色与铁律段自带）。 */
  systemPrompt: string;
  /** 【上轮正文】取最近几层 AI 回复。 */
  contextTurnCount: number;
  /** AI 原始输出整段长度低于此值视为失败重试（0＝不校验）。 */
  minLength: number;
  /** 重试次数上限（0＝不重试）。 */
  maxRetries: number;
  /** 输出标签（逗号分隔；最终指令模板里写 {{标签}} 才会输出，输出形态 <标签>内容</标签>）。 */
  tags: string;
  /** 提示词段与固定块混排（顺序即请求顺序）。 */
  promptGroup: DriverPromptMessage[];
  /** 最终指令模板：{{本轮输入}}＝本轮输入原文，{{标签}}＝替换为 <标签>内容</标签>（未占位的标签不输出）。 */
  finalDirectiveTemplate: string;
  /** 匹配替换参数（可选；占位符 {{意外倾向}} 等）。 */
  rates?: DriverRates;
  /** 状态栏后台事件桥：true/false 为显式开关；缺省按旧口径（内置魔改召回或模板含 {{world_cue}}）自动判定。 */
  statusbarBridge?: boolean;
}

/** 台账推进预设导出/导入标记（读写只认此格式；旧库 plotSettings 形态一律拒绝）。 */
export const PLOT_PRESET_FORMAT = 'sese-ledger-plot-preset';
export const PLOT_PRESET_SCHEMA = 2;

/** 输出标签切分（逗号分隔；空串 → []）。 */
export function splitTags(text: unknown): string[] {
  return String(text ?? '').split(',').map((t) => t.trim()).filter(Boolean);
}

/**
 * 形状归一化（读入 / 导入 / 校验共用）：单任务形状原样归一；不合格返回 null
 * （不报错，由调用方决定回退/提示；旧格式预设在下拉里标「旧格式·不可用」可一键删）。
 */
export function normalizeDriverPreset(value: unknown): DriverPreset | null {
  const raw = value as Record<string, any> | null;
  if (!raw || typeof raw !== 'object') return null;
  const promptGroup = raw.promptGroup;
  if (!Array.isArray(promptGroup)) return null;
  if (typeof raw.finalDirectiveTemplate !== 'string') return null;
  if (typeof raw.systemPrompt !== 'string') return null;
  for (const m of promptGroup) {
    if (!m || typeof m !== 'object') return null;
    if (m.block === undefined && typeof m.content !== 'string') return null;
  }
  const num = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    name: String(raw.name || '未命名预设'),
    systemPrompt: raw.systemPrompt,
    contextTurnCount: Math.max(1, Math.trunc(num(raw.contextTurnCount, 3))),
    minLength: Math.max(0, Math.trunc(num(raw.minLength, 0))),
    maxRetries: Math.max(0, Math.trunc(num(raw.maxRetries, 1))),
    // 单一标签清单（旧预设的 injectTags 读取时并入并去重；落盘/导出只写 tags）
    tags: [...new Set([...splitTags(raw.tags), ...splitTags(raw.injectTags)])].join(','),
    promptGroup: promptGroup as DriverPromptMessage[],
    finalDirectiveTemplate: raw.finalDirectiveTemplate,
    ...(typeof raw.statusbarBridge === 'boolean' ? { statusbarBridge: raw.statusbarBridge } : {}),
    ...(raw.rates && typeof raw.rates === 'object' ? { rates: raw.rates as DriverRates } : {}),
  };
}

/** 预设形状校验（读取 / 导入 / 面板列预设都走它；旧格式一律不合格）。 */
export function isValidDriverPreset(value: unknown): value is DriverPreset {
  return normalizeDriverPreset(value) !== null;
}

export const SL_PLOT_FIELD = 'sl_plot';
export const SL_PLOT_TASKS_FIELD = 'sl_plot_tasks';
/** 隐藏回执落点：本轮事件池挑选结果（不进 tags、不进最终指令模板，只随自产用户楼字段回读）。 */
export const SL_WORLD_ACK_FIELD = 'sl_world_ack';

/** 回执的一条 pick（id 来自 <statusbar_events> 的 [id]）。 */
export interface WorldAckPick {
  id: string;
  /** 落在哪个输出标签：world_cue（后台切入）或 chaos（全局意外）。 */
  targetTag: string;
  reason: string;
}

export interface WorldAck {
  version: 1;
  chatIdentity: string;
  picked: WorldAckPick | null;
  /** 本轮评估过但故意压住的 id（幻觉 id 已被过滤）。 */
  skippedIds: string[];
  skippedReason: string;
}

/** id 分隔：逗号/顿号/分号/空白都算（回执由 AI 手写，不给它记标点的负担）。 */
const ACK_ID_SEPARATOR = /[,，、;；\s]+/;

function ackIds(text: string): string[] {
  return String(text || '')
    .split(ACK_ID_SEPARATOR)
    .map((s) => s.trim().replace(/^[\s`'"“”‘’\[\]()（）]+|[\s`'"“”‘’\[\]()（）]+$/g, ''))
    .filter((s) => !!s && !/^(无|none|-|—)$/i.test(s));
}

/** 回执里的目标标签：宽容大小写与多余解释。 */
function ackTargetTag(text: string): string {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'world_cue' || value === 'chaos') return value;
  if (/world_cue/.test(value)) return 'world_cue';
  if (/(^|[^a-z])chaos([^a-z]|$)/.test(value)) return 'chaos';
  return '';
}

/** 解析原始输出末尾的 <world_ack> 回执：容忍中英文冒号、pick/picked、skip/skipped、逗号/顿号分隔；
 *  给了 validIds 时过滤掉不在本轮事件池里的幻觉 id（pick 整条作废，skip 逐条丢弃）。
 *  既没 pick 也没 skip ＝ 没有可记录的挑选，返回 null。 */
export function extractWorldAck(raw: string, validIds?: ReadonlySet<string>, chatIdentity?: string | null): WorldAck | null {
  const block = extractTag(String(raw || ''), 'world_ack');
  if (!block) return null;
  const valid = validIds && validIds.size > 0 ? validIds : null;
  const accept = (id: string): boolean => !!id && (!valid || valid.has(id));
  let picked: WorldAckPick | null = null;
  const skipped: string[] = [];
  let skippedReason = '';
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*·]\s*/, '');
    if (!line) continue;
    const matched = line.match(/^(pick(?:ed)?|skip(?:ped)?)\s*[:：]\s*(.*)$/i);
    if (!matched) continue;
    const kind = matched[1].toLowerCase();
    const body = matched[2].trim();
    const fields = body.split(/[|｜]/).map((s) => s.trim());
    if (kind.startsWith('pick')) {
      const id = ackIds(fields[0])[0] || '';
      if (!accept(id)) continue; // 不在本轮事件池里的 id ＝ 幻觉，整条 pick 作废
      const targetTag = ackTargetTag(fields[1] || '') || ackTargetTag(body);
      const reason = (targetTag && fields.length > 2 ? fields.slice(2) : fields.slice(1)).join(' | ').trim();
      picked = { id, targetTag, reason };
      continue;
    }
    for (const id of ackIds(fields[0])) {
      if (!accept(id) || skipped.includes(id)) continue;
      skipped.push(id);
    }
    if (!skippedReason) skippedReason = fields.slice(1).join(' | ').trim();
  }
  if (!picked && skipped.length === 0) return null;
  return {
    version: 1,
    chatIdentity: String(chatIdentity || ''),
    picked,
    skippedIds: skipped,
    skippedReason,
  };
}

// ===== 前端投骰（数据库 `<random id=…>` + `$random:xxx` 的台账等价物） =====

/** 骰面上限（与数据库 `<random id="roll_bg" min="1" max="40" />` 一致）。 */
export const DICE_MAX_MAIN = 40;
/** 角色骰点个数（数据库 roll_char1~5；在场几个就取前几个）。 */
export const DICE_CHAR_COUNT = 5;
/** 走向分骰面上限（数据库 roll_fate 1-100）。 */
export const DICE_MAX_FATE = 100;

export interface DriverDice {
  /** 全局混沌骰点（1..DICE_MAX_MAIN）。 */
  rollBg: number;
  /** 角色骰点池（长度 DICE_CHAR_COUNT，各 1..DICE_MAX_MAIN）。 */
  rollChars: number[];
  /** 走向分骰点（1..DICE_MAX_FATE）。 */
  rollFate: number;
}

/** 投一轮骰（纯函数；rand 可注入以便测试与复现）。 */
export function rollDriverDice(rand: () => number = Math.random): DriverDice {
  const roll = (max: number): number => {
    const v = Math.floor(rand() * max) + 1;
    return v > max ? max : (v < 1 ? 1 : v);
  };
  return {
    rollBg: roll(DICE_MAX_MAIN),
    rollChars: Array.from({ length: DICE_CHAR_COUNT }, () => roll(DICE_MAX_MAIN)),
    rollFate: roll(DICE_MAX_FATE),
  };
}

// ===== 占位符求值 =====

export interface PlaceholderContext {
  /** {{本轮输入}} 本轮用户输入原文（任务段与最终指令模板通用）。 */
  userInput: string;
  /** 上轮推进（用户楼 sl_plot 回读＝最终指令全文）；固定块【上轮推进结果】的回落来源。 */
  lastPlot: string;
  /** 上轮推演**原始输出**（用户楼 sl_plot_tasks 聚合，缺则空）；固定块【上轮推进结果】的首选来源
   * ——标签没进最终指令模板时（如 <chaos_bg>/<chaos_char>）也能读到，值以它为准。 */
  lastPlotRaw?: string;
  /** 已有纪要（AMxxxx：概览 全量）；固定块【已有纪要】用。 */
  chronicleOverview: string;
  /** 上轮正文（最近 N 层 AI 回复，过主项目标签剥离）；固定块【上轮正文】用。 */
  recentStory: string;
  /** 匹配替换参数（{{意外倾向}} 等；缺省 1/1/1/1/25）。 */
  rates?: DriverRates;
  /** 本轮骰点（{{roll_bg}} / {{roll_charN}} / {{roll_fate}} 的取值来源；缺省则这些占位符原样保留）。 */
  dice?: DriverDice;
  /** 本轮在场与近期相关核心角色的心路与心境切片（block: 'mindBrief' 用；无数据则空）。 */
  mindBrief?: string;
  /** 当前聊天的版本化只读认知/候选副本；仅内置魔改预设消费，自定义预设不追加段。 */
  statusbarSnapshot?: StatusbarNarrativeSnapshot | null;
}

const MIND_BRIEF_MAX_CHARS_PER_ROLE = 6;
const MIND_BRIEF_CHAR_LIMIT = 750;

function mindTableColumnIndex(table: TableModel | undefined, name: string, fallback = 1): number {
  if (!table) return -1;
  const idx = table.headers.indexOf(name);
  if (idx >= 0) return idx;
  return fallback >= 0 && fallback < table.headers.length ? fallback : -1;
}

function collectCoreNamesFromTable(table: TableModel | undefined, colName = '姓名'): string[] {
  if (!table) return [];
  const colIdx = mindTableColumnIndex(table, colName, 1);
  if (colIdx < 0) return [];
  const out: string[] = [];
  const rowIds = [...table.rows.keys()].sort((a, b) => a - b);
  for (const rid of rowIds) {
    const val = String(table.rows.get(rid)?.[colIdx] ?? '').trim();
    if (val) out.push(val);
  }
  return out;
}

function countKeywordHits(text: string, keyword: string): number {
  if (!text || !keyword) return 0;
  let hits = 0;
  let pos = 0;
  while (true) {
    const idx = text.indexOf(keyword, pos);
    if (idx < 0) break;
    hits++;
    pos = idx + keyword.length;
  }
  return hits;
}

/** 构造推进器【角色心路与心境切片】块：从恋爱对象表/重要角色表筛选在场优先＋近期提及的最多 6 名核心角色，
 *  拼出「角色心路档案表」非空维度与最近 1~2 篇去标签「恋爱日记表」摘要（单人硬上限 ~750 字）；无数据时返回 ''。 */
export function buildMindBriefBlock(
  book: BookModel,
  presentNames: string[],
  recentStory: string,
  userInput: string,
): string {
  const protagonistNames = new Set(collectCoreNamesFromTable(resolveTable(book, '主角信息表'), '姓名'));
  const coreOrder: string[] = [];
  const coreSet = new Set<string>();
  for (const tblName of ['恋爱对象表', '重要角色表']) {
    for (const name of collectCoreNamesFromTable(resolveTable(book, tblName), '姓名')) {
      if (protagonistNames.has(name) || coreSet.has(name)) continue;
      coreSet.add(name);
      coreOrder.push(name);
    }
  }
  if (coreOrder.length === 0) return '';

  const selected: string[] = [];
  const selectedSet = new Set<string>();
  for (const raw of presentNames || []) {
    const name = String(raw || '').trim();
    if (!name || !coreSet.has(name) || selectedSet.has(name)) continue;
    selectedSet.add(name);
    selected.push(name);
    if (selected.length >= MIND_BRIEF_MAX_CHARS_PER_ROLE) break;
  }

  if (selected.length < MIND_BRIEF_MAX_CHARS_PER_ROLE) {
    const mentionSource = `${String(recentStory || '')}\n${String(userInput || '')}`;
    const rest: { name: string; hits: number; order: number }[] = [];
    for (let i = 0; i < coreOrder.length; i++) {
      const name = coreOrder[i];
      if (selectedSet.has(name)) continue;
      const hits = countKeywordHits(mentionSource, name);
      if (hits > 0) rest.push({ name, hits, order: i });
    }
    rest.sort((a, b) => (b.hits !== a.hits ? b.hits - a.hits : a.order - b.order));
    for (const item of rest) {
      selectedSet.add(item.name);
      selected.push(item.name);
      if (selected.length >= MIND_BRIEF_MAX_CHARS_PER_ROLE) break;
    }
  }
  if (selected.length === 0) return '';

  const mindTable = resolveTable(book, 'sheet_char_mind_profile') || resolveTable(book, '角色心路档案表');
  const diaryTable = resolveTable(book, '恋爱日记表');
  const mindNameIdx = mindTableColumnIndex(mindTable, '姓名', 1);
  const diaryWriterIdx = mindTableColumnIndex(diaryTable, '写作角色', 1);
  const diaryRelIdx = diaryTable ? diaryTable.headers.indexOf('关联角色') : -1;
  const diaryBodyIdx = diaryTable ? diaryTable.headers.indexOf('日记内容') : -1;
  const diaryTimeIdx = diaryTable ? diaryTable.headers.indexOf('发生时间') : -1;
  const diaryTypeIdx = diaryTable ? diaryTable.headers.indexOf('事件类型') : -1;

  const charBlocks: string[] = [];
  for (const name of selected) {
    const profileLines: string[] = [];
    if (mindTable && mindNameIdx >= 0) {
      const rowIds = [...mindTable.rows.keys()].sort((a, b) => a - b);
      for (const rid of rowIds) {
        const cells = mindTable.rows.get(rid);
        if (!cells || String(cells[mindNameIdx] ?? '').trim() !== name) continue;
        for (let ci = 1; ci < mindTable.headers.length; ci++) {
          if (ci === mindNameIdx) continue;
          const header = String(mindTable.headers[ci] || '').trim();
          const val = String(cells[ci] ?? '').trim();
          if (header && val) {
            const line = `- ${header}：${val}`;
            profileLines.push(line.length > 220 ? line.slice(0, 219) + '…' : line);
          }
        }
        break;
      }
    }
    const diaryLines: string[] = [];
    if (diaryTable && diaryWriterIdx >= 0 && diaryBodyIdx >= 0) {
      const entries: string[] = [];
      const rowIds = [...diaryTable.rows.keys()].sort((a, b) => a - b);
      for (const rid of rowIds) {
        const cells = diaryTable.rows.get(rid);
        if (!cells || String(cells[diaryWriterIdx] ?? '').trim() !== name) continue;
        const body = String(cells[diaryBodyIdx] ?? '').replace(/<\/?span\b[^>]*>/gi, '').trim();
        if (!body) continue;
        const t = diaryTimeIdx >= 0 ? String(cells[diaryTimeIdx] ?? '').trim() : '';
        const et = diaryTypeIdx >= 0 ? String(cells[diaryTypeIdx] ?? '').trim() : '';
        const rel = diaryRelIdx >= 0 ? String(cells[diaryRelIdx] ?? '').trim() : '';
        const meta = [t, et, rel ? `关联:${rel}` : ''].filter(Boolean).join(' · ');
        const line = meta ? `- [日记 ${meta}] ${body}` : `- [日记] ${body}`;
        entries.push(line.length > 220 ? line.slice(0, 219) + '…' : line);
      }
      diaryLines.push(...entries.slice(-2));
    }
    const allLines = [...profileLines, ...diaryLines];
    if (allLines.length === 0) continue;
    let block = `【${name}】\n${allLines.join('\n')}`;
    if (block.length > MIND_BRIEF_CHAR_LIMIT) {
      const diaryPart = diaryLines.join('\n');
      const header = `【${name}】\n`;
      if (diaryPart && diaryPart.length < MIND_BRIEF_CHAR_LIMIT - header.length - 80) {
        const profileBudget = MIND_BRIEF_CHAR_LIMIT - header.length - diaryPart.length - 2;
        const profilePart = profileLines.join('\n');
        const clippedProfile = profilePart.length > profileBudget
          ? profilePart.slice(0, Math.max(0, profileBudget - 1)) + '…'
          : profilePart;
        block = header + (clippedProfile ? `${clippedProfile}\n${diaryPart}` : diaryPart);
      }
      if (block.length > MIND_BRIEF_CHAR_LIMIT) {
        block = block.slice(0, MIND_BRIEF_CHAR_LIMIT - 1) + '…';
      }
    }
    charBlocks.push(block);
  }
  if (charBlocks.length === 0) return '';
  return [
    '【角色心路与心境切片】',
    '以下为本轮在场及近期相关核心角色的心路档案与主观日记切片（仅供推演各自真实视角，严禁让未获知情方偷窥他人心路）：',
    '',
    charBlocks.join('\n\n'),
  ].join('\n');
}

/** 占位符表：{{本轮输入}} / {{意外倾向}} … / {{roll_bg}} {{roll_char1..5}} {{roll_fate}}。 */
export function placeholderMap(ctx: PlaceholderContext): Record<string, string> {
  const rates = normalizeRates(ctx.rates);
  const map: Record<string, string> = {
    '意外倾向': String(rates.rateMain),
    '意外频率': String(rates.ratePersonal),
    '主动频率': String(rates.rateErotic),
    '氛围频率': String(rates.rateCuckold),
    '召回数量': String(rates.recallCount),
    '本轮输入': String(ctx.userInput ?? ''),
  };
  if (ctx.dice) {
    map['roll_bg'] = String(ctx.dice.rollBg);
    ctx.dice.rollChars.forEach((v, i) => { map[`roll_char${i + 1}`] = String(v); });
    map['roll_fate'] = String(ctx.dice.rollFate);
  }
  return map;
}

/** 求值 {{…}} 占位符（不认识的花括号内容原样保留）。 */
export function renderPlaceholders(text: string, ctx: PlaceholderContext): string {
  const map = placeholderMap(ctx);
  return String(text || '').replace(/\{\{([^{}]+)\}\}/g, (m, key) => {
    const name = String(key).trim();
    return name in map ? map[name] : m;
  });
}

const THINKING_SHELL_TAGS = ['thinking', 'think', 'reasoning', 'reflection', 'deep_thinking', 'deep_think', 'dream_think', 'thought'];

/** 剥除思维链外壳：先用状态栏同款栈式剥离清掉完整思考块，再切除前导孤儿 </thinking> / </think>（防预填漏开标签）。 */
function stripThinkingForTagExtract(raw: string, targetTag: string): string {
  let s = String(raw || '');
  if (!s) return '';
  if (THINKING_SHELL_TAGS.includes(String(targetTag || '').trim().toLowerCase())) return s;
  s = stripContextTags(s, THINKING_SHELL_TAGS);
  // 若文本里已无开标签但仍留有 </thinking> / </think>（如上游预填了开标签），只取最后一个闭合思考标签之后的部分
  if (!/<(?:thinking|think)(?=[\s/>])[^<>]*>/i.test(s)) {
    const closeRe = /<\/(?:thinking|think)\s*>/gi;
    let lastEnd = -1;
    let cm: RegExpExecArray | null;
    while ((cm = closeRe.exec(s)) !== null) lastEnd = cm.index + cm[0].length;
    if (lastEnd >= 0) s = s.slice(lastEnd);
  }
  return s;
}

/** 标签提取：先剥思维链，再为每个 </tag> 配对前面最近的 <tag>（防未闭合顺嘴提及吞掉后续段落），取最后一次出现。 */
export function extractTag(raw: string, tag: string): string {
  const name = String(tag || '').trim();
  if (!name) return '';
  const s = stripThinkingForTagExtract(raw, name);
  const open = `<${name}>`;
  const close = `</${name}>`;
  let from = 0;
  let last = '';
  while (true) {
    const closeIdx = s.indexOf(close, from);
    if (closeIdx < 0) break;
    if (closeIdx > from) {
      const openIdx = s.lastIndexOf(open, closeIdx - 1);
      if (openIdx >= from) last = s.slice(openIdx + open.length, closeIdx).trim();
    }
    from = closeIdx + close.length;
  }
  return last;
}

/** world_cue 占位词归空：若推进 AI 把“留空/无/跳过”写进标签里，按空处理，不污染正文指令。 */
function normalizeWorldCueContent(content: string): string {
  const t = String(content || '').trim();
  if (!t) return '';
  if (/^[（(\[]?(?:留空|空|无|略|跳过|不触发|未触发|不需要|无需|none|null|n\/a|-|—)[）)\]。.！!]*$/i.test(t)) return '';
  return t;
}

/** 已有纪要（资料块【已有纪要】）：纪要表「编码索引 + 概览/概要」两列全量，格式 `AM0001：概览内容`。 */
export function buildChronicleOverview(summaryTable: { headers: string[]; rows: Map<number, string[]> } | null | undefined): string {
  if (!summaryTable || !summaryTable.headers || summaryTable.headers.length === 0) return '（未找到纪要表）';
  const headers = summaryTable.headers;
  const summaryIdx = headers.findIndex((col) => col === '概览' || col === '概要');
  const codeIdx = headers.findIndex((col) => col === '编码索引');
  if (summaryIdx < 0 || codeIdx < 0) return '（纪要表缺少概览/概要或编码索引列）';
  if (summaryTable.rows.size === 0) return '（纪要表为空）';
  const lines: string[] = [];
  for (const rowId of [...summaryTable.rows.keys()].sort((a, b) => a - b)) {
    const cells = summaryTable.rows.get(rowId)!;
    const code = String(cells[codeIdx] ?? '').trim();
    const summary = String(cells[summaryIdx] ?? '').trim();
    if (!code && !summary) continue;
    lines.push(`${code || `row${rowId}`}：${summary}`);
  }
  return lines.join('\n');
}

// ===== 触发判定（纯函数 + 状态由闭包持有） =====

export const USER_SEND_TTL_MS = 12000;
export const DEDUP_WINDOW_MS = 5000;

export interface TriggerGateState {
  lastIntentAt: number;
  lastIntercept: { text: string; ts: number };
}

export function markIntercept(state: TriggerGateState, text: string, now: number): void {
  state.lastIntercept = { text: String(text || ''), ts: now };
}

export function shouldSkipIntercept(state: TriggerGateState, text: string, now: number, windowMs = DEDUP_WINDOW_MS): boolean {
  const t = String(text || '');
  if (!t) return false;
  const age = now - (state.lastIntercept?.ts || 0);
  if (age < 0 || age > windowMs) return false;
  return t === String(state.lastIntercept?.text || '');
}

/** 触发总判定：开关 + 非静默 + 非自动 + 非再生 + 新鲜回合（12s TTL）。 */
export function shouldProcessPlot(deps: {
  enabled: boolean;
  type: string | undefined;
  params: any;
  dryRun: boolean | undefined;
  lastIntentAt: number;
  now: number;
}): boolean {
  if (!deps.enabled) return false;
  if (deps.dryRun) return false;
  const type = String(deps.type || '');
  if (type === 'regenerate') return false;
  const params = deps.params || {};
  if (params.automatic_trigger) return false;
  if (type === 'quiet' || (typeof params.quiet_prompt === 'string' && params.quiet_prompt.trim())) return false;
  if (!deps.lastIntentAt) return false;
  return deps.now - deps.lastIntentAt <= USER_SEND_TTL_MS;
}

/** 自产文本判定：消息带 sl_plot 字段=台账自产（该楼不算新鲜用户回合）。 */
export function isSelfProduced(message: any): boolean {
  if (!message) return false;
  if (message.is_user !== true) return false;
  return typeof message[SL_PLOT_FIELD] === 'string' && String(message[SL_PLOT_FIELD]).length > 0;
}

// ===== 最终指令组装（单任务） =====

export interface AssembleInput {
  preset: DriverPreset;
  userInput: string;
  /** 本次请求的原始输出（标签从这里摘取）。 */
  raw: string;
}

/** 正则元字符转义（标签名进动态正则需要）。 */
function escapeRegExp(text: string): string {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 组装最终指令（替换用户消息的文本）：{{本轮输入}} 原文；{{标签}} → `<标签>内容</标签>`。
 * 标签内容缺失/为空 → 占位符整体消失（独占一行时连空行一并去掉）；模板里没写占位符的标签不输出。
 */
export function assembleFinalDirective(input: AssembleInput): string {
  const { preset, userInput, raw } = input;
  let out = String(preset.finalDirectiveTemplate || '').split('{{本轮输入}}').join(userInput);
  for (const tag of splitTags(preset.tags)) {
    const rawContent = extractTag(raw, tag);
    const content = (tag === 'world_cue' || tag === 'radar') ? normalizeWorldCueContent(rawContent) : rawContent;
    if (content) {
      out = out.split(`{{${tag}}}`).join(`<${tag}>${content}</${tag}>`);
      continue;
    }
    // 空占位：连它独占的那一行一起去掉（模板里 {{world_cue}} 多数轮次为空，不能留出多余空行）
    out = out.replace(new RegExp(`^[\\t ]*\\{\\{${escapeRegExp(tag)}\\}\\}[\\t ]*(?:\\r?\\n|$)`, 'gm'), '');
    out = out.split(`{{${tag}}}`).join('');
  }
  return out;
}

// ===== 预设：内置目录（魔改召回 / 极速纯召回） =====
//
// 内置两份预设＝**随台账发货的资产文件**（`assets/plot-preset-*.json`，与「导出预设」同一格式，
// 换代＝换文件、内容逐字不改；载入只做「形状归一 + 覆写定名」两件事）：
//   · plot-preset-magic-recall.json ＝《灵感魔改召回》的台账移植：六段文本照搬 + 标签适配——
//     $8→{{本轮输入}}；$5→资料块（【已有纪要】）；$7→上下文块（【上轮正文】＋【当前输入】）；
//     $U/$C/$1→参考资料块（【参考资料】）；sulv1/2/3→{{意外倾向}}/{{意外频率}}/{{主动频率}}；zhaohui→{{召回数量}}；
//     $random:roll_bg / roll_char1~5 / roll_fate→{{roll_bg}} / {{roll_char1..5}} / {{roll_fate}}（**值由前端投真骰**）；
//     {{chaos_bg}}/{{chaos_char}}→【上轮推进结果】块（本轮照旧输出这两个标签 → 最终指令模板占位 →
//     落用户楼 → 下一轮由该块只提取勾选的 chaos_bg/chaos_char 读回）；spot 段的 {[db.杂表.where('名称','已探索地点概览').get('描述')]}→表数据块。
//   · plot-preset-pure-recall.json ＝只保留「穷举全部 AM → 按相关性挑选 → 输出 match/recall」
//     （固定块＝参考资料块*（默认隐藏、一键可开）+ 纪要 + 正文/输入；不需要上轮推进结果块与表数据块）。
// 定名（BUILTIN_PRESET_NAMES）是外部契约：设置的 driverPresetName / 工作台下拉都按名取内置，
// 故资产文件名里的「改」字样不进下拉名（覆写成内置定名，文件本身不动）。

/** 内置预设名（工作台下拉里的固定项：不可覆盖、不可删除）。 */
export const BUILTIN_PRESET_NAMES: readonly string[] = ['魔改召回', '极速纯召回'];

/** 缺省预设名（未选 / 被删时回落；＝内置第一项）。 */
export const DEFAULT_PRESET_NAME = BUILTIN_PRESET_NAMES[0];

/** 状态栏后台事件桥是否启用：显式 true/false 优先；缺省按旧口径自动判定
 *  （内置魔改召回，或最终指令模板已占位 {{world_cue}}）。 */
export function isStatusbarBridgeEnabled(preset: DriverPreset | null | undefined): boolean {
  if (!preset) return false;
  if (preset.statusbarBridge === true) return true;
  if (preset.statusbarBridge === false) return false;
  return preset.name === BUILTIN_PRESET_NAMES[0]
    || String(preset.finalDirectiveTemplate || '').includes('{{world_cue}}');
}

/** 资产文件外壳（＝导出格式 `{format,schemaVersion,preset}`）；无外壳时按裸预设读。 */
interface PlotPresetAssetFile { format?: string; schemaVersion?: number; preset?: unknown }

/** 资产 → 归一化预设（形状不合法 → null：内置目录宁可少一项，也不让装载崩）。 */
function loadPresetAsset(file: unknown, name: string): DriverPreset | null {
  const wrapper = (file || {}) as PlotPresetAssetFile;
  const raw = wrapper.preset && typeof wrapper.preset === 'object' ? wrapper.preset : wrapper;
  const preset = normalizeDriverPreset(raw);
  if (!preset) return null;
  preset.name = name;
  return preset;
}

const MAGIC_PRESET_ASSET = loadPresetAsset(magicRecallAsset, '魔改召回');
const PURE_PRESET_ASSET = loadPresetAsset(pureRecallAsset, '极速纯召回');

/** 资产副本（面板编辑器会就地改拿到的预设对象：每次给新对象，不污染资产本体）。 */
function cloneBuiltin(asset: DriverPreset | null, name: string): DriverPreset {
  if (!asset) {
    // 资产读坏（构建期问题）兜底：装载不崩、界面能看见「空预设」，runPlanningRequest 因 promptGroup 为空直接判失败
    return {
      name, systemPrompt: '', contextTurnCount: 3, minLength: 0, maxRetries: 1,
      tags: '', promptGroup: [], finalDirectiveTemplate: '{{本轮输入}}',
    };
  }
  return {
    ...asset,
    promptGroup: asset.promptGroup.map((m) => ({
      ...m,
      ...(m.table ? { table: { ...m.table } } : {}),
      ...(m.tags ? { tags: [...m.tags] } : {}),
    })),
    ...(asset.rates ? { rates: { ...asset.rates } } : {}),
  };
}

/** 按名字取内置预设（非内置名 → null）。 */
export function builtinDriverPreset(name: string): DriverPreset | null {
  if (name === '魔改召回') return cloneBuiltin(MAGIC_PRESET_ASSET, '魔改召回');
  if (name === '极速纯召回') return cloneBuiltin(PURE_PRESET_ASSET, '极速纯召回');
  return null;
}

/** 缺省内置（未选预设 / 预设丢失时的兜底）＝魔改召回。 */
export function defaultDriverPreset(): DriverPreset {
  return builtinDriverPreset(DEFAULT_PRESET_NAME)!;
}

// ===== 规划执行（单任务：一次请求 + 重试 + minLength） =====

export interface DirectorTaskRequest {
  /** 结构头任务段（预设 systemPrompt；留空则只有破限头内建文本）。 */
  task: string;
  items: LedgerPromptItem[];
  blocks: LedgerBlockContents;
  /** 触发注入素材＝上轮正文 ＋ 本轮输入（只喂绿灯扫描，不进提示词）。 */
  scanText: string;
  /** 状态栏已自行投影「世界演化-世界动态」时=true：扫描钩一并暂停该条目，防与尾部事件池重复喂料。 */
  suspendWorldDigest?: boolean;
}

export interface DirectorRequestDeps {
  requestTask(spec: DirectorTaskRequest, opts?: { signal?: AbortSignal }): Promise<string>;
  /** 表数据块取值（读当前账本；缺省＝该块不出条）。 */
  resolveTableBlock?(cfg: LedgerTableBlockConfig): string;
  /** 请求异常原文上报（工作台日志用；缺省不报）。调用方拿完整错误对象自己格式化。 */
  onRequestError?(error: unknown, attempt: number, maxAttempts: number): void;
}

/** 单标签取值：**优先上轮原始输出**（sl_plot_tasks 聚合），取不到回落最终指令（sl_plot）。
 * 原始输出是「推演结果」的真源——标签没写进最终指令模板时（如混沌计数）也要读得到；块求值与面板预览共用。 */
export function pickPrevTagContent(tag: string, raw: string | undefined, assembled: string | undefined): string {
  return extractTag(raw || '', tag) || extractTag(assembled || '', tag);
}

/** 上轮推进结果块正文：只提取块项勾选的标签（与最终指令同一包裹形态）；无内容＝该块不出条。 */
export function buildPrevDirectiveText(ctx: PlaceholderContext, tags: string[] | undefined): string {
  const picked: string[] = [];
  for (const tag of tags || []) {
    const content = pickPrevTagContent(tag, ctx.lastPlotRaw, ctx.lastPlot);
    if (content) picked.push(`<${tag}>${content}</${tag}>`);
  }
  const body = picked.join('\n\n').trim();
  return body ? '【上轮推进结果】\n\n' + body : '';
}

/** 由预设的提示词段列表构建内容项：block 项→固定块（表数据/上轮结果块就地求值成 system 段）；普通段→渲染占位符（含骰点）；hidden 项跳过。 */
export function buildPromptItems(preset: DriverPreset, ctx: PlaceholderContext, deps: Pick<DirectorRequestDeps, 'resolveTableBlock'> = {}): LedgerPromptItem[] {
  const items: LedgerPromptItem[] = [];
  for (const m of preset.promptGroup) {
    if (m.hidden === true) continue;
    if (m.block) {
      if (m.block === 'tableData') {
        const text = String(deps.resolveTableBlock?.(m.table || { table: '' }) || '').trim();
        if (text) items.push({ kind: 'segment', role: 'system', content: text });
        continue;
      }
      if (m.block === 'prevDirective') {
        const text = buildPrevDirectiveText(ctx, m.tags);
        if (text) items.push({ kind: 'segment', role: 'system', content: text });
        continue;
      }
      items.push({ kind: 'block', block: m.block });
      continue;
    }
    const content = renderPlaceholders(String(m.content ?? ''), ctx);
    if (!content.trim()) continue;
    items.push({ kind: 'segment', role: String(m.role || 'user'), content });
  }
  return items;
}

/** 内容块正文（四固定块；缺内容即整块不出）。抬头与功能说明都由此拼（块展开只透传正文，见 core/ai-request.ts）。
 * prevDirective 在此＝上轮最终指令全文（通用兜底）；推进路径的「只提取勾选标签」在 buildPromptItems 就地 materialize。 */
export function buildPromptBlocks(ctx: PlaceholderContext): LedgerBlockContents {
  const overview = String(ctx.chronicleOverview || '').trim();
  const recent = String(ctx.recentStory || '').trim();
  const userInput = String(ctx.userInput || '').trim();
  const contextParts: string[] = [];
  if (recent) contextParts.push('【上轮正文】\n\n' + recent);
  if (userInput) contextParts.push('【当前输入】\n\n' + userInput);
  return {
    dossier: overview ? '【已有纪要】\n\n' + overview : '',
    context: contextParts.join('\n\n'),
    mindBrief: String(ctx.mindBrief || '').trim(),
    prevDirective: String(ctx.lastPlot || '').trim(),
    scan: '下面为与本轮推演相关的世界观、人物与设定条目（世界书条目里关键词命中的参考资料＋当前角色卡设定：用户人设 / 角色卡描述 / 角色性格 / 场景 / 示例对话），供理解既有设定用。',
  };
}

/** 触发注入素材：上轮正文 ＋ 本轮输入（不含推进结果/附加资料）。 */
export function buildPromptScanText(ctx: PlaceholderContext): string {
  return [String(ctx.recentStory || '').trim(), String(ctx.userInput || '').trim()].filter(Boolean).join('\n\n');
}

/** 执行预设的请求：空回复 / 请求异常 / 输出总长度不足均重试。
 *  返回最后一次原始输出与失败清单；`errors` 非空＝重试耗尽或未成功（调用方判为失败，不再降级继续）；
 *  中止时输出为空串（errors 也为空，由调用方按 signal 处理）。 */
export async function runPlanningRequest(
  preset: DriverPreset,
  ctx: PlaceholderContext,
  deps: DirectorRequestDeps,
  signal?: AbortSignal,
): Promise<{ raw: string; errors: string[] }> {
  const errors: string[] = [];
  const aborted = { raw: '', errors: [] as string[] };
  if (preset.promptGroup.length === 0) {
    errors.push('预设没有可发送的提示词段');
    return { raw: '', errors };
  }
  const blocks = buildPromptBlocks(ctx);
  const scanText = buildPromptScanText(ctx);
  const items = buildPromptItems(preset, ctx, { resolveTableBlock: deps.resolveTableBlock });
  // 状态栏桥只对声明了 bridge 的预设生效（内置魔改召回 / 模板含 {{world_cue}} / 显式勾选）；
  // 不改预设 schema，也不给用户自定义预设暗中追加提示段。
  if (isStatusbarBridgeEnabled(preset) && ctx.statusbarSnapshot) {
    const snapshot = ctx.statusbarSnapshot;
    items.push({ kind: 'segment', role: 'system', content: buildStatusbarCognitionPrompt(snapshot) });
    const events = buildStatusbarCandidatePrompt(snapshot);
    if (events) items.push({ kind: 'segment', role: 'system', content: events });
  }
  const task: DirectorTaskRequest = {
    task: String(preset.systemPrompt || ''),
    items,
    blocks,
    scanText,
    ...(ctx.statusbarSnapshot ? { suspendWorldDigest: Boolean(ctx.statusbarSnapshot.worldbookDelegated) } : {}),
  };
  const min = Math.max(preset.minLength, 0);
  const maxRetries = Math.max(0, preset.maxRetries);
  let last = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) return aborted;
    try {
      const raw = await deps.requestTask(task, { signal });
      last = String(raw || '').trim();
      if (!last) {
        errors.push(`AI 返回空回复（第 ${attempt + 1}/${maxRetries + 1} 次）`);
        continue;
      }
      // minLength 校验：按 AI 原始输出整段长度判定（不逐标签）
      if (min > 0 && last.length < min) {
        errors.push(`回复长度不足（${last.length}/${min}，第 ${attempt + 1}/${maxRetries + 1} 次）`);
        continue;
      }
      return { raw: last, errors: [] };
    } catch (e) {
      if (signal?.aborted) return aborted;
      // 请求级异常单独上报完整原文（状态码/响应体/原因/堆栈）；errors 里仍只留单行摘要给 toast。
      deps.onRequestError?.(e, attempt + 1, maxRetries + 1);
      errors.push(`AI 请求失败：${describeErrorSummary(e)}（第 ${attempt + 1}/${maxRetries + 1} 次）`);
    }
  }
  return { raw: last, errors };
}

/** 读取用户楼推演**原始输出**（sl_plot_tasks 聚合；缺则空）——【上轮推进结果】块的首选来源。 */
export function readPlotRawFromMessage(message: any): string {
  const tasks = message?.[SL_PLOT_TASKS_FIELD];
  if (tasks && typeof tasks === 'object') {
    const joined = Object.entries(tasks).map(([id, raw]) => `【${id}】\n${String(raw)}`).join('\n\n');
    if (joined.trim()) return joined;
  }
  return '';
}

/** 读取用户楼推进文本：sl_plot 优先，缺失读 sl_plot_tasks（原始输出仍是可靠来源）。 */
export function readPlotFromMessage(message: any): string {
  if (!message) return '';
  const sl = message[SL_PLOT_FIELD];
  if (typeof sl === 'string' && sl.trim()) return sl;
  return readPlotRawFromMessage(message);
}
