# ICM 查询输入契约（INTENT）

本文是 Resolver 构造查询输入的**公共输入契约**。它说明输入 JSON 的顶层结构、
必填/可选字段、dimension/filter/measure/ordering 的结构、全部公开枚举的 JSON 表示、
值类型、操作符、分页与 Top N 语义，并给出通用示例。Resolver 只依据本文与
[`DOMAIN.md`](DOMAIN.md) 构造合法输入，不需要读取源码、测试或诊断来猜测类型。

> 本文只描述**输入**契约。它不描述任何物理 schema、Join 路径、SQL、bindings 或实现
> 细节；不包含任何评测题、选择列表、隐藏知识、标准答案或按题编号的提示。

## 1. 模型与词汇

- 模型由稳定 ID 词汇组成：**measure id**、**dimension id**、**稳定对象 id**。
  全部公开 ID 及其业务含义见 `DOMAIN.md`（§5 指标目录、§6 维度目录、§8 稳定对象）。
- 请求里的 `id`/`target`/`measure` 字段必须精确引用这些公开 ID。未知 id、
  非法枚举、类型不匹配、粒度不兼容等都会确定性失败，不返回部分结果（§7）。
- **成功 ≠ 语义保真**：`make-query` 成功只表示“输入符合本契约并能生成一条参数化
  查询”，**不代表**该查询已经忠实于原始问题。被换域、被缩窄、被忽略条件或被任意
  假设修饰的输入不会“成功”——模型对这类输入确定性拒绝。调用方若无法用一个合法
  Intent 忠实表达原问题，必须先澄清或明确放弃，不得先构造一个“看似成功”的查询、
  再在说明文字中披露其降级（见 §8）。

## 2. 顶层结构

每次调用提交一个 JSON 对象。两种形式都被接受：

1. **完整 Intent**（推荐）：在 QueryRequest 字段之外还携带可选的存在性过滤/分组谓词
   等字段：
   ```jsonc
   {
     "measures":    [ MeasureRequest, ... ],      // 可为空（行级列表请求）
     "dimensions":  [ DimensionRequest, ... ],    // 可为空
     "filters":     [ FilterRequest, ... ],       // 可为空
     "any_of":      [ AnyOfRequest, ... ],        // 可为空（subject 的 OR-group）
     "ordering":    [ OrderRequest, ... ],        // 可为空
     "limit":        <非负整数> | null,
     "offset":       <非负整数> | null,
     "partition":    <PartitionRequest> | null,
     "exists":      [ ExistsRequest, ... ],       // 可为空（相关存在性过滤）
     "having":      [ HavingRequest, ... ],       // 可为空（聚合结果谓词）
     "group_count":  "CountGroups" | null         // 组数计数模式
   }
   ```
2. **QueryRequest 简写**：只含 `measures/dimensions/filters/ordering/limit/offset/
   partition` 六个字段（`any_of/exists/having/group_count` 按空/关闭处理）。

所有数组均可为空；`null` 表示该可选字段未启用。

两种形式必须清晰区分：`any_of` / `exists` / `having` / `group_count` 四个信封字段
要么**全部出现**（完整 Intent），要么**全部省略**（QueryRequest 简写）。只出现其中
一部分的“残缺信封”（如只带 `having` 而没有 `any_of`/`exists`）会被确定性拒绝，不会
被当作忽略信封字段的简写请求处理。

## 3. JSON 值编码（所有公开枚举的 JSON 表示）

