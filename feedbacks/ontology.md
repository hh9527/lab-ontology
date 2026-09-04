# Ontology foundation feedback

执行评测已经稳定确认一个领域无关的 Query 能力缺口：外层主体需要按已声明的直接关系，
对关联实体计算聚合，并把聚合结果用于 ORDER BY/Top-N 或 HAVING，但不把该聚合加入最终
投影。请实现一个封闭的 related aggregate 抽象；不得加入任何实验领域实体、字段、业务
词汇、数据值、问题或参考 SQL，也不得开放 raw SQL、alias、任意表达式或 Join 拼装。

## 统一语义

关联聚合引用至少包含：外层主体、已 prepare 的直接关系、关联侧的封闭 aggregate、可选的
已授权关联侧字段，以及稳定 id。第一阶段至少支持关联行 `count(*)`；设计应能继续承载已有
aggregate 枚举，而不是把 count 写成特例 SQL。

同一个关联聚合引用必须能用于：

- 隐藏 ORDER BY，配合升降序和 Top-N；
- 隐藏 HAVING，复用现有聚合比较算子和类型化 threshold；
- 两者均不要求聚合出现在 SELECT projection。

## Grain 与关系约束

- 外层结果保持主体粒度；按调用方已选择的主体维度或经证明的主体键分组。
- 关联关系必须已声明、方向确定、授权且唯一；不得从表名或字段名猜路径。
- 支持关系的正向或反向使用，但 lowering 必须依据 prepared 方向生成确定 Join。
- 关联侧多行只参与聚合，不得额外放大最终主体结果。
- projection 只包含请求方明确选择的项，列序继续遵守显式 projection order。
- 动态 HAVING threshold 进入 bindings；隐藏排序本身不产生 binding。

## 拒绝与确定性

未知实体/关系、方向不匹配、歧义路径、未授权字段、非法聚合、无法证明主体 grain、HAVING
类型不兼容时，产生稳定且可归因的 `unsupported`/contract 诊断，并且不发布部分 Query。
不得通过额外返回聚合列、改用 EXISTS、结果后处理或近似另一关系来绕过。

使用与实验领域无关的合成 schema/data 覆盖：隐藏关联计数排序 Top-N、隐藏关联计数 HAVING、
正反向关系、多匹配关联行、明确主体分组、返回列不含聚合、阈值 binding、歧义/越权/方向
错误、重复 lowering 的 SQL/bindings 完全一致。同步更新 `QUERY.md` 与 `ONTOLOGY.md`，运行
三项计划检查，并以“完成任务。”开头提交。
