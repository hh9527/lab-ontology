# world_1 领域模型 — DOMAIN.md

本文是 `world-model` Resolver 可读的知识包之一（与 `INTENT.md` 配套）。只描述业务
对象、领域词汇、值域与统计口径；**不含**题目、SQL、标准答案、物理 schema 或 Join
路径。物理映射在 `world-model/src/model.telora`（私有）。

## 业务对象

- **Country（国家）**：具有代码（业务标识）、名称、大洲、地区、独立年份、人口、
  预期寿命、GNP、政府形式、国家元首、面积等。
- **City（城市）**：属于一个国家，具有名称、地区（district）与人口。
- **CountryLanguage（国家语言）**：一个国家使用的语言，含官方标记与使用占比。

概念关系：一个 Country 有多个 City、多个 CountryLanguage；City 与 CountryLanguage
分别通过其国家代码归属到一个 Country。

## 领域词汇

### Measure（指标）

ID 命名 `<entity>_<attribute>_<function>`，函数即语义；不把函数从上下文猜测，
不用 `avg` 替代 raw 投影/sum/min/max。行计数指标与数值属性聚合分开保留。

| id | 语义 | 类型 |
| --- | --- | --- |
| `country_count` | 国家行数 | count |
| `country_population_sum` | 人口合计 | sum |
| `country_population_avg` | 人口平均 | avg |
| `country_population_min` | 人口最小 | min |
| `country_population_max` | 人口最大 | max |
| `country_surface_area_sum` | 面积合计 | sum |
| `country_surface_area_avg` | 面积平均 | avg |
| `country_surface_area_min` | 面积最小 | min |
| `country_surface_area_max` | 面积最大 | max |
| `country_gnp_sum` | GNP 合计 | sum |
| `country_gnp_avg` | GNP 平均 | avg |
| `country_gnp_min` | GNP 最小 | min |
| `country_gnp_max` | GNP 最大 | max |
| `country_life_expectancy_avg` | 预期寿命平均 | avg |
| `country_life_expectancy_min` | 预期寿命最小 | min |
| `country_life_expectancy_max` | 预期寿命最大 | max |
| `country_indep_year_avg` | 独立年份平均 | avg |
| `country_indep_year_min` | 最早独立年份 | min |
| `country_indep_year_max` | 最晚独立年份 | max |
| `country_government_count` | 政府形式（可按 distinct 计数） | count |
| `city_count` | 城市行数 | count |
| `city_population_sum` | 城市人口合计 | sum |
| `city_population_avg` | 城市人口平均 | avg |
| `city_population_min` | 城市人口最小 | min |
| `city_population_max` | 城市人口最大 | max |
| `language_count` | 语言（行/去重语言）计数 | count |
| `language_percentage_avg` | 语言占比平均 | avg |
| `language_percentage_min` | 语言占比最小 | min |
| `language_percentage_max` | 语言占比最大 | max |

说明：人口、面积、GNP 是可加数量，发布 sum/avg/min/max；预期寿命、独立年份、
语言占比是非可加数值/比率，发布 avg/min/max（对它们求 `sum` 会误导业务含义，
故不发布 `_sum`）。

### Dimension（维度 / 属性）

| id | 语义 | 类型 |
| --- | --- | --- |
| `country_code` | 国家代码 | text |
| `country_name` | 国家名 | text |
| `country_continent` | 大洲 | text |
| `country_region` | 地区 | text |
| `country_indep_year` | 独立年份 | integer |
| `country_population` | 国家人口 | integer |
| `country_government` | 政府形式 | text |
| `country_head` | 国家元首 | text |
| `city_name` | 城市名 | text |
| `city_district` | 城市地区 | text |
| `city_population` | 城市人口 | integer |
| `language_name` | 语言 | text |
| `language_official` | 官方标记 | text |
| `language_percentage` | 语言占比 | integer |

## 值域与统计口径