| Telora 类型 | 字段 | JSON 表示 |
| --- | --- | --- |
| `measure input` | `measures[].input` | `"All"` 或 `"Distinct"` |
| `dimension input` | `dimensions[].input` | `"None"` |
| `FilterOp` | `filters[].op` | 字符串：`"Eq"`, `"Ne"`, `"Gt"`, `"Ge"`, `"Lt"`, `"Le"`, `"Contains"`, `"NotContains"`, `"StartsWith"`, `"EndsWith"` |
| `HavingOp` | `having[].op` | 字符串：`"Eq"`, `"Ne"`, `"Gt"`, `"Ge"`, `"Lt"`, `"Le"` |
| `OrderDirection` | `ordering[].direction` | 字符串：`"Asc"` 或 `"Desc"` |
| `order target` | `ordering[].target` | `{"Measure": "<measure id>"}` 或 `{"Dimension": "<dimension id>"}` |
| `FilterInput` | `filters[].input`、`having[].threshold`、`any_of[].values[]` | `{"Text": "<string>"}` 或 `{"Int": <integer>}` 或 `{"Number": <float>}` |
| `partition` | `partition` | `{"by": ["<dimension id>", ...], "take": <正整数>}` |
| `exists` | `exists[]` | 见 §4.5 |
| `group_count` | `group_count` | `"CountGroups"` 或 `null` |

数值类型注意事项：

- 整数字段（`limit`、`offset`、`partition.take`、`exists[].min_matches`、`{"Int": n}`
  的 `n`）必须写成 JSON 整数。
- 浮点字段（`{"Number": f}` 的 `f`）必须写成带小数点或指数的 JSON 数字
  （如 `70.0`、`1.5e3`）；JSON 整数会被视为 Int 而不是 Number。
- 值类型必须与维度声明一致（文本维度用 `{"Text": ...}`，整数维度用 `{"Int": ...}`，
  浮点维度用 `{"Number": ...}`），否则确定性失败。
- 分类/状态/枚举类文本维度只接受 `DOMAIN.md` §2/§3 公布的**稳定值（存储编码）**：
  例如通信状态用 `"0"`/`"1"`、存储运行/健康状态用 `"1"`、PON 分类用归一后的
  `"olt"`/`"onu"`/`"gpon"`。不要传中文标签（如 `"在线"`）或未归一别名；这些值可能在
  类型上合法但不会命中底层数据。

## 4. 字段语义

### 4.1 MeasureRequest

```json
{"id": "<measure id>", "subject": "<authorized subject>", "input": "All"}
```

- `input` 控制去重口径：`"All"` = 普通聚合；`"Distinct"` = 按度量列去重后计数
  （仅对支持去重的指标有意义，如 `AlarmDeviceRefCount`）。
- `AlarmDeviceRefCount` 的 `Distinct` 表示“去重后的受影响设备/资源数”，可与告警侧
  分类维度（`AlarmType`/`AlarmSeverity`/`AlarmName` 等）组合分组，表达“每个告警分类下
  的去重设备/资源数”，而不是相关记录条数（`All` 才是引用行数）。分组粒度、去重键与
  授权由模型决定（见 `DOMAIN.md` §4.1/§5）。
- 一个请求的所有指标必须具有兼容的统计粒度；跨粒度混用指标确定性失败。

### 4.2 DimensionRequest 与 FilterRequest

```json
{"id": "<dimension id>", "subject": "<authorized subject>", "input": "None"}
```

```json
{"id": "<dimension id>", "subject": "<authorized subject>", "op": "Eq",
 "input": {"Text": "value"}}
```

- 维度用于投影、分组、筛选与排序。被筛选的维度不必同时被投影。
- 多个 `filters` 按出现顺序以 AND 组合；同一维度可多次出现（如时间半开区间上下界）。
- 算子的可用范围由维度类型决定（见 `DOMAIN.md` §10）：文本算子与文本输入、整数/
  浮点比较与对应输入、时间维度的范围比较。任何维度不支持某个算子/输入类型都会
  确定性失败。
- 文本语义：`Contains`/`StartsWith`/`EndsWith` 大小写不敏感，`NotContains`、
  `Eq`/`Ne` 大小写敏感（分类与归一化维度使用已规范化的稳定值，见 `DOMAIN.md` §2）。

### 4.3 Ordering、分页与 Top N

```json
{"target": {"Dimension": "<dimension id>"}, "direction": "Asc"}
```

