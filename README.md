# 瑟瑟台账（`n-sese-ledger`）

> **致后续接手本仓库的 AI（强制维护纪律）**
> 1. **每次修改本仓库代码、标准表结构、推进预设或外部接口后，必须同步更新本 README**（至少更新「当前改造状态与未完成项」「表结构与世界书契约」及文末「改造记录」），严禁只改代码不留记录。
> 2. **先读再改，按固定顺序交付（长期明确授权）**：① 改代码/文档 → ② 改到 `src/` 时刷新 `source-files.sha256.json` 并执行 `npm run build` 重建 `dist/index.js` → ③ 递增四处版本号（**仅功能/界面/修复改动**；纯文档同步不递增）并更新本 README → ④ 运行 `npm run build`、`npm test`、`npm run check` 全绿，确认 `git diff -- dist` 无异常 → ⑤ `git add <明确列出的文件>`、`git commit`、`git push origin main`（无需逐次询问，也不要打包 zip，详见 [AGENTS.md](AGENTS.md)）。
> 3. **在 Antigravity 等独立客户端打开本仓时**：`src/unified-statusbar/core/` 是内嵌共享件副本，其中 `env.ts` 含台账 Toast 前缀定制、`external-projection-client.ts` 为伴生仓专用，**禁止整目录盲目覆盖**；同步共享件须逐文件比对并刷新 SHA-256 清单（见 [src/README.md](src/README.md)）。
> 4. **做角色卡联动必看**：第 3 节完整列出了台账默认 19 张表的表名/分组/列名、`SeseLedger-*` 世界书投影槽位、填表与剧情推进的宿主字段契约，写卡时直接对照，无需猜字段名。
> 5. **设计基准**：排障与重构一律以本仓库既有契约与 TT/ST 宿主实态为准，不套用其他外部数据库插件的实现方式。

---

## 1. 定位与运行依赖

- **扩展名称**：`瑟瑟台账`（`manifest.json` `loading_order: 210`，在 `n-sese-unified-statusbar` `200` 之后、`n-sese-phone` `220` 之前装载）
- **当前版本**：`0.1.0-alpha.16`（在 `b5d5470` 基础上推进；功能性改动递增版本并推仓供 TT 拉取实测，纯文档同步不递增版本但记 `(docs)` Changelog）
- **宿主要求**：`manifest.json` 声明 `minimum_client_version: 1.13.0`；装载前由 [runtime/extension.js](runtime/extension.js) 做能力检查——`SillyTavern.getContext` 与 `CHAT_CHANGED`、酒馆 jQuery、`toastr`，以及 `TavernHelper` 的 `generateRaw` / `injectPrompts` / `getWorldbook` / `replaceWorldbook` / `getCharWorldbookNames` / `getWorldbookNames`，缺项时在扩展设置区显示「安装状态」面板与中文缺项提示。台账 `template: false`（不注入状态栏壳）、`blockDatabase: true`（检测到另一套数据库插件时拒绝混装，提示停用，不删数据）。
- **宿主设置键**：`extensionSettings.sese_ledger_v1`（详见 [core/settings-store.ts](src/sese-ledger/core/settings-store.ts)）
- **协同关系**：
  - 安装 `n-sese-unified-statusbar` 时，台账从状态栏设置面板打开工作台，并通过 `__ubWorldbookProjection` 共享同一主世界书写入队列、通过 `__ubWorldCognitionSnapshot` 读取世界认知快照（单开时自动安全降级）。
  - 向状态栏与 `n-sese-phone` 暴露 `window.SeseLedgerAPI`（当宿主未装载外部真数据库时，自动注册兼容别名 `window.AutoCardUpdaterAPI`）。
  - 请勿与另一套独立数据库插件同时启用。
- **来源与参考**：业务原始源码源自原作者 2026-10-25 公开分享包（原作者已停更），本仓库为个人后续适配与改造维护版本，版权归属见 [SOURCE_NOTICE.md](SOURCE_NOTICE.md) 与 [src/README.md](src/README.md)。

---

## 2. 当前改造状态与未完成项（截至 2026-11-26，当前 `0.1.0-alpha.16`）

