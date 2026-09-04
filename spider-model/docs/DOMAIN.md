# concert_singer 领域模型 — DOMAIN.md

本文是 `spider-model` Resolver 可读的知识包之一（与 `INTENT.md` 配套）。它只描述
业务对象、领域词汇、概念关系、值域与统计口径。**不含**任何题目、标准答案、参考 SQL、
物理 schema 或 Join 路径；物理映射属于 `spider-model/src/model.telora` 的私有实现。

`INTENT.md` 定义输入 JSON 契约；本文的词汇 id 是契约中引用 measure/dimension 时的
稳定标识。

## 业务对象

- **Singer（歌手）**：一位歌手，具有：
  - `singer_name` 姓名（文本）；
  - `singer_country` 国籍/来自国家（文本）；
  - `singer_song_name` 代表歌曲名（文本）；
  - `singer_song_year` 代表歌曲发行年份（整数）；
  - `singer_age` 年龄（整数）。
- **Stadium（场馆）**：一个演唱会场馆，具有：
  - `stadium_name` 名称（文本）；
  - `stadium_location` 地点（文本）；
  - `stadium_capacity` 容量（整数）；
  - `stadium_highest`、`stadium_lowest`、`stadium_average` 票价统计
    （最高/最低/平均，整数）。
- **Concert（演唱会）**：一场在某个场馆举办的演唱会，具有：
  - `concert_name` 名称（文本）；
  - `concert_theme` 主题（文本）；
  - `concert_year` 举办年份（整数）。
- **SingerInConcert（参演关系）**：歌手与演唱会之间的多对多参演关系。一条关系表示
  “某歌手在某演唱会中演出”。

## 概念关系

- 一场演唱会（Concert）在**一个**场馆（Stadium）举办；一个场馆可举办多场演唱会。
- 一个歌手（Singer）可参演多场演唱会；一场演唱会可有多个歌手；歌手与演唱会之间为
  多对多，经参演关系（SingerInConcert）连接。
- 统计“演唱会数量/场馆数量/参演数量”时，均按对应对象的自然粒度计数：一场演唱会、
  一个场馆、一条参演关系各计一次。

## 领域词汇（measure/dimension id）

### Measure（指标）

| id | 语义 | 类型 |
| --- | --- | --- |
| `singer_count` | 歌手数量（按歌手自然粒度计数） | count |
| `singer_age_avg` | 歌手年龄的平均值 | avg |
| `singer_age_min` | 歌手年龄的最小值 | min |
| `singer_age_max` | 歌手年龄的最大值 | max |
| `stadium_count` | 场馆数量 | count |
| `concert_count` | 演唱会数量 | count |
| `singer_in_concert_count` | 参演关系条数（= 参演人次） | count |

指标的 `all/distinct` 输入控制是否去重计数（`distinct` 仅对 count 类语义有意义）。

### Dimension（维度 / 属性）

| id | 语义 | 类型 |
| --- | --- | --- |
| `singer_name` | 歌手姓名 | text |
| `singer_country` | 歌手国家 | text |
| `singer_song_name` | 歌手代表歌曲名 | text |
| `singer_song_year` | 代表歌曲发行年份 | integer |
| `singer_age` | 歌手年龄 | integer |
| `stadium_name` | 场馆名称 | text |
| `stadium_location` | 场馆地点 | text |
| `stadium_capacity` | 场馆容量 | integer |
| `stadium_highest` | 票价最高统计 | integer |
| `stadium_lowest` | 票价最低统计 | integer |
| `stadium_average` | 票价平均统计 | integer |
| `concert_name` | 演唱会名称 | text |
| `concert_theme` | 演唱会主题 | text |
| `concert_year` | 演唱会年份 | integer |

文本维度支持：相等/不等、包含、不包含、前缀、后缀；数值（整数）维度支持相等/不等
与大小比较。详见 `INTENT.md` 的过滤器算子。

### 值域说明

- 所有文本维度为开放值域（任意文本，参数化绑定）。
- 所有数值维度为开放整数/数值值域。
- 数值筛选值在输入中以 JSON 数值给出；整数用整数，需要小数时用浮点数。

### 统计口径

- 请求只含 measure、不含 dimensions 时：对全量行做一次聚合。
- 请求同时含 measure 与 dimensions 时：按全部 dimension 分组，各组分别聚合
  （dimension 即分组键，同时出现在输出）。
- 请求只含 dimensions、不含 measure 时：行级列表投影，不做分组、不引入虚拟计数。
- 多个 measure 必须同属一个业务对象粒度（同实体）。
- 筛选按 AND 组合；排序目标必须是本请求已选择的 measure 或 dimension。
- `limit` 截断结果行数、`offset` 跳过前若干行（`offset` 必须有排序）。

## 边界

- 本模型 v1 覆盖：计数/均值/最值、按维度分组、文本/数值筛选、排序、Top-N 与分页。
- 集合运算（EXCEPT/INTERSECT）、标量子查询、`NOT EXISTS`、按未显示列/未显示聚合的
  分组与排序等基础层能力暂不可表达；相应意图会得到确定性拒绝诊断，不会退化为近似
  SQL。