- 排序目标必须是**本请求已选择**（已投影）的指标或维度；未选择的排序目标失败。
- `limit`：可选；存在时必须为正整数。截断结果行数。
- `offset`：可选；存在时必须为非负整数，且请求必须带有稳定排序；否则失败。
- `limit`/`offset` 一起使用表示取第 `offset` 行之后的 `limit` 行。有限结果只代表
  一个页面，不代表已覆盖全量；需要遍历完整结果时必须显式分页。
- `partition`：分组内 Top N。`by` 中的每个维度必须已选择；`take` 必须是
  `(0, 1000]` 内的正整数；`ordering` 必须稳定（覆盖所有非 partition 分组维度）。
  存在 `partition` 时**不得**同时使用全局 `limit` 或 `offset`；`partition` 只用于
  含指标的请求，行级列表请求不允许 `partition`。
- 分组内 Top N 的结果行包含本请求**已选择**的维度，因此既可以返回稳定标识也可以
  返回业务展示维度：单域设备计数可按 `SiteName`/`TenantName` 等展示维度分组、
  分区与排序，结果直接给出展示值（仍保持稳定排序与每分区 Top N 语义）。唯一例外是
  统一设备 `DeviceCount`：它只发布 `DeviceTenantId`/`DeviceSiteId` 稳定标识，不能按
  展示名称分区或返回站点/租户名称；需要展示名称时按 `DOMAIN.md` §4.1 的对象域纪律
  先澄清到单一域。

### 4.4 AnyOfRequest（subject 的 OR-group）

```json
{"id": "<dimension id>", "subject": "<authorized subject>",
 "values": [{"Text": "a"}, {"Text": "b"}]}
```

- 表示“该维度值属于任一给定值即匹配”。组内值保持顺序、非空。
- 作为单个 OR 条件与普通 AND 过滤合并（AND 之外附加一个 OR 组）。
- 组值同样遵守维度输入类型与枚举/值域规则；空组或非法值失败。

### 4.5 ExistsRequest（相关存在性过滤）

```json
{"target": "<稳定对象 id>", "subject": "<authorized subject>",
 "filters": [ FilterRequest, ... ],
 "any_of": [ AnyOfRequest, ... ],
 "min_matches": <正整数> | null}
```

- 保持 base 指标粒度：保留那些“在 `target` 对象上存在至少一条匹配相关行”的 base
  行，不放大 base 粒度。
- `target` 必须是 `DOMAIN.md` §8 列出的稳定对象 id，且与 base 相关；不直接相关或
  未知对象失败。对象关系的方向由模型推导（正向缺失时自动按反向相关推导）。
- `filters`/`any_of` 只约束 `target` 侧的相关行（引用 target 对象的维度），动态值
  进入参数绑定。
- `min_matches`：`null` = 普通存在；正整数 n = “至少 n 条匹配相关行”的相关聚合
  存在。
- `exists` 保持 base 指标粒度，不会因相关行 Join 而放大计数；`target` 侧的全部
  动态过滤值（含 `min_matches`）作为参数化绑定进入查询。统一设备源不是存在性过滤
  端点：`target` 不接受 `device`，也不支持“`DeviceCount` + 告警相关条件”的组合
  （见 `DOMAIN.md` §4.1 与 §8），这类输入确定性失败。
- 存在性只覆盖 base 与 target **直接相关**（正向或反向单边）的对象。KPI 采样、
  子部件等事实粒度到告警/其它对象的**多跳**相关存在性（经所属设备）当前不可表达，
  相关请求确定性失败（不会放大计数、不会退化为 Join）。需要“有某告警的设备在时间窗
  的 KPI”时，先在设备对象域做存在性（如 `NetworkDeviceCount` + `exists(alarm)`）并把
  结果作为设备集合，再分步查询其 KPI；无法单条表达时按 §8 澄清/分步处理。

### 4.6 HavingRequest（聚合结果谓词）与 group_count

```json
{"measure": "<已选 measure id>", "subject": "<authorized subject>",
 "op": "Gt", "threshold": {"Int": 2}}
```

