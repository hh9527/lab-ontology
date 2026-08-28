# Ontology 目标

`ontology` 是领域无关的 EnterpriseKnowledge eDSL。它让企业作者通过 nominal entity
types 和 type/member/variant properties 声明知识，一次性准备知识图，并把有类型
`QueryRequest` 确定性地 lowering 为 `query` crate 的标准 Plan。

## 功能要求

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

Plan、PlanProfile、Query 和标准算子由 `query` crate 提供。Ontology 保持领域无关，
不包含物流实体、企业表列、具体指标或业务题面，也不把 SQLite 细节写入 Plan 语义。
公共 API 使用精确具名类型，业务 vocabulary 使用稳定 String id 作为交换身份。

## 交付物

- `src/edsl.telora`：property providers、prepared knowledge 和 Request lowering。
- `src/knowledge.telora`：小型、领域中性的完整建模示例。
- `src/bin/main.telora`：包含筛选、排序和 Top N 的端到端演示。
- `src/bin/verify.telora`：property、关系、筛选、排序、Top N、枚举值域和确定性验证。
- `src/bin/invalid.telora`：非法知识或请求的带外诊断演示。
- `tests/ontology.telora`：公共契约检查。
- `docs/ONTOLOGY.md`：企业知识作者可独立使用的公共契约与指南。
- `telora-deps.json`：声明对 `query` 的依赖。

## 完成条件

以下命令通过；`invalid` 按预期产生诊断且不发布可信结果：

```bash
./bin/telora -C ontology run main
./bin/telora -C ontology run verify
./bin/telora -C ontology run invalid --best-effort
./bin/telora -C ontology check @test/ontology
./bin/telora -C ontology query exports @bin/main
```
