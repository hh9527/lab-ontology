# RFC 0003：准备阶段发布同源知识事实

- 状态：实施中，工作分支验收后提交，不合入
- 跟踪：[RFC 0002 总议题 #64](https://github.com/hh9527/lab-ontology/issues/64)

## 目标与范围

同一份 typed 声明及 transform 准备过程同时提供运行状态和知识事实。声明提供 Entity、Dataset、Group 与 Binding 的来源语义，lowering 结果提供实际公开能力。知识图在构建初始化中一次性生成并序列化，由通用 Service 元数据出口保存为 Wasm 自定义段；transform actor 不捕获知识图。插件读取静态图并补齐反向导航，不再逐节点爬取新制品的 info 路由。

## 事实契约

图的根为 entities、datasets、dimension_groups、measure_groups、types、relations、items。Entity 发布身份，Dataset 发布粒度、实体角色、字段与查询能力。Group 定义与绑定实例分开：Dataset 内 bindings 为独立可寻址成员，公开维度与度量引用其 binding 和 group。Group 在不同名义类型上的实例化必须保留类型差异，不能仅按显示名称合并。

模型发布完整业务语义和明确的正向引用，包括角色映射、输入表达式、单位、值域、聚合、关系端点与基数。插件只根据这些事实派生反向引用、成员索引、类型使用位置和词表，不推断业务关系或权限。名称、说明、示例可由外部 items 补充，关联使用稳定语义地址。外部资料内容应纳入插件缓存身份。

地址沿用节点／成员规则；新增 entities、dimension_groups、measure_groups 根及 datasets/<id>#bindings/<id>。字典键保留原始 ID，地址的 ID 恰好 URI 编码一次。模型导出类型使用明确的名称及结构语义，不把构建内 TypeId 当作跨制品身份。匿名结构与 Group 实例使用规范描述的 SHA-256，完整定义仍随事实发布；Binding 使用本地成员到公开名的有序字典，不依赖声明位置。

## 线格式与外部资料

ontology.knowledge 条目独立声明 ontology-knowledge-v4、ontology-intent-v1、node-member-uri-v1 及 revision。facts 为 {key,value,references} 数组，key 就是最终图的稳定地址，value 不含 Type、闭包或反向链接；references 显式列出语义正向引用。插件按地址装配根与成员字典，检查引用闭合，并补分类导航。items 为 {key,names,doc} 的说明数组。

插件可读取 <model.wasm>.knowledge-items.json，格式为 {version:1,items:[{key,names,doc}]}。资料只追加名称、补说明，不能增加事实地址或修改权限；资料内容摘要与 Wasm 摘要一起构成检索缓存身份。新制品出现错误元数据时直接失败，不能静默回退旧发现路由。

## 初始化与制品

知识发布显式放在 Service init 内，使用已有 Prepared 的 declarations 和 payload，不再运行模型自检或建立反向图。Service 构建元数据仅在初始化接收序列化值，不成为 GC／snapshot 的语言值根。发布在 A 成功及 B 验证后原子完成。插件直接解析元数据段，transform 请求不重新生成图。

## 实施与验收

1. 固定事实契约和通用构建期元数据出口
2. relation model 验证同一 Group 多次绑定、角色映射和公开成员溯源
3. 插件验证静态采集、引用闭合、反向导航及 jq 工具
4. IC 构建、50 Dataset transform／SQLite 与知识图验收，报告额外准备成本、体积和冷启动

旧契约读取保留其现有行为，新契约明确版本化。模型语义、运行期输入校验、自检入口保持独立。两仓库工作分支自主提交、推送，不合入或部署。
