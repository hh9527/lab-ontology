# world_1 领域模型 — DOMAIN.md

本文是 `world-model` Resolver 可读的知识包之一（与 `INTENT.md` 配套）。Resolver 经
ontology 共享 closed Intent protocol 请求 lowering（`INTENT.md`）；本文提供业务对象、
领域词汇与统计口径。**不含**题目、SQL、标准答案、物理 schema 或 Join 路径。物理映射
在 `world-model/src/model.telora`（私有）。

## 业务对象

- **Country（国家）**：代码（业务标识）、名称、大洲、地区、独立年份、人口、预期寿命、
  GNP、政府形式、国家元首、面积等。
- **City（城市）**：属于一个国家，名称、地区（district）与人口。
- **CountryLanguage（国家语言）**：一个国家使用的语言，含官方标记与使用占比。

概念关系：一个 Country 有多个 City、多个 CountryLanguage；City 与 CountryLanguage
经其国家代码归属 Country。相关存在/缺失限定可沿 Country↔City、Country↔CountryLanguage
单跳，以及 City → Country → CountryLanguage（owner 两跳）使用。

## 领域词汇

### Measure（指标）

ID 命名 `<entity>_<attribute>_<function>`，函数即语义。行计数与数值属性聚合分开。

- 行计数：`country_count`、`city_count`、`language_count`、`country_government_count`。
- Country 数值：`country_population_sum/avg/min/max`、`country_surface_area_sum/avg/min/max`、
  `country_gnp_sum/avg/min/max`、`country_life_expectancy_avg/min/max`、
  `country_indep_year_avg/min/max`。
- City 数值：`city_population_sum/avg/min/max`。
- CountryLanguage：`language_percentage_avg/min/max`。

可加数量（人口/面积/GNP）发布 sum/avg/min/max；非可加数值（预期寿命、独立年份、
语言占比）发布 avg/min/max（不发布 `_sum`）。

### Dimension（维度 / 属性）

- Country：`country_code`、`country_name`、`country_continent`、`country_region`、
  `country_indep_year`(int)、`country_population`(int)、`country_government`、
  `country_head`、`country_gnp`(num)、`country_life_expectancy`(num)、
  `country_surface_area`(num)。
- City：`city_name`、`city_district`、`city_population`(int)。
- CountryLanguage：`language_name`、`language_official`、`language_percentage`(int)。

## 值域与统计口径

- 文本/整数维度开放值域；动态值参数化；字符串逐字保真。
- 过滤算子：文本维度支持 eq/ne/gt/ge/lt/le/contains/not_contains/starts_with/ends_with；
  数值维度支持 eq/ne/gt/ge/lt/le。文本算子需 `kind: "text"`，数值需 `"int"`/`"number"`。
- 属性比较只支持两侧同一 prepared 主体的纯列维度；数值属性 vs 标量聚合只接受数值族。
- `language_count` 为 countrylanguage 行计数；需要“互不重复的语言/属性值”时用
  `distinct` 行级形状，而不是对文本列做 count(distinct)。
- 相关存在限定语义：`exists`/`absence` 中的 `target` 只允许已声明的相关实体；内层过滤
  只能引用 target 实体维度。相关谓词只决定外层行/分组去留，其字段/计数绝不进入投影。
- 集合并集操作数可 dimension-only；遍历关系不需要 helper count。
- 输出列序与数值语义由 ontology Intent protocol 统一处理（见 `INTENT.md`）；领域不
  重复实现 lowering。

## 注释

- 本修订不再保留领域 `src/query.telora`：resolver 直接绑定
  `ontology/intent::query_intent_lower_factory` 到 prepared payload。
- 若未来评估需要的领域无关形状不在 ontology 公共 closed Intent 协议内，按 Foundation
  gap 上报，不在领域层用近似 SQL 绕过。
