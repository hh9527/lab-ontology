# lab-ontology

基于 Telora Property 的领域建模、查询语义校验与参数化 SQL 生成。

| 目录 | 职责 |
|---|---|
| `ontology` | 业务类型、能力与关系声明，模型准备，查询证明，SQL 方言及服务发布 |
| `icloud_model` | IC 领域模型与服务配置，使用 semantic 建模入口 |
| `ns_model` | NS 领域模型，使用 registry 建模入口 |
| `relation_model` | 关系模型与等价性验收基线 |
| `scripts` | 数据合成、审计与验收工具 |
| `benchmarks`、`evaluations` | 性能实验及评估记录 |
| `rfcs` | 设计提案与演进记录 |

业务模型以 `ontology::semantic` 声明类型与字段能力，通过 roots 准备模型。集成层使用 `ontology::preparation`；DARI 模型服务使用 `ontology::publication::stage` 在构建期生成契约与 codec，并显式选择 SQL 方言。

- [模块边界](ontology/docs/ARCHITECTURE.md)
- [DARI 模型协议](ontology/DARI-INPUT.md)
- [查询接口](USAGE.md)
- [IC 类型建模](icloud_model/docs/TYPED_MIGRATION.md)
- [NS 模型](ns_model/README.md)
