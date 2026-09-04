# 为 Spider 审查 Ontology

依据 `concert_singer` 的 schema、SQLite 数据库和建模用例，对
`ontology.foundation-next` 的 Query/Ontology 基础栈做一次集成审查。

重点检查实体、属性、主外键、一对多、多对多桥接，以及投影、过滤、聚合、分组、排序、
Top N、子查询和集合运算的表达能力。生成的 SQL 必须参数化；不能表达时应产生确定诊断，
不得绕过 eDSL 拼接 SQL。

将结论写入 `spider-model/my-feedbacks/ontology.md`。这里只提出领域无关的基础层改进；
`concert_singer` 的具体词汇映射和能力取舍留给后续 Spider 建模阶段。

审查只能使用计划提供的 modeling 资产，不得读取 `spider-data-1/eval/` 或其他 held-out 数据。
