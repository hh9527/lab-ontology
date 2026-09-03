# Query 目标

`ontology/src/query.telora` 是统一 `ontology` crate 中领域无关的结构化查询基础模块。
它定义稳定的 Plan vocabulary、能力 Profile、结构验证，以及确定性的 SQLite
`Plan -> Query` 转换。Ontology eDSL 和具体企业模型只通过该公共模块使用 Query 能力。
crate 内部通过 `@src/query` 导入，外部依赖者通过 `ontology/query` 导入；不保留旧的
`query/lib` 包名或兼容入口。

## 功能要求

- 用封闭具名类型表达 `Val`、`Expr`、聚合、数据源、Join、排序、`Plan`、
  `PlanProfile` 和 `Query`。
- Plan 完整保留 revision、有序投影、筛选、Join、分组、排序和可选 limit。
- 排序同时支持普通表达式和对已投影聚合的引用，从而表达稳定 Top N。
- `PlanProfile` 显式声明允许的算子、Join 类型、聚合、标量函数和 distinct 能力；
  Profile 只收窄能力，不改变标准算子的语义。
- 提供纯检查和失败式检查，覆盖结构合法性与 Profile 能力范围。
- `transform_sqlite` 对同一个合法 Plan 生成逐字节相同的 SQL 和相同顺序的 bindings。
- 所有动态值通过 `Bind(Val)` 进入 `?` 占位符；SQL 文本只承载结构和合法标识符。
- bindings 顺序与 SQL 中占位符的出现顺序严格一致。
- `Val` re-export `std/value.ScalarValue`，在 JSON codec 边界编码为原生 null、string、
  integer、number 和 boolean。
- 非法 Plan、Profile 越界和无法具体化的 Plan 通过带外诊断失败，不发布部分 Query。

## 范围

本阶段只实现通用查询结构和 SQLite 具体化，不包含 ontology、企业实体、指标、
维度、业务题面或领域 lowering。当前后端范围是 SQLite；公共边界保持精确类型。

## 交付物

- `ontology/src/query.telora`：公共类型、构造函数、验证和 SQLite 转换。
- `ontology/docs/QUERY.md`：可独立使用的公共契约与指南。
- `ontology/tests/query.telora`：结构、能力、SQL、bindings、确定性和 codec 契约测试。

## 完成条件

以下命令通过：

```bash
./bin/telora -C ontology check @src/query
./bin/telora -C ontology check @test/query
```
