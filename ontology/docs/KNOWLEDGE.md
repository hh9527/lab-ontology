# 模型知识契约

模型发布领域知识事实：稳定身份、描述、关系、逻辑类型、值和已声明业务约束。
工具用法、请求语法、检索方法和 Agent 工作流由消费方负责。宿主收集完整图，并可向 Agent 暴露紧凑投影。

## 构建期发布与静态程序

IC／relation 通过 `ontology::build::stage` 从 transform 的同一 Prepared 导出模型 JSON。
Wasm custom section `telora.build.information` 使用 `{version:1,entries:{...}}` envelope。
`entries["ontology.knowledge"]` 为 `{knowledge_contract:"ontology-knowledge-javascript-v1",program,data}`。

program 是 ontology 的固定 JS 函数体，同一版本对所有模型完全一致。模型标注只派生 JSON，不生成 JS 源码。
data 为 `{revision,instructions}`，instructions 的每项为 `[operation,...args]`。当前顺序为完整类型表 types、Entity、Dataset、能力和关系；领域操作由静态程序解释，插件无需理解其含义。

插件 JSON.parse 构建信息后执行：

```js
const buildKnowledge = new Function("data", publication.program);
const { graph, vocabulary } = buildKnowledge(publication.data);
```

插件信任模型代码，直接同步执行。静态程序使用 Map／Set 和原地更新，负责规范地址、SHA256 Group 哈希、类型内联、节点展开与事实合并；输入 JSON 保持不变。构图状态只在一次调用中使用，不经跨调用序列化。

最终 graph 使用 `ontology-knowledge-v4` 图结构，含 facts 和 items。vocabulary 每项为 `{key,kind,name,doc,aliases,owner,ownerValue}`，用于 `va_ask`。插件验证词条身份及唯一性，外部展示文件可补充说明和别名。编译、执行或验证错误直接拒绝加载，成功结果按模型及外部展示身份缓存。

库的 `knowledge::export` 保留完整图等价验收参考实现；默认构建使用 `knowledge::publication`。

## 最终知识事实
每条事实为 `{key,value,references}`，key 是规范稳定地址，references 显式指向其他事实。
消费方必须校验契约与引用闭合，再从事实派生成员导航、语义链接和反向链接；展示条目不授予查询权限。

Entity 表达独立业务身份，Dataset 表达行类型、来源、粒度与时钟；Role 以完整身份映射关联 Dataset 与 Entity。
DimensionGroup／MeasureGroup 表达可复用能力，绑定表达输入映射和发布成员。关系显式引用端点角色。
这些是不同种类的事实，不能仅按表名或字段同名合并。具体地址以输出 key 为准，不能推测或重写。

Int、Float、Bool、String 及内置 Option、Array、Dict 不生成类型节点，也就没有其反向链接。
类型字段内联表达，例如 `Array(Option(Dict(types/<业务类型地址>)))`；其中具名业务类型的引用仍保留。
具名 newtype、具名枚举保留节点，不能因底层为标量或结构类似 Option 而忽略。

P1 支撑运行期程序，P2 支撑上述外部知识；运行期不重跑准备或发现。
dsh-oks 直接读取 custom section，并可从 `<model>.knowledge-items.json` 补充名称和文档。
插件只读取 `telora.build.information`；重复或损坏的新段均拒绝，旧 `telora.service.metadata` 不作为知识来源。
当前模型不挂载下述可选 info／discovery 接口。

## 可选库接口：info／discovery

下文仅记录仍保留的独立库接口，插件不消费这些接口，其 v3 协议与构建期发布及最终 v4 图不是同一运输或地址契约。

工程边界采用版本管理：discovery 声明 `knowledge_contract: "ontology-knowledge-v3"` 和 `intent_contract: "ontology-intent-v1"`。
消费方必须显式拒绝不兼容快照。更新 Intent 语法时须同时审查消费方的版本化工具帮助及解析测试；修改知识描述须保留业务语义，不能加入工具操作指令。

## info 协议

`knowledge::knowledge_service_factory(payload, domain)` 绑定已准备模型，返回纯 `Fn(Value) -> Value` 请求处理函数。
`knowledge::serve_value` 是等价未绑定入口，无需数据库连接或 SQL 后端。

将 `knowledge::knowledge_info_method_factory(payload)` 挂载到 `<domain>/info` 槽位。
Telora 按方法路由，只把 input 传给槽位；不要在 transform 内再传信封。

```json
{"method":"foo/info","input":{"key":"index"}}
{"method":"foo/info","input":{"key":"Dataset/example"}}
```

