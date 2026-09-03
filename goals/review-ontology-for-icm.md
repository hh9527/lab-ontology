# 为 ICM 审查 Ontology

依据 `icm/ao/` 的实体、关系、指标与查询用例，审查 `ontology.a1` 是否能安全表达 ICM 模型。
重点检查多类设备、告警、站点/租户、子部件、链路、KPI 时间序列、关系基数、属性投影和
分组 Top N；不能表达时要求确定诊断，不接受绕过 eDSL 的 SQL 字符串。

将结论写入 `icm-model/my-feedbacks/ontology.md`，只提出通用 Ontology 层改进，并把领域词汇
映射、具体能力取舍留给后续 `icm-model.a3`。
