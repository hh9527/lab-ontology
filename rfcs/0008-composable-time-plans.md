# RFC 0008：可组合的强类型时间计算

- 状态：设计草案，接口尚未实现
- 分支：`experiment/dari-telora-expression`
- 跟踪：[#74](https://github.com/hh9527/lab-ontology/issues/74)
- 范围：ontology/DARIT 共享类型、有限时间算子及查询边界，不部署

## 目标

用有类型的有限算子组合表达日历选择、时间移动、区间运算和数据库时间条件。作者声明计算计划，不开放任意函数、循环或递归。时间能力不依赖 IC/NS。

`time_windows(ctx,{unit,count,mode})` 同时封装了定位、移动、分割及窗口选择，难以表达指定月份及不同周边界。此设计以原子运算构成核心；便捷窗口能力只能组合这些原语，不能拥有另一套隐含语义。`Complete/Current/Rolling` 不作为核心运算模式。

## 类型

| 类型 | 意义 | 编码或性质 |
| --- | --- | --- |
| EpochMillis | 时间线上的瞬时值 | 整数毫秒 |
| DateTimeUtc | 同一瞬时值的 UTC 表达 | 规范化 ISO 字符串 |
| DateTimeTz | 带显示时区的瞬时值 | 保留偏移与 IANA 时区 |
| LocalDate | ISO 日历日期 | YYYY-MM-DD，无时区、无时分秒 |
| TimeZone | IANA 时区身份 | 经过验证的字符串值 |
| DurationMillis | 固定经过时长 | 有符号整数毫秒，不是瞬时值 |
| DateRange | 日历日期区间 | start/end 为 LocalDate |
| TimeRange | 时间线区间 | start/end 为 EpochMillis |

区间是受控构造器产生的可信值，不允许普通对象伪装成区间。区间可作为 data 结果或函数参数；不能作为数据库结果表中的标量列。端点是可投影的逻辑标量。模型边界仍只使用公开的时间标量。

CalendarUnit、FixedUnit、Weekday 和 DateOverflow 是宿主发布的封闭 sum type，variant 采用 PascalCase。字符串仅承载实际日期、时区等值。

```telora
type CalendarUnit = enum { Year, Quarter, Month, Week, Day };
type FixedUnit = enum { Millisecond, Second, Minute, Hour, Day };
type Weekday = enum { Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday };
type DateOverflow = enum { Reject, Clamp };
```

CalendarUnit::Day 在日历上移动一天，FixedUnit::Day 恰为 24 小时；两者不隐式转换。Month/Year 不属于 FixedUnit。此阶段不引入无时区的本地时分秒构造器，因此不向作者开放含混的夏令时时刻消歧参数。

## 时间上下文与纯计算

环境入口统一为顶层静态选择，按选择项推导结果 Schema：

```telora
data ctx = context! { now: Context::Now, tz: Context::ClientTz };
```

Context::Now 返回 EpochMillis，由宿主捕获当前瞬时值；Context::ClientTz 返回 TimeZone，来自当前客户端提交的时区。字段名由作者指定。选择项是具有不同结果类型的宿主选择器，不是普通枚举值。当前仅发布这两项。

context! 只能直接初始化顶层 data；同次 resolve 共享上下文快照，下次 resolve 独立捕获。只获取声明的项目，客户端时区缺失或无效时，仅请求 ClientTz 的节点报错，不隐式回退或读取机器默认时区。作者也可以使用任务明确指定的 TimeZone。

局部计算使用纯 do 块，let 绑定不可变且仅在块内可见，末尾表达式决定结果类型。do 可嵌套，不能嵌入环境获取或查询计划；缓存边界由外层 data 明确声明：

```telora
data week_start = do {
    let today = date_of(ctx.now, ctx.tz);
    let week = calendar_period(today, CalendarUnit::Week);
    week.start
};
```

其余运算都是有限的纯计算，不读取当前时钟或进程默认时区。`!` 标记特殊语法/语义结构，不等同于副作用：query!/select!/tree! 按各自计划契约工作。

## 日历原语

以下签名是设计契约，`weekStartsOn = Monday` 等表示具名默认参数的契约，不引入新的函数声明语法。

| 运算 | 输入 → 输出 | 语义 |
| --- | --- | --- |
| date_of | instant, TimeZone → LocalDate | 取得指定时区的日历日期 |
| calendar_floor | LocalDate, CalendarUnit, weekStartsOn → LocalDate | 包含该日的周期起点 |
| calendar_ceil | LocalDate, CalendarUnit, weekStartsOn → LocalDate | 大于等于该日的首个周期起点，已对齐时保持原日 |
| calendar_period | LocalDate, CalendarUnit, weekStartsOn → DateRange | 包含该日的完整日历周期 |
| shift_date | LocalDate, CalendarUnit, Int, DateOverflow → LocalDate | 日历移动 |
| shift_dates | DateRange, CalendarUnit, Int, DateOverflow → DateRange | 分别移动两个日期端点 |
| date_range | LocalDate, LocalDate → DateRange | 构造日期区间 |
| at_zone | DateRange, TimeZone → TimeRange | 将日历边界映射为该时区每个边界日的开始 |

默认 weekStartsOn 为 Weekday::Monday，采用周一开始的 ISO 周边界。默认 DateOverflow 为 Reject。其他周起始日须显式指定。周所属年份不得用普通年份推断，需要时单独发布 ISO weekYear/weekNumber。

例如 1 月 31 日移动一个月，在 Reject 下报错；显式 Clamp 时才收敛为二月最后一天。分别移动日期端点可能改变区间长度，也可能在收敛后产生空区间，这必须由作者明确选择的规则解释。

`at_zone` 使用时区规则确定当天起点，不按固定 UTC 偏移拼接。午夜跳变时取该日期最早存在的瞬时值；整个日期不存在时拒绝并指明日期和时区，不能静默查询另一天。空 DateRange 可直接转为相同端点的空 TimeRange。

## 固定时长与瞬时值原语

| 运算 | 输入 → 输出 | 语义 |
| --- | --- | --- |
| duration | Int, FixedUnit → DurationMillis | 构造固定经过时长 |
| elapsed | TimeRange → DurationMillis | end - start |
| shift_instant | instant, DurationMillis → EpochMillis | 按时间线移动 |
| shift_time | TimeRange, DurationMillis → TimeRange | 整体按固定时长移动 |
| time_range | instant, instant → TimeRange | 端点统一为 EpochMillis |
| to_epoch_millis / to_datetime_utc / to_datetime_tz | 已发布的瞬时类型 → 目标类型 | 显式表示转换，Tz 转换额外指定 TimeZone |

这里的 instant 是三种受认可瞬时类型的输入契约，不是新的公开类型或字符串参数。普通 Int 不隐式作为瞬时值或时长。迁移时应将 EpochMillis 与 Int 的便捷算术改为显式时长运算；该变更须独立验收，不能悄悄改变已有表达式的单位含义。

## 区间代数

DateRange 和 TimeRange 都使用半开区间 `[start,end)`。构造要求 start <= end，逆向区间报错。start == end 是有效空区间，区别于输入缺失 None。

- intersection(a,b)：同类区间交集；不相交时返回位于 max(a.start,b.start) 的空区间
- overlaps(a,b)：同类区间是否有非空交集
- contains(range,value)：是否包含日期或瞬时值；结束边界不包含
- is_empty(range)：起止端点是否相等

两个区间必须同类，日期区间不能直接与时间线区间相交。日期区间没有隐含时区；需要时间线关系时先显式 at_zone。

空交集作为区间值保留，便于继续组合查询条件，不需要伪造数据或取任意默认日期。None 表达缺失输入，不能替换为空区间。此阶段不提供可能产生不连续集合的 union/difference；需要时以区间表表达。

## “本年二月第一、第二周”

下面的示例明确采用上海日历。实际任务可将 zone 绑定为已确定的客户端时区。示例展示拟议 API，不代表当前编译器已接受这些接口。

```telora
data ctx = context! { now: Context::Now };
data zone = TimeZone("Asia/Shanghai");
data today = date_of(ctx.now, zone);
data year = calendar_period(today, CalendarUnit::Year);
data february_start = shift_date(year.start, CalendarUnit::Month, 1);
data february = calendar_period(february_start, CalendarUnit::Month);
```

### 与二月相交的自然周，跨月部分裁到月内

```telora
data containing_week = calendar_period(
    february.start, CalendarUnit::Week, Weekday::Monday
);
data first_dates = intersection(containing_week, february);
data second_dates = intersection(
    shift_dates(containing_week, CalendarUnit::Week, 1), february
);
data first = at_zone(first_dates, zone);
data second = at_zone(second_dates, zone);
```

这里第二周从完整自然周移动得出，不能从已经裁剪的 first_dates 移动，否则会把部分周误当成完整周。

### 二月内第一个、第二个完整自然周

```telora
data first_monday = calendar_ceil(
    february.start, CalendarUnit::Week, Weekday::Monday
);
data first_complete_dates = date_range(
    first_monday, shift_date(first_monday, CalendarUnit::Week, 1)
);
data second_complete_dates = shift_dates(
    first_complete_dates, CalendarUnit::Week, 1
);
data first_complete = at_zone(first_complete_dates, zone);
data second_complete = at_zone(second_complete_dates, zone);
```

二月的前两个完整周必然在月内。对于任意第 N 个周期，作者必须检查是否完整落入父区间；批量分割使用下一节的边界策略。

## 批量分割与可证明上界

核心原语不要求先生成所有窗口。批量周期由 `calendar_parts(range, unit, edge, weekStartsOn)` 表达，结果为有序、有限的 Table(Schema({index:Int,start:LocalDate,end:LocalDate}))，index 从 0 开始，按 start 升序。分割单位和策略必须是静态枚举。

```telora
type PeriodEdge = enum { Cover, Clip, Complete };
```

- Cover：返回与父区间相交的完整子周期，允许超出父区间
- Clip：将每个相交周期裁到父区间内，排除空段
- Complete：只返回完全落入父区间的子周期

可分割关系固定为 Year → Quarter/Month/Week/Day、Quarter → Month/Week/Day、Month → Week/Day、Week → Day。不能把日历日期区间分割为固定小时。空父区间产生空表，不产生占位行。

检查器传递日历跨度的有限上界，不依赖执行期日期值猜测行数。日历周期范围携带非作者可伪造的证明：Year 最多 366 天，Month 最多 31 天、最多接触 6 个自然周。静态移动、交集及分割规则传播证明，CalendarUnit::Week 的 ISO 周跨年不影响可终止性。日期编码范围固定为公历 0001..9999，超出范围拒绝。

对于不能证明交付上界的范围，不能将其作为已物化数组返回宿主再 take。应留在有限生成计划中，经明确筛选/排序/take 后交付；此阶段实现不了该 lowering 时明确拒绝，不能伪称满足计划契约。已有 500 行交付上界保持不变。

## 分桶

分桶分为两个不同契约，不接受一个含混的 unit 字符串。

- calendar_bucket(instant, CalendarUnit, TimeZone, Weekday)：返回包含瞬时值的日历桶起点 EpochMillis；与 date_of → calendar_period → at_zone 的起点一致
- fixed_bucket(instant, positive DurationMillis, origin:EpochMillis)：按明确原点对齐固定步长，返回桶起点 EpochMillis

固定桶使用 floor((t-origin)/step)，对原点之前的瞬时值也成立。月/年不能作为固定步长。分桶在 select! 字段表达式中 lowering 为确定性 SQL UDF；query! 中仍由模型证明，不能因为本地实现了就宣称远程模型也支持。

## 查询接合与 Option

TimeRange 的边界是 EpochMillis，可直接供接受该类型的模型成员使用；UTC 编码成员使用显式 to_datetime_utc。典型筛选为 `clock >= range.start && clock < range.end`，空区间自然匹配零行。

可空标量的纯转换继续保留 Option。需要有效 DateRange/TimeRange 的结构运算，不隐式吞掉 None，也不自动替换为当前日期或空区间。初期要求明确的非空端点；若输入可空，先通过有业务依据的 coalesce 或非空投影准备端点。不能引入 Some(Some(...))。

区间、单位、边界策略和来源范围证明属于本地类型计划；模型 ABI 只接收其公开标量参数及已发布类型。静态结构在 check 时确定，依赖 context! 的值在 resolve 时从上下文快照取得。纯时间计算不重新读取当前时钟或时区来源。

## 可组合场景检查

| 问题 | 组合方式 |
| --- | --- |
| 上两完整周 | 定位本周起点，分别向前移动一周、两周，构造日期区间 |
| 最近 48 小时 | duration(48,Hour)，从当前瞬时值按固定时长向前移动 |
| 本年二月前两自然周 | 定位年/月，定位自然周，移动并与月份求交 |
| 二月前两完整周 | 从月初向上对齐周起点，再构造两个完整周 |
| 本季度截至今天 | 定位季度，与从季度起点到明日日始的区间求交；若截至当前瞬时值，则在 TimeRange 层裁剪 |
| 去年同月 | 定位本月，用明确的日历移动规则向前移动一年 |
| 各自然日 CPU 均值 | calendar_bucket 加模型允许的分组/聚合 |
| 每 15 分钟采样 | fixed_bucket，明确固定步长及 origin |

## 诊断与实施顺序

诊断必须区分时间表示不匹配、日期与瞬时值混用、缺失时区、无效日期、日期溢出、逆向区间、不支持的分割关系及无法证明的交付上界。建议不得擅自使用 UTC、Clamp、裁剪跨月周或删去筛选条件。

1. 发布 LocalDate、TimeZone、DurationMillis 与封闭枚举，完成 codec 和类型契约
2. 实现日历定位/移动、可信区间及交集、at_zone，打通二月示例和模型参数绑定
3. 实现固定时长、两类分桶及本地 SQL UDF，确认与模型能力边界分离
4. 实现有序且有上界的 calendar_parts 计划，最后评估是否保留便捷窗口组合

验收按单条流水线覆盖闰年、年/月/周边界、周起始日、空区间、跨月裁剪、月末溢出、夏令时 23/25 小时日、缺失整日、UTC/毫秒查询参数一致性及不重复捕获上下文。未完成这些契约前，不将草案写入生产工具手册，也不部署。

## 参考

- [Temporal PlainDate](https://tc39.es/proposal-temporal/docs/plaindate.html)
- [Temporal ZonedDateTime](https://tc39.es/proposal-temporal/docs/zoneddatetime.html)
- [PostgreSQL 日期时间函数](https://www.postgresql.org/docs/current/functions-datetime.html)
- [NodaTime DateInterval](https://nodatime.org/3.2.x/api/NodaTime.DateInterval.html)

## 当前实验进度

已接入 context! 静态选择、纯 do 块、LocalDate/TimeZone、CalendarUnit/Weekday/DateOverflow、日历定位与移动、可信日期及时间线区间、区间交集及 at_zone。可运行组合见 experiments/darit/examples/calendar.darit，覆盖本年二月的前两个相交自然周；日历准备函数目前仅用于局部计算，标量端点可接入查询。

DurationMillis、固定时长算子、固定时长分桶和 calendar_parts 尚未实现；UTC 及地区日历分桶的已实现子集见后文。input! 不在本轮实现范围。本文前面的完整接口仍是设计契约，不能据此宣称这些后续能力已发布。客户端上下文通过宿主现有 epochMillis/timeZone 编码适配到选择项，对作者只暴露 Context::Now / Context::ClientTz。

### 数据库分桶的首个子集

先实现独立的 utc_bucket(DateTimeUtc, CalendarUnit) → DateTimeUtc，单位为 Year/Quarter/Month/Week/Day，Week 固定从周一开始。可空输入保留可空性，不接收时区参数。本地 select! 使用确定性 SQLite UDF，模型 query! 使用显式 utc_bucket 意图，由模型构造查询局部的派生分组维度，复用原有授权、分组与度量聚合路径。模型回执仍基于原始完整意图计算，派生维度不发布到知识目录。

已完成本地与小模型 SQL 的五种单位分桶、分组及聚合验证；CalendarUnit 与 ontology 内核枚举按语义名称映射。本阶段没有实现带时区分桶、固定时长分桶或补齐空桶。

模型查询的 UTC 投影也支持显式 to_datetime_utc(EpochMillis dimension)，可单独投影或作为 utc_bucket 的输入。ABI 保留转换与分桶的组合结构，模型按源成员编码生成 SQL；EpochMillis 不会被直接当成 UTC 文本或隐式按秒解释。SQLite 按整秒和毫秒余数分别转换，避免负时间戳或浮点秒数引入毫秒舍入。

### 地区时区分桶的实验实现

calendar_bucket(DateTimeUtc, CalendarUnit, TimeZone) 已接入本地 select! 与模型 query!；EpochMillis 通过显式 to_datetime_utc 组合。地区为非空的类型化参数，单位为静态枚举。模型为 PostgreSQL 选择原生 date_trunc，为 SQLite 选择固定适配 UDF，UQL 明确拒绝。SQLite 地区桶实现与 Temporal later 消歧进行了交叉验证，并按日期边界缓存计算，不对每行重新定位边界。

地区分桶的规范键采用 PostgreSQL 的午夜消歧约定，重复午夜取较后瞬时值，跳变午夜按跳变前偏移解释。它与前文 DateRange/at_zone 的最早存在瞬时值约定有所区别：桶键用于归组，覆盖区间用于筛选，特殊跳变日不能把两者混用。此前“分桶起点与 at_zone 无条件一致”的拟议契约据此收窄。尚未实现公开 DateTimeLocal 转换、地区字段逐行取值、固定时长分桶或批量分割。
