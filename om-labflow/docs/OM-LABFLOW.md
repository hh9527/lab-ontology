# OM-Labflow

面向 Labflow 运行数据（`events.sqlite` Timeline schema version 2）的
EnterpriseKnowledge：把领域业务词汇确定性地降低为参数化 SQLite `Query`。

## 文档

- [`docs/DOMAIN.md`](DOMAIN.md)：领域说明、架构分层、业务词汇表、能力边界。
- [`docs/QUERY-DESIGN-GUIDE.md`](QUERY-DESIGN-GUIDE.md)：动态请求 JSON 契约、
  查询设计指南、失败语义、验证命令。

## 结构

```text
src/model.telora      私有物理模型（实体/指标/维度/关系/计算维度/scope）
src/knowledge.telora  PreparedPayload（profile/authorize/路径矩阵）
src/query.telora      公共 typed/dynamic query facade（规范实现）
src/facade.telora     facade 兼容性 re-export
src/bin/query.telora  稳定入口：input Value source -> Query JSON
src/bin/main.telora   typed 路径演示
src/bin/verify.telora 严格验证
src/bin/invalid.telora 关键非法场景
src/bin/probe.telora  知识目录
tests/query.telora    契约测试
```

## 快速开始

```bash
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/rounds-per-role.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/failed-command-heads.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/command-heads-page-2.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/per-role-failed-command-heads.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/task-outstanding-by-role.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/task-outstanding-top5-by-role.json
./bin/telora -C om-labflow run verify
./bin/telora -C om-labflow run invalid --best-effort
./bin/telora -C om-labflow check @test/query
```
