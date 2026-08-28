# 为 Ent-1 审查 Ontology

审查 `ontology/docs/` 发布的 EnterpriseKnowledge eDSL，判断它是否足以实现
`goals/ent-1.md` 的物流领域模型。结合已接受的 `query/docs/` 公共契约进行审查，
不依赖 Ontology 的私有实现。

重点检查：

- nominal entity、字段/类型 property、物理 mapping 和显式 root 是否可表达；
- Order、Package、PackageItem 三种 grain 及 Safe/FanOut 关系能否正确约束组合；
- 指标必需实体、计算维度和未投影筛选路径能否进入 prepared lowering；
- CustomerTier 封闭 enum 值域、稳定值、标签和 Eq-only 筛选能否表达；
- 授权、分组能力和筛选 capability 是否能够独立声明和诊断；
- Request 是否覆盖参数化筛选、有序排序和正整数 Top N；
- prepared payload 是否可复用，并在失败时不发布部分 Plan。

将结论写入 `ent-1/my-feedbacks/ontology.md`。报告应列出满足项、阻塞项和需要澄清的
契约；没有阻塞问题时，也要明确记录通过结论和核对范围。
