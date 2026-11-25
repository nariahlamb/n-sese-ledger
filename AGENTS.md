# n-sese-ledger 仓库规范 (AGENTS.md)

本文件继承 `n-sese-suite/AGENTS.md`，是 `n-sese-ledger` 的长期工程与交付规则。**步骤顺序固定，不得跳步或换序。**

## 1. 交付流水线（长期自动，无需再问）

1. **改代码 / 改文档**：功能、界面、修复或文档改动本身。
2. **改到 `src/` 时补两件事**：刷新 `source-files.sha256.json` 中受影响条目的 SHA-256，并执行 `npm run build` 重建 `dist/index.js`。
   - 新增或修改的 `src/**` 文件必须登记；`scripts/check-release.mjs` 逐条重算清单内的文件，清单里的旧 hash 会直接让 `npm run check` 失败（但它**不会自动发现漏登记的新文件**，登记靠人）。
3. **递增版本号 + 更新 `README.md`**：**仅在功能、界面或修复类改动时**递增，且四处必须同步——`manifest.json` 的 `version`、`package.json` 的 `version`、`package-lock.json` 顶层 `version`、`package-lock.json` 的 `packages[""].version`；随后更新 `README.md`（当前版本、第 2 节状态表、第 5 节测试数与第 6 节 Changelog）。
   - **纯文档同步（只改 `.md` 与说明文字、不动代码）不递增版本号**：不发假代码版本，但仍须在第 6 节 Changelog 记一条带 `(docs)` 的记录。
4. **全绿门禁**：依次运行 `npm run build`、`npm test`、`npm run check`，三者退出码必须为 0；再确认 `git diff -- dist` 无异常（`dist/index.js` 必须与当前源码的构建结果一致，CI 另跑 `git diff --exit-code -- dist`）。
5. **落地推仓**：`git add <明确列出的文件>` → `git commit` → `git push origin main`，供手机端 TauriTavern (TT) 直接 `git pull` 实机复测。无需逐次询问，也不要打包 zip。

## 2. 在 Antigravity 等独立客户端打开本仓时

若在 Antigravity 或其他独立打开本仓的客户端中操作，先认清 `src/unified-statusbar/` 的性质：

- `src/unified-statusbar/core/` 是**内嵌共享件副本**（42 个文件），不是 `n-sese-unified-statusbar` 仓库的原始工作副本；`src/unified-statusbar/docs/色色灵感数据库模板V3.3.4.json` 同样是内嵌依赖。台账业务代码只在 `src/sese-ledger/`。
- 两处已按台账需求定制，**不可被上游版本覆盖**：
  - [src/unified-statusbar/core/env.ts](src/unified-statusbar/core/env.ts)：含台账 Toast 前缀定制（台账全部 toast 统一加「台账」前缀）；
  - [src/unified-statusbar/core/external-projection-client.ts](src/unified-statusbar/core/external-projection-client.ts)：为伴生仓 `n-sese-unified-statusbar` 专用，仅在此提供外部投影注册能力。
- **禁止整目录盲目覆盖**：从状态栏仓库同步共享件时逐文件比对，跳过上述两处定制；同步后刷新 `source-files.sha256.json`，否则 `npm run check` 会报「原始源码被修改」。

## 3. 验收边界

`npm run check` 只校验清单一致性、入口依赖可解析、产物非空且不含本机绝对路径，**不代表真机验收**；填表、推进、世界书投影与状态栏 v2 联动的真实行为须由仓库所有者在手机 TT / 电脑 TT 上确认。
