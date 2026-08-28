# 为 Ent-1 审查 Query

审查 `query/docs/` 发布的公共 Query 能力，判断它是否足以承载 `goals/ent-1.md`
定义的物流查询模型和公共查询面。以公共文档为依据，不依赖 Query 的私有实现。

重点检查：

- 三种指标 grain 所需的投影、Join、聚合和分组能否完整表达；
- 参数化等值/范围筛选、未投影筛选维度和正整数 limit 能否进入 bindings；
- 指标降序、维度并列排序和稳定 Top N 能否表达；
- PlanProfile 是否覆盖 Ent-1 需要的 Count、Substr、Eq、Ge、Le、And 和 Inner Join；
- 同一个 Plan 是否确定性地产生 SQL 和 bindings；
- 非法结构或能力越界是否只产生诊断，不发布部分 Query。

将结论写入 `ent-1/my-feedbacks/query.md`。报告应列出满足项、阻塞项和需要澄清的
契约；没有阻塞问题时，也要明确记录通过结论和核对范围。
