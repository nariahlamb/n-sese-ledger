// ===== 剧情推进正则：面板模板 + 三条正则脚本定义（两条显示、一条提示词） =====
//
// 单一事实源：本文件的面板 HTML/CSS/JS（日间奶油手账 + 夜间 TokyoNight Storm）。
// 正则替换串里用 $1 = <本轮用户输入> 内文、$2 = 其后全部（recall/soul/chaos/world_cue/spot 标签）。
// 面板只读：纪要走 SeseLedgerAPI.query；重置走 SeseLedgerAPI.driver.resetRound；
// 人物/地点分别走状态栏 __ub_showCharacterHub / __ub_showMapForLocation。
// 性能：不轮询、不常驻监听；纪要点击才查、按面板会话缓存；主题只在加载时读一次宿主正文色。

export interface PlotRegexScript {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: number[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  substituteRegex: number;
  minDepth: number | null;
  maxDepth: number | null;
}

/** 酒馆正则面板可见的脚本名前缀（归属锚点：查重/撤除都以它认领）。 */
export const PLOT_REGEX_PREFIX = '【瑟瑟台账】';
export const PLOT_PANEL_SCRIPT_NAME = PLOT_REGEX_PREFIX + '剧情推进·面板';
export const PLOT_HIDE_SCRIPT_NAME = PLOT_REGEX_PREFIX + '剧情推进·隐藏历史';
export const PLOT_PROMPT_STRIP_SCRIPT_NAME = PLOT_REGEX_PREFIX + '剧情推进·历史只留输入';

/** 面板：整条用户楼 → 面板 HTML（display only；maxDepth 1＝只美化最新用户楼）。 */
const PANEL_FIND = '/^[\\s\\S]*?<本轮用户输入>([\\s\\S]*?)<\\/本轮用户输入>([\\s\\S]*)$/';
/** 历史：更早的台账用户楼整条替换为空（display only；不删提示词历史）。 */
const HIDE_FIND = '/^[\\s\\S]*<本轮用户输入>[\\s\\S]*<\\/本轮用户输入>[\\s\\S]*$/';
/** 提示词：更早的台账用户楼只保留 <本轮用户输入> 内文，去掉召回/soul/chaos/world_cue/spot 等当轮指令。
 *  宿主提示词深度：末楼=0（续写时末楼=-1、其前用户楼=0；swipe 先弹出待重写楼），故 minDepth 1
 *  恒保留本轮用户楼。世界书扫描读的也是正则后的历史，旧楼 <recall> 不再重复触发纪要条目。 */
const PROMPT_STRIP_FIND = '/^[\\s\\S]*?<本轮用户输入>\\n?([\\s\\S]*?)\\n?<\\/本轮用户输入>[\\s\\S]*$/';

export const PLOT_PANEL_HTML = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }

  /* 夜间默认：TokyoNight Storm */
  .slp {
    --slp-bg: rgba(36, 40, 59, .97);
    --slp-surface: rgba(31, 35, 53, .92);
    --slp-soft: rgba(41, 46, 66, .88);
    --slp-fg: #c0caf5;
    --slp-fg-soft: #a9b1d6;
    --slp-muted: #787c99;
    --slp-line: rgba(86, 95, 137, .40);
    --slp-border: rgba(122, 162, 247, .28);
    --slp-accent: #7aa2f7;
    --slp-accent-soft: rgba(122, 162, 247, .14);
    --slp-cue: #bb9af7;
    --slp-cue-soft: rgba(187, 154, 247, .14);
    --slp-warn: #e0af68;
    --slp-danger: #f7768e;
    --slp-danger-soft: rgba(247, 118, 142, .14);
    --slp-ok: #9ece6a;
    --slp-shadow: 0 8px 26px rgba(15, 18, 30, .42);
    width: 100%; max-width: 740px; margin: 0 auto;
    color: var(--slp-fg);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.8;
    border: 1px solid var(--slp-border);
    border-radius: 12px;
    background: var(--slp-bg);
    box-shadow: var(--slp-shadow);
    padding: 14px 18px 15px;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  /* 日间：奶油手账（对齐台账工作台 .slw-theme-light） */
  .slp.light {
    --slp-bg: #f7f1e6;
    --slp-surface: #fffaf1;
    --slp-soft: #f3ead9;
    --slp-fg: #4a3f36;
    --slp-fg-soft: #6a5a4c;
    --slp-muted: #8a7a6a;
    --slp-line: #e2d5c0;
    --slp-border: #d9c8ad;
    --slp-accent: #b9586c;
    --slp-accent-soft: rgba(232, 165, 176, .22);
    --slp-cue: #4b7ba8;
    --slp-cue-soft: rgba(75, 123, 168, .12);
    --slp-warn: #8f6a1f;
    --slp-danger: #c0565a;
    --slp-danger-soft: rgba(192, 86, 90, .12);
    --slp-ok: #5f8f5a;
    --slp-shadow: 0 6px 20px rgba(120, 90, 60, .14);
    background-color: var(--slp-bg);
    background-image:
      linear-gradient(rgba(180, 150, 110, .07) 1px, transparent 1px),
      linear-gradient(90deg, rgba(180, 150, 110, .07) 1px, transparent 1px);
    background-size: 18px 18px;
    border-width: 1.5px;
  }

  .slp-head { padding: 1px 1px 13px; border-bottom: 1px solid var(--slp-line); }
  .slp.light .slp-head { border-bottom-style: dashed; border-bottom-width: 1.5px; }
  .slp-head-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
  .slp-kicker {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 10px; letter-spacing: 1.8px; line-height: 1;
    color: var(--slp-muted);
  }
  .slp-pill {
    display: inline-flex; align-items: center; gap: 4px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 9px; letter-spacing: .8px; line-height: 1.4;
    padding: 1px 6px; border-radius: 999px;
    border: 1px solid var(--slp-line);
    background: var(--slp-soft);
    color: var(--slp-fg-soft);
  }
  .slp-pill.nsfw {
    border-color: var(--slp-danger);
    background: var(--slp-danger-soft);
    color: var(--slp-danger);
    font-weight: 600;
  }
  .slp-pill.cue {
    border-color: var(--slp-cue);
    background: var(--slp-cue-soft);
    color: var(--slp-cue);
  }
  .slp-pill.ok {
    border-color: var(--slp-ok);
    color: var(--slp-ok);
  }
  .slp-tools { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; }
  .slp-tool {
    appearance: none; border: 1px solid transparent; background: transparent; color: var(--slp-muted);
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 10px; letter-spacing: .5px; line-height: 1;
    padding: 4px 7px; border-radius: 999px; cursor: pointer;
    display: inline-flex; align-items: center; gap: 5px;
    transition: color .14s ease, border-color .14s ease, background .14s ease;
  }
  .slp-tool:hover { color: var(--slp-accent); border-color: var(--slp-line); background: var(--slp-soft); }
  .slp-tool:disabled { opacity: .35; cursor: default; }
  .slp-tool.armed { color: var(--slp-danger); border-color: var(--slp-danger); background: var(--slp-danger-soft); }
  .slp-tool-sep { font-size: 9px; color: var(--slp-line); padding: 0; }
  .slp-input {
    white-space: pre-wrap; word-break: break-word;
    font-size: 14.5px; line-height: 1.88; letter-spacing: .2px;
    padding: 4px 0 4px 12px;
    border-left: 2.5px solid var(--slp-accent);
    color: var(--slp-fg);
  }

  .slp-main { display: flex; align-items: flex-start; padding-top: 13px; }

  .slp-rail {
    flex: 0 0 116px; align-self: stretch;
    display: flex; flex-direction: column; gap: 3px;
    padding: 0 13px 0 1px;
    border-right: 1px solid var(--slp-line);
    margin-right: 17px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .slp.light .slp-rail { border-right-style: dashed; border-right-width: 1.5px; }
  .slp-rail::-webkit-scrollbar { display: none; }
  .slp-tab {
    appearance: none; border: 1px solid transparent; background: transparent; color: var(--slp-muted);
    font: inherit; text-align: left; cursor: pointer;
    display: flex; align-items: center; gap: 7px;
    padding: 7px 9px; border-radius: 7px;
    transition: color .14s ease, background .14s ease, border-color .14s ease;
  }
  .slp-tab:hover { color: var(--slp-fg); background: var(--slp-soft); }
  .slp-tab.on {
    color: var(--slp-accent);
    background: var(--slp-accent-soft);
    border-color: var(--slp-border);
    box-shadow: inset 2.5px 0 0 var(--slp-accent);
    font-weight: 600;
  }
  .slp-tab .num {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 9.5px; letter-spacing: 0; opacity: .68;
  }
  .slp-tab .lab { font-size: 12.5px; letter-spacing: 1px; }
  .slp-tab .cnt {
    margin-left: auto;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 9.5px; opacity: .72;
  }
  .slp-badge {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    min-width: 14px; height: 14px; padding: 0 4px;
    border: 1px solid var(--slp-accent);
    border-radius: 999px;
    background: var(--slp-accent-soft);
    color: var(--slp-accent);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 8.5px; line-height: 1; font-weight: 600;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
  .slp-tool .slp-badge {
    height: 13px; min-width: 13px;
    font-size: 8px; padding: 0 3px;
  }

  .slp-view { flex: 1; min-width: 0; padding-bottom: 2px; }
  .slp-sec-hd {
    display: flex; align-items: center; gap: 8px;
    padding: 0 1px 8px; margin-bottom: 10px;
    border-bottom: 1px solid var(--slp-line);
  }
  .slp.light .slp-sec-hd { border-bottom-style: dashed; border-bottom-width: 1.5px; }
  .slp-sec-title {
    font-size: 12.5px; letter-spacing: 1.4px; font-weight: 600;
    color: var(--slp-fg);
    display: inline-flex; align-items: center; gap: 6px;
  }
  .slp-sec-title::before {
    content: ""; width: 6px; height: 6px; border-radius: 50%;
    background: var(--slp-accent); display: inline-block;
  }
  .slp-sec-count {
    margin-left: auto;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 10px; color: var(--slp-muted);
  }

  /* 召回 */
  .slp-ams {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(94px, 1fr));
    gap: 6px;
  }
  .slp-am {
    appearance: none; border: 1px solid var(--slp-line); border-radius: 6px;
    background: var(--slp-surface); color: var(--slp-fg-soft); cursor: pointer;
    display: flex; align-items: center; gap: 7px;
    padding: 8px 9px; line-height: 1;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 10.5px; letter-spacing: 0;
    transition: color .14s ease, border-color .14s ease, background .14s ease;
  }
  .slp-am .dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--slp-muted); opacity: .45; flex: 0 0 auto;
    transition: opacity .14s ease, background .14s ease;
  }
  .slp-am:hover { color: var(--slp-fg); border-color: var(--slp-border); background: var(--slp-soft); }
  .slp-am:hover .dot { opacity: .85; background: var(--slp-accent); }
  .slp-am.on { color: var(--slp-accent); border-color: var(--slp-accent); background: var(--slp-accent-soft); font-weight: 600; }
  .slp-am.on .dot { opacity: 1; background: var(--slp-accent); }

  .slp-detail {
    margin-top: 12px; padding: 12px 13px;
    border: 1px solid var(--slp-line); border-radius: 8px;
    background: var(--slp-surface);
  }
  .slp-dmeta {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;
    margin-bottom: 7px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 10px; letter-spacing: .5px; color: var(--slp-muted);
  }
  .slp-dmeta b {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-weight: 600; color: var(--slp-accent);
  }
  .slp-reason {
    margin-bottom: 9px; padding: 6px 9px; border-radius: 6px;
    background: var(--slp-accent-soft); border-left: 2.5px solid var(--slp-accent);
    font-size: 11.5px; line-height: 1.65; color: var(--slp-fg);
  }
  .slp-reason-lab {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 9px; letter-spacing: 1px; color: var(--slp-accent);
    margin-right: 6px; font-weight: 600;
  }
  .slp-summary {
    font-size: 12.5px; line-height: 1.82; color: var(--slp-fg);
    white-space: pre-wrap; word-break: break-word; text-align: justify;
  }
  .slp-talk {
    margin-top: 10px; padding: 8px 0 1px 11px;
    border-left: 2px solid var(--slp-line);
    font-size: 11.5px; line-height: 1.75; color: var(--slp-fg-soft);
    white-space: pre-wrap; word-break: break-word;
  }
  .slp-talk-label {
    display: block; margin-bottom: 3px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 9px; letter-spacing: 1.4px; color: var(--slp-muted);
  }
  .slp-error {
    padding: 3px 0; font-size: 11.5px; letter-spacing: .3px; color: var(--slp-danger);
  }

  /* 人物 */
  .slp-cast {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(252px, 1fr));
    align-items: start;
    gap: 9px;
  }
  .slp-char {
    border: 1px solid var(--slp-line); border-radius: 8px;
    background: var(--slp-surface);
    padding: 11px 12px 10px;
  }
  .slp-char-hd { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; row-gap: 3px; }
  .slp-name {
    appearance: none; border: 0; background: none; color: var(--slp-fg);
    font: inherit; font-size: 13.5px; font-weight: 600; letter-spacing: .5px;
    padding: 0; cursor: pointer; text-align: left;
    max-width: 100%; overflow-wrap: anywhere;
    position: relative;
  }
  .slp-name::after {
    content: ""; position: absolute; left: -4px; right: -4px; top: -7px; bottom: -7px;
  }
  .slp-name:hover { color: var(--slp-accent); text-decoration: underline; text-underline-offset: 3px; }
  .slp-new {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 8.5px; letter-spacing: 1px; line-height: 1.5;
    padding: 0 5px; border: 1px solid var(--slp-border); border-radius: 999px;
    background: var(--slp-soft); color: var(--slp-accent);
  }
  .slp-chaos-num {
    margin-left: auto;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 9.5px; letter-spacing: 0; color: var(--slp-muted);
  }
  .slp-meter { display: flex; gap: 2px; margin: 8px 0 9px; height: 4px; }
  .slp-meter i {
    flex: 1; min-width: 0; height: 100%; border-radius: 1px;
    background: var(--slp-soft); border: 0;
  }
  .slp-meter i.on { background: var(--slp-accent); opacity: .72; }
  .slp-meter.hot i.on { background: var(--slp-warn); opacity: .95; }
  .slp-rows { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
  .slp-row { display: flex; align-items: flex-start; gap: 0; }
  .slp-lab {
    flex: 0 0 48px; padding-top: 1px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 10px; letter-spacing: .8px; line-height: 1.75;
    color: var(--slp-muted);
  }
  .slp-val {
    flex: 1; min-width: 0;
    font-size: 12.5px; line-height: 1.76; color: var(--slp-fg);
    white-space: pre-wrap; word-break: break-word;
  }
  .slp-val.mute { color: var(--slp-muted); opacity: .65; }
  .slp-val.hot { color: var(--slp-accent); }
  .slp-hub-status {
    margin-top: 9px; padding: 7px 9px;
    border: 1px dashed var(--slp-line); border-radius: 6px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 10px; letter-spacing: .3px; color: var(--slp-muted);
  }

  /* 地点 */
  .slp-locs { display: flex; flex-direction: column; gap: 8px; }
  .slp-loc-item { display: flex; flex-direction: column; }
  .slp-loc {
    appearance: none; border: 1px solid var(--slp-line); border-radius: 7px;
    background: var(--slp-surface); color: var(--slp-fg); cursor: pointer;
    display: flex; align-items: center; gap: 10px;
    width: 100%; padding: 10px 12px; text-align: left;
    font: inherit; font-size: 12.5px; letter-spacing: .5px;
    transition: border-color .14s ease, background .14s ease;
  }
  .slp-loc:hover { border-color: var(--slp-accent); background: var(--slp-soft); }
  .slp-loc:disabled { cursor: default; opacity: .6; }
  .slp-loc .idx {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 9.5px; color: var(--slp-accent); opacity: .8;
  }
  .slp-loc .nm { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .slp-loc .go {
    flex: 0 0 auto;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 10px; letter-spacing: .5px; color: var(--slp-muted);
  }
  .slp-loc:hover .go { color: var(--slp-accent); }
  .slp-loc-status {
    padding: 6px 2px 1px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 10px; letter-spacing: .3px; color: var(--slp-muted);
  }
  .slp-loc-status.err { color: var(--slp-danger); }

  /* 动态 / 意外 */
  .slp-chaos-card {
    border: 1px solid var(--slp-line); border-radius: 8px;
    background: var(--slp-surface);
    padding: 12px 13px 11px;
  }
  .slp-chaos-card.cue {
    border-color: var(--slp-cue);
    border-left-width: 3px;
  }
  .slp-chaos-card + .slp-chaos-card { margin-top: 10px; }
  .slp-chaos-top {
    display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-bottom: 8px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 10px; letter-spacing: .8px; color: var(--slp-muted);
  }
  .slp-chaos-tag {
    padding: 1px 7px;
    border: 1px solid var(--slp-border); border-radius: 999px;
    background: var(--slp-soft); color: var(--slp-accent);
    font-size: 10px; letter-spacing: .6px; font-weight: 600;
  }
  .slp-chaos-tag.cue {
    border-color: var(--slp-cue);
    background: var(--slp-cue-soft);
    color: var(--slp-cue);
  }
  .slp-chaos-text {
    font-size: 12.5px; line-height: 1.8; color: var(--slp-fg);
    white-space: pre-wrap; word-break: break-word;
  }
  .slp-chaos-sub {
    margin-top: 6px; font-size: 11px; line-height: 1.6; color: var(--slp-muted);
  }
  .slp-chaos-empty { font-size: 12px; letter-spacing: .3px; color: var(--slp-muted); padding: 1px 0 2px; }
  .slp-chaos-meter {
    display: flex; align-items: center; gap: 9px;
    margin-top: 11px; padding-top: 10px; border-top: 1px solid var(--slp-line);
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 10px; letter-spacing: .5px; color: var(--slp-muted);
  }
  .slp.light .slp-chaos-meter { border-top-style: dashed; }
  .slp-chaos-meter .slp-meter { flex: 1; margin: 0; }
  .slp-chaos-meter .num {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 10px; color: var(--slp-fg-soft); font-variant-numeric: tabular-nums;
  }
  .slp-ack-note {
    margin-top: 9px; padding: 6px 10px;
    border: 1px dashed var(--slp-line); border-radius: 6px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 10.5px; line-height: 1.55; color: var(--slp-muted);
  }

  .slp-empty {
    padding: 12px 0 6px;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 11px; letter-spacing: .5px; color: var(--slp-muted);
  }

  @media (max-width: 600px) {
    .slp { padding: 12px 12px 11px; border-radius: 10px; }
    .slp-input { font-size: 14px; padding-left: 10px; }
    .slp-main { display: block; padding-top: 10px; }
    .slp-rail {
      flex: none; flex-direction: row; align-items: center;
      overflow-x: auto; gap: 5px;
      padding: 0 0 9px; margin: 0 0 11px;
      border-right: 0; border-bottom: 1px solid var(--slp-line);
      -webkit-overflow-scrolling: touch;
    }
    .slp.light .slp-rail { border-bottom-style: dashed; border-bottom-width: 1.5px; }
    .slp-tab {
      flex: 0 0 auto; padding: 6px 9px; align-items: center;
      box-shadow: none;
    }
    .slp-tab.on { box-shadow: inset 0 -2px 0 var(--slp-accent); }
    .slp-tab .num { display: none; }
    .slp-tab .cnt { margin-left: 3px; }
    .slp-tool { padding: 6px 8px; }
    .slp-ams { grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); }
    .slp-am { padding: 9px 8px; }
    .slp-cast { grid-template-columns: 1fr; }
    .slp-lab { flex-basis: 45px; }
  }
</style>
</head>
<body>
<div class="slp" id="slp"></div>
<script type="text/plain" id="slp-raw">$1</script>
<script type="text/plain" id="slp-tail">$2</script>
<script>
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function textOf(id) { var node = byId(id); return node ? String(node.textContent || '') : ''; }
  function trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }

  var INPUT = trim(textOf('slp-raw'));
  var TAIL = textOf('slp-tail');

  function tag(raw, name) {
    var s = String(raw || '');
    var open = '<' + name + '>';
    var close = '</' + name + '>';
    var from = 0;
    var last = '';
    while (true) {
      var a = s.indexOf(open, from);
      if (a < 0) break;
      var b = s.indexOf(close, a + open.length);
      if (b < 0) break;
      last = s.slice(a + open.length, b);
      from = b + close.length;
    }
    return trim(last);
  }

  function parseRecall(raw) {
    var text = tag(raw, 'recall');
    if (!text) return [];
    var parts = text.split(/[,，、\s]+/);
    var out = [];
    var seen = {};
    for (var i = 0; i < parts.length; i++) {
      var code = trim(parts[i]).toUpperCase();
      if (!/^AM\d+$/.test(code) || seen[code]) continue;
      seen[code] = 1;
      out.push(code);
    }
    out.sort();
    return out;
  }

  function parseMatchReasons(raw) {
    var text = tag(raw, 'match');
    var map = {};
    if (!text) return map;
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = trim(lines[i]).replace(/^[-*·]\s*/, '');
      if (!line) continue;
      var sep = line.search(/[|｜]/);
      if (sep < 0) continue;
      var code = trim(line.slice(0, sep)).toUpperCase();
      var reason = trim(line.slice(sep + 1));
      if (/^AM\d+$/.test(code) && reason) map[code] = reason;
    }
    return map;
  }

  function splitSegments(s) {
    var i1 = s.indexOf('|');
    if (i1 < 0) return [s];
    var i2 = s.indexOf('|', i1 + 1);
    if (i2 < 0) return [trim(s.slice(0, i1)), trim(s.slice(i1 + 1))];
    return [trim(s.slice(0, i1)), trim(s.slice(i1 + 1, i2)), trim(s.slice(i2 + 1))];
  }

  function parseSoul(raw) {
    var text = tag(raw, 'soul');
    var rows = [];
    var isNsfw = false;
    if (!text) return { rows: rows, isNsfw: false };
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = trim(lines[i]);
      if (!line) continue;
      if (/^nsfw$/i.test(line)) { isNsfw = true; continue; }
      var m = line.match(/^【([^】]+)】\s*([\s\S]*)$/);
      if (!m) continue;
      var parts = splitSegments(trim(m[2]));
      rows.push({ name: trim(m[1]), boundary: parts[0] || '', refuse: parts[1] || '', proactive: parts[2] || '' });
    }
    return { rows: rows, isNsfw: isNsfw };
  }

  function normalizeName(name) {
    return String(name || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, '').trim();
  }

  function parseBg(text) {
    var m = String(text || '').match(/chaos_bg\s*=\s*([0-9]+(?:\.[0-9]+)?)/i);
    return m ? Number(m[1]) : null;
  }

  function parseCharCounts(text) {
    var out = {};
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = trim(lines[i]);
      if (!line) continue;
      var m = line.match(/^(.+?)\s*=\s*([0-9]+(?:\.[0-9]+)?)$/);
      if (!m) continue;
      var name = trim(m[1]);
      if (/^chaos_bg$/i.test(name)) continue;
      out[normalizeName(name)] = Number(m[2]);
    }
    return out;
  }

  function parseChaosText(text) {
    var t = trim(text);
    if (!t) return null;
    var lead = '';
    var m = t.match(/走向[：:]\s*([^\n]+)/);
    if (m) lead = trim(m[1]);
    var body = t;
    if (lead) body = t.replace(/走向[：:][^\n]*\n?/, '');
    body = body.replace(/^突发意外[：:]\s*/, '').trim();
    if (!body) body = t;
    return { lead: lead, text: body };
  }

  function parseSpot(raw) {
    var text = tag(raw, 'spot');
    if (!text) return [];
    var parts = text.split(/[,，、\r?\n]+/);
    var out = [], seen = {};
    for (var i = 0; i < parts.length; i++) {
      var name = trim(parts[i]);
      if (!name || seen[name]) continue;
      seen[name] = 1;
      out.push(name);
    }
    return out;
  }

  function parseWorldAckFromRaw(raw) {
    var block = tag(raw, 'world_ack');
    if (!block) return null;
    var picked = null;
    var skippedIds = [];
    var skippedReason = '';
    var lines = block.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = trim(lines[i]).replace(/^[-*·]\s*/, '');
      if (!line) continue;
      var m = line.match(/^(pick(?:ed)?|skip(?:ped)?)\s*[:：]\s*(.*)$/i);
      if (!m) continue;
      var kind = m[1].toLowerCase();
      var fields = m[2].split(/[|｜]/);
      if (kind.indexOf('pick') === 0) {
        var pid = trim(fields[0]).split(/[,，、;；\s]+/)[0] || '';
        if (!pid || /^(无|none|-|—)$/i.test(pid)) continue;
        picked = {
          id: pid,
          targetTag: trim(fields[1] || ''),
          reason: trim(fields.slice(2).join(' | '))
        };
      } else {
        var ids = trim(fields[0]).split(/[,，、;；\s]+/);
        for (var j = 0; j < ids.length; j++) {
          var sid = trim(ids[j]);
          if (sid && !/^(无|none|-|—)$/i.test(sid) && skippedIds.indexOf(sid) < 0) skippedIds.push(sid);
        }
        if (!skippedReason) skippedReason = trim(fields.slice(1).join(' | '));
      }
    }
    if (!picked && !skippedIds.length) return null;
    return { picked: picked, skippedIds: skippedIds, skippedReason: skippedReason };
  }

  function currentMessage() {
    try {
      var p = window.parent;
      var st = p && p.SillyTavern;
      var ctx = st && typeof st.getContext === 'function' ? st.getContext() : null;
      if (!ctx || !ctx.chat) return null;
      var id = null;
      try {
        var fe = window.frameElement;
        var mes = fe && fe.closest ? fe.closest('.mes') : null;
        id = mes ? mes.getAttribute('mesid') : null;
      } catch (e) { id = null; }
      if (id != null && ctx.chat[Number(id)]) return ctx.chat[Number(id)];
      var needle = INPUT.replace(/\s+/g, ' ').slice(0, 48);
      for (var i = ctx.chat.length - 1; i >= 0; i--) {
        var msg = ctx.chat[i];
        if (!msg || msg.is_user !== true || typeof msg.mes !== 'string') continue;
        if (msg.mes.indexOf('<本轮用户输入>') < 0) continue;
        if (!needle || msg.mes.replace(/\s+/g, ' ').indexOf(needle) >= 0) return msg;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function currentRaw(msg) {
    var tasks = msg && msg.sl_plot_tasks;
    if (!tasks || typeof tasks !== 'object') return '';
    var best = '';
    for (var key in tasks) {
      if (!Object.prototype.hasOwnProperty.call(tasks, key)) continue;
      var raw = tasks[key];
      if (typeof raw === 'string' && raw.length > best.length) best = raw;
    }
    return best;
  }

  function currentAck(msg, raw) {
    var ack = msg && msg.sl_world_ack;
    if (ack && typeof ack === 'object') {
      return {
        picked: ack.picked && ack.picked.id ? ack.picked : null,
        skippedIds: Array.isArray(ack.skippedIds) ? ack.skippedIds : [],
        skippedReason: String(ack.skippedReason || '')
      };
    }
    return parseWorldAckFromRaw(raw);
  }

  var MSG = currentMessage();
  var RAW = currentRaw(MSG);
  var RECALL = parseRecall(TAIL);
  var MATCH_REASONS = parseMatchReasons(RAW);
  var SOUL_PARSED = parseSoul(TAIL);
  var SOUL = SOUL_PARSED.rows;
  var IS_NSFW = SOUL_PARSED.isNsfw;
  var CHAOS = parseChaosText(tag(TAIL, 'chaos'));
  var WORLD_CUE = tag(TAIL, 'world_cue');
  var ACK = currentAck(MSG, RAW);
  var BG = parseBg(tag(RAW, 'chaos_bg') || tag(TAIL, 'chaos_bg'));
  var CHARS = parseCharCounts(tag(RAW, 'chaos_char') || tag(TAIL, 'chaos_char'));
  var SPOTS = parseSpot(TAIL);

  function proactiveText(entry) {
    return String(entry.proactive || '').replace(/^主动[：:]\s*/, '').trim();
  }
  function hasProactive(entry) {
    var v = proactiveText(entry);
    return !!v && v !== '无' && v !== '未触发';
  }
  var PROACTIVE_COUNT = 0;
  for (var pi = 0; pi < SOUL.length; pi++) if (hasProactive(SOUL[pi])) PROACTIVE_COUNT++;
  var HAS_PICKED_EVENT = !!(WORLD_CUE || (ACK && ACK.picked));
  var GLOBAL_EVENT = (CHAOS ? 1 : 0) + (HAS_PICKED_EVENT ? 1 : 0);

  function pct(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function meter(value, hot) {
    var m = el('span', 'slp-meter' + (hot ? ' hot' : ''));
    var filled = Math.round(pct(value) / 10);
    for (var i = 0; i < 10; i++) m.appendChild(el('i', i < filled ? 'on' : ''));
    return m;
  }

  var THEME_KEY = 'sese_ledger_plot_panel_theme';
  function detectHostTheme() {
    try {
      var p = window.parent;
      var target = p.document.querySelector('.mes_text') || p.document.body;
      var color = p.getComputedStyle(target).color || '';
      var nums = color.match(/\d+(?:\.\d+)?/g);
      if (nums && nums.length >= 3) {
        var lum = (0.299 * Number(nums[0]) + 0.587 * Number(nums[1]) + 0.114 * Number(nums[2])) / 255;
        return lum > 0.6 ? 'dark' : 'light';
      }
    } catch (e) { /* ignore */ }
    return 'dark';
  }
  function loadTheme() {
    try {
      var saved = window.localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) { /* ignore */ }
    return detectHostTheme();
  }
  function saveTheme(theme) { try { window.localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ } }

  var FOLD_KEY = 'sese_ledger_plot_panel_collapsed';
  function loadCollapsed() {
    try { return window.localStorage.getItem(FOLD_KEY) === '1'; } catch (e) { return false; }
  }
  function saveCollapsed(collapsed) {
    try { window.localStorage.setItem(FOLD_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function syncHostStyle() {
    try {
      var p = window.parent;
      var target = p.document.querySelector('.mes_text') || p.document.body;
      var cs = p.getComputedStyle(target);
      if (cs.fontFamily) document.body.style.fontFamily = cs.fontFamily;
      if (cs.fontSize) document.body.style.fontSize = cs.fontSize;
      if (cs.fontWeight) document.body.style.fontWeight = cs.fontWeight;
    } catch (e) { /* ignore */ }
  }

  function ledgerApi() {
    try { var p = window.parent; if (p && p.SeseLedgerAPI) return p.SeseLedgerAPI; } catch (e) { /* ignore */ }
    try { var t = window.top; if (t && t.SeseLedgerAPI) return t.SeseLedgerAPI; } catch (e) { /* ignore */ }
    try { if (window.SeseLedgerAPI) return window.SeseLedgerAPI; } catch (e) { /* ignore */ }
    return null;
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/\\+r\\+n/g, '\n')
      .replace(/\\+n/g, '\n')
      .replace(/\\+r/g, '\n');
  }

  function pick(row, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = row[keys[i]];
      if (v != null && String(v).trim()) return normalizeText(v).trim();
    }
    return '';
  }

  function fetchSummary(code) {
    var api = ledgerApi();
    if (!api || typeof api.query !== 'function') return { ok: false, reason: '台账未就绪，无法读取纪要。' };
    try {
      var r = api.query('纪要表', { where: { '编码索引': code }, limit: 1 });
      if (!r || !r.rows || !r.rows.length) return { ok: false, reason: '未找到 ' + code + '。' };
      var row = r.rows[0] || {};
      return { ok: true, time: pick(row, ['时间跨度']), summary: pick(row, ['纪要', '纪要内容', '概览', '概要']), talk: pick(row, ['重要对话']) };
    } catch (e) {
      return { ok: false, reason: '读取纪要失败。' };
    }
  }

  function openCharacter(name) {
    try {
      var p = window.parent;
      var fn = p && p.__ub_showCharacterHub;
      if (typeof fn !== 'function') return { ok: false, reason: '状态栏未就绪，无法打开角色中枢。' };
      fn(name);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: '打开角色中枢失败。' };
    }
  }

  function openMap(loc) {
    return new Promise(function (resolve) {
      try {
        var p = window.parent;
        var fn = p && p.__ub_showMapForLocation;
        if (typeof fn !== 'function') { resolve({ ok: false, reason: '状态栏未就绪，无法打开地图。' }); return; }
        Promise.resolve(fn(loc)).then(function (r) { resolve(r || { ok: false, reason: '地图未响应。' }); }, function () { resolve({ ok: false, reason: '打开地图失败。' }); });
      } catch (e) {
        resolve({ ok: false, reason: '打开地图失败。' });
      }
    });
  }

  function resetRound(input) {
    var api = ledgerApi();
    if (!api || !api.driver || typeof api.driver.resetRound !== 'function') return Promise.resolve({ ok: false, reason: '台账未就绪，无法重置。' });
    try { return Promise.resolve(api.driver.resetRound(input)); } catch (e) { return Promise.resolve({ ok: false, reason: '重置失败。' }); }
  }

  function mapFailureText(reason) {
    var text = String(reason || '');
    if (/未生成/.test(text)) return '该地点地图尚未生成。';
    if (/未启用/.test(text) || /地图功能/.test(text)) return '地图功能未启用。';
    if (/未找到/.test(text)) return '未找到该地点的地图。';
    return text || '无法打开地图。';
  }

  var state = {
    tab: '',
    activeAm: '',
    locStatus: {},
    hubStatus: '',
    error: '',
    collapsed: loadCollapsed(),
    resetArmed: false,
    resetting: false,
    resetTimer: null,
    theme: loadTheme()
  };
  var summaryCache = {};

  function tabMeta(key) {
    if (key === 'recall') return { title: '召回', count: RECALL.length + ' 条' };
    if (key === 'cast') return { title: '人物', count: SOUL.length + ' 位' };
    if (key === 'spot') return { title: '候选地点', count: SPOTS.length + ' 处' };
    return { title: '动态', count: '' };
  }

  function sectionHeader(title, count) {
    var hd = el('div', 'slp-sec-hd');
    hd.appendChild(el('span', 'slp-sec-title', title));
    if (IS_NSFW && title === '人物') hd.appendChild(el('span', 'slp-pill nsfw', 'NSFW'));
    if (count) hd.appendChild(el('span', 'slp-sec-count', count));
    return hd;
  }

  function renderHead(hasBody) {
    var head = el('div', 'slp-head');
    var row = el('div', 'slp-head-row');
    row.appendChild(el('div', 'slp-kicker', '本轮输入'));
    if (IS_NSFW) row.appendChild(el('span', 'slp-pill nsfw', 'NSFW'));
    if (HAS_PICKED_EVENT) row.appendChild(el('span', 'slp-pill cue', '后台入戏'));

    var tools = el('div', 'slp-tools');
    var themeBtn = el('button', 'slp-tool', state.theme === 'light' ? '☾ Storm' : '☀ 手账');
    themeBtn.type = 'button';
    themeBtn.title = state.theme === 'light' ? '切换为夜间 TokyoNight Storm' : '切换为日间奶油手账';
    themeBtn.addEventListener('click', function () {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      saveTheme(state.theme);
      render();
    });
    tools.appendChild(themeBtn);
    tools.appendChild(el('span', 'slp-tool-sep', '·'));

    if (hasBody) {
      var foldBtn = el('button', 'slp-tool', state.collapsed ? '展开' : '收起');
      foldBtn.type = 'button';
      if (state.collapsed) {
        var foldEvents = PROACTIVE_COUNT + GLOBAL_EVENT;
        if (foldEvents > 0) foldBtn.appendChild(el('span', 'slp-badge', String(foldEvents)));
      }
      foldBtn.addEventListener('click', function () {
        state.collapsed = !state.collapsed;
        saveCollapsed(state.collapsed);
        render();
      });
      tools.appendChild(foldBtn);
      tools.appendChild(el('span', 'slp-tool-sep', '·'));
    }

    var resetBtn = el('button', 'slp-tool' + (state.resetArmed ? ' armed' : ''), state.resetting ? '重试中…' : (state.resetArmed ? '确认重试？' : '推进重试'));
    resetBtn.type = 'button';
    resetBtn.disabled = state.resetting;
    resetBtn.addEventListener('click', function () {
      if (state.resetting) return;
      if (!state.resetArmed) {
        state.resetArmed = true;
        render();
        if (state.resetTimer) clearTimeout(state.resetTimer);
        state.resetTimer = setTimeout(function () {
          state.resetArmed = false;
          render();
        }, 3000);
        return;
      }
      if (state.resetTimer) clearTimeout(state.resetTimer);
      state.resetArmed = false;
      doReset();
    });
    tools.appendChild(resetBtn);

    row.appendChild(tools);
    head.appendChild(row);
    head.appendChild(el('div', 'slp-input', INPUT));
    if (state.error) head.appendChild(el('div', 'slp-error', state.error));
    return head;
  }

  function doReset() {
    state.resetting = true;
    state.error = '';
    render();
    resetRound(INPUT).then(function (r) {
      if (r && r.ok) return;
      state.resetting = false;
      state.error = (r && r.reason) ? String(r.reason) : '重置失败。';
      render();
    }, function () {
      state.resetting = false;
      state.error = '重置失败。';
      render();
    });
  }

  function renderRecall() {
    var pane = el('div', 'slp-pane');
    var list = el('div', 'slp-ams');
    for (var i = 0; i < RECALL.length; i++) {
      var code = RECALL[i];
      var btn = el('button', 'slp-am' + (state.activeAm === code ? ' on' : ''));
      btn.type = 'button';
      btn.appendChild(el('span', 'dot'));
      btn.appendChild(el('span', null, code));
      (function (c) {
        btn.addEventListener('click', function () {
          state.activeAm = state.activeAm === c ? '' : c;
          render();
        });
      })(code);
      list.appendChild(btn);
    }
    pane.appendChild(list);

    if (state.activeAm) {
      var detail = el('div', 'slp-detail');
      var matchReason = MATCH_REASONS[state.activeAm] || '';
      var res = summaryCache[state.activeAm];
      if (!res || !res.ok) {
        res = fetchSummary(state.activeAm);
        if (res.ok) summaryCache[state.activeAm] = res;
      }
      if (!res.ok) {
        if (matchReason) {
          var reasonBoxOnly = el('div', 'slp-reason');
          reasonBoxOnly.appendChild(el('span', 'slp-reason-lab', '召回依据'));
          reasonBoxOnly.appendChild(document.createTextNode(matchReason));
          detail.appendChild(reasonBoxOnly);
        }
        detail.appendChild(el('div', 'slp-error', res.reason || '读取纪要失败。'));
      } else {
        var meta = el('div', 'slp-dmeta');
        meta.appendChild(el('b', null, state.activeAm));
        meta.appendChild(el('span', null, '时间跨度'));
        meta.appendChild(el('span', null, res.time || '—'));
        detail.appendChild(meta);
        if (matchReason) {
          var reasonBox = el('div', 'slp-reason');
          reasonBox.appendChild(el('span', 'slp-reason-lab', '召回依据'));
          reasonBox.appendChild(document.createTextNode(matchReason));
          detail.appendChild(reasonBox);
        }
        detail.appendChild(el('div', 'slp-summary', res.summary || '（无纪要内容）'));
        if (res.talk) {
          var talk = el('div', 'slp-talk');
          talk.appendChild(el('span', 'slp-talk-label', '重要对话'));
          talk.appendChild(document.createTextNode(res.talk));
          detail.appendChild(talk);
        }
      }
      pane.appendChild(detail);
    }
    return pane;
  }

  function makeRow(label, value, tone) {
    var row = el('div', 'slp-row');
    row.appendChild(el('span', 'slp-lab', label));
    row.appendChild(el('span', 'slp-val' + (tone ? ' ' + tone : ''), value || '—'));
    return row;
  }

  function renderCast() {
    var pane = el('div', 'slp-pane');
    var grid = el('div', 'slp-cast');
    for (var i = 0; i < SOUL.length; i++) {
      var entry = SOUL[i];
      var rawName = String(entry.name || '').trim();
      var isNew = /[（(]新出场[）)]/.test(rawName);
      var clean = rawName.replace(/[（(]新出场[）)]/g, '').trim();
      var isHero = clean === '主角';

      var card = el('div', 'slp-char');
      var hd = el('div', 'slp-char-hd');
      var nameBtn = el('button', 'slp-name', clean || '未命名');
      nameBtn.type = 'button';
      nameBtn.title = '打开角色中枢';
      (function (name) {
        nameBtn.addEventListener('click', function () {
          var r = openCharacter(name);
          state.hubStatus = r.ok ? '已打开角色中枢「' + name + '」。' : r.reason;
          render();
        });
      })(clean);
      hd.appendChild(nameBtn);
      if (isNew) hd.appendChild(el('span', 'slp-new', '新出场'));

      var chaosVal = CHARS[normalizeName(clean)];
      if (typeof chaosVal === 'number') hd.appendChild(el('span', 'slp-chaos-num', '混沌 ' + pct(chaosVal)));
      card.appendChild(hd);
      if (typeof chaosVal === 'number') card.appendChild(meter(chaosVal, pct(chaosVal) >= 80));

      var rows = el('div', 'slp-rows');
      rows.appendChild(makeRow('防全知', entry.boundary || '无', (!entry.boundary || entry.boundary === '无认知盲点') ? 'mute' : ''));
      if (!isHero) {
        var refuse = entry.refuse || '';
        rows.appendChild(makeRow('拒绝', refuse || '无', (!refuse || refuse === '无') ? 'mute' : ''));
        var proactive = proactiveText(entry);
        var activePro = hasProactive(entry);
        rows.appendChild(makeRow('主动', proactive || '未触发', activePro ? 'hot' : 'mute'));
      }
      card.appendChild(rows);
      grid.appendChild(card);
    }
    pane.appendChild(grid);
    if (state.hubStatus) pane.appendChild(el('div', 'slp-hub-status', state.hubStatus));
    return pane;
  }

  function renderSpot() {
    var pane = el('div', 'slp-pane');
    var list = el('div', 'slp-locs');
    for (var i = 0; i < SPOTS.length; i++) {
      (function (loc, idx) {
        var item = el('div', 'slp-loc-item');
        var btn = el('button', 'slp-loc');
        btn.type = 'button';
        btn.appendChild(el('span', 'idx', idx + 1 < 10 ? '0' + (idx + 1) : String(idx + 1)));
        btn.appendChild(el('span', 'nm', loc));
        btn.appendChild(el('span', 'go', '打开地图 →'));

        var status = el('div', 'slp-loc-status');
        var saved = state.locStatus[loc];
        if (saved) {
          status.textContent = saved.text;
          if (saved.err) status.className = 'slp-loc-status err';
        }

        btn.addEventListener('click', function () {
          btn.disabled = true;
          status.className = 'slp-loc-status';
          status.textContent = '正在定位…';
          openMap(loc).then(function (r) {
            btn.disabled = false;
            if (r && r.ok) {
              status.textContent = '已在状态栏地图中定位「' + loc + '」。';
              state.locStatus[loc] = { text: status.textContent, err: false };
            } else {
              status.className = 'slp-loc-status err';
              status.textContent = mapFailureText(r && r.reason);
              state.locStatus[loc] = { text: status.textContent, err: true };
            }
          });
        });

        item.appendChild(btn);
        item.appendChild(status);
        list.appendChild(item);
      })(SPOTS[i], i);
    }
    pane.appendChild(list);
    return pane;
  }

  function renderChaos() {
    var pane = el('div', 'slp-pane');
    var picked = ACK && ACK.picked ? ACK.picked : null;
    if (WORLD_CUE || picked) {
      var cueCard = el('div', 'slp-chaos-card cue');
      var cueTop = el('div', 'slp-chaos-top');
      cueTop.appendChild(el('span', 'slp-chaos-tag cue', '后台切入'));
      if (picked && picked.id) cueTop.appendChild(el('span', 'slp-pill cue', picked.id));
      if (picked && picked.targetTag) cueTop.appendChild(el('span', null, '落点：' + picked.targetTag));
      cueCard.appendChild(cueTop);
      cueCard.appendChild(el('div', 'slp-chaos-text', WORLD_CUE || '已并入本轮 <chaos> 全局意外演绎。'));
      if (picked && picked.reason) {
        cueCard.appendChild(el('div', 'slp-chaos-sub', '选中依据：' + picked.reason));
      }
      pane.appendChild(cueCard);
    }

    var card = el('div', 'slp-chaos-card');
    if (CHAOS) {
      var top = el('div', 'slp-chaos-top');
      top.appendChild(el('span', null, '走向'));
      if (CHAOS.lead) top.appendChild(el('span', 'slp-chaos-tag', CHAOS.lead));
      card.appendChild(top);
      card.appendChild(el('div', 'slp-chaos-text', CHAOS.text));
    } else {
      card.appendChild(el('div', 'slp-chaos-empty', '本轮未触发全局意外。'));
    }
    if (BG != null) {
      var mrow = el('div', 'slp-chaos-meter');
      mrow.appendChild(el('span', null, '全局混沌'));
      mrow.appendChild(meter(BG, pct(BG) >= 80));
      mrow.appendChild(el('span', 'num', pct(BG) + ' / 100'));
      card.appendChild(mrow);
    }
    pane.appendChild(card);

    if (ACK && ACK.skippedIds && ACK.skippedIds.length) {
      var noteText = '本轮已压住 ' + ACK.skippedIds.length + ' 条后台候选';
      if (ACK.skippedReason) noteText += '：' + ACK.skippedReason;
      pane.appendChild(el('div', 'slp-ack-note', noteText));
    }
    return pane;
  }

  function render() {
    var root = byId('slp');
    if (!root) return;
    root.className = 'slp' + (state.theme === 'light' ? ' light' : '');
    root.innerHTML = '';
    var hasDyn = BG != null || CHAOS || HAS_PICKED_EVENT || (ACK && ACK.skippedIds && ACK.skippedIds.length);
    var tabs = [];
    if (RECALL.length) tabs.push({ key: 'recall', num: '01', label: '召回', count: RECALL.length, badge: 0 });
    if (SOUL.length) tabs.push({ key: 'cast', num: '02', label: '人物', count: SOUL.length, badge: PROACTIVE_COUNT });
    if (SPOTS.length) tabs.push({ key: 'spot', num: '03', label: '地点', count: SPOTS.length, badge: 0 });
    if (hasDyn) tabs.push({ key: 'chaos', num: '04', label: '动态', count: 0, badge: GLOBAL_EVENT });

    root.appendChild(renderHead(tabs.length > 0));
    if (!tabs.length || state.collapsed) return;

    var preferred = 'cast';
    var active = state.tab;
    var hasActive = false, hasPreferred = false;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].key === active) hasActive = true;
      if (tabs[i].key === preferred) hasPreferred = true;
    }
    if (!hasActive) active = hasPreferred ? preferred : tabs[0].key;
    state.tab = active;

    var main = el('div', 'slp-main');
    if (tabs.length > 1) {
      var rail = el('div', 'slp-rail');
      for (var j = 0; j < tabs.length; j++) {
        var t = tabs[j];
        var tb = el('button', 'slp-tab' + (t.key === active ? ' on' : ''));
        tb.type = 'button';
        tb.appendChild(el('span', 'num', t.num));
        tb.appendChild(el('span', 'lab', t.label));
        if (t.badge > 0) tb.appendChild(el('span', 'slp-badge', String(t.badge)));
        if (t.count) tb.appendChild(el('span', 'cnt', String(t.count)));
        (function (key) {
          tb.addEventListener('click', function () {
            state.tab = key;
            render();
          });
        })(t.key);
        rail.appendChild(tb);
      }
      main.appendChild(rail);
    }

    var view = el('div', 'slp-view');
    var meta = tabMeta(active);
    view.appendChild(sectionHeader(meta.title, tabs.length === 1 ? meta.count : ''));
    if (active === 'recall') view.appendChild(renderRecall());
    else if (active === 'cast') view.appendChild(renderCast());
    else if (active === 'spot') view.appendChild(renderSpot());
    else if (active === 'chaos') view.appendChild(renderChaos());
    main.appendChild(view);
    root.appendChild(main);
  }

  syncHostStyle();
  render();
})();
</script>
</body>
</html>`;

/**
 * 构建产物会把面板 HTML 里的 `</script>` 转义成 `<\/script>`（防止脚本内容破坏外层装载）。
 * 正则替换串最终会作为 HTML 代码块注入聊天；HTML 解析器只认真正的 `</script>`，收到 `<\/script>`
 * 会一直吞到文档末尾，导致主脚本不执行、面板只剩空壳。注入前统一还原。
 */
export function normalizePanelScriptClose(text: string): string {
  const BS = String.fromCharCode(92);
  const SL = String.fromCharCode(47);
  return String(text || '').split('<' + BS + SL + 'script>').join('<' + SL + 'script>');
}

/** 注入用面板 HTML（已修复构建期脚本结束标签转义）。 */
export function plotPanelHtml(): string {
  return normalizePanelScriptClose(PLOT_PANEL_HTML);
}

/** 注入用快照（每次取新数组，防调用方误改常量）。 */
export function plotRegexScripts(): PlotRegexScript[] {
  const panel: PlotRegexScript = {
    id: '7c2f5a10-3b9d-4e6a-8f21-5d0c9b1a2e01',
    scriptName: PLOT_PANEL_SCRIPT_NAME,
    findRegex: PANEL_FIND,
    replaceString: '```html\n' + plotPanelHtml() + '\n```',
    trimStrings: [],
    placement: [1],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: 1,
  };
  const hide: PlotRegexScript = {
    id: '7c2f5a10-3b9d-4e6a-8f21-5d0c9b1a2e02',
    scriptName: PLOT_HIDE_SCRIPT_NAME,
    findRegex: HIDE_FIND,
    replaceString: '',
    trimStrings: [],
    placement: [1],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: 2,
    maxDepth: null,
  };
  const promptStrip: PlotRegexScript = {
    id: '7c2f5a10-3b9d-4e6a-8f21-5d0c9b1a2e03',
    scriptName: PLOT_PROMPT_STRIP_SCRIPT_NAME,
    findRegex: PROMPT_STRIP_FIND,
    replaceString: '$1',
    trimStrings: [],
    placement: [1],
    disabled: false,
    markdownOnly: false,
    promptOnly: true,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: 1,
    maxDepth: null,
  };
  return [panel, hide, promptStrip];
}
