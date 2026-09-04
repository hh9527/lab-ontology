# 为 ICM 审查 Ontology

依据 `icm/ao/` 的实体、关系、指标与查询用例，对 `ontology.foundation-next` 的统一基础栈做一次集成审查。
同时检查底层 Query 模块的参数化 SQL、Join、聚合、排序和分组 Top N，以及 Ontology eDSL
对多类设备、告警、站点/租户、子部件、链路、KPI 时间序列、关系基数和属性投影的表达能力；
不能表达时要求确定诊断，不接受绕过 eDSL 的 SQL 字符串。

将结论写入 `icm-model/my-feedbacks/ontology.md`，只提出通用 Query/Ontology 基础层改进，
并把领域词汇映射、具体能力取舍留给后续 `icm-model.icm-modeler`。
