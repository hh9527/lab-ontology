# Ontology 目标

`ontology` 是领域无关的 EnterpriseKnowledge eDSL。它让企业作者通过 nominal entity
types 和 type/member/variant properties 声明知识，一次性准备知识图，并把有类型
`QueryRequest` 确定性地 lowering 为同一 crate 中 `query` 模块的标准 Plan。

## 功能要求

- 当 `feedbacks/ontology.md` 作为当前 artifact 输入时，其中明确标注为 ontology phase
  的领域无关 lowering 属于本阶段必交范围；必须基于 query-core 已发布的原语完成 typed
  eDSL API、验证、诊断、文档与测试，不得把部分实现作为 artifact 成功。

- 用 typed property 表达实体数据源、字段列映射、key、指标、普通维度、计算维度、
  实体关系和 enum variant 的稳定值与标签。
- `build_root` 显式接收实体类型、PlanProfile 和授权函数，收集 property，验证知识，
  建立索引并预计算关系路径，发布可复用的 `PreparedPayload`。
- 业务 lowering 只消费 prepared payload，不在热路径重新扫描 metadata、构图或执行 BFS。
- 关系区分 grain-safe 与 fan-out；路径选择确定、对有向环稳定，并只把安全路径用于 Plan。
- 指标保持 natural grain，并能声明语义所需的额外实体；不兼容 grain 原子失败。
- 普通具名 enum 维度形成封闭值域，发布稳定值和展示标签，并验证筛选值。
- `QueryRequest` 独立表达指标、分组维度、有序筛选、有序排序和可选正整数 Top N。
- 筛选维度可以不参与投影；排序目标只能引用本请求已选择的指标或维度。
- 授权、查询能力和筛选能力分别表达；已知但不可用的维度得到 capability 诊断。
- Lowering 生成完整标准 Plan，并用知识声明的 `PlanProfile` 验证。
- 失败通过带外诊断表达，不发布部分 Plan 或 Query。

## 边界

Plan、PlanProfile、Query 和标准算子由同一 crate 的 `query` 模块提供。Ontology 保持领域无关，
不包含物流实体、企业表列、具体指标或业务题面，也不把 SQLite 细节写入 Plan 语义。
公共 API 使用精确具名类型，业务 vocabulary 使用稳定 String id 作为交换身份。
crate 内部使用 `@src/query`，外部依赖者使用 `ontology/query`；所有旧 `query/lib`
引用都应迁移，不提供兼容包。

## 交付物

- `src/edsl.telora`：property providers、prepared knowledge 和 Request lowering。
- `src/knowledge.telora`：小型、领域中性的完整建模示例。
- `tests/ontology.telora`：property、关系、筛选、排序、Top N、枚举值域、失败路径和确定性契约测试。
- `docs/ONTOLOGY.md`：企业知识作者可独立使用的公共契约与指南。
- `telora-crate.json`：声明统一 crate 的 Query 与 Ontology 模块。

## 完成条件

以下命令通过：

```bash
./bin/telora -C ontology check @test/ontology
```
