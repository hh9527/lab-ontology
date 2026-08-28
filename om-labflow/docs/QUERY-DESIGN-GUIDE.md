# OM-Labflow 公共查询设计指南

本文档面向调用 `labflow query-om` 的观察者与 Labflow 集成方，说明如何用业务
词汇构造领域查询请求，以及输出 Query 的语义。领域词汇与能力边界见
`docs/DOMAIN.md`。

## 动态请求 JSON 契约

`run query` 的 `input` source 是完整 JSON 对象。业务词汇位于 `id` 字段；调用者
不得提交表名、列名、alias、join、SQL 片段或任意表达式。

```json
{
  "measures": [
    {"id": "EventCount", "input": "all"},
    {"id": "DurationSum", "input": "all"}
  ],
  "dimensions": [{"id": "Role"}],
  "filters": [
    {"id": "EventType", "op": "eq", "value": "task_started"},
    {"id": "AtTime", "op": "ge", "value": 1750000000000}
  ],
  "ordering": [
    {"target": {"kind": "measure", "id": "EventCount"}, "direction": "desc"},
    {"target": {"kind": "dimension", "id": "Role"}, "direction": "asc"}
  ],
  "limit": 10
}
```

- 授权主体固定为 `analyst`：请求**不能也不应**包含 `subject` key。显式提供
  `subject` 属于未知顶层 key，整体拒绝。
- `measures[].input`：可选，`all`（默认）或 `distinct`。
- `filters[].op`：`eq` / `ge` / `le`；`value` 为 String、Int 或 Float。Bool 不
  是合法筛选值（`Success` 使用 `0`/`1`）。
- `filters[].value`：枚举维度必须是其封闭值域内的稳定值。`EventType` 是封闭
  业务词汇，只接受 schema v2 的全部 14 个 `type`；`TaskKind` 只接受
  `artifact`/`problem`。值域外的字符串原子失败。
- `ordering[].target`：`{"kind": "measure"|"dimension", "id": ...}`；排序目标
  必须已在请求中选择。
- `limit`：可选正整数或 `null`。
- 未知 key（包括显式 `subject`）、未知 id、非法 op/input、非法值类型、非正
  limit 都原子失败。
- 动态值只进入 `bindings`，绝不拼接进 SQL。

输出是唯一 JSON 对象（无额外包装）：

```json
{"sql": "SELECT ... WHERE ... = ?", "bindings": ["task_started", 10]}
```

## 查询设计指南

| 业务问题 | 写法 |
| --- | --- |
| 某个角色经历了多少轮（task_started 数） | measure `EventCount`，dimension `Role`，filter `EventType=task_started` |
| 某个任务经历多少轮 | measure `EventCount`，dimension `TaskId`，filter `EventType=task_started` |
| 最近一次 Host 请求解析时间 | measure `AtMax`，filter `EventType=host_request_resolved` |
| 最长思考时间（按角色） | measure `DurationMax`，dimension `Role`，filter `EventType=thinking` |
| 成功/失败 shell action 的耗时与次数 | measure `EventCount`+`DurationSum`，dimension `Command`，filter `EventType=action` + `Action=shell`（可加 `Success=0/1`） |
| 最常关联的路径 Top N | measure `PathCount`，dimension `Path`，ordering `PathCount desc` |
| 按角色统计关联路径数（join） | measure `PathCount`，dimension `Role`（经 Safe join 到 timeline） |
| 一轮 reply token | measure `InputTokenSum`/`OutputTokenSum`/`ReasoningTokenSum`，filter `EventType=reply`；合计 = 三者之和 |
| 按时间范围筛选 | dimension `AtTime`，filter `AtTime ge/le <毫秒 epoch>` |

重复 lowering 逐字节稳定：同一个合法请求总是产生完全相同的 SQL 与 bindings。

## 失败语义

以下情况原子失败，不发布部分 Query：

- grain 不兼容（事件 grain 指标与路径 grain 指标/维度混用）；
- 关系会放大统计（事件 grain 请求 `Path` 维度，FanOut-only）；
- 未知词汇（未知指标 id、未知维度 id、未知顶层 key，包括显式 `subject`）；
- 非法筛选（封闭值域外的枚举值，如 `EventType=not_a_real_event`、Bool 值、
  未知 op、非法值类型）；
- 非正 limit；
- 未授权 subject（仅 typed 入口可触发：dynamic 入口固定为 `analyst`）；
- 排序目标未在请求中选择。

演示：`bin/telora -C om-labflow run invalid --best-effort`。

## 验证命令

在仓库根目录运行（或任意子目录，`-C om-labflow` 指定 crate）：

```bash
./bin/telora -C om-labflow run main
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/rounds-per-role.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/action-duration-by-command.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/host-latest-resolved.json
./bin/telora -C om-labflow run query --source input=om-labflow/tests/requests/top-paths.json
./bin/telora -C om-labflow run query --source input=stdin+json:// < om-labflow/tests/requests/rounds-per-role.json
./bin/telora -C om-labflow run probe
./bin/telora -C om-labflow run verify
./bin/telora -C om-labflow run invalid --best-effort
./bin/telora -C om-labflow check @test/query
./bin/telora -C om-labflow check @src/model
./bin/telora -C om-labflow check @src/knowledge
./bin/telora -C om-labflow check @src/query
./bin/telora -C om-labflow query exports @bin/query
```

- `verify` 覆盖确定性、SQL 形状、绑定顺序、筛选/分组/Top N、Distinct、join
  grain 保持、codec round-trip、dynamic JSON 边界（固定 subject / EventType
  封闭值域）与动态路径端到端。
- `invalid --best-effort` 演示上述失败语义（非零退出、无 output），包括
  `EventType=not_a_real_event` 与显式 `subject`。
- `check @test/query` 是契约测试：成功路径的确定性断言，含 EventType 全部合法
  值、shell action 绑定顺序、缺少 subject 成功与显式 subject 拒绝。
- `query-om` 只捕获 stdout 作为参数化 Query，并检查进程退出状态；stderr 直接
  继承调用终端，使 diagnostics 透明输出。stdin 入口
  `--source input=stdin+json://` 继承调用进程的 stdin，供 `labflow query-om -`
  使用。
