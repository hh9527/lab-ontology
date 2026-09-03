# icm-model（私有源码）

本 crate 实现 ICM 领域模型与动态查询 facade，基于 `ontology` eDSL 与 `query`
QueryBuilder。

模块布局：

| 模块 | 职责 |
| --- | --- |
| `src/model.telora` | 私有 EnterpriseKnowledge：实体、维度、指标、关系与根 payload |
| `src/query.telora` | 动态查询 facade：`make_query(QueryRequest) -> Query` |
| `src/bin/make-query.telora` | Host 适配器 `bin/make-query` 固定调用的 `entry.Eval` |
| `tests/query.telora` | 契约测试（check @test/query） |
| `testdata/*.json` | make-query 合法/非法 intent 样例 |

领域文档与查询设计指南：

- `docs/DOMAIN.md` — 稳定业务词汇（实体、维度、指标）、授权、枚举值与能力边界。
- `docs/QUERY-DESIGN-GUIDE.md` — intent JSON 契约、查询族示例、时间窗、确定性、
  失败诊断与验证命令。

公共镜像同步到 `../icm/eval/public/`（Resolver 使用）。模型源码是私有的，
不进入 `icm/eval/public`。