| 模块 / 阶段 | 当前状态 | 关键证据与说明 |
|---|---|---|
| **P1 剧情推进召回与预设去模板化** | ✅ 代码+单测完成 | 内置 [魔改召回](src/sese-ledger/assets/plot-preset-magic-recall.json) 升级为「至少 25 条 AM 保底（不足全召回）」+ `<match>` <=18 字瘦身 + `<world_cue>` 防思考泄漏；[极速纯召回](src/sese-ledger/assets/plot-preset-pure-recall.json) 保留 `0～N` 上限不补位；均取消无条件主动与固定“温柔”人设，不凑认知盲点 |
| **P4 状态栏只读认知桥窄适配** | ✅ 代码+单测完成 | 新增 [statusbar-cognition.ts](src/sese-ledger/core/statusbar-cognition.ts) 消费状态栏 `window.__ubWorldCognitionSnapshot`：内置魔改规划继承角色 `knownFacts`（去重盲点）与合规入镜候选（主入口+参考），无候选时回落单开路径（[director.ts](src/sese-ledger/core/director.ts)、[director-runtime.ts](src/sese-ledger/core/director-runtime.ts)） |
| **推进防异步串楼与手机输入兼容** | ✅ 代码+单测完成 | 规划前钉住 `PlanningTarget`（聊天身份+数组引用+稳定 ID/原文），写入前二次定位防切聊/删楼串写；修复 `locatePlanningTarget` `.trim()` 不一致导致的手机端输入法换行误删用户楼（[director-runtime.ts](src/sese-ledger/core/director-runtime.ts)） |
| **手机 TT 填表防串轮次加固** | ✅ 代码+单测完成 | 新增 [message-gate.ts](src/sese-ledger/core/message-gate.ts) 过滤 `first_message/quiet/impersonate/command/extension`、让步并轮询等待下标 `id` 对应 AI 楼层正文物化、防切聊串台；`fillBusy` 改为 `pendingAutoFill` 结束后补跑不丢轮；`scribe.ts` 实现 `splitPlanByBatchSize` 按 `batchSize` 切批 |
| **上下文标签剥离分层与逐楼清洗** | ✅ 代码+单测完成 | 同步 `contextKeepTags` + 剥离优先级保护（[context-strip.ts](src/unified-statusbar/core/context-strip.ts)），`scribe.ts`/`director-runtime.ts` 改为逐楼独立清洗后再拼接防跨楼误吞（`v0.1.0-alpha.4`） |
| **API 源与出站消息兼容（gpt-load / Gemini 原生渠道）** | ✅ 代码+单测完成 | [host-config.ts](src/sese-ledger/core/host-config.ts) 的 `presetToCustomApi` 按预设透传 `source`（仅非 `openai` 才写字段），并用共享件 `tagCustomApiPostProcessing` 登记前端出站策略（缺省/非法回退 `semi`）；新增 [tests/ai-tool-shield.test.mjs](tests/ai-tool-shield.test.mjs) 覆盖 source 透传与「首条非系统消息后无 system/developer」（`v0.1.0-alpha.7`） |
| **后台 AI 请求提示词与外挂世界书清洗** | ✅ 代码+单测完成 | 同步状态栏四道净化共享件（默认仅放行 `primary` 主世界书、屏蔽 `globalLore`/`additional`/`chatLore`、`role:assistant` 剔除、内置正文向核心词根过滤与出站 stray `assistant`/扩展注入剥离）；[ai-request.ts](src/sese-ledger/core/ai-request.ts) 与 [host-ai.ts](src/sese-ledger/core/host-ai.ts) 为填表拆分 `LEDGER_FILL_NATIVE_SLOTS`（保留净设定、剔除 `dialogue_examples` 与 `chat_history`），[scribe.ts](src/sese-ledger/core/scribe.ts) 补齐「忽略文风/状态栏/思维链」参考声明；保留楼层「保留标签/剥离标签」不变；新增 [tests/bg-isolation.test.mjs](tests/bg-isolation.test.mjs)（`v0.1.0-alpha.8`–`9`） |
| **工作台 UI 与模板持久化** | ✅ 代码+单测完成 | 奶油手账日间默认主题（支持深浅切换）；表格数据页重构为电脑端滑动网格布局并下线字段健康页签；跨卡记住并沿用当前模板（[settings/panel/](src/sese-ledger/settings/panel/shell.ts)） |
| **进度 Toast 防误触与单开兜底** | ✅ 代码+单测完成 | `fill-notify.ts` 为进度 toast 补充 `sl-progress-toast` 单开/原版兜底半透明紧凑样式与 `30×30` 大 `×` 热区，捕获阶段拦截关闭钮旁 8px 缓冲带误触并转为关闭到后台（[fill-notify.ts](src/sese-ledger/core/fill-notify.ts) `v0.1.0-alpha.5`） |
| **魔改推进与状态栏后台演化 v2 联动** | ✅ 代码+单测完成 | [statusbar-cognition.ts](src/sese-ledger/core/statusbar-cognition.ts) 升级消费 v2 `eventPool`（兼容 v1）并产出 `<statusbar_events>`（宁缺毋滥/限量/防撞车/`<world_ack>` 回执）；[director.ts](src/sese-ledger/core/director.ts) 解除预设名硬编码（`statusbarBridge` + `{{world_cue}}` 识别）并解析 `sl_world_ack`；[host-ai.ts](src/sese-ledger/core/host-ai.ts) 委派时暂停 `UBS-世界演化-世界动态` 防重喂；[director-runtime.ts](src/sese-ledger/core/director-runtime.ts) 三入口落楼写回 `sl_world_ack`；[plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json)/[plot-tab.ts](src/sese-ledger/settings/panel/plot-tab.ts)/[plot-regex-template.ts](src/sese-ledger/core/plot-regex-template.ts)/[index.ts](src/sese-ledger/index.ts) 补齐 `<world_cue>` 展示、极简桥开关与 `isDriverWorldBridgeActive`（`v0.1.0-alpha.10`） |
| **剧情推进面板重制与 AI 请求管线同步（`0.1.0-alpha.11`）** | ✅ 代码+单测完成 | [plot-regex-template.ts](src/sese-ledger/core/plot-regex-template.ts) 重制为奶油手账（日间网格纸/樱粉）+ TokyoNight Storm（夜间）双主题，支持 `NSFW` 标记、`<match>` 召回依据、`<world_cue>` 后台切入与 `sl_world_ack` 选中/压住提示；同步内嵌共享件 [ai-request-pipeline.ts](src/unified-statusbar/core/ai-request-pipeline.ts) 的 `buildStandardPromptMiddle` 内联直传；新增 [tests/plot-regex-panel.test.mjs](tests/plot-regex-panel.test.mjs) |
| **思考链泄漏加固与魔改预设保底（`0.1.0-alpha.12`）** | ✅ 代码+单测完成 | [director.ts](src/sese-ledger/core/director.ts) 的 `extractTag` 先用栈式 `stripContextTags` 剔块、再切除孤儿 `</thinking>` / `</think>` 后才配对目标闭标签（防 `<thinking>` 内顺嘴提及未闭合标签把大段推理吞进 `<recall>` / `<world_cue>`），面板 `tag()` 同步；`assembleFinalDirective` 过滤 `<world_cue>` 占位空词；[plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json) 恢复「至少 25 条 AM 保底（不足全召回）」；扩充 `director-p4.test.mjs` / `plot-regex-panel.test.mjs` |
| **角色心路档案表、物理隔离填表与 `<radar>` 推进（`0.1.0-alpha.13`）** | ✅ 代码+单测完成 | [standard-template.json](src/sese-ledger/assets/standard-template.json) 升级为 19 表：放宽 `恋爱日记表` 准入到重要角色表并新增 `角色心路档案表`（`sheet_char_mind_profile`，7 列，`readMode: 'none'`，`worldbook.enabled: false`）；[scribe.ts](src/sese-ledger/core/scribe.ts) 新增在场优先单角色物理隔离填表通道（`selectMindFillTargets` / `buildIsolatedMindFillRequest` / `validateIsolatedMindOps` / 单写者串行落账）及设置页开关与上限（默认开、上限 3 人）；[director.ts](src/sese-ledger/core/director.ts) / [director-runtime.ts](src/sese-ledger/core/director-runtime.ts) / [ai-request.ts](src/sese-ledger/core/ai-request.ts) / [plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json) 接入 `mindBrief` 切片块、双向防全知 / `<EQUIV_BAN>` / `Pool_1 ≻ Pool_2` 与按需 `<radar>` 四向错位标签；新增 [tests/mind-profile-pipeline.test.mjs](tests/mind-profile-pipeline.test.mjs) |
| **去“记账/暗账/旧账”人机口癖清洗（`0.1.0-alpha.16`）** | ✅ 代码+单测完成 | 全面清理 [plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json)、[standard-template.json](src/sese-ledger/assets/standard-template.json)（`角色心路档案表` 退火描述）与 [scribe.ts](src/sese-ledger/core/scribe.ts) 中容易诱发大模型套用“记入暗账/暂搁旧账”口癖的措辞，统一改为“暂压心底 / 先搁一边”，并配合主预设清除全部启用条目中的“暗中记账”诱导词 |
| **台账退居幕后辅助分析（`0.1.0-alpha.15`）** | ✅ 代码+单测完成 | 纠正早期精简割裂主预设思考链的问题：主协同预设已完整恢复原版角色锚（`character-anchor`）、`<state>`/`<anchor>` 与 `<liwe>` 独立推演；同步将 [plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json)（`魔改召回`）从「推演导演 / 正文须遵从演绎」降级定位为**幕后辅助分析师**（仅提供 `AMxxxx` 记忆召回、跨角色盲点提醒与错位/风险参考，人物立场与剧情主走向交回正文模型与角色锚自主裁定），同时保留止损给台阶与感叹号克制防呆提醒；补充 `tests/mind-profile-pipeline.test.mjs` 回归用例 |
| **心路止损给台阶、1+4 任务重塑与反热血漫感叹号约束（`0.1.0-alpha.14`）** | ✅ 代码+单测完成 | 为解决实机多轮「抓着同一弱点反复钻牛角尖」问题，在 [standard-template.json](src/sese-ledger/assets/standard-template.json)（`角色心路档案表`）、[scribe.ts](src/sese-ledger/core/scribe.ts) 隔离填表指令与 [plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json) 推进规则同步加入「退火/止损/给台阶（锋芒 1~2 轮即止，余刺转暗账或换条件谈正事）」及「对话克制感叹号（！）」硬规则；将 `瑟瑟任务表`（`sheet_k7gp2gbw7`，同步状态栏侧 `docs/色色灵感数据库模板V3.3.4.json`）重塑为固定 **1 条瑟瑟 + 4 条有阻碍/有博弈感的日常·社交·探索任务**，明令禁止零阻碍流水账；扩展 `tests/mind-profile-pipeline.test.mjs` |
| **真机回归与可选本地模板测试** | ⏳ 待继续验证 | 离线：`npm test` **106 通过 / 3 跳过**（1 项为 jsdom 空聊天兜底，2 项依赖本机未附带的私人特调模板），`npm run check` 通过；真实手机 TT / 电脑 TT 配合恢复主预设角色锚与辅助定位后的多轮对手戏、独立心路隔离填表（止损给台阶/感叹号克制）、1+4 趣味任务生成与魔改推进事件闭环待真机验证 |