- `measure` 必须是本请求已选择的指标；`op`/`threshold` 组成该指标的聚合结果比较。
- 仅用于含指标的聚合请求；行级列表请求带 `having` 失败。
- `group_count: "CountGroups"` 把请求切换为“统计满足 HAVING 的分组个数”的嵌套
  计数模式；该模式下请求必须同时选择指标与分组维度，且不得携带
  `ordering`/`limit`/`offset`/`partition`。返回单个计数值。

### 4.7 行级列表/属性请求（measures 为空）

- `measures` 为空时是行级投影/列表请求：只投影维度属性，不引入任何虚构计数指标。
- 必须至少选择一个 `dimensions`；base 对象取自第一个维度所属对象。
- 不允许 `partition`；排序目标只能是维度；`limit`/`offset`、筛选与授权规则照常。

## 5. 授权

`subject` 字段必须填写已授权主体。当前模型接受的主体标识为 `analyst` 与
`resolver`（见 `DOMAIN.md` §9）。未授权主体确定性失败。

## 6. 通用示例（与任何评测无关）

示例 1 —— 聚合计数 + 文本前缀筛选 + 分页：

```json
{
  "measures": [{"id": "ServerDeviceCount", "subject": "analyst", "input": "All"}],
  "dimensions": [{"id": "ServerName", "subject": "analyst", "input": "None"}],
  "filters": [
    {"id": "ServerName", "subject": "analyst", "op": "StartsWith", "input": {"Text": "demo"}}
  ],
  "any_of": [],
  "ordering": [{"target": {"Dimension": "ServerName"}, "direction": "Asc"}],
  "limit": 10,
  "offset": 0,
  "partition": null,
  "exists": [],
  "having": [],
  "group_count": null
}
```

示例 2 —— 行级属性列表（measures 为空）：

```json
{
  "measures": [],
  "dimensions": [
    {"id": "NetworkDeviceName", "subject": "analyst", "input": "None"},
    {"id": "NetworkDeviceModel", "subject": "analyst", "input": "None"},
    {"id": "NetworkDeviceIp", "subject": "analyst", "input": "None"}
  ],
  "filters": [
    {"id": "NetworkDeviceType", "subject": "analyst", "op": "Eq", "input": {"Text": "ne.category.switch"}}
  ],
  "ordering": [{"target": {"Dimension": "NetworkDeviceName"}, "direction": "Asc"}],
  "limit": 1000,
  "offset": null,
  "partition": null
}
```

示例 3 —— 存在性过滤（保留至少 2 条匹配告警的设备计数）：

```json
{
  "measures": [{"id": "NetworkDeviceCount", "subject": "analyst", "input": "All"}],
  "dimensions": [],
  "filters": [],
  "any_of": [],
  "ordering": [],
  "limit": null,
  "offset": null,
  "partition": null,
  "exists": [
    {"target": "alarm", "subject": "analyst",
     "filters": [{"id": "AlarmSeverity", "subject": "analyst", "op": "Eq", "input": {"Int": 4}}],
     "any_of": [], "min_matches": 2}
  ],
  "having": [],
  "group_count": null
}
```

示例 4 —— 满足 HAVING 的分组个数（按告警类型分组后数量大于 2 的组数）：

```json
{
  "measures": [{"id": "AlarmCount", "subject": "analyst", "input": "All"}],
  "dimensions": [{"id": "AlarmType", "subject": "analyst", "input": "None"}],
  "filters": [],
  "any_of": [],
  "ordering": [],
  "limit": null,
  "offset": null,
  "partition": null,
  "exists": [],
  "having": [
    {"measure": "AlarmCount", "subject": "analyst", "op": "Gt", "threshold": {"Int": 2}}
  ],
  "group_count": "CountGroups"
}
```

## 7. 失败语义与确定性

