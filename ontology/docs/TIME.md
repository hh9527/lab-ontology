# 时间输入与物理编码

时间维度同时声明逻辑输入类型和物理列编码。物理 `String` 或 `Int` 不意味着可用普通文本或整数比较时间维度。
本体将每个 Intent 值按模型时间角色校验后才绑定到 SQL；关系键同样拒绝不兼容的时间与普通字段。

| 逻辑输入 | 声明编码 | 物理绑定 | 接受格式 |
| --- | --- | --- | --- |
| `Date` | `DateText` | String | 有效 `YYYY-MM-DD` |
| `DateTimeUtc` | `Rfc3339Text` | String | UTC `YYYY-MM-DDTHH:MM:SSZ` |
| `DateTime` | `LocalText` | String | 无时区 `YYYY-MM-DD HH:MM:SS` |
| `EpochMillis` | `EpochMillis` | Int | Unix 纪元毫秒 |

`DateTimeUtc` 使用规范 UTC 文本，时区身份类型 `DateTimeTz` 与仅偏移量类型 `DateTimeOffset` 尚未实现。
`Rfc3339Text` 是物理编码名，不是另一逻辑类型。维度的 `detail.input_docs` 发布规范格式及具体示例。

IC 契约使用 `DateTimeUtc`、`Date` 和 `EpochMillis` 三种逻辑类型。
PostgreSQL 分别使用 `timestamptz`（UTC 输入输出）、`date`、`bigint`；SQLite 使用规范 ISO-Z 文本、日期文本和 INTEGER。
PG timestamptz 保存瞬间，不保存原始时区，宿主必须将返回时间戳序列化为 UTC。
`Date` 是不含时区与时刻的日历日期，`DateTime` 是不含时区的日期时间。从瞬间提取日期必须显式选择时区；UTC 分桶使用 UTC 规则，结果类型本身不携带时区。

RFC3339 输入目前只接受规范 UTC 秒，偏移和小数秒需在提交 Intent 前处理。
固定宽度 UTC 文本在原始列字符串比较中保持时间顺序。
`EpochMillis` 是从 `1970-01-01T00:00:00Z` 起的绝对毫秒数，编码不依赖时区；UTC／本地业务描述不改变整数表示。
移位的墙上时钟整数需要另行指定编码。DateTime 是无时区或 UTC 偏移的日期加钟表时间，其值不依赖运行环境，也不同于绝对瞬间。
将瞬间或相对周期解析为本地墙上时间边界可能需要时区及歧义策略，本接口不会推断二者。

Graph Intent 在根部及 `exists` 内接受 `time_windows`。
每个时间 Ty 知识节点链接到共享 TimeWindow 操作契约，应跟随返回的不透明键阅读区间和边界规则。
类型支持不授予字段权限：维度必须有时间角色并授权 Lt，提供起点时还须授权 Ge。
这与维度的 `half_open` 业务词汇契约无关。

```json
"time_windows": [{
  "node": "sample", "dimension": "sample_time",
  "start": 1727308800000,
  "end": 1727395200000
}]
```

窗口为 `[start, end)`。终点必填且非 null，起点可省略或为 null。端点必须是维度声明逻辑类型中的具体值。
对原始时间维度，SQL 将原始列与已分配绑定比较（`>= start AND < end`），不使用数据库 `now()`，也不在列侧做时间变换。
逆序或无效端点在生成 Query 前失败。

## UTC 日历分桶

在具有 UTC 时间角色的字段上声明固定分桶维度：

```telora
@edsl::time_field(edsl::TimeSemantics::Utc, edsl::TimeEncoding::Rfc3339Text)
@edsl::utc_bucket_dimension("sample_hour", qb::UtcBucketUnit::Hour)
@edsl::utc_bucket_dimension("sample_day", qb::UtcBucketUnit::Day)
@edsl::utc_bucket_dimension("sample_month", qb::UtcBucketUnit::Month)
ts: String,
```

结果是桶的 UTC 起点，保留源逻辑类型。DateTimeUtc 在 SQLite 中保留 RFC3339 文本，在 PostgreSQL 中保留原生 timestamptz，客户端序列化为规范 UTC RFC3339。
EpochMillis 返回整数毫秒，Date 保留日期文本／原生 date，仅支持日与月。月指日历月；本地时间角色被拒绝。
每个精确的单位／编码组合都必须在查询配置中授权为 `qb::ScalarFunction::UtcTimeBucket({unit, encoding})`。
没有运行时粒度参数或隐式类型转换。NULL 仍为 NULL。日历分桶采用共同范围 0001-01-01 至 9999-12-31，范围外纪元输入返回 NULL。
负纪元向前一桶取整，包括 -1 毫秒；结果不受 PG 会话时区影响。

将分桶维度与已声明度量一同选择即可分组样本。请求的半开窗口应作用于原始时间维度，以保持存储时间谓词可利用索引。
若筛选分桶维度，比较的是显式计算的桶起点，可能选择不同总体。
分桶不补齐缺失周期、不改变 NULL 聚合或所选度量含义，也不授权跨时间累加仪表值。

下界可为 `null` 或省略：

```json
"time_windows": [{
  "node": "sample", "dimension": "sample_time",
  "end": 1727395200000
}]
```

这表示显式截止时间之前的全部历史，SQL 仅有 `< end`。省略或 null 的 `end` 被拒绝。
调用方在规划时固定终点，执行不会代入 `now`。在数据库内容、排序及并列规则不变时，同一计划重放得到相同结果。
完全省略 `time_windows` 仍表示无时间限制。

Agent 在提交 Intent 前解析“现在”“三天前”和日历周期；参考时间及时区可来自应用客户端或自身环境，应向用户解释最终具体日期及时区。
transform 请求只包含 `intents`（一至五项数组）；`ctx`、`"now"`、`{"delta_ms":...}` 和 `{"calendar":...}` 均被拒绝。
本体不读取时钟或推断时区。绝对 Intent 可重放，之后的转换结果一致。

筛选、`any_of` 和度量阈值可省略 `kind`：维度声明输入类型或度量输出类型决定逻辑输入。
若 JSON 值在模型声明下仍有歧义，则转换失败。外部 Intent 协议中不要提供 `kind` 字段。

## 知识导航

Date、DateTime、DateTimeUtc、EpochMillis 的类型节点与字段到类型的正向连接保留；这些通用标量默认不建立反向引用，避免汇集大量无区分度的使用者。

业务类型可以显式选择策略：

```telora
use ontology::experimental::knowledge as knowledge;

@knowledge::reverse_references(False)
type SharedCode = struct(String);
```

普通自定义类型默认不允许反向引用；需要时显式声明 `True`。策略仅属于被标注类型，不沿 newtype 的底层表示继承，不改变 transform 或类型约束。模型发布类型事实中的 `reverse_references`，插件据此生成导航与索引。

承载业务名词与规范值的类型通常应显式开启反向引用，使 Agent 能从 va_ask／search 命中的值，经所属类型找到使用该值域的维度，再定位 Dataset。该用途不要求时间、单位或行结构类型也开启反向引用。
