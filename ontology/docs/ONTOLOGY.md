# 本体模型与查询转换

本文是 `ontology` 包当前的模型作者契约。宿主服务协议和 JSON Intent 语法见
[使用说明](../../USAGE.md)，知识查询见[知识契约](KNOWLEDGE.md)。声明签名以
[`ontology.telora`](../src/ontology.telora) 为准，本文不另行维护装饰器参数清单。

知识发布包含事实和已声明的约束。面向 Agent 的用法与工具示例由消费方负责；版本化契约见[知识契约](KNOWLEDGE.md)。

## 一个模型，两种用途

领域在 Telora 模块中定义带类型的数据集、维度、度量、值、时间角色和具名关系，再通过
`edsl::build_root(revision, entity_types, profile)` 一次性准备。得到的 `PreparedPayload`
由查询转换和知识发现共享。完整的小型声明见 [`relation_model`](../../relation_model/src/model.telora)；
将同一载荷挂载为知识与查询方法的示例见[服务入口](../../relation_model/src/lib.telora)。

```telora
use ontology::ontology as edsl;
use ontology::intent as intent;
use ontology::knowledge as knowledge;
use ontology::sqlite as sqlite;
use std::value::{ Value };

# `payload` 是领域模型的 PreparedPayload。
def lower: Fn(Value) -> Value =
    intent::query_request_method_factory(payload, "public", sqlite::build_query);
def info: Fn(Value) -> Value =
    knowledge::knowledge_info_method_factory(payload, "public");
```

SQL 后端在构造转换函数时指定，请求本身不能选择后端。入口服务仅将槽位输入传给对应方法，宿主的 JSONL 信封负责选择槽位。
SQLite、PostgreSQL 和 UQL 均提供 `build_query(QueryAst)` 渲染器。
[UQL 文档](UQL.md)说明接入方式及执行假设；[方言契约](DIALECT-CONTRACT.md)记录宣布完整跨方言支持前尚需完成的执行等价性验证。

## 模型声明

属性业务角色和具名唯一引用集合见[字段角色](FIELD-ROLES.md)。这些声明丰富发现信息，与查询权限、键、粒度和聚合规则相互独立。

- `@entity_id` 和 `@entity_source` 指定数据集及其可信物理来源。`@dataset` 可声明种类和完整身份粒度；未显式声明粒度的模型也可使用 `@key()`。
- `@dimension`、`@measure` 及相关注解发布可查询能力。物理字段不会自动成为可见或可筛选维度；声明的操作符和输入种类约束 Intent 值。
- 具名值类型拥有规范成员及其源编码。维度通过 `@dimension_type` 绑定这些类型。标签和别名辅助发现，查询 Intent 仍使用稳定 ID。类型级 `@half_open()` 增加显式 Unknown 分支，保留未识别字符串；带标签输入、结果列和分组规则见[半开放枚举](HALF-OPEN.md)。
- 具名关系声明包括端点类型、连接键和 `RelationCardinality {from,to}`。各端点指定另一侧一条记录可匹配本侧多少条记录：`One`（1..1）、`Optional`（0..1）、`Many0`（0..N）、`Many1`（1..N）。对 Device → Site，`{from: Many0, to: One}` 表示每台设备恰好属于一个站点，而每个站点可有零至多台设备。
  基数是可信的模型契约，独立于 Eq/And/Or 键。正向遍历读取 `to`，反向读取 `from`。`One` 和 `Optional` 保持粒度，对 Or 键也如此；两种 Many 均可能扩增行数。准备阶段校验字段、标量与时间类型及保护条件，但不根据身份键重新证明基数，也不检查运行时数据。
  下界描述必需的参与关系，不改写连接或取消筛选。内连接仍只选择匹配记录，现有 `include_empty` 模式决定左连接行为。
  身份分组、实体计数和集合结果对齐仍需要实体身份；业务连接的端点身份比较仍需完整参与者键。业务连接可将端点角色标为有向或无向，物理 A/Z 存储位置本身不表示业务方向。
- `@knowledge_doc`、`@term`、描述、标签、本地化文本及引用丰富知识图，但不授予查询权限，也不创建遍历边。只有已声明关系或业务连接授权图遍历。
- 时间角色声明逻辑类型和物理编码。调用方提供具体时间边界，详见[时间契约](TIME.md)。
- 逻辑标量类型定义值与操作的语义，独立于物理存储和维度能力子集。初始 IPv4 契约见[逻辑类型](LOGICAL-TYPES.md)。

`build_root` 校验声明并生成准备好的词汇表，供从 `index` 开始的 `info` 和 `transform` 共同使用。
维度可见性由模型声明，调用方认证由宿主负责。模型注解决定哪些业务含义合法；Intent 和渲染器都不能增加未声明语义。

## 转换边界

公共服务通过 `{"intents":[...]}` 接收一至五个独立的 `Graph`、`GraphPair` 或 `GraphUnion` Intent，各项拥有独立诊断作用域。
仅当所有项均可转换时接受整批；任一项失败时，`queries` 为 null，且每项都有带索引的状态。多个 Intent 是独立计划，不是 SQL 并集。
`GraphUnion` 则是单个 Intent，遵循更严格的形状规则并产生一个去重结果集。

内部的 `query_intent_ast_factory(payload)` 返回将单个 Intent 转为已校验 `QueryAst` 的函数。
`query_intent_lower_factory(payload, to_query)` 在其上增加后端渲染器；
`query_request_method_factory(payload, to_query)` 是示例和 IC 入口使用的批量服务边界。
这些工厂不同：直接工厂不解析服务请求对象，方法工厂负责解析。

图节点指定数据集实例，边通过已声明关系连接实例。`exists` 限定外层总体而不扩增其行数。
只有能证明模型支持对应粒度和能力时，才允许投影、聚合、分组、排序和时间窗口。
失败返回结构化诊断，不能据此随意选择连接或悄悄改变请求总体。转换成功只证明所提交 Intent 在模型下合法，不证明 Agent 正确理解了用户自然语言问题。

Intent 解析与转换实现见 [`intent.telora`](../src/intent.telora)，模型支持的图校验见
[`ontology.telora`](../src/ontology.telora)。外部 Intent 形状示例统一维护在[使用说明](../../USAGE.md)，避免产生第二份 JSON 协议。
