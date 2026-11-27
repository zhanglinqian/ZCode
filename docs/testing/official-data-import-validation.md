# 官方数据迁移隔离验收

2026-11-27 在 Windows Electron 中通过设置页完整链路。

## 执行

仓库根目录使用 Node 24.14.0 和 pnpm 10.33.2。先以 `ZCODE_ENV=production ZCODE_FENJUE_IDENTITY=1` 构建 desktop 主进程，再在本机 5199 端口启动 renderer Vite。

设置 `ZCODE_OFFICIAL_IMPORT_E2E_AGENT_DIR` 为配套 glm 运行时目录，然后运行：

```powershell
node packages/desktop/scripts/official-data-import-e2e.cjs
```

脚本为 HOME、USERPROFILE、APPDATA、LOCALAPPDATA、Electron userData 和 sessionData 新建临时目录，将配套 Agent 复制到临时运行目录，播种官方与 Fen Jue 模拟数据。登录使用产品提供的「Use API key → Skip for now」，首次引导通过 Escape 关闭。

原生确认及结果对话框由驱动自动应答。设置页、preload、IPC、退出屏障、app.relaunch、重启迁移和 Host 启动均运行实际代码。驱动给 relaunch 指定测试启动器和调试端口，以便重启后重新连接。

## 本次结果

- 设置 → Data sync → Import data from official ZCode，最终重放实际重启进程从 141436 变为 132464。
- 新数据根包含官方模拟文件，backup 包含原 Fen Jue 模拟文件。
- 设置页出现 Restore Fen Jue backup，点击后实际重启为进程 106920。
- 原 Fen Jue 模拟文件恢复，导入数据归档到 before-restore 副本。
- 官方模拟设置文件前后字节一致。
- 完整 pnpm typecheck 通过。修复了 SettingsPage 中四处不受支持的 defaultMessage 参数。
- 完整 pnpm lint 为 0 error、538 warning。迁移模块与相关设置页的 React Hooks 专项检查为 0 Hooks 诊断。

最终重放证据目录为 `C:\Users\zhang\AppData\Local\Temp\fenjue-chain-wXTaIT`，包含 result.json、before.png、imported.png、restored.png、分阶段 UI 文本以及完整 typecheck、lint 和 E2E 日志。测试进程已清理。验证没有对用户现有业务数据执行迁移。

## 本机目录链接失败回归

15:22 本机首次执行在清单阶段失败。只读目录类型检查发现官方目录有 97 个链接，原实现抛出 unsupported-import-file，错误展示又将业务错误归并为 migration-failed。失败后事务、暂存和备份目录均不存在，Fen Jue 原数据根保留。

修复后夹具增加内部目录联接、外部技能链接和失效链接。完整 Electron 链路在临时目录 `C:\Users\zhang\AppData\Local\Temp\fenjue-chain-T9uHXG` 通过。断言内部链接实际指向新数据根，外部内容仍可读取，并验证备份及恢复。类型检查和 lint 均退出 0，lint 为 538 warning、0 error。
