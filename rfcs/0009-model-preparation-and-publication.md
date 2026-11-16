# 统一建模、准备与发布边界

关联 issue：[#78](https://github.com/hh9527/lab-ontology/issues/78)

## 目的

IC 以业务类型和字段 Property 表达可解空间。领域声明、模型准备、查询证明与服务发布应有独立边界，使其他模型可复用相同发布机制。

## 模块契约

- `semantic`：业务建模入口，包含身份、Reference、字段能力、关系以及根模型的 payload/stage 组装
- `preparation`：集成与验收入口，提供局部准备、能力发现及存储映射；不承担服务协议
- `semantic_model`、`semantic_lowering`、`semantic_preparation`：私有实现，分别处理声明与证据、局部映射、根模型汇总
- `query`：领域无关的计划与表达式
- `intent`、`typed_query`、`typed_query_protocol`：领域证明、符号与外部查询协议
- `sqlite`、`postgres`：显式选择的 SQL 方言
- `publication`：组装类型目录、codec、契约摘要、check_type 与 transform 请求分发

`publication::prepare` 接收 PreparedPayload、命名空间、显式类型别名及 SQL lowering 函数，返回 Program；stage 在构建期准备 Program 并发布 codec 元数据。Program 包含 contract/check/transform，由调用方绑定到服务槽。发布器不依赖 IC 或 NS，不决定数据库执行方式。

服务入口只提供模型配置与运输层包装。业务校验仍由模型执行；发布器不增加宿主领域判断。ABI 维持 `dari-model/v3`。

## 阶段与迁移范围

本次迁移 IC。NS 与 relation_model 的 registry 入口保留原状，之后以同一套 semantic 模型契约集中迁移。旧模型基线不在本次删除范围。

保持 build::stage 的准备信息与运行载荷边界；模型执行端继续接收参数化计划，DARI 本地计算与数据库执行边界不变。

## 验收

1. semantic 模型能力与拒绝语义回归
2. 准备层到 SQLite/PostgreSQL 的 lowering 回归
3. IC 类型检查与 staged 构建
4. 发布目录、codec、check_type、transform 与错误分发验证
5. 公共模块不暴露 semantic 私有实现，NS 文件不修改

## 统一发布补充（#81）

统一模型发布调整为一个构建入口、一次准备和一个 Wasm。当前契约见 [模型发布契约](../ontology/MODEL-PUBLICATION.md)。独立的 IC DARI 入口删除；公共服务以 transform 承载通用转换语义，类型化查询协议在检查期完成校验与 lowering，执行期只绑定参数并执行计划。