---

> **单开安全降级**：未启用 `n-sese-unified-statusbar` 时台账照常运行——从状态栏打开工作台、`__ubWorldbookProjection` 共享写入队列、`__ubWorldCognitionSnapshot`（v2 事件池，兼容 v1）与 `__ubStorageRelocation` 全部缺席，此时台账退回自建投影与单机路径：不报错、不阻断填表与推进，`isDriverWorldBridgeActive()` 返回 `false`，推进预设的 `<world_cue>` 桥接自动关闭。

## 3. 角色卡开发必读：表结构、世界书与推进契约

### 3.1 默认标准模板全表速查（19 张表）

来源于 [standard-template.json](src/sese-ledger/assets/standard-template.json)（分组 `1=角色组`，`2=基础组`，`3=不更新组`）。写角色卡内嵌设定、MVU 状态或扩展读表查询时，表名与列名以此为准：

| 分组 | 表名 | 精确列名（已略去内部 `row_id`） |
|---|---|---|
| `group 1` | `主角信息表` | `姓名`, `性别`, `生日`, `外貌特征`, `身份背景`, `近况`, `瑟瑟能量` |
| `group 1` | `恋爱对象表` | `姓名`, `性别`, `生日`, `一句话介绍`, `外貌特征`, `身份`, `语言风格和口癖`, `对主角态度`, `过往经历`, `最近亲密互动` |
| `group 1` | `重要角色表` | `姓名`, `性别`, `生日`, `一句话介绍`, `外貌特征`, `身份`, `语言风格和口癖`, `对主角态度`, `过往经历` |
| `group 1` | `人物关系表` | `人物A`, `人物B`, `关系类型`, `相互看法`, `起因备注`, `关系状态` |
| `group 1` | `角色里程碑表` | `姓名`, `里程碑事件` |
| `group 1` | `NSFW信息表` | `姓名`, `身高/体重`, `三围/罩杯`, `身材与特异性征`, `性爱接受度和XP倾向`, `性经验程度`, `下体状态`, `后庭状态`, `泌乳/体液状态`, `床上淫语风格`, `调教值`, `性爱次数`, `最近性行为`, `对主角的称呼` |
| `group 1` | `人物性格偏移表` | `姓名`, `近期情绪状态`, `对主角的交互逻辑`, `被强化的性格侧面`, `被弱化的性格侧面`, `行为模式变化` |
| `group 1` | `在场角色表` | `姓名`, `当前状态`, `内心想法`, `下一步打算`, `当前穿搭`, `上装`, `下装`, `内衣/内裤`, `袜子`, `鞋子`, `饰品`, `情绪` |
| `group 1` | `即时生理反应表` | `姓名`, `胸部`, `下体`, `口穴`, `菊穴`, `其他部位` |
| `group 1` | `恋爱日记表` | `写作角色`, `关联角色`, `日记内容`, `发生时间`, `事件类型` |
| `group 1` | `角色心路档案表` | `姓名`, `人格底色与筹码`, `已知事实与盲点`, `四向关系认知`, `个人进度与打算`, `核心纠结与情绪惯性`, `蝴蝶效应留痕` |
| `group 2` | `全局数据表` | `当前详细地点`, `上轮场景时间`, `经过的时间`, `当前时间`, `是否色色` |
| `group 2` | `备忘录` | `备忘标题`, `类型`, `相关角色`, `详细内容`, `当前状态`, `记录时间`, `约定时间`, `后续结果` |
| `group 2` | `物品表` | `物品名称`, `类型`, `数量`, `描述` |
| `group 2` | `检定建议表` | `展示文本` |
| `group 2` | `纪要表` | `编码索引`, `时间跨度`, `概览`, `纪要`, `重要对话` |
| `group 2` | `瑟瑟任务表` | `任务名称`, `任务描述`, `任务目标`, `完成情况` |
| `group 2` | `主角技能表` | `技能名称`, `技能类别`, `技能经验值`, `技能描述` |
| `group 3` | `杂表` | `名称`, `描述` |

