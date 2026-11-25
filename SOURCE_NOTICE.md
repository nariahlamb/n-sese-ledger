# 来源

本仓库业务源码最初来自 **2026-10-25 公开分享包**，**版权归原作者所有**。MistHarbor 最初仅做个人安装适配。

原作者已停更；原始分享包的目录结构、包含/未包含内容与版权许可见 [src/README.md](src/README.md)（其中「历史来源说明」一节完整保留）。

## 后续独立工程化

在本仓库（`n-sese-ledger`）中，源码已做**独立工程化改造**，不再仅限于个人安装适配：

- 从三模块 webpack 阅读包拆成**独立 esbuild 工程**：构建入口 [scripts/build.mjs](scripts/build.mjs)，产物 `dist/index.js`，装载链为 `index.js` → `runtime/extension.js` → `dist/index.js`；
- 建立独立测试套件（仓库根目录 [tests/](tests/)，`npm test`）与发布自检 [scripts/check-release.mjs](scripts/check-release.mjs)（`npm run check`）；
- 与 [n-sese-unified-statusbar](https://github.com/nariahlamb/n-sese-unified-statusbar)（统一状态栏）、`n-sese-phone`（小手机）建立跨仓联动：世界书投影协调、世界认知快照 v1/v2 与后台事件池回执（`<world_cue>` / `sl_world_ack`）、存储迁移与投影让位；
- 在此基础上持续做功能、界面与修复迭代维护。

当前仓库定位、版本、表结构契约与改造记录见根目录 [README.md](README.md)；内嵌源码结构与共享件同步边界见 [src/README.md](src/README.md)。

## 版权

源码版权归原作者所有。再分发、商用或二次发布前请先取得原作者许可；本仓库的工程化改造部分沿用同一许可口径。
