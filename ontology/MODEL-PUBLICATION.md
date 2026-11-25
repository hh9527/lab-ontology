# 模型发布契约

模型以一个 Wasm 制品发布。`publication::stage(revision, roots, profile, namespace, aliases)` 在一次构建期准备中生成知识、公开目录、codec 与转换闭包；运行期不重复准备模型。

## 统一入口

服务槽为 `ontology/model`，请求为 `{method, input}`。

- `contract`：返回公开符号、业务类型、codec、契约身份及协议版本
- `transform`：执行模型声明的转换协议，返回经过校验的转换结果

`transform` 表达通用转换契约；具体输入、输出及证明规则由所使用的协议定义。DARI 的类型化查询意图是其中一种协议，DARI 的本地检查接口可将该转换作为外部类型证明使用。

## 类型化查询协议

当前查询协议接收 `{intent}`。意图包含静态数据集与成员符号、关系、有限步骤，以及参数的类型与槽位；具体参数值不参与此次转换。

转换结果包含：

- 参数化 SQLite SQL 与模型常量 bindings
- 有序结果 columns，包括物理类型、业务类型及可空性
- container 与 max_rows，表达结果容器和已证明的行数上界
- receipt，锚定 contractId、规范化意图摘要及已消费的步骤序列

参数占位符 `:__dari_N` 引用意图中的参数槽 N；模型常量使用 `?N` 引用返回的 bindings。消费者依据公开 codec 将参数编码为存储值，再绑定到既定计划。字符串、注释中的占位符文本不参与绑定。

执行期只绑定参数和执行计划，不调用模型。数据库连接、本地后处理、展现和缓存由消费者负责。源位置以结构化 origin 随输入传递，转换诊断可映射回调用方源码。

当前查询协议版本标识为 `dari-model/v3`。该标识用于类型化查询协议校验，不要求模型为某个消费者建立独立源码入口或单独制品。查询协议当前生成 SQLite 计划；通用 `transform` 名称不承诺任意后端或任意转换协议已实现。

## 静态知识

全量知识通过同一 Wasm 的 `telora.build.information` 中的 `ontology.knowledge` 条目发布。消费者可直接读取知识，不需要运行转换服务。类型目录和 codec 通过 contract 获取，两者来自同一次模型准备。

## 共享类型登记与 codec

知识描述、查询目录与 codec 使用同一份按 Type 缓存的类型结构登记，包含具名身份、解析后的结构、字段、枚举成员和可空包装。知识沿依赖收集可发现类型；查询目录按可查询成员及显式输入类型确定公开范围。两者共享结构信息，各自保留用途所需的视图。

codec 由模型属性形成描述表，制品携带单份 JS 构造程序。描述表分别登记 codec 实现、展示规则、共享类型语义和字段映射；相同描述只存储一份，各业务类型按逻辑身份与存储类型引用实现。共享实现不合并业务类型，也不增加运算能力。范围继承、枚举标签和业务顺序、可空性及字段多 wire 映射均由模型声明决定。

消费者仍通过 `codec_module` 获取 `createCodecs(primary)`、`presentations`、`semantics` 和 `mappings`。基础类型 codec 由宿主提供；模型制品决定业务约束，执行端负责实例化和适配。codec、展示和语义的不同组合保持独立，例如两个不同指标可共享数值校验，但保留各自的名义类型。

发布目录遍历指标时直接使用当前条目推导结果可空性，计算指标才递归读取依赖；目录收集不逐项重新扫描完整指标表。

## IC 验收

`scripts/check-model-publication.mjs` 验证单一制品的全量知识、公开目录、codec、查询证明及参数化计划；关闭模型通道后，仍能复用同一计划绑定不同参数并在 SQLite 上执行。来源位置的集成验收由插件的 model-located-integration 测试覆盖。

`scripts/compare-model-publications.mjs <baseline.wasm> <candidate.wasm> <adapter.ts>` 对照相同模型源码的两个制品，核对知识图与词汇、公开目录，以及全部 codec 和字段映射的行为，报告制品与 codec 大小。契约身份随发布内容变化；比较时使用两个制品各自的契约身份。

描述式 codec 的独立行为验收：

```sh
publication_tmp="${TMPDIR:-$HOME/.cache/tmp}"
mkdir -p "$publication_tmp"
bin/telora -C ontology eval @test/publication:runtime_contract \
  --request-fuel 100000 > "$publication_tmp/codec-contract.json"
node ontology/tests/codec-publication-runtime.mjs "$publication_tmp/codec-contract.json" \
  /path/to/dari/packages/dari-model/src/telora-model.ts
```