### 3.2 台账世界书投影规则（`SeseLedger-*`）

由 [lens.ts](src/sese-ledger/core/lens.ts) 经状态栏协调器写入角色主世界书，**写卡勿新建 `SeseLedger-` 或 `TavernDB-ACU-` 开头条目**：

- **通用准则**：`row_id` 仅在填表/推进请求内部供 SQL 定位行使用，**世界书投影绝不输出 `row_id`**；空表（0 行）不产出条目。
- **常量表**：整表单条目，命名 `SeseLedger-<表名>`（如 `SeseLedger-备忘录`）。
- **关键词按行触发**：每行一条目，命名 `SeseLedger-<表名>-<主关键词值>`，包裹标签 `<表名-主关键词值>`；`人物关系表` 特判为 `SeseLedger-人物关系表：<A>与<B>的关系`（主+次关键词 `and_any`）。
- **纪要表特判（按 `AM` 码召回）**：
  - 组头 `SeseLedger-纪要-过往记忆Start`（`order: 9985`，`constant: true`）输出 `<过往记忆>` 与格式说明；
  - 纪要行 `SeseLedger-纪要-<编码索引>`（`order: 9990`，`keys` 为 `AM0001` 等编码拆分，内容为 `时间跨度|纪要|重要对话`）；
  - 组尾 `SeseLedger-纪要-过往记忆End`（`order: 9995`，`constant: true`）输出 `</过往记忆>`；
  - 剧情推进在 `<recall>` 中输出 `AMxxxx`，下一发给主对话模型时酒馆原生世界书即按关键词自动点亮对应纪要行。

### 3.3 自动填表与剧情推进运行契约

1. **自动填表链路**（[index.ts](src/sese-ledger/index.ts) → [message-gate.ts](src/sese-ledger/core/message-gate.ts) → [scribe.ts](src/sese-ledger/core/scribe.ts)）：
   - `MESSAGE_RECEIVED(id, type)` 自动跳过 `first_message`（开场白不填表）、`quiet`、`impersonate`、`command`、`extension`；
   - 异步退出宿主事件栈并核验 `chat[id]` 已落定为非空 AI 楼层后再同步楼层锚点（[floor-scope.ts](src/sese-ledger/core/floor-scope.ts)）与计算更新计划；
   - 填表上下文仅取到期 AI 楼层正文，经过状态栏同款 `stripWithContextConfig`（配置在状态栏「上下文标签剥离」）剥除 `<thinking>`/`<options>`/`<orange>`/`<UpdateVariable>` 等非正文块后注入 `【当前正文】`；
   - `batchSize` 按批由旧到新并发请求组，落账并推进水位后继续下一批；上一轮未结束时新回复触发 `pendingAutoFill` 排队补查。
   - 启用「心路隔离填表」（默认开，上限 3 人）时，`角色心路档案表` 自动脱离 `group 1` 打包请求，改为在常规组落账后按「在场且提及 ＞ 在场 ＞ 提及频次」选人发起单角色物理隔离请求（只附本人基础档案、本人近期去标签日记与本人心路行，`scanText` 仅传本人姓名，越权改写他人会被拦截）。
2. **剧情推进与用户楼字段**（[director.ts](src/sese-ledger/core/director.ts) & [director-runtime.ts](src/sese-ledger/core/director-runtime.ts)）：
   - 规划写入用户消息的字段：`mes`（聚合后最终指令）、`sl_plot`（最终指令真源）、`sl_plot_tasks`（各子任务原始输出，含 `<recall>`/`<soul>`/`<radar>`/`<chaos>`/`<world_cue>`/`<spot>`）、`sl_world_ack`（隐藏事件池回执，供状态栏确认/冷却且不进正文）、`_sl_processed`（防重放）。
   - `mindBrief` 块从实时账本提取至多 6 名在场/提及核心角色的心路维度与近 1~2 篇日记切片，供魔改推进输出防全知 `<soul>` 与按需四向错位 `<radar>`（无触发条件时完全省略，不留空标签）。
   - 历史只留用户原话正则 `【瑟瑟台账】剧情推进·历史只留输入` 会自动把历史楼层还原为 `<本轮用户输入>` 内原话，不让推进指令污染长期对话历史。
   - 对外全局 API 面见下方 3.3.1。

