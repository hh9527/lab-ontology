# RFC 0001：知识索引由 host 持有

状态：分支实验。日期：2026-10-22。

## 目标与依据

降低 Wasm Guest 的启动 CPU、耗时与 fuel。Wasm 保留查询 lowering 所需的模型结构和索引；host 持有知识访问索引。导出可以整批或逐节点，选择依据是启动和首次加载的完整成本。

当前 IC 在模块初始化时准备模型，在服务初始化时为 info 构建 KnowledgeIndex。消费侧随后遍历知识节点，再建立自己的知识索引。当前分支已通过按声明推导过滤能力减少试造 AST；本 RFC 在此基础上拆分知识访问职责。

## 边界

- Guest 的 PreparedPayload、查询能力校验、维度/度量/关系解析及 lowering 保留。
- Guest 保留轻量 discovery 契约，包含 revision、roots、key_patterns、vocabulary 与契约版本。
- Guest 提供知识 root，服务 init 只捕获共享准备结果，不生成完整知识节点或知识查询索引。
- host 首次需要知识时拉取并校验数据，建立 key 与引用索引，提供 info/discovery；消费侧可继续建立 SemanticGraph 和检索索引。
- 导出中的临时节点数组和完整性校验集合随请求释放，不持久化为 Guest 的知识查询索引。每次请求恢复快照，因此 host 应按产物身份缓存成功结果，不能依赖 Guest 在请求后持有缓存。

## 两个 root

数据集和逻辑类型声明是共同输入，准备模型一次，再派生两个 root：

```text
数据集/类型声明 → edsl::build_root → knowledge::model_roots
                                  ├─ lowering: PreparedPayload
                                  └─ knowledge: KnowledgeRoot
```

`lowering` 服务于查询编译；`knowledge` 包含发现契约与节点清单的按需求值函数。两者共享已经准备的模型，不独立重建领域模型。当前逻辑类型来自数据集字段声明与 dimension_type 引用，保持现有 build_root API，避免引入第二份类型注册表。

知识节点清单允许仅包含入口节点；完整性以入口和引用闭包为准。构造 root 与 handler 不强制物化清单。这样既承接有限声明根，又避免提前执行全部知识生成工作。

## 实验协议

新增可选入口 `@src/hosted`，路由为 `ic/transform`、`ic/discovery`。现有 `icloud_model` 入口保留，供现有 info 消费者使用。

hosted 的 `ic/discovery` 接受空对象，返回知识 root：

```json
{"format":"ontology-knowledge-export-v1","discovery":{},"complete":true,"nodes":[]}
```

嵌套 discovery 与同模型旧入口的发现契约一致。nodes 使用现有 ontology-knowledge-v3 节点结构；节点数组顺序不承担寻址语义，节点内部数组保持既有顺序与语义。

- `complete=true`：提供完整清单，host 直接构建索引。本轮 IC 使用此形态。
- `complete=false`：提供入口节点，host 从 index、discovery.roots 及已给节点的 links 出发，调用该提供者的 info 补齐引用闭包。每个 key 只获取一次，循环引用可终止。此形态要求提供者实现 info；本轮 hosted 完整清单入口无需该路由。

物化直接从模型构造节点，不调用 index_from_model、map 或逐节点 info。保留文档覆盖、术语、可见引用与知识可见性；对重复 key 和悬空引用报错。与既有 info 路径逐节点比较 JSON 内容，不能仅比较数量。

host 用产物内容 hash＋domain 作为缓存身份，revision 用于内容契约一致性检查。并发首次加载共享一次发现过程；加载失败不缓存，可重试。数据通过校验后整体发布，避免暴露半成品索引。host info 对缺失 key 返回现有 NotFound 结构。

## 成本与取舍

轻量启动不包含知识节点生成、序列化、传输和 host 建索引。首次知识访问仍需支付这些成本，必须分别报告快照初始化、snapshot runner 启动、首次 discovery/host 知识加载及缓存命中成本。按需导出降低启动成本不等于消除知识生成成本。

本轮先使用完整节点清单验证职责拆分，避免数千次 Guest 请求。若响应大小或请求 fuel 成为限制，可改为按数据集分页或逐节点导出，但不能恢复启动期的知识索引构建。未经测量不承诺首次知识加载总成本下降。

## 验收与迁移

1. release 构建及评估；构建输出隔离到 /tmp，不替换运行产物。
2. 小模型验证文档、术语、可见性、引用、特殊字符寻址及 NotFound。
3. IC 全部节点与既有 info 输出相等，discovery 相等；代表性 transform 输出相等。
4. host 验证重复 key、悬空引用、契约不匹配、并发 single flight 和失败重试。
5. 对比完整入口与 hosted 的初始化、首个查询和首次 host 知识加载。

本轮提供可选入口、导出函数、独立 host 适配器和验证脚本；dsh-oks 保持只读。消费侧接入和默认入口切换作为后续迁移，在完整数据等价和端到端成本确认后推进。

## 实现记录

根的节点回调返回公开 Node 的 Value 数组，按实体生成并编码。请求期不同时保留整棵
Point 图与整棵 Node 图。初版同时保留两棵图，在 IC 快照请求中触发运行时 trap；分实体
编码后，默认托管堆预算下的 2756 节点完整发现与后续 lowering 均已通过。当前运行时
默认托管堆预算为 32 MiB，独立于 CLI 的 Wasm 线性内存上限。

已有的全量 Point 物化函数用于小模型语义对照；生产 hosted 的发现路径使用按实体编码。
更大模型可以通过部分节点清单和提供者的 info 继续发现，不要求扩大 Guest 的启动期索引。

## 本轮 release 结果

在过滤能力校验优化之后，以相同成功 lowering 请求串行测量：

| 指标 | 完整入口 | hosted |
|---|---:|---:|
| 编译/初始化至首个查询 | 31.23s | 20.64s |
| Guest 服务创建 | 10.58s | 0.11s |
| 初始化 fuel | 572.35 亿 | 332.03 亿 |
| 已构建 snapshot 的首次 host 知识加载 | 21.81s | 32.94s |

本轮实现降低 Guest 启动成本，完整知识加载成本后移；完整冷路径总成本尚无明显下降。
IC 当前完整清单为 2756 个节点、约 2.33MB，所有节点与原 info 路径的 JSON 摘要相等。
86 项相关 Telora 测试和 14 项 Node 测试通过。部分清单通过 host 适配器与小模型协议测试，
IC 当前 hosted 实现仍返回完整清单。

性能各项为单轮样本，阶段分别测量，不构成一次完整冷路径的端到端计时。
测量脚本为 scripts/benchmark-host-knowledge.mjs；详细日志和机器可读结果位于本次会话的
/tmp/ic-host-knowledge/，正常 release 构建未替换运行环境产物。