请求恰好包含 method 和 input，info 输入恰好为 `{key:<string>}`。
响应为 `{"Document":{"Found":{...}}}` 或 `{"Document":"NotFound"}`。
每个 Found 节点包含 `{key,address,type,description,links,detail}`。
description 包含标签、别名、本地化文本、摘要和显式术语。
links 的每项为 `{type,key,role}`：Member 表示结构成员，Traversable 表示声明关系端点，Related 表示解释性关联，绝不授权查询遍历。

未知或不可见键返回 NotFound。`info("terminology")` 也返回 NotFound，词汇由消费方根据 discovery 根及结构化 info 文档生成。
格式错误或不支持字段通过结构化诊断失败，包含 JSON 路径和具体原因。身份认证与访问控制由宿主负责。

## 顶层索引

`info("index")` 返回 Index，detail 为 `{revision,key_patterns,encoding}`。
key_patterns 列出具体节点的 `{kind,pattern}`，encoding 描述稳定 URI 组件身份。
Member 链接包含基本类型，故 index 加 discovery 根可到达完整公开图；索引不枚举业务实例。

键前缀与种类相同，包括 `Ty/{ty}`。

| 节点种类 | 键模式 |
| --- | --- |
| Dataset | `Dataset/{dataset}` |
| Field | `Field/{dataset}/{field}` |
| Dimension | `Dimension/{dataset}/{dimension}` |
| Measure | `Measure/{dataset}/{measure}` |
| Relation | `Relation/{relation}` |
| Ty | `Ty/{ty}` |
| Value | `Value/{ty}/{value}` |
| TimeRole | `TimeRole/{dataset}/{field}` |
| BusinessLink | `BusinessLink/{hub}/{link}` |

每个规范名称作为一个 URI 组件编码且仅编码一次。返回键完整，应原样传给 info。
名称、别名和标签不同于规范 Intent ID。

## 具体知识

Dataset 详情包含 `{id,grain,time_roles,references,field_roles}`。
其 Member 链接直接标识已发布 Field、Dimension、Measure、Relation、TimeRole 和 BusinessLink。
Dimension 链接标识字段、逻辑类型和声明值。Relation 从与查询转换相同的准备模型发布端点、基数和形状。

Field 详情包含 `{id,dataset,nullable,logical_type,roles,reference_ids}`，Value 包含 `{id,ty,wires}`。
Ty 详情有 id，描述及结构化操作解释逻辑值域。Dimension、Measure 和 Relation 保留对应模型概要。
若声明采样，Measure 详情包含 `sampling`：源字段、单位、聚合和角色（`Primary` 或 `SampleSummary`）。
采样元数据属于该度量，没有单独知识键。`sample_measure` 直接声明主样本度量和单位，`sample_aggregate` 为同字段声明同单位的其他统计量。
数据集种类 `Metric` 表示采样总体，字段角色 `Metric` 表示定量用途，二者都不是知识节点种类。
Metric 和 TimeRole 标识所属数据集。BusinessLink 包含 `{id,hub,direction,guard}`。
Latest 度量详情包含结构化选择事实：时钟键、完整数据集粒度键、时间降序、粒度升序且 NULL 在前、排除 NULL 时间、保留 NULL 值。
声明 UTC 分桶时，Dimension 详情包含带日历单位的 utc_bucket；字段和输入类型标识源与输出时间域。

字段可见性来自粒度、时间角色、可见维度、度量和采样度量。仅有私有物理列不会发布，Field ID 不自动成为可查询 Dimension ID。
逻辑类型操作不授予字段权限，必须检查维度 ops、filterable 及时间角色。

维度 input_kinds 和 input_docs 描述接受的逻辑值。输入文档来自 FilterInputKind 变体上的 @doc。
时间角色声明语义、编码和权威性；相对日历边界、本地时区歧义须在外部解决。
时间角色及 UTC 分桶元数据独立于消费方查询语法保留时间含义。

`business_link_description(id,label,summary)` 描述枢纽上声明的连接，`term` 提供可搜索别名及解释。
BusinessLink 名称描述通过两个端点关系的遍历；方向及保护条件仍是显式查询契约，名称不建立设备层级。

数据集引用是可替代完整唯一地址 `{id,fields}`。任何 NULL 成员使引用不可用，不创建全行键或查询粒度。
字段 nullable 从 Option(T) 派生。角色包括 Appellation、Reference、Classification、Metric，不授予查询访问。
隐藏字段和可见成员不完整的引用被排除，详见[字段角色](FIELD-ROLES.md)。

