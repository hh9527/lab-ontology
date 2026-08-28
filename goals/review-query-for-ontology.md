# 为 Ontology 审查 Query

审查 `query/docs/` 发布的公共 Query 能力，判断它是否足以支持 `goals/ontology.md`
定义的领域无关 EnterpriseKnowledge eDSL。以公共文档和公共类型契约为依据。

重点检查：

- Plan 是否能表达数据源、投影、参数化筛选、Join、聚合、分组、有序排序和 Top N；
- PlanProfile 是否能明确收窄 eDSL 接受的算子能力；
- 排序是否能引用已投影聚合，并支持稳定的并列打破规则；
- 动态筛选值和 limit 是否进入有序 bindings；
- 验证、确定性转换和失败时不发布部分 Query 的保证是否明确；
- 公共类型是否保持领域无关、精确且能被 Ontology 直接复用。

将具体、可操作的结论写入 `ontology/my-feedbacks/query.md`。报告应区分已满足能力、
缺失能力和需要澄清的契约，并说明每个问题影响的 Ontology 要求。没有阻塞问题时，
也要写出明确的通过结论和核对范围。
