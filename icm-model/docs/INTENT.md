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
     "group_count":  "CountGroups" | null,        // 组数计数模式
     "time_windows": [ TimeWindowSpec, ... ] | null // 可选：时间窗口来源（§4.8）
   }
   ```
2. **QueryRequest 简写**：只含 `measures/dimensions/filters/ordering/limit/offset/
   partition` 六个字段（`any_of/exists/having/group_count/time_windows` 按空/关闭
   处理）。

所有数组均可为空；`null` 表示该可选字段未启用。`time_windows` 只声明“由相对时间词
换算得到的窗口”的来源与参考时刻；直接由用户给出的绝对时间边界放在 `filters` 中即可，
无需 `time_windows`（缺省为 `null`）。

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
- 维度值必须使用 `DOMAIN.md` 公布的值域：分类/归一维度用归一稳定值（如 `"ne.category.
  switch"`、`"huawei"`、`"gpon"`）；通信/运行/健康状态维度用**公开业务值**（如
  `"在线"`、`"离线"`、`"正常"`）。Resolver 只使用公开业务值，不感知也不传递源字段的
  存储编码；模型的确定性编译把业务值映射为真实存储值写入 SQL binding。
- 封闭枚举状态维度（通信/运行/健康）只支持 `Eq` 与文本业务值：未知业务值、非文本
  输入、非 `Eq` 算子、或试图传存储码/数字短码都会**确定性拒绝**。开放分类/归一维度
  对未归一别名不做保证（以稳定值为准）。

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
- **受控两跳相关存在（模型声明的路线）**：KPI 采样与设备子部件实体可通过唯一
  owner 设备到告警对象做 `exists` 过滤（模型已声明的路线，见 `DOMAIN.md` §4）。编译
  使用 owner 上的 grain-safe join + correlated EXISTS 保持 base 粒度，不放大也不退化
  为 Join；`min_matches`、`filters`/`any_of`、绑定顺序规则与一跳一致。除模型已声明
  路线外，不存在任意图遍历或按字段名猜路径；路线缺失、方向不匹配、owner 非唯一、
  多候选路径或目标维度不属于路径终点时确定性失败且无部分输出。
- **物理链路双端 participant（A/Z 任一端切片）**：链路为 base 时，`exists.target` 可为
  网络/PON/服务器/存储设备或网络端口（`net_port`），经双端 hub（A/Z 设备键；端口仅用
  A/Z port DN）编译为相关 union EXISTS `((A = participant.key) OR (Z = participant.key))`，
  保持链路 base grain、不 fan-out、同一链路只计一次；participant 属性筛选进入 bindings。
  “两指定设备互为对端”与“peer 上的告警/属性”仍确定性拒绝；终端/协作无源链路关系，
  不作为 participant 开放（见 `DOMAIN.md` §4）。

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

### 4.8 TimeWindowSpec（时间窗口来源 / 参考时刻信任边界）

```json
{"dimension": "<时间维度 id>", "subject": "<已授权主体>",
 "kind": "Direct" | "FixedWindow" | "Calendar",
 "start": "<绝对文本起点>", "end": "<绝对文本终点>",
 "reference": "<绝对文本参考时刻>" | null}
```

- `time_windows` 声明“由相对时间词换算得到的窗口”及其形状：
  - **用户直接给出的绝对边界**：既可以放在普通 `filters`，也可以放在 `kind:"Direct"`
    的 `time_windows`；
  - **由相对时间词换算得到的边界**：`kind` 为 `"FixedWindow"`（固定时长）或
    `"Calendar"`（自然周期）。
- **信任边界与 request-scoped 上下文（重要）**：Resolver 不能把相对时间自行换算成
  绝对边界后伪装成普通 `filters`/`Direct` 直接输入。Host 为**每个请求**注入只读
  `time_context`（Resolver 不可写），版本 2 结构：
  ```json
  {"version": 2,
   "report_reference": null | "<绝对时刻>",
   "direct_bounds": [{"dimension":"<时间维度 id>","value":"<绝对文本>"}, ...]}
  ```
  编译规则：
  - **普通时间 `filters` / `Direct` 窗口**：其中每个时间维度过滤值（或 Direct 窗口的
    start/end）必须出现在 Host 声明的 `direct_bounds` 中（该请求原文直接提供的绝对
    边界），否则确定性失败；没有 `direct_bounds` 时，任何含时间维度的请求确定性失败。
    Resolver 自造的边界无法伪装成直接输入。
  - **相对窗口（`FixedWindow`/`Calendar`）**：只在 `report_reference` 非空时授权；窗口
    自报 `reference`（若有）必须与可信值严格一致。运行环境日期不会被当作隐式参考。
  - **不含时间维度的查询不受影响**；缺少 request-scoped 上下文只阻断含时间条件的
    请求。上下文按请求隔离，不是静态全局白名单。