### 3.3.1 对外 API 面（`window.SeseLedgerAPI`）

装载完成时 canonical 对象同时挂到 `window.SeseLedgerAPI` 与 `parent.SeseLedgerAPI`；未检测到外部真数据库时条件注册 `window.AutoCardUpdaterAPI = __legacyFace`（老版状态栏与现版小手机零改动可用），检测到真数据库则只旁观不注册；卸载时按同样条件删除。

| 成员 | 用途 |
|---|---|
| `version` / `ready` | 版本号与就绪 Promise |
| `__legacyFace` | 老形态 API 的直接投影（`AutoCardUpdaterAPI` 兼容面） |
| `fieldContracts` | 字段契约注册表（外部模块按表/列查询展示名与语义） |
| `reportIssue(level, source, message, detail?)` | 外部模块把低频失败写进工作台日志（来源非六类时归「其他」；成功路径禁用） |
| `snapshot()` / `query(table, opts)` / `readCell(table, rowId, column)` / `apply(ops, opts)` | 读写门面：整本快照、按表查询、读单元格、批量提交操作 |
| `onChange(cb)` | 表格数据变更订阅（返回注销器） |
| `tableWorldbookInjection(table)` | 该表是否由台账投影世界书（v2 `worldbook.enabled` 且非停用组）；状态栏据此让位重复注入 |
| `isDriverWorldBridgeActive()` | 推进是否正与状态栏后台事件桥联动（真数据库旁观 / 推进关闭 / 预设未开桥接 → `false`） |
| `notifyStatusbarWorldbookSync()` | 手动触发状态栏世界书投影重排（world / character-dynamic）；桥缺席时静默 |
| `driver` | 推进预设面：`builtinNames()` / `getPreset()` / `setPreset()` / `deletePreset()` / `isValidPreset()` / `resetRound(input)` |
| `fill` | 填表面：`isRunning()` / `getState()` / `subscribe()` / `terminate()` / `runNow()` / `refreshWorldbook()` |
| `summaryMerge` / `timemachine` / `migrate` | 纪要合并、时光机回滚、真数据库迁移向导（`fromDb` / `alignToTemplate` / `apply`） |
| `templateBinding` / `exportBook()` / `importBook()` / `recovery` / `bakeStateAt(floor)` | 模板绑定与套用、整本导入导出、台账找回、按楼层烘焙状态 |
| `prompts` / `aiRequest()` / `openSettings(tab?)` / `syncPlotRegex()` | 提示词读写、建表向导同源 AI 请求、打开工作台指定页签、推进显示正则联动 |

**双向生命周期挂钩**：台账 `dispose()` 先撤 `projectionBridge` 的外部投影注册（防协调器读到已封存 runtime），再执行 disposers、`flush()` 并 `close()` / `destroy()` 存储、注销面板与两处全局 API；反向地，状态栏启用时通过 `__ubWorldbookProjection` 注册投影描述符、通过 `__ubWorldCognitionSnapshot` 提供只读快照，台账据 `isDriverWorldBridgeActive()` 决定是否产出 `<world_cue>` 并写回 `sl_world_ack`。

---

## 4. 模块与关键源码索引

