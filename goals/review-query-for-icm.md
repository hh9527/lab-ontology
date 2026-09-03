# 为 ICM 审查 Query

依据 `icm/ao/` 的真实查询空间，审查 `query.a1` 的公共 QueryBuilder 契约是否足以支撑 ICM
领域模型。重点检查参数化 SQL、Join 与 grain 安全、目标属性投影、时间窗口、聚合、排序、
分组 Top N、JSON 动态输入和失败诊断。只报告通用 Query 层缺口，不在 Query 层加入 ICM
表名、字段名或业务特例。

将结论写入 `icm-model/my-feedbacks/query.md`，明确区分阻塞问题、可接受边界和模型层应负责
的事项，并给出可复现的公共接口证据。