- `start` 必须早于 `end`（半开区间 `[start, end)`）；编译时每个窗口确定性地转换为该
  时间维度上的 `Ge start`、`Lt end` 两条半开过滤，KPI 采样时间维度与告警时间维度同一
  机制；不针对某问法或固定天数写特殊分支。
- **适配器/计划契约（精确的 Host 变更要求）**：`make-query` 需要两个 source：Resolver
  写的 `input`（不可信）与 Host 提供的只读 `time_context`（始终存在）。Host 的
  `time-context.json` 必须升级为上述 **version 2** 结构，并在每次请求给出该请求原文
  直接提供的绝对边界（`direct_bounds`）与可信参考时刻（`report_reference`）；当适配器
  尚不能提供 request-scoped 输入时，含时间条件的请求确定性失败（诊断会指出所需 Host
  契约字段）。这是模型声明的必要输入与编译器强制，不是仅靠字段或文档的解决方案。

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
- KPI 采样/子部件作为 base 且 `exists.target` 为告警时，只沿模型**已声明路线**编译
  （受控两跳，见 §4.5 与 `DOMAIN.md` §4）；未声明路线、方向不匹配、owner 非唯一、
  多候选路径、目标维度不属于路径终点时确定性失败且无部分输出，不会退化为 Join 放大
  或任意图遍历。
- 告警为对象、且引用站点/租户治理维度但缺少单一设备域锚点（或锚点横跨多域）时
  确定性失败（见 `DOMAIN.md` §4），不会产生只按某一设备域路由的静默窄化 SQL。
- 封闭枚举状态维度（通信/运行/健康）传入未知业务值、非文本输入、非 `Eq` 算子或试图
  传存储码/数字短码时确定性失败（未知枚举值/不支持算子/错误类型）；模型只接受
  `DOMAIN.md` §3 的公开业务值，并把其映射后的真实存储值作为 SQL binding（见
  `DOMAIN.md` §3）。
- 时间相关请求必须经 **request-scoped Host 时间上下文**授权（见 §4.8）：普通时间
  `filters`/`Direct` 窗口的每个值必须在 Host 声明的 `direct_bounds` 中；`FixedWindow`/
  `Calendar` 窗口需要非空 `report_reference`。Intent 自报 reference 不构成信任；缺少
  `direct_bounds`/`report_reference`、值与可信上下文不一致、`start >= end` 或窗口非法
  均确定性失败。运行环境日期不会被当作隐式参考或自动填充上下文。不含时间维度的请求
  不受影响。
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
- **位置概念不得隐式替换**：设备位置（`*Location`）、所属站点（`SiteName`/`SiteId`）
  与所属租户（`TenantName`/`TenantId`）是不同源属性且未声明等价，不可互相替换；缺少
  对应维度时澄清或放弃，不能把设备位置静默改写成站点名称/标识。
- **参考时刻与时间口径必须显式**：相对时间词必须先确定参考时刻 R 与口径（固定时长
  窗口 vs 自然日历周期）再换算绝对边界（`DOMAIN.md` §7）。R 必须是数据环境/契约显式
  提供的参考时刻，Resolver 不得以自身当前日期（运行环境时钟）自行选取“当日零点”之类
  作为“现在”；环境当前日期不是完整、稳定的报告时刻。模型只消费换算后的绝对文本边界，
  不推算“现在”，也不接受相对时间词。
- **模型拒绝时不得手写 SQL**：当模型确定性拒绝某个单条表达（§7），Resolver **不得**在
  回答中手工拼写一条“等价的单条 SQL”来替代。手写 SQL 未经过 `make-query`，绕过公开
  模型与权限边界，也与“不可表达”的结论矛盾。Resolver 只能发布确定性工具实际产生的
  结果；否则应澄清或明确拒绝。
- **分步建议不得冒充最终结果**：若当前能力只能分步表达，应清楚说明所需的外部编排与
  中间数据（例如先用设备存在性得到设备集合，再对该集合做第二步查询），不得声称占位
  SQL 已通过完整校验或可直接执行；占位结果必须与确定性工具的实际输出明确区分。
- **比例/跨事实粒度比较**：模型不提供比例与跨事实粒度比较指标，也不做隐式对齐/拼接；
  此类问题没有对应 measure 时确定性失败，按对象域分步计算或澄清（`DOMAIN.md` §5）。
- 模型不会对上述情形“猜一个答案”：无法表达的组合给出确定性诊断（§7），不会发布
  部分结果、不会绕过公开词汇或语义。