@knowledge_doc 改变解释，不授予可见性或查询能力；@related_to 增加解释性引用，不创建查询关系。
knowledge_lookup_factory 准备一个目录供反复带类型查询，服务工厂同样只初始化一次。
目录缓存可见 Dataset 概要，按键索引文档、关联引用和显式术语。成员查询只构造请求节点，不缓存完整成员文档。

准备阶段用批量字典检查维度 ID 唯一性，重复诊断按源顺序选择首个冲突声明。
数据集发布准备实体内部字段成员，目录构造消费已解析维度项。输入类型文档元数据只准备一次，由维度描述共享。
配置校验在遍历表达式时一并检查操作符和标量能力。

测量模型准备须使用 release 编译器，对同一源版本和资源限制串行执行。例如从仓库根目录：

```sh
printf '{"method":"ic/discovery","input":{}}\n' | /usr/bin/time -v /path/to/telora/target/release/telora \
  -C icloud_model --initialization-fuel 1000000 --request-fuel 10000 \
  --with-memory-limit 2048 run icloud_model
```

这包含编译、模型准备和服务初始化，应分别记录总耗时及用户 CPU 时间。下面的快照启动基准测量已准备模型的加载。

`node scripts/benchmark-knowledge.mjs --artifact <snapshot> --full --output <report.json>`
测量快照启动至首次 discovery 响应、预热后的单键请求及完整遍历。
报告包含紧凑 JSON 字节数和 SHA-256，用于逐节点比较快照；Linux 下也记录 runner 常驻内存，包含运行时和临时分配，不只是目录。
启动不包含源编译和快照初始化。

## 程序化发现

`knowledge::knowledge_discovery_method_factory(payload)` 挂载 `<domain>/discovery`，接受 `{}`，返回
`{knowledge_contract,intent_contract,revision,roots,key_patterns,vocabulary}`。
`roots` 列出完整可见 Dataset 和 Relation 键，`key_patterns` 与顶层索引相同。
消费方收集 `index` 及这些根，再沿直接链接遍历。

`vocabulary` 用 `{kind,group,owner,require}` 声明可搜索成员及输出形状，`group` 是术语输出数组名。
可选 `owner` 同时指定详情字段及键模式中的归属占位符，Value 使用 `ty`。
可选 `require` 指定纳入成员时必须存在且非 NULL 的一个详情字段，不是表达式或转换。
未列入 vocabulary 的种类仍可读取，但不属于词汇成员；消费方通过 `key_patterns` 区分被排除种类与未知种类。
空 vocabulary 表示无成员，缺少声明则是契约错误。

每个知识点的 `description.terms` 包含显式 `{term,description}` 注解，结合标签、摘要、别名和本地化文本，保留外部生成搜索词汇所需元数据。

## 外部索引

`scripts/derive-discovery.mjs` 通过 discovery 及精确 info 调用生成：

- `.terminology.json`：`{revision,datasets,dimensions,measures,rels,types,values,business_links}`。
- `.links.json`：`{revision,links:[{source,target,kind}]}`。
- `.keys.json`：Dataset／Relation 根。
- `.report.json`：完整清单覆盖及可选基线比较。

业务连接术语项为 `{hub,name,doc,aliases}`，用 URI 组件编码标识 `BusinessLink/{hub}/{name}`，与 Relation 术语不同；发现仍从 Dataset／Relation 根开始。

`--keys roots.json` 从独立文件读取根。未解析引用、重复节点和归属不匹配显式失败。
`--compare-prefix` 将词汇名称、文档、别名及唯一引用边与本地基线文件比较，有差异时退出码为 1。

Dataset、Relation 和业务 Type 术语为 `{name,doc,aliases}`；Dimension、Measure 增加 `dataset`，Value 增加 `ty`。
仅索引可见节点。物理 Field 和基本 Type 可通过 info 读取，不进入搜索词汇。
一个术语可匹配多个键；名称、别名和文档支持消费方按范围搜索。
别名无独立声明描述时采用节点摘要，无摘要时采用显示标签。

每条链接对应其源 info 文档中的引用，边按 `(source,target,kind)` 唯一，保留 Member、Traversable 和 Related 的区别。
Relation 端点中，源数据集是 Member 边，目标是 Traversable 边，保留自关系两侧。
消费方按目标索引边，查找引用它的知识键。

Value 归属编码为 `Value/{ty}/{value}`，Dimension 为 `Dimension/{dataset}/{dimension}`。
反向类型引用找到使用该类型的维度，再读取局部约束确定接受值。

## 机械导出

