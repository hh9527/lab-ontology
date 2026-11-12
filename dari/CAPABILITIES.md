# `.dari` 能力对照

对照 `.dari` 的业务数据流能力，语法采用有限的 Telora 风格组合。所有表间组合均下推为 SQL；交付前证明结果上界。

| 能力 | `.dari` 表达 | 验证 |
| --- | --- | --- |
| 模型公开字段及业务类型 | oks_info 源码契约、node、成员符号、模型 codec | abi-test、ic-test |
| 节点与局部计划 | data 是可缓存的数据节点，let 是节点内不可变计划，投影结果显式绑定 | named-plans-test、named-model-test |
| 单表查询与聚合 | query_remote!、project、group_by_identity | model-filter-test |
| 多表语义关系与可选关联 | 多 node、connect、Relation 公共符号 | relation-test |
| 时间范围、枚举、比较与文本筛选 | 前置 filter、布尔组合、有限文本算子 | model-filter-test、model-composition-test |
| 聚合阈值 | 独立度量 filter，可重复 | pair-test、ic-test |
| 两期对齐与劣化排名 | pair、分期 filter、身份对齐、growth_rate/difference/ratio | pair-test |
| 隐藏成员排序 | order_by 直接引用成员，模型验证分组语义 | abi-test |
| 多查询集合组合 | union/union_all/intersect/except，统一 Schema | set-test、model-composition-test |
| 存在性条件与反存在性条件 | semi_join/anti_join | set-test |
| 任务内连接与左连接 | join/left_join，显式 project 命名输出 | composition-test、test |
| 全量分组、组内排名、去重 | group_by、聚合、top_per、distinct | set-test、composition-test |
| 完整输入后处理 | 无上界中间 SQL DAG，交付处证明至多 500 行 | model-composition-test |
| 单行和可选行 | take_opt、if let、map_opt 投影 | pipeline-test、scalar-test |
| 有限计算与映射 | 算术、余数、lookup、case_when、coalesce、round、concat | scalar-test、lookup-test |
| 量纲与名义类型 | 兼容类型的算术保留量纲，标识类型不参与数值运算 | compiler 类型规则、ic-test |
| IPv4 视图与子网 | 模型视图、query! 中 in_subnet/not_in_subnet | ipv4-test |
| 小型任务常量表 | table([...])，空表显式 Schema | ipv4-test |
| 固定上下文与日历窗口 | context、time_windows、静态窗口索引 | presentation-test |
| 16 类原生产图表 | tree! 中内联组件及 spec | presentation-test |
| 图表原有配置 | 分组、颜色、字体、基线、allow_no_data、图内 CSV/spec | 原组件校验与渲染器复用 |
| 表格与报告 | Markdown Table、受控 HTML、内联 SVG、UseReport | presentation-test、dari-adapter-test |
| 源码提取与执行溯源 | 源码、context、参数、SQL、时间、返回行数归档 | presentation-test |
| 工具投递 | check、resolve、附件、唯一 Answer 消息 | dari-adapter-test |

Graph 的领域约束由原模型内核证明；集合、半连接、组内排名等通过 query! 组合表达，不要求重现原 JSON Intent 的每一种形状。IPv4 子网处理放在已投影字段的 query! 中。模型维度的原筛选授权仍由 query_remote! 检查；后处理不会改变模型内字段的授权。

`.dari` 不开放手写函数、递归、循环、任意执行代码或物理数据库 source。测试中的 source 由独立 API 开关授权。声明按依赖顺序书写。表格显示标签使用任务内 lookup；稳定业务编码由模型 property 和生成的 codec 决定。

Stack 枚举、非加总指标限制和类型化数值展示由 chart-types-test 验证；默认最多两位小数，支持模型精度及显式展示精度覆盖。