| 目录 / 文件 | 职责 |
|---|---|
| [src/sese-ledger/index.ts](src/sese-ledger/index.ts) | 插件入口、事件绑定、填表互斥与补跑调度、`SeseLedgerAPI` 挂载与卸载 |
| [src/sese-ledger/core/message-gate.ts](src/sese-ledger/core/message-gate.ts) | `MESSAGE_RECEIVED` 事件过滤、异步让步与下标楼层物化校验 |
| [src/sese-ledger/core/scribe.ts](src/sese-ledger/core/scribe.ts) | 填表计划计算（`computeUpdatePlan`）、`splitPlanByBatchSize` 切批、提示词拼装、AI 重试、目标楼层钉住与 SQL 落账 |
| [src/sese-ledger/core/runtime.ts](src/sese-ledger/core/runtime.ts) & [floor-scope.ts](src/sese-ledger/core/floor-scope.ts) | 账本运行时状态、楼层锚点（`ledgerAnchorFor`）、删楼/Swipe 自动回退与水位重基 |
| [src/sese-ledger/core/lens.ts](src/sese-ledger/core/lens.ts) & [projection-bridge.ts](src/sese-ledger/core/projection-bridge.ts) | `SeseLedger-*` 世界书条目生成与状态栏投影协调器桥接 |
| [src/sese-ledger/core/director.ts](src/sese-ledger/core/director.ts) & [director-runtime.ts](src/sese-ledger/core/director-runtime.ts) | 剧情推进双策略拦截（已落楼/输入框）、跨聊天/删楼目标校验、召回与骰点组装 |
| [src/sese-ledger/core/statusbar-cognition.ts](src/sese-ledger/core/statusbar-cognition.ts) | 状态栏 `__ubWorldCognitionSnapshot` 只读适配器（给内置魔改预设喂认知与入镜候选） |
| [src/sese-ledger/assets/](src/sese-ledger/assets/standard-template.json) | `standard-template.json`（19 表标准模板）、`plot-preset-magic-recall.json`、`plot-preset-pure-recall.json` |
| [src/unified-statusbar/core/context-strip.ts](src/unified-statusbar/core/context-strip.ts) | 台账内嵌的标签剥离实现（与状态栏保持同步单遍栈式算法） |
| [src/sese-ledger/core/time-machine.ts](src/sese-ledger/core/time-machine.ts) / `summary-merge.ts` / `migrator.ts` / `relocation.ts` | 时光机快照恢复、纪要合并压缩、真数据库（`qrf_plot`/`TavernDB`）迁移、一键搬家 |
| [src/sese-ledger/settings/panel/](src/sese-ledger/settings/panel/shell.ts) | 台账**九页签**工作台面板（`TAB_DEFS`，[shell.ts:476-486](src/sese-ledger/settings/panel/shell.ts#L476-L486)：数据、表格、填表、推进、时光机、纪要合并、迁移、日志、设置）；`index.ts` 内注释仍写「六标签页」，以 `TAB_DEFS` 为准 |
| [index.js](index.js) → [runtime/extension.js](runtime/extension.js) | 宿主装载层：能力检查、安装状态面板、旧脚本/数据库混装拦截、动态 `import('dist/index.js')`、启动后校验 `__SL_LOADED__` |
| [src/unified-statusbar/core/ai-request-pipeline.ts](src/unified-statusbar/core/ai-request-pipeline.ts) / [ai-tool-shield.ts](src/unified-statusbar/core/ai-tool-shield.ts) | 内嵌共享件：后台 AI 请求管线与出站消息净化（填表/推进共用提示词拼装与自定义 API `source` 透传） |
| [src/unified-statusbar/core/worldbook-entry.ts](src/unified-statusbar/core/worldbook-entry.ts) / [worldbook-projection.ts](src/unified-statusbar/core/worldbook-projection.ts) / [external-projection-client.ts](src/unified-statusbar/core/external-projection-client.ts) | 内嵌共享件：世界书条目构造、主世界书解析、外部投影注册（最后一个为伴生仓专用） |
| [src/unified-statusbar/core/env.ts](src/unified-statusbar/core/env.ts) | 内嵌共享件：`getToastr()` 含台账 toast 前缀定制 |

---

> **内嵌共享件同步边界**：`src/unified-statusbar/core/`（42 个文件）与 `docs/色色灵感数据库模板V3.3.4.json` 是仓库内副本，与 `n-sese-unified-statusbar` 同名文件保持算法一致，但 `env.ts`（台账 toast 前缀）与 `external-projection-client.ts`（伴生仓专用）为有意差异；同步上游时逐文件比对、**禁止整目录覆盖**，改后刷新 `source-files.sha256.json`。详见 [src/README.md](src/README.md)。

## 5. 构建与自检命令

环境：Node `>=22.12.0`（`package.json` 的 `engines`），CI 用 Node 24（[.github/workflows/build.yml](.github/workflows/build.yml)）。新克隆先 `npm ci` 安装依赖（`npm install` 可能改写 lockfile）。

在 `n-sese-suite/n-sese-ledger` 目录下执行：

```powershell
npm ci
npm run build                    # esbuild 打包 dist/index.js
npm test                         # node --test tests/*.test.mjs（当前 109 项：106 通过 / 3 跳过 / 0 失败）
npm run check                    # scripts/check-release.mjs：清单、入口依赖、产物与 src/ SHA-256 校验
git diff --exit-code -- dist     # CI 同款：构建产物必须与源码构建结果一致
```

**3 项跳过测试的原因**（环境缺件，不是失败）：

1. `聊天清空后恢复状态栏壳，保留已迁出的弹窗；卸载器解绑`——台账 `template: false`，该用例为状态栏壳专用，台账侧不注入壳；
2. `用户斯德哥摩尔特调：读写、结构保存、切换、取消与重载持久化`——需本机私人特调模板，设置 `LEDGER_ACCEPTANCE_TEMPLATE` 后才运行；
3. `真实「生活化 → 去情绪」模板预览指出情绪列`——本地私人模板未提供，显式跳过而不用 Git/宿主路径替代。

**`check-release.mjs` 的真实校验范围**：`manifest.json` 与 `package.json` 版本一致、`homePage` 指向 `github.com/<owner>/<pkg.name>`、`manifest.js === 'index.js'`、版本号格式合规、必需文件存在（`index.js` / `runtime/*` / `dist/index.js` / `SOURCE_NOTICE.md` / `README.md`）、`index.js` 的本地静态依赖可被 esbuild 解析、`dist/index.js` 非空且不含本机绝对路径、`source-files.sha256.json` 内每个文件逐条重算 SHA-256。

**它不做什么**：不校验 lockfile 四处版本一致；不自动发现 `src/` 下漏登记的新文件（清单靠人维护）；不重算 `dist/index.js` 与源码是否同构——这三项分别靠人工核对、登记纪律与 `npm run build` + `git diff --exit-code -- dist`（CI 已跑）兜底。

**更新 `source-files.sha256.json` 的方法**：键为仓库相对路径（`src/...`），值为该文件字节的 SHA-256（小写十六进制）。改完 `src/**` 后只重算受影响条目即可；单条核对：

```powershell
node -e "const fs=require('fs'),c=require('crypto');console.log(c.createHash('sha256').update(fs.readFileSync('src/README.md')).digest('hex'))"
```

批量重算清单内已有条目（一次性脚本，跑完删除）：

```powershell
@'
const fs = require('fs'), c = require('crypto');
const p = 'source-files.sha256.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
for (const k of Object.keys(j.files)) j.files[k] = c.createHash('sha256').update(fs.readFileSync(k)).digest('hex');
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
'@ | Set-Content -Encoding utf8 refresh-hashes.cjs
node refresh-hashes.cjs
Remove-Item refresh-hashes.cjs
```

新增/删除 `src/**` 文件时必须手工增删对应键；之后 `npm run check` 会逐条复核。

---

## 6. 改造记录（Changelog，后续 AI 改完必须按此表倒序追加）

| 日期 | 版本 / Commit | 改动范围与摘要 | 验证状态 |
|---|---|---|---|
| 2026-11-26 | `0.1.0-alpha.16` | 清洗提示词“记账/暗账/旧账”人机口癖：[plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json)、[standard-template.json](src/sese-ledger/assets/standard-template.json) 与 [scribe.ts](src/sese-ledger/core/scribe.ts) 将涉及角色心理余波的“记入暗账/暂搁旧账”全部改写为“暂压心底/先搁一边”，与主预设同步消除“动辄念叨记账/算账”的机械模板 | `build` / `test` 106 通过 3 跳过 / `check` 全绿；待真机验收 |
| 2026-11-26 | `0.1.0-alpha.15` (`b5d5470`) | 推进器降级为幕后辅助分析师：[plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json)（`魔改召回`）移除“推演导演 / 须在正文中自然遵从演绎”越权命令，改定位为仅提供 `AMxxxx` 记忆召回、信息盲点提醒、潜在风险（`<soul>` SEG2/SEG3）与错位参照（`<radar>`）的幕后参谋，将角色立场、九型/依恋推演与剧情走向完全交回主预设 `<anchor>` 与 `<liwe>`；保留【止损与台阶法则】【克制标点与反热血漫腔】防呆提醒；新增 `tests/mind-profile-pipeline.test.mjs` 辅助定位回归测试 | `build` / `test` 106 通过 3 跳过 / `check` 全绿；待真机验收 |
| 2026-11-26 | `0.1.0-alpha.14` (`2807fc0`) | 心路推进止损给台阶、任务 1+4 趣味重塑与标点克制：[standard-template.json](src/sese-ledger/assets/standard-template.json) 与同步副本 [色色灵感数据库模板V3.3.4.json](src/unified-statusbar/docs/色色灵感数据库模板V3.3.4.json) 为 `角色心路档案表` 补充退火与台阶机制（禁连续多轮抓同一弱点钻牛角尖），并将 `瑟瑟任务表`（`sheet_k7gp2gbw7`）固定为 1 条瑟瑟 + 4 条高趣味有阻碍的日常/社交/探索任务（禁流水账）；[scribe.ts](src/sese-ledger/core/scribe.ts) 同步隔离填表退火指令；[plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json) 增补【止损与台阶法则】【克制标点与反热血漫腔】及 `<task_soul>` / `finalDirectiveTemplate` 约束；扩展 `tests/mind-profile-pipeline.test.mjs` | `build` / `test` 105 通过 3 跳过 / `check` 全绿；待真机验收 |
| 2026-11-26 | `0.1.0-alpha.13` (`25e4b70`) | 落地角色心路管线与物理隔离填表：[standard-template.json](src/sese-ledger/assets/standard-template.json) 升级为 19 表（放宽 `恋爱日记表` 准入到重要角色表，新增 `角色心路档案表` `sheet_char_mind_profile` 7 列、`readMode: 'none'`、`worldbook.enabled: false`）；[scribe.ts](src/sese-ledger/core/scribe.ts) 新增单角色物理隔离填表通道（`selectMindFillTargets` / `buildIsolatedMindFillRequest` / `validateIsolatedMindOps` / `parseIsolatedMindFillOutput`）与 `settings-store.ts` / `settings-tab.ts` 开关及人数上限（默认开、3 人）；[ai-request.ts](src/sese-ledger/core/ai-request.ts) / [director.ts](src/sese-ledger/core/director.ts) / [director-runtime.ts](src/sese-ledger/core/director-runtime.ts) / [plot-tab.ts](src/sese-ledger/settings/panel/plot-tab.ts) 接入 `mindBrief` 块与 `<radar>` 空值清理；[plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json) 升级双向防全知、`<EQUIV_BAN>`、情绪惯性、`Pool_1 ≻ Pool_2` 与按需 `<task_radar>`；新增 [tests/mind-profile-pipeline.test.mjs](tests/mind-profile-pipeline.test.mjs) 并更新 `director-p4.test.mjs` | `build` / `test` 105 通过 3 跳过 / `check` 全绿；待真机验收 |
| 2026-11-26 | `0.1.0-alpha.12 (docs)` | 纯文档交接校对：补全并更新 [README.md](README.md) / [AGENTS.md](AGENTS.md) / [SOURCE_NOTICE.md](SOURCE_NOTICE.md) / [src/README.md](src/README.md) / [src/sese-ledger/README.md](src/sese-ledger/README.md)——九页签工作台、状态栏 v2 联动与面板/防泄漏汇总、装载链与内嵌共享件同步边界、`check-release.mjs` 真实校验范围与哈希维护方法；同步刷新两份 `src/*.md` 的 SHA-256 清单。不改代码、不递增版本号 | `build` / `test` 99 通过 3 跳过 / `check` 全绿 |
| 2026-11-22 | `0.1.0-alpha.12` | 加固 `extractTag` 与面板 `tag()` 防思考链泄漏（先用栈式 `stripContextTags` + 孤儿 `</thinking>`/`</think>` 切除思维链，再以最近开标签配对 `</tag>`，防 `<thinking>` 内未闭合顺嘴提及把大段推理吞进 `<recall>`/`<world_cue>`；`assembleFinalDirective` 过滤 `<world_cue>` 占位空词）；[statusbar-cognition.ts](src/sese-ledger/core/statusbar-cognition.ts) 提示禁止在思考写未闭合标签及空标签说明；内置 [plot-preset-magic-recall.json](src/sese-ledger/assets/plot-preset-magic-recall.json) 切换为「至少 25 条 AM 保底（不足全召回）」+ 精简 `<match>` 短句 + 保留 `<world_cue>`；扩充 `director-p4.test.mjs` / `plot-regex-panel.test.mjs` | `build` / `test` 99 通过 3 跳过 / `check` 全绿；待真机验收 |
| 2026-11-19 | `0.1.0-alpha.11` | 同步状态栏 `ai-request-pipeline.ts`（`buildStandardPromptMiddle` 内联直传）；升级并美化 [plot-regex-template.ts](src/sese-ledger/core/plot-regex-template.ts) 剧情推进面板（日间奶油手账网格纸/樱粉 + 夜间 TokyoNight Storm、支持 `NSFW` 标记/`<match>` 召回依据/`<world_cue>` 后台切入/`sl_world_ack` 选中与压住提示）；新增 [tests/plot-regex-panel.test.mjs](tests/plot-regex-panel.test.mjs) | `build` / `test` 97 通过 3 跳过 / `check` 全绿；待真机验收 |
| 2026-11-19 | `0.1.0-alpha.10` | 魔改推进深度适配状态栏后台演化 v2 事件池：`statusbar-cognition.ts` 消费 v2 `eventPool`（兼容 v1）并注入 `<statusbar_events>`；`director.ts`/`plot-preset-magic-recall.json` 新增 `statusbarBridge` 能力判据、独立出口 `<world_cue>`（空白不留空行）与隐藏回执 `extractWorldAck`；`host-ai.ts` 在 `worldbookDelegated` 时暂停 `UBS-世界演化-世界动态` 防重喂；`director-runtime.ts` 三入口落楼写入 `sl_world_ack`；`index.ts` 暴露 `isDriverWorldBridgeActive` 与变更自动同步；`plot-tab.ts` 新增极简勾选框、`plot-regex-template.ts` 渲染「后台切入」卡片；扩展 `director-p4.test.mjs` / `director-runtime.test.mjs` / `statusbar-bridge-contract.test.mjs` 含 v2 跨仓闭环测试 | `build` / `test` 95 通过 3 跳过 / `check` 全绿；待真机验收 |
| 2026-11-18 | `0.1.0-alpha.9` | 同步状态栏共享件注释与精简 `fill-tab.ts` `scan` 说明文案，移除无关第三方引用词 | `build` / `test` 79 通过 3 跳过 / `check` 全绿；已推仓 |
| 2026-11-18 | `0.1.0-alpha.8` | 同步状态栏后台 AI 请求净化与外挂世界书隔离共享件（默认只放行 `primary` 主世界书、屏蔽 `globalLore`/`additional`/`chatLore`、剔除 `role:assistant`、启用内置正文向核心词根过滤并出站剥离第三方扩展注入）；`ai-request.ts`/`host-ai.ts` 为填表拆分 `LEDGER_FILL_NATIVE_SLOTS`（保留净设定、剔除 `dialogue_examples` 与 `chat_history`）；`scribe.ts` `scan` 抬头新增「忽略正文文风/状态栏/思维链要求」声明；更新 `fill-tab.ts` 说明；新增 `tests/bg-isolation.test.mjs` | `build` / `test` 79 通过 3 跳过 / `check` 全绿；已推仓待 TT 拉取真机验收 |
| 2026-11-17 | `0.1.0-alpha.7` | 同步状态栏出站兼容件（`constants.normalizeCustomApiSource` / `normalizeCustomApiPostProcessingMode`、`ai-tool-shield.tagCustomApiPostProcessing`）；[host-config.ts](src/sese-ledger/core/host-config.ts) 的 `presetToCustomApi` 透传预设 `source`（`openai` 不写字段）并登记前端出站策略；新增 `tests/ai-tool-shield.test.mjs`（source 透传 / `semi` 回退 / 混排固定块经 `scrubGenerateData(..., 'semi')` 后无中段 system） | `build` / `test` 77 通过 3 跳过 / `check` 全绿；已推仓待 TT 拉取真机验收 |
| 2026-11-17 | `0.1.0-alpha.6` | `index.ts` 与内嵌 `env.ts` 的 `getToastr()` 及 `fill-notify.ts` 统一为台账全部 toast（含报错与警告）自动加「台账」前缀；扩展 `tests/toast-ui.test.mjs` | `build` / `test` 75 通过 3 跳过 / `check` 全绿；已推仓待 TT 拉取真机验收 |
| 2026-11-17 | `0.1.0-alpha.5` | `fill-notify.ts` 进度 toast 新增贴边防误触拦截与单开半透明/紧凑/30×30 大 `×` 兜底样式，防止点击关闭到后台时误触任务中止；新增 `tests/toast-ui.test.mjs` | `build` / `test` 74 通过 3 跳过 / `check` 全绿；已推仓待 TT 拉取真机验收 |
| 2026-11-17 | `0.1.0-alpha.4` | 同步 `contextKeepTags` 保留标签提取与剥离标签优先级保护；`scribe.ts` 与 `director-runtime.ts` 改用 `stripWithContextMessages` 逐楼独立清洗后再拼接；扩展 `tests/context-strip.test.mjs` | `build` / `test` 73 通过 3 跳过 / `check` 全绿；已推仓待 TT 拉取真机验收 |
| 2026-11-15 | `0.1.0-alpha.3` (`5f90879`) | 同步重写台账侧 `context-strip.ts` 为单遍栈式配对剥离，防止思维链内未闭合孤儿标签误吞 `<content>` 正文；新增 `tests/context-strip.test.mjs` | `build` / `test` 67 通过 3 跳过 / `check` 全绿 |
| 2026-11-15 | (`0e76ad7`) | 加固手机 TT 自动填表：新增 `message-gate.ts` 过滤非剧情事件并轮询等待下标楼层物化；`fillBusy` 改为 `pendingAutoFill` 结束后补跑；`scribe.ts` 按 `batchSize` 切批；修复 `director-runtime.ts` `.trim()` 不一致；新增 `tests/scribe-turn-order.test.mjs` | `build` / `test` 66 通过 3 跳过 / `check` 全绿 |
| 2026-11-14 | (`79d5a8a`) | 落地 P1/P4：`plot-preset-*.json` 改为 `0～N` 上限召回与去固定模板；新增 `statusbar-cognition.ts` 消费状态栏 `__ubWorldCognitionSnapshot`；`director-runtime.ts` 防异步切聊天/删楼串写；跨仓联合测试 8 项 | `build` / `test` 60 通过 3 跳过 / `check` 全绿 |
| 2026-11-14 | (`1045656`) | 重构电脑端表格数据页为滑动网格布局并下线字段健康页签 | `build` / `test` / `check` 通过 |
| 2026-11-08 | (`5827cbb` / `1bd45a6`) | 全局记住并跨角色卡沿用当前表格模板；增加剧情推进历史只留用户原话正则 | 当轮测试与构建通过 |
| 2026-11-07 | `table-v1` (`1cf93bf` / `b14aebd`) | 工作台数据编辑、字段影响保护、奶油手账日间主题与模板结构持久化修复 | 当轮测试与构建通过 |