```sh
node scripts/build-knowledge-snapshot.mjs --module icloud_model --domain ic \
  --output bin/icloud_model.snapshot.wasm --with-memory-limit 2048
node scripts/derive-discovery.mjs --output-prefix bin/icloud_model
node scripts/export-knowledge-markdown.mjs
node ontology/tools/knowledge-export.mjs http://127.0.0.1:8080/foo/info > /tmp/foo-knowledge.json
node ontology/tools/knowledge-html.mjs /tmp/foo-knowledge.json > /tmp/foo-knowledge.html
```

快照发布遍历 index、discovery 根及直接引用，记录版本、产物摘要和完整可见键集。
HTML 渲染器转义文本，拒绝重复或悬空引用。产物访问由宿主控制。
与模型无关的服务工程协议见[使用说明](../../USAGE.md)。

## 语义地址与分类导航

工程知识契约为 `ontology-knowledge-v3`，discovery 的 `addressing` 为 `"node-member-uri-v1"`。
每个 info 节点含 `address: {node,member}`。独立节点使用 `datasets/<id>`、`types/<id>` 或 `relations/<id>`，member 为 null；
归属成员例如 node 为 `datasets/<dataset>`、member 为 `fields/<field>`。地址内 ID 分别进行一次 URI 组件编码。
每个链接声明标识目标分类的 role：fields、dimensions、measures、time_roles、business_links、datasets、types、values 或 relations。
模型发布身份和事实；消费方组织投影，并据此派生分类反向导航。

反向导航由工具层从正向事实派生。模型通过地址表达成员归属，并由父节点列出成员；成员不重复发布归属父节点的链接。关系端点、业务链接端点及度量依赖属于业务事实，仍显式发布。

## 宿主持有知识索引的实验入口

IC 的 `@src/hosted` 入口提供 `ic/transform` 与 `ic/discovery`。模型准备结果通过
`knowledge::model_roots(payload)` 派生两个根：`lowering` 供查询编译，`knowledge`
提供发现契约和按需物化的知识节点清单。构造根、服务初始化和查询请求均不强制生成知识清单。

```sh
bin/telora -C icloud_model build @src/hosted --snapshot \
  --initialization-fuel 1000000 --request-fuel 1000000 \
  --with-memory-limit 2048 -o /tmp/icloud-hosted.snapshot.wasm
```

该入口的 discovery 返回 `ontology-knowledge-export-v1`：

```json
{"format":"ontology-knowledge-export-v1","discovery":{},"complete":true,"nodes":[]}
```

`discovery` 内是已有的地址、知识、Intent 契约及 revision、roots、key_patterns、vocabulary；
`nodes` 保持 `ontology-knowledge-v3` 结构。IC 返回完整清单。宿主的
`ontology/tools/knowledge-host.mjs` 校验清单并建立键、引用索引，提供 `load()`、`discovery()` 和 `info({key})`。
调用方提供 `request(method, input)`，返回成功响应的解包值，并把传输或 Guest 诊断作为异常抛出。

```js
const host = createKnowledgeHost({ request, artifactHash, domain: 'ic' });
await host.load();
const node = await host.info({ key: 'Dataset/device' });
```

缓存按产物 SHA-256 和 domain 共享，并发首次加载复用同一次发现，失败后可重试。
适配器也支持 `complete=false` 的入口节点清单：沿 index、roots 和 links 通过提供者的
`info` 补齐可达节点，每个键只取一次；提供者必须实现对应 info 路由。
缓存生存期由宿主管理，可以通过 `cache`、`pending` 参数传入应用持有的 Map。

完整入口 `icloud_model` 继续使用现有 discovery／info 协议。hosted 的 discovery 返回知识根，消费方须使用对应宿主适配器。
`dsh-oks` 的接入作为后续迁移。

完整节点等价检查和首次加载计时可以运行：

```sh
node scripts/benchmark-host-knowledge.mjs \
  --artifact /tmp/icloud-hosted.snapshot.wasm --output /tmp/host-knowledge.json
```

`--runner` 可指定隔离的 release runner，`--baseline` 可指定
`scripts/benchmark-knowledge.mjs --full` 生成的知识图摘要，逐节点核对 SHA-256 和字节数。
设计及边界见 [RFC 0001](../../rfcs/0001-host-knowledge-index.md)。

静态 JS 源码为 `ontology/src/knowledge.js`，通过 `python3 scripts/embed-knowledge-program.py` 生成 Telora 字符串；`--check` 检查漂移。协议设计见 [RFC 0005](../../rfcs/0005-programmed-knowledge-discovery.md)。
