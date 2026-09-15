# Telora 任务参考

根据本次任务需要，阅读 `telora/docs/TELORA.md`、`telora/docs/TELORA-CLI.md`、
`telora/docs/WORKSPACE.md` 和 `telora/docs/EXEC-MODE.md`，结合根目录
`telora-config.json`、`telora-lock.json`，理解所需语言能力和命令。
阅读与必要学习属于正式任务的准备工作，不单独发布工件或提交会话资质。
实际检查仅使用当前 artifact 在计划中显式授予的命令。

工作时参考以下要点：

- 阅读和编写当前实现支持的 Telora 源码；
- 理解 workspace、crate manifest、lock、module selector、import、test 和 diagnostics 的边界；
- 使用 `eval` 验收导出的纯 `Value`，使用 `run` 验收 TransformService 的单次数据转换；
- 使用 `check` 完成模块与测试检查，使用 `query` 完成模块和类型知识发现；
- `run`/`serve` 共享 MainService 类型入口；初始化来源与查询输入分离，不提供用户态外部 I/O；
- 不执行 `lock`，不修改 Host 管理的 workspace config 或 lock；
- 依据实际诊断修正代码，不依赖未实现或旧版本命令。
