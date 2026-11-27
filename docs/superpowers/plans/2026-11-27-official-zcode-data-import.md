# Official ZCode Data Import Implementation Plan

**Goal:** 从 Fen Jue 桌面设置导入官方数据，保留可恢复备份。

**Architecture:** 桌面协调器负责预检、重启事务及恢复，Host 和 CLI 在事务完成后打开存储。共享平台契约只传输结构化结果。

- [ ] 从 `packages/services/src/paths.ts` 和 CLI 存储适配器核对持久文件清单、SQLite 版本、凭据和路径字段。
- [ ] 在设置浏览器验收中覆盖预检、覆盖确认、结果和恢复。用隔离桌面数据验证真实重启。
- [ ] 在桌面迁移模块实现源稳定性检查、同卷暂存、数据库校验、备份切换及中断恢复。接在主进程 bootstrap 读取数据设置之前，并处理自定义数据根。
- [ ] 通过共享平台契约、桌面桥和 UI hook 接入设置页，加入多语言文案。仅 Fen Jue 本地桌面提供入口。
- [ ] 在模拟 profile 上验证导入及还原，比较官方源哈希，运行架构检查、typecheck 和 lint。
