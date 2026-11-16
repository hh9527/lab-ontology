# 模块边界

## 领域建模

新领域模型使用 `ontology::semantic` 声明身份、Reference、字段能力、存储绑定及外置关系。模型通过 roots 与 profile 准备 payload。IC 使用该入口。

`ontology::preparation` 面向集成和验收，提供局部准备结果、能力发现与存储映射。semantic_model、semantic_lowering、semantic_preparation 为私有实现。

NS 与 relation_model 当前使用 `ontology::registry`，它们的声明由 registry_impl 准备。迁移计划见 RFC 0009。

## 查询与方言

`query` 提供封闭的通用计划与表达式。`intent` 校验领域请求并构造计划；`typed_query` 发布业务类型和成员符号；`typed_query_protocol` 接收外部类型意图并返回查询证明。

`sqlite` 与 `postgres` 接收通用计划并生成参数化 SQL。模型集成显式选择 lowering 函数。

## 服务发布

`publication::prepare(payload, namespace, aliases, lower)` 纯计算生成 Program，`publication::stage` 在构建期准备相同的 Program 并附带 codec 元数据。Program 包括公开契约、查询类型证明函数和 transform 函数。发布器统一生成 codec、展示语义、字段映射及契约摘要。

`publication::dispatch(program, request)` 分发 contract/check_type/transform。模型入口绑定服务槽和运输层，发布模块不执行数据库查询。

知识发布由模型准备中的 knowledge/world 链生成，与类型查询协议共享模型载荷。
