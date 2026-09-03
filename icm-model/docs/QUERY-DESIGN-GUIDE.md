# ICM 查询设计指南（Resolver）

> 与 `icm/eval/public/QUERY-DESIGN-GUIDE.md` 同源（本镜像供开发参考）。Resolver
> 使用 `icm/eval/public/QUERY-DESIGN-GUIDE.md`。

## 工具入口

主用法：直接传 intent JSON object（单引号包裹），不需要创建文件：

```bash
bin/make-query check '{"measures":[{"id":"ServerDeviceCount","subject":"analyst","input":"All"}],"dimensions":[],"filters":[],"ordering":[],"limit":null,"offset":null,"partition":null}'
```

兼容用法：第二参数也可为已有 intent 文件路径（仓库 fixture 形式）。两种输入对同一
合法 intent 产生逐字节相同 Query。

成功输出单个 `{"sql": ..., "bindings": [...]}`；失败非零退出、stdout 无部分 Query。
不要使用 `/dev/stdin`、pipe 或重定向；工具不可用时返回待校验 intent/诊断。

## intent JSON

intent 只有两种无歧义形状：

1. 纯 QueryRequest：仅七字段 `measures/dimensions/filters/ordering/limit/offset/partition`；
2. 完整 Intent：七字段 + **始终显式** `any_of: []`、`exists: []`、`having: []`、
   `group_count: null`（用到的再替换）。

“七字段 + 部分扩展字段”不是合法形状，decoder 原子失败且不自动补字段；文件路径与直接
JSON 用同一 decoder。示例：

```json
{
  "measures": [{"id":"AlarmCount","subject":"analyst","input":"All"}],
  "dimensions": [{"id":"AlarmType","subject":"analyst","input":"None"}],
  "filters": [],
  "any_of": [],
  "ordering": [],
  "limit": null,
  "offset": null,
  "partition": null,
  "exists": [],
  "having": [{"measure":"AlarmCount","subject":"analyst","op":"Gt","threshold":{"Int":2}}],
  "group_count": "CountGroups"
}
```

- `FilterOp` JSON：`Eq/Ne/Gt/Ge/Lt/Le/Contains/NotContains/StartsWith/EndsWith`。
- `FilterInput` JSON：`{"Text":..}`/`{"Int":n}`/`{"Number":n}`。
- `having` 项：`{"measure":"..","subject":"analyst","op":"Gt","threshold":{"Int":2}}`。
- `exists` 项：`{"target":"alarm","subject":"analyst","filters":[],"any_of":[],"min_matches":2|null}`。
- `any_of` 项：`{"id":"<dimensionId>","subject":"analyst","values":[{"Text":".."},...]}`（OR-group）。
- `group_count`：`"CountGroups"`（计数满足 having 的组）或 `null`（完整 Intent 始终显式给出）。

约束：filters AND；ordering 目标须已选择；offset 需稳定排序；partition 不与
limit/offset 同用；having.measure 须已选择；行级请求禁 partition/having。
`exists` 支持反向推导（“有告警的设备”用 target=alarm）；`min_matches` 为 ≥N 相关行。
`group_count` 模式下请求须有 measure+分组维度+having，且不带 ordering/limit/offset/
partition。

## 示例形状

- 数量：measure 计数 + 过滤/分组。
- 行级列表：`measures: []` + 维度投影 + 过滤 + 排序 + `limit`。
- 文本过滤：`ServerName` `Contains` `"core"` → `instr(lower(name), lower(?)) > ?`。
- 趋势：KPI measure + 设备维度 + `*Time`，order by `*Time Asc`。
- Top N：partition by 设备、稳定 ordering、take。
- HAVING：分组计数后 `having count > ?`。
- EXISTS：设备 measure + `exists.target="alarm"`；“≥N 告警”加 `min_matches`。
- 分组计数：`having` + `group_count:"CountGroups"` → `count(1)` over 内层分组；
  实体数量按稳定实体 ID 分组（如 `NetworkDeviceId`），`*Name` 只用于展示/名称分组，
  不是 entity identity。
- 五域统一设备：治理层级泛指设备数量/分组/Top1 → `DeviceCount` +
  `DeviceTenantId`/`DeviceSiteId`（网络/PON/服务器/存储/终端；协作无站点键被排除，
  公开的是稳定治理 id 而非名称）。

## 时间窗

把“近 N 天”物化为 `*Time` 的文本边界；**半开区间 `[start,end)`：下界 `Ge`、上界
`Lt`**；值格式 `YYYY-MM-DD HH:MM:SS`。“近一个月”在自然月/固定天数间歧义需澄清。

## 厂商与澄清规则

- 厂商过滤用 `<域>Manufacturer` + `Eq` + `"huawei"`（模型归一 2011/Huawei/
  huawei technologies co., ltd）。
- 跨域“设备”无统一 measure：不得默认某一域，需澄清；跨域过滤会被确定诊断拒绝。
- 自由文本（地点/地域）无稳定映射时请求澄清，不猜站点/租户名。
- `bin/make-query check <intent.json>` 输入即 intent JSON；工具不可用时返回待校验
  intent/诊断，不声称已执行。

## 未决输出决策规则

- 已知槽位保留、未知槽位不补全；一次澄清只补齐被明确回答的槽位。
- 实体域 / 时间锚点 / 其它决定 Query 语义的必要信息仍未知 → 返回简短未决诊断，
  不输出 measure/intent/SQL。
- 治理层级（站点/租户）共享治理维度；跨层级的泛指设备数量/分组/Top1 用五域统一
  `DeviceCount`（协作排除、稳定治理 id）；属性/KPI 等单域能力仍须明确设备域，示例
  measure 不建立默认设备域。
- 每道题独立：只使用当前题面 + 稳定公开背景 + 对当前题的澄清；同一 Session 的上一题
  不得继承实体域/过滤/时间锚点/假设。存在指定告警的泛指设备去重数，当题未限定域时用
  `AlarmDeviceRefCount` + `Distinct` + `AlarmName any_of`。
- “显式注明假设”仍是无依据默认，不允许。
- 部分可确定 ≠ 可补全：地域已定但设备域未定，只确认地域过滤；时间窗类型已定但域或
  as-of 未定，只确认窗口语义。
- 输出形状已由题意确定时（如单一平均值、无“按设备/按时间”）不追问分组。
- 领域无关正反例见 `icm/eval/public/QUERY-DESIGN-GUIDE.md` §8.2。

## 失败类别

`unknown measure` / `unknown filter dimension` / codec Enum variant /
`invalid filter value for dimension` / `filter operation not supported for
dimension` / `subject is not authorized ...` / `requested measures are not
grain-compatible` / `path to requested entity requires a fan-out relation` /
`exists target is not directly related to the base entity` / `ordering target is
not a requested dimension` / `having references a measure that is not requested`
/ `top per group does not combine with a global limit or offset` 等，均 stdout 无输出。

## 验证命令

```bash
./bin/telora -C icm-model check @src/model
./bin/telora -C icm-model check @src/query
./bin/telora -C icm-model check @src/bin/make-query
./bin/telora -C icm-model check @test/query
./bin/make-query check icm-model/testdata/alarm-count.json
./bin/make-query check icm-model/testdata/server-list.json
./bin/make-query check icm-model/testdata/alarm-count-having.json
./bin/make-query check icm-model/testdata/err-unknown-measure.json
```
