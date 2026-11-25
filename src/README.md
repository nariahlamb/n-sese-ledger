# sese-ledger 源码目录（内嵌结构说明）

> 本目录当前服务于 **`n-sese-ledger` 独立工程**；文件末尾的「历史来源说明」保留 2026-10-25 原始分享包的完整说明与版权信息。

## 当前工程结构（独立 esbuild 工程）

`n-sese-ledger` 现在是**独立 esbuild 工程**，不再依赖同级源码目录，也不再需要放回某个 webpack 工程的 `src/` 下：

```
src/
├── sese-ledger/                        台账业务源码（入口 index.ts，58 个文件）
│   ├── core/                           账本存储、填表 SQL、剧情推进、投影、时光机、纪要合并、迁移
│   ├── settings/panel/                 工作台九页签（数据/表格/填表/推进/时光机/纪要合并/迁移/日志/设置）
│   └── assets/                         19 表标准模板与剧情召回预设
└── unified-statusbar/                  内嵌公共件子集（不是状态栏仓库的工作副本）
    ├── core/                           42 个共享模块（事件总线、聊天元数据宿主、世界书投影、上下文剥离、AI 请求管线等）
    └── docs/色色灵感数据库模板V3.3.4.json   标准模板来源（编译期 import）
```

- **构建入口**：`scripts/build.mjs`（esbuild，`src/sese-ledger/index.ts` → `dist/index.js`）。
- **测试位置**：仓库根目录 `tests/`（`npm test`，`node --test`），不在 `src/` 内。
- **发布自检**：`scripts/check-release.mjs`（`npm run check`），逐条重算本目录下文件的 SHA-256。

### 内嵌共享件与同步边界

`src/unified-statusbar/core/` 与 `n-sese-unified-statusbar` 的同名文件保持算法一致，但**允许存在台账定制**：

| 文件 | 台账侧差异 |
|---|---|
| `core/env.ts` | `getToastr()` 为台账全部 toast 统一加「台账」前缀 |
| `core/external-projection-client.ts` | 伴生仓专用，提供外部投影注册能力 |

**同步纪律**：从状态栏仓库拉取共享件时逐文件比对，跳过上述定制；禁止整目录覆盖。改完任何 `src/**` 文件都必须刷新 `source-files.sha256.json`，否则 `npm run check` 会失败。

---

## 历史来源说明（2026-10-25 原始分享包）

以下为原始分享包（日期：2026-10-25）的说明，**仅作历史记录**：当时本目录是三个酒馆助手扩展模块的源码阅读副本，三个目录需保持同级，`sese-ledger` 从 `../unified-statusbar/core` 与 `../unified-statusbar/docs` 引用公共模块；该形态已被上面的独立工程取代。

### 原目录

```
unified-statusbar/   主扩展（统一状态栏）
UBS_phone/           小手机
sese-ledger/         瑟瑟台账
```

### 原包含内容

- 三个模块的 TypeScript 运行源码（`index.ts`、`core/`、`renderers/`、`styles/`、`panels/`、`settings/` 等）
- 运行期资源：成就数据、卡池数据、技能/货币正文正则、数据库标准模板、台账标准模板与召回预设
- 各模块入口 HTML（宿主内联构建用）

### 原未包含内容

为控制分享范围并避免泄露内部资料，以下内容当时已剔除：

- 开发用 AI 记忆、架构笔记、协作规范（`claude_memory/`、`CLAUDE.md`、`AGENTS.md`）
- 内部设计文档、研究笔记、方案稿、mockup 与历史归档
- 测试套件与测试夹具
- 历史版本打包产物、旧版脚本 JSON、第三方正则与第三方角色卡资料
- 本地编辑器/代理配置、构建产物、依赖目录、绝对路径与个人标识

> 说明：其中「测试套件」在当前仓库已重新建立（`tests/`）；「构建产物」即现在的 `dist/index.js`。

### 原关于第三方名称

代码中仍保留少量**功能性**的第三方名称与兼容常量（例如宿主平台 API、数据库插件的公开接口名、生图插件的通道名、插件 toast 标题匹配串）。这些是运行时互通所必需的标识符，不是对第三方代码的复制。源码中涉及**外部项目**的借鉴/移植/调研来源说明与对比内容已移除；三个模块之间的内部复用说明（如「小手机复用主项目契约」）保留。

### 原规模

- `unified-statusbar/`：361 个文件
- `UBS_phone/`：155 个文件
- `sese-ledger/`：51 个文件
- 合计 568 个文件、约 15 MB；其中 TypeScript 553 个（含 3 个入口与 1 个编排文件）

> 当前仓库实际规模：`src/` 共 102 个文件（`sese-ledger/` 58、内嵌 `unified-statusbar/` 43 + 根 `README.md` 1）。

### 原构建说明

原包不是可独立构建的工程：三个模块原本是同一个 webpack + TypeScript 工程的多入口，构建需放回同类酒馆助手模板工程的 `src/` 下并沿用该工程的 `package.json`、`webpack.config.ts` 多入口配置与宿主类型声明。

**现状**：已改为独立 esbuild 工程，直接在仓库根目录执行 `npm ci && npm run build` 即可产出 `dist/index.js`。

### 内容提示

本项目包含成人向（NSFW）内容与相关提示词，请仅在合适的受众与场景中分享。

### 版权

源码版权归原作者所有。本副本仅用于交流与阅读；如需再分发、商用或二次发布，请先取得作者许可。本仓库的工程化改造部分沿用同一许可口径。
