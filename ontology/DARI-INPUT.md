# DARI 模型输入

IC 的统一模型服务发布 `dari-model/v3` 契约，来源语义使用 Telora RFC 0322 的结构化输入。DARI 引擎公共端口、意图类型及回执规范见 [dari 模型证明契约](https://github.com/hh9527/dari/blob/main/docs/MODEL-ABI.md)。

## 服务请求

`ontology/model` 的 transform 接收以下业务值：

```json
{"method":"transform","input":{"intent":{"root":"node_0","nodes":[],"steps":[]}}}
```

intent 为有限的结构化 Value。模型直接通过 codec 解码，节点、投影字段、参数和步骤来源沿普通值流传播。传输来源不添加到业务字段中；宿主可为生成字段提供相同的原始表达式 span，并独立传入键来源。

receipt.inputDigest 对实际收到的 intent 执行紧凑 JSON stringify 后取 SHA-256。对象使用 Telora Dict 的 UTF-8 键顺序，数组保留顺序，意图中的数值仅包含安全整数；与 DARI 的 canonicalIntent 对应。步骤消费顺序、输出 Schema、容器和上界校验继续有效。

## 诊断来源

codec 和领域 fail! 的输入 subject 使用临时 source=0，显示为 `<input>`。start/end.offset 是原始 DARI 文本的 UTF-8 字节半开范围，line 为 0。Telora 不接收 DARI 文件名、源码或 CRLF 信息，行列与编辑器位置由 DARI 转换。

模型规则位置与输入 subject 分别返回。新增拒绝路径应明确引用相关输入，避免只给出消息或只引用模型目录中的派生身份。参数检查引用输入参数槽，非法投影引用投影表达式。

## 执行集成

dsh-oks 的 DARI 模型适配器在 worker 内使用 Node 内置 WebAssembly，直接实例化零导入制品，通过 run-service-located 传入 TLI1。支持自包含初始化和服务快照、请求重置与 trap 后恢复。构建和模型验收使用 release 版 Telora；集成不需要 telora-run 可执行文件。

## 模型集成入口

模型通过 `ontology::publication::stage(revision, roots, profile, namespace, aliases)`，在一次构建期准备中发布知识、契约、codec 与转换能力。服务槽通过 `publication::dispatch` 分发 contract/transform；当前查询协议在 transform 内完成校验与 SQLite lowering，执行期只绑定参数并执行。完整契约见 [模型发布契约](MODEL-PUBLICATION.md)。