- 未知 measure/dimension/稳定对象 id、未授权主体、非法枚举值、类型/值域不匹配、
   维度不支持的操作、粒度不兼容、grain 放大路径、不支持的目标属性、非法分页或
   Top N 组合（partition 与 limit/offset 并存、partition 缺少稳定排序、非法
   `take`/`min_matches`/`limit`/`offset`、行级请求带 partition/having 等）以及残缺/
   非法 Intent 信封（`any_of`/`exists`/`having`/`group_count` 只出现一部分、或完整
   信封中字段类型错误）都会产生确定性、可归因的诊断，并且**不发布任何部分查询结果**。
- 超出统一设备源能力的组合同样确定性失败、不发布任何部分结果：`DeviceCount` 带
  展示名称维度/筛选（`SiteName`/`TenantName`）、`DeviceCount` 带告警存在性
  （`exists`/`having` 中的告警条件）、或 `exists.target = "device"`（见 `DOMAIN.md`
  §4.1/§8）。这些失败不是“请求有问题”，而是该对象域的组合不可表达，应先澄清对象域
  或改用告警锚定/单域指标。
- KPI 采样或子部件作为 base、`exists.target` 指向告警等需经所属设备多跳的对象时
  确定性失败（存在性只覆盖直接相关对象）；状态/枚举维度使用中文标签而非底层存储
  编码时值域错误并确定性失败（`DOMAIN.md` §3）。
- 告警为对象、且引用站点/租户治理维度但缺少单一设备域锚点（或锚点横跨多域）时
  确定性失败（见 `DOMAIN.md` §4），不会产生只按某一设备域路由的静默窄化 SQL。
- 同一输入重复提交产生逐字节相同的输出（确定性）；不同的合法输入之间的行为差异
   全部来自上述公开语义，不依赖隐藏知识。

## 8. 语义保真与澄清义务

本节约束 Resolver（或任何把自然语言问题转成 Intent 的调用方），使“成功查询”始终
忠实于问题，而不是在事后用文字披露降级。

- **对象域不得静默缩窄**：问题只说了“设备/网络设备/服务器”等上位概念、没有给出
  具体设备域，且需求超出统一设备源能力（展示名称维度、告警存在性、KPI/子部件
  组合）时，必须向用户澄清对象域。未经澄清不得把 `DeviceCount` 换成
  `NetworkDeviceCount` 之类单域计数，也不得在统一设备请求上丢弃告警/名称条件。
- **时间口径必须显式**：相对时间词（“近 7 天/最近 30 天/近一个月/昨天/今天”）必须
  先确定口径再换算成绝对文本边界（`DOMAIN.md` §7）。固定时长窗口与自然日历周期
  边界不同；问题或上下文没有指明采用哪一种时（典型如“近一个月”），先澄清，不得
  自行选择固定天数并把假设当作最终口径。换算得到的绝对边界作为参数化值传入。
- **展示对象按对象域返回**：需要站点/租户等业务对象的名称或 Top N 时，先确定对象
  域；单域设备计数可直接选择/分区/返回 `SiteName`/`TenantName` 展示维度。统一设备
  `DeviceCount` 只返回稳定标识，若用户期待的是展示名称，先澄清到单一域。
- **告警侧引用治理维度需要设备域锚点**：以告警为对象的请求若同时引用站点/租户治理
  维度（`SiteName`/`SiteId`/`TenantName`/`TenantId`/`TenantIndustry`），必须带明确
  单一设备域锚点（v1 支持网络设备域，如 `NetworkDeviceType`/`NetworkDeviceName` 等
  网络设备维度/过滤）。无锚点或多域锚点会确定性失败，不产生“只按某一设备域路由”的
  静默窄化 SQL；这类问题应改为设备侧表达（设备计数/信息 + `exists(alarm)`）。
  告警自身文本维度（如 `AlarmTenant`）不属于治理对象维度，不受此限制。
- **成功不证明忠实**：生成成功只证明 Intent 合法且被模型接受；是否忠实于原问题由
  上述规则保证。无法以合法 Intent 忠实表达时必须澄清或放弃，禁止“先生成、后说明”。
- 模型不会对上述情形“猜一个答案”：无法表达的组合给出确定性诊断（§7），不会发布
  部分结果、不会绕过公开词汇或语义。
