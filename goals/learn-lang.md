# 学习 Telora

本目标是与当前角色会话绑定的语言资质。完整阅读 `telora/docs/TELORA.md`、
`telora/docs/TELORA-CLI.md`、`telora/docs/WORKSPACE.md` 和
`telora/docs/EXEC-MODE.md`，结合根目录 `telora-config.json`、`telora-lock.json`，理解后续
任务需要使用的命令。Learn 阶段是只读资质，不执行 shell 命令；实际检查由后续实现 artifact
按照计划显式授予的命令完成。

完成时应当能够：

- 阅读和编写当前实现支持的 Telora 源码；
- 理解 workspace、crate manifest、lock、module selector、import、test 和 diagnostics 的边界；
- 使用 `eval` 验收导出的纯 `Value`，使用 `eval-with` 验收带 context source 的纯入口；
- 使用 `check` 完成模块与测试检查，使用 `query` 完成模块和类型知识发现；
- 理解 `run`/`serve` 只用于 reducer/effect 应用入口，本实验角色不得用它们替代纯入口；
- 不执行 `lock`，不修改 Host 管理的 workspace config 或 lock；
- 依据实际诊断修正代码，不依赖未实现或旧版本命令。

该目标不产生业务文件。完成学习后，提交当前 session qualification。