- 文本/整数维度开放值域；动态值参数化；字符串值逐字保真（不改写大小写/拼写）。
- 请求是封闭的 tagged family，本修订包含十四个 kind（见 `INTENT.md`）：
  - `ordinary`：投影/过滤/聚合/排序；只含 measures → 单行聚合；含
    measures+dimensions → 按全部 dims 分组；measure `mode: distinct` → 去重计数；
    只含 dimensions → 行级非去重列表。
  - `distinct_dimensions`：无 measure 的维度行请求，结果行互不重复（行级 distinct），
    绝不投影 count 指标；只能按已选择维度排序。
  - `hidden_row_order`：无 measure 行级列表，只返回请求维度，按一个**未投影的数值
    维度**排序/取 Top N。
  - `hidden_aggregate_order`：无 measure 分组列表，只返回分组维度，按 base 实体上
    一个**未投影的简单聚合 measure** 排序/取 Top N。
  - `related_exists` / `related_absent`：country base 的普通投影/过滤请求，外加
    related 子句（target 为 `city` / `country_language`，及 target 维度上的有序
    过滤与可选 `min_matches`）；有/无匹配 related 记录只决定 country 行/分组的
    去留，其字段/计数绝不进入返回列。
  - `set_combine` / `set_count`：对两个兼容 ordinary 操作数施加封闭集合 kind
    （`intersect` / `except` / 去重 `union`）；`set_combine` 返回共同投影列，
    `set_count` 只返回集合基数。操作数不得携带本地 order/limit/offset；集合操作数
    可以是纯 dimension-only 行列表（包括跨实体关系遍历，如 City 经 Country owner
    过滤——不发明 count/helper measure）。
  - `selected_having` / `hidden_having`：聚合/分组请求外加有序 HAVING 谓词
    （measure + 封闭比较算子 + 数值 threshold）；`selected_having` 谓词引用已选
    measure，`hidden_having` 谓词引用 base 实体上未选择/未投影的简单聚合 measure
    （只出现在 HAVING，绝不进入 SELECT）。
  - `attribute_aggregate_compare`：无 measure 行级列表，按外层 base 实体上一个
    已授权数值维度属性与一个已授权未过滤数值 measure 的标量聚合比较保留行；每个
    comparison 可带有序 `scope_filters`（属于所选 measure 实体）只收窄内层聚合的
    输入行，空数组 = 全局聚合；被比较的属性、聚合与 scope 维度绝不成为输出列。
  - `related_hidden_row_order`：City 行级列表只返回 City 维度，按未投影的 City
    数值维度排序，并按 **City → Country(owner) → CountryLanguage** 声明的两跳相关
    存在限定；qualifier 降低为 grain-safe owner join + correlated EXISTS，不使用
    直接 City–CountryLanguage join，也不放大外层 City 行。
  - `related_set_combine` / `related_set_count`：对两个独立的 **dimension-only**
    Country 列表（各带一个相关 EXISTS 限定）施加封闭集合 kind；`related_set_combine`
    返回共享外层维度，`related_set_count` 只返回集合基数；不做 fan-out join，不发明
    helper measure。
- 输出列序：空 `output_order`（legacy）为 dimensions（请求序）在前、measures（请求序）
  在后；非空 `output_order` 是 `Ordinary` / `RelatedExists` / `RelatedAbsent` /
  `SelectedHaving` / `HiddenHaving` 的**精确**公共列序（token 引用已请求
  measure/dimension）。两种模式都只改变 `SELECT` 列序，不改变分组/HAVING/过滤/join/
  EXISTS/排序/分页/bindings/grain；hidden HAVING/order/related/scalar 机制在两种模式
  下都不进入公共输出。
- 隐藏排序目标（数值维度或简单聚合）只出现在排序，绝不进入返回列；数值隐藏维度
  必须经 base 安全路径可达，隐藏聚合必须位于分组维度的同一 base 实体。
- related 谓词只经声明的 grain-safe 路线解析：country base 走 City / CountryLanguage
  单跳路线；City base 的 `related_hidden_row_order` 走 City → Country →
  CountryLanguage 两跳路线。related 过滤只能引用 target 实体自身维度。
- HAVING / attribute-aggregate 比较的阈值来自数值动态绑定；标量聚合比较只接受
  数值属性对数值聚合（text/enum vs 数值稳定拒绝）。
- 尚未发布的其它能力形状给确定性 `unsupported:`。
