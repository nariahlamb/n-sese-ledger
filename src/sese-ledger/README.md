# sese-ledger（瑟瑟台账）

编译入口：`src/sese-ledger/index.ts`，由 `scripts/build.mjs` 用 esbuild 打包到仓库根目录 `dist/index.js`。

## 运行时装载链

```
manifest.json (loading_order: 210)
  └─ index.js                       宿主加载的扩展入口（ESM）
      └─ runtime/extension.js       能力检查 + 装载状态面板 + 模块装载器
          └─ dist/index.js          构建产物（业务模块）
              └─ src/sese-ledger/index.ts   编译入口
```

- `loading_order: 210`：在 `n-sese-unified-statusbar`（200）之后、`n-sese-phone`（220）之前装载。
- `runtime/extension.js` 在装载前做能力检查：`SillyTavern.getContext` 与 `CHAT_CHANGED`、酒馆 jQuery、`toastr`，以及 `TavernHelper` 的 `generateRaw` / `injectPrompts` / `getWorldbook` / `replaceWorldbook` / `getCharWorldbookNames` / `getWorldbookNames`；缺项时在扩展设置区渲染「安装状态」面板并给出中文缺项提示，不静默失败。
- `runtime/config.js`：`template: false`（台账不注入状态栏壳）、`blockDatabase: true`（检测到 `AutoCardUpdaterAPI` / `__ACU_STAR_DB_III_LOADED__` 时拒绝混装，提示停用另一套数据库，不删数据）。
- 宿主最低版本由 `manifest.json` 的 `minimum_client_version`（当前 `1.13.0`）声明。

## 目录

- `core/`：账本存储、填表 SQL、剧情推进、投影、时光机、纪要合并、迁移
- `settings/panel/`：工作台九页签（数据、表格、填表、推进、时光机、纪要合并、迁移、日志、设置）
- `assets/`：`standard-template.json`（18 表标准模板）、`plot-preset-magic-recall.json`、`plot-preset-pure-recall.json`

## 编译期依赖（同仓内嵌，不是同级目录）

台账在**编译期**从仓库内的 `src/unified-statusbar/` 引用共享件，随本仓一起构建、一起被 `source-files.sha256.json` 校验：

- `../unified-statusbar/core/*`：42 个文件（事件总线 `events.ts`、聊天元数据宿主 `silly-chat-metadata-host.ts`、文件存储 `server-file-store.ts`、世界书条目/投影 `worldbook-entry.ts` / `worldbook-projection.ts`、上下文剥离 `context-strip.ts`、AI 请求管线 `ai-request-pipeline.ts` / `ai-tool-shield.ts`、外部投影注册 `external-projection-client.ts` 等）；
- `../unified-statusbar/docs/色色灵感数据库模板V3.3.4.json`：标准模板来源。

两处台账定制（同步上游时不得整目录覆盖）：

| 文件 | 定制内容 |
|---|---|
| `core/env.ts` | `getToastr()` 为台账全部 toast 统一加「台账」前缀 |
| `core/external-projection-client.ts` | 伴生仓 `n-sese-unified-statusbar` 专用，提供外部投影注册 |

## 运行期可选联动（跨插件，不是编译依赖）

以下能力只在**同一宿主同时启用 `n-sese-unified-statusbar`** 时解锁；台账单开时**自动安全降级**，不报错、不阻断填表与推进：

- 工作台入口（从状态栏设置面板打开台账工作台）；
- `window.__ubWorldbookProjection`：与状态栏共享同一主世界书写入队列，避免重复注入；
- `window.__ubWorldCognitionSnapshot`（v2 事件池，兼容 v1）：给内置魔改预设喂世界认知与入镜候选，并据此产出 `<statusbar_events>`；
- `window.__ubStorageRelocation`：一键搬家（存储位置迁移）。

单开时台账退回自建投影与单机路径；`isDriverWorldBridgeActive()` 返回 `false`，推进预设中的 `<world_cue>` 桥接自动关闭。

## 测试

测试位于**仓库根目录** `tests/`（`npm test`，`node --test tests/*.test.mjs`），包括填表轮次、上下文剥离、AI 请求隔离、推进 v2 契约、面板渲染与装载器冒烟等。`src/` 内不含测试文件。
