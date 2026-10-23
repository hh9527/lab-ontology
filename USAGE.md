# 本体服务使用说明

本文介绍基于本体的查询服务如何打包、启动和使用。第 1～3 节适用于暴露相同三个方法的任意模型。
第 4 节列出本仓库领域，集成应用可替换或省略。构建命令在仓库根目录运行，runner 可从任意能访问产物的目录启动。
第 1～2 节面向可信宿主，不面向发起查询的 Agent。

本文是当前外部服务及 Intent 契约。模型作者和 QueryAst 边界见[本体文档](ontology/docs/ONTOLOGY.md)和[查询文档](ontology/docs/QUERY.md)。
[关系示例](relation_model/README.md)和 [IC 领域指南](icloud_model/docs/DOMAIN.md)说明两个模型，均使用下文共享 Intent 语法。
评测结果记录早期实验，不是当前 API 契约。Telora 语言和 CLI 文档属于 Telora 项目，不在本仓库复制维护。

## 1. 构建快照

```sh
node scripts/build-knowledge-snapshot.mjs --module <module> \
  --domain <domain> --output <artifact>.wasm
```

`<module>` 是拥有 `MainService` 的 Telora 工作区成员，不是请求中的领域名。
构建初始化服务并将就绪状态嵌入 Wasm。若模块声明外部源，构建时用 `--source name=path` 提供全部源。
部署需要时可通过 CLI 设置初始化 fuel、请求 fuel 和内存上限；实验产物须搭配兼容版本 `telora-run`。
包装脚本以 `--snapshot` 编译，遍历实际产物的可见知识，检查通过后才发布。
集合中每个领域重复传入 `--domain`；当前两个服务各暴露一个领域：`relation` 或 `ic`。
生成 `<artifact>.wasm.knowledge.json`（可见键／类型、计数、模型版本和产物 SHA-256）以及
`<artifact>.wasm.knowledge-sizes.json`（完整大小排名、最大条目／链接、阈值及运行时验证结果）。
具体文档默认预算为 16,000 字符，严格按 `JSON.stringify({Document:{Found:node}}, null, 2).length` 测量，而非 UTF-8 字节。
索引元数据会测量但不受该预算约束。完整术语通过独立能力获取，供消费方缓存与搜索。
用 `--max-node-chars <number>` 设置部署预算；超限会在替换旧产物前失败，`--on-oversize warn` 显式允许带警告发布。
`--not-found <checks.json>` 还可用 `{domain,key}` 请求组成的 JSON 数组检查隐藏键。
包上下文不同于模块名时使用 `--context <crate-directory>`，包装脚本转发重复的 `--source` 及 fuel／内存选项。
传输或部署后，`node scripts/check-knowledge-manifest.mjs <artifact>.wasm` 校验哈希、版本、计数和真实 `info` 样本。
实验可直接用 `bin/telora -C <module> build <module> --snapshot -o <artifact>.wasm`，但会绕过发布检查。

## 2. 启动服务

```sh
telora-run <artifact>.wasm --serve stdio+jsonl://
telora-run <artifact>.wasm --serve http://127.0.0.1:8080
```

保持进程运行：向 stdin 每行写一个 JSON 请求，从 stdout 每行读一个 JSON 响应，不要混入其他标准输出。
不带 `--serve` 的 runner 读取一个完整 JSON 请求，响应一次后退出。
`telora-run` 执行构建产物，无需源树、工作区配置或编译器；部署只需产物和兼容 runner。

本仓库模型显式声明 POST 路由 `/<domain>/info` 和 `/<domain>/transform`。
HTTP 请求体就是槽位输入，不含 JSONL 的 `method`／`input` 信封。例如：

```sh
curl -sS -X POST http://127.0.0.1:8080/ic/info \
  -H 'Content-Type: application/json' -d '{"key":"index"}'
```

`telora-run` 不提供认证，只绑定宿主私有回环或 Unix socket，并通过可信工具适配器或认证网关向 Agent 暴露这两个操作。
Agent 环境不得挂载快照、runner、源树、测试或评测材料，也不得拥有能读取宿主部署目录的 shell 或文件工具。
网关凭据及 runner 命令不进入 Agent 上下文。仅在提示词中省略产物路径不构成隔离；能无限制访问宿主文件系统的本地工具进程也不构成隔离。
限流、请求大小限制、访问日志和 SQL 执行授权由宿主负责。`transform` 只生成 Query，不执行。
当前 CLI 选项是 `--serve`，`--bind` 属于旧版 Telora 文档。

## 3. 宿主请求协议与知识事实

JSONL 请求恰好包含 `method` 和 `input`；method 选择槽位，仅 input 传入该槽位。
HTTP 则直接把相同 input POST 到对应路径。知识与查询方法如下：

```json
{"method":"<domain>/info","input":{"key":"index"}}
{"method":"<domain>/info","input":{"key":"<key returned by index or links>"}}
```

宿主收集 `index` 和 discovery 根，再跟随全部 `links[].key` 引用。
`index.detail` 包含 `{revision,key_patterns,encoding}`，Member 链接包含基本类型。
每个节点含 `{key,type,description,links,detail}`。键包括 Dataset、Dimension、Field、Measure、Relation、Ty、Value、TimeRole 和 BusinessLink，每个规范名称进行一次 URI 编码。
返回键是完整稳定身份，标签、别名和物理名称不能替代规范业务 ID。

`<domain>/discovery` 接受 `{}`，返回 `{knowledge_contract,intent_contract,revision,roots,key_patterns,vocabulary}`。
当前契约为 `ontology-knowledge-v2` 和 `ontology-intent-v1`。根标识可见 Dataset 和 Relation 节点。
图包含知识事实与业务约束；消费工具负责 Agent 工作流、查询帮助和检索示例，宿主 info 是集成接口。

对 dsh-oks，知识是 `{meta,origin,data}` 资源，data 为规范键字典。
`oks_data` 自动解包 `.data`，通过 `knowledge://#meta` 暴露元数据和来源。
用法分别由 `oks://help/knowledge`、`oks://help/query` 提供，检索由内置 jq 程序实现。
消费方在加载图前校验契约。

生成消费方数据：

```sh
node scripts/derive-discovery.mjs --output-prefix bin/icloud_model
```

脚本写入 `.terminology.json`、`.links.json`、`.keys.json` 和 `.report.json`。
`--artifact`、`--domain`、`--output-prefix` 选择模型与输出，`--keys roots.json` 可提供根以替代 discovery 调用。

术语结构为 `{revision,datasets,dimensions,measures,rels,types,values}`。
Dataset、Relation 和业务 Ty 条目含 `{name,doc,aliases}`；Dimension、Measure 增加 `dataset`，Value 增加 `ty`。
物理 Field 和基本 Type 可通过 info 获取，但不进入搜索词汇。别名和描述来自结构化元数据、本地化标签及显式术语。

链接结构为 `{revision,links:[{source,target,kind}]}`，消费方按目标索引用于反向发现。
边按 `(source,target,kind)` 唯一，不同种类保留自关系两侧；完整定义及维度局部约束仍在 info 文档中。

Dimension 标识业务投影与筛选，Measure 标识声明聚合，文档提供允许的查询能力。

先用索引主题和 `info` 发现模型，再用发现的稳定 ID 将用户业务请求表达为 Intent。
借助 `transform` 诊断修复 Intent，不改变请求的业务含义。转换成功只说明 Intent 在模型下合法，不证明回答了用户问题。
优先用一个接受的 Intent 满足业务目的；单计划不足时，可一次 transform 提交最多五个独立 Intent。
用业务语言解释各结果及其如何共同回答问题。服务不合并或跨计划去重，不能声称已经做了这些工作。
若没有支持且有用的计划，应解释限制或提出聚焦的业务问题，不能为成功转换而改变用户含义。
SQL 与绑定是交给获授权执行层的中间输出，不是澄清依据或最终业务结果。

一至五个 Intent 使用相同外层信封；即使只有一个也必须放入数组：

```text
{"method":"<domain>/transform","input":{"intents":[<Intent>, ...]}}
```

每个顶层 Intent 可声明 `limit`，范围为 1 至 9,223,372,036,854,775,807 的 JSON 整数（有符号 64 位）。
省略或显式 null 保留既有行为，不增加上限或绑定；布尔、字符串、浮点及非正值被拒绝，并返回针对 limit 的诊断。
GraphPair 操作数和 GraphUnion 分支不要求此字段。
模型定义 limit 语义及整数范围；外部插件声明并执行自己的调用要求与行数限制，可以要求 limit、收窄范围或在转发前注入／覆盖。
通过插件调用时遵守其声明要求。

`limit` 在筛选、聚合、DISTINCT、排名、分区 Top-N、配对及集合操作之后限制最终行数。
业务 `take` 继续选择总体；二者作用于同一最终有序结果时，SQL 取较小值。分区 Top-N 先于全局输出上限执行。
上限是 SQL 绑定，不是客户端切片。保留已有排序，无排序时不承诺具体子集或稳定分页。
transform 返回完整 SQL 和绑定，而非数据库行。执行层必须返回全部结果，包括空结果和恰好到上限的结果；额外截断必须披露。
不计算总数或 `hasMore`，达到上限不代表覆盖整个总体。

响应包含 `accepted`、`diagnostics`、`queries`。每项诊断有标识 Intent 的零基 `index`，以及含 `severity`、`message`、有序 `locs` 的 `diagnostic`。
由 `fail!` 抛出的转换失败中，`locs[0]` 为规则位置，`locs[1..]` 按参数顺序列来源，含重复来源。
源文件位置带源名及 `start`／`end`；行号从 1 开始，offset 是行内零基 UTF-8 字节偏移。
解析请求参数也携带来源，其内部源 ID 为 0（报告为 `<input>`），两端均用 `line: 0`，offset 为整个输入内的 UTF-8 字节偏移。
这保留相同位置结构，无需为动态输入建立行索引。其他诊断可能用 `locs[0]` 表示错误输入。
没有 Intent 产生诊断时数组为空。
即使前项失败也检查全部 Intent。仅全部成功时 queries 才按原顺序包含每项 Query，否则为 null。
成功批次仍可能有警告，使用前应阅读。这是独立计划批次，不是合并结果集。

每个成功 Query 为 `{sql, bindings, columns, limit_slot}`。
`columns` 按最终 SQL 结果排序，包含生成的标签和比较列，每项为 `{name, type, nullable}`，例如：

```json
{
  "sql": "SELECT ...",
  "bindings": [],
  "limit_slot": null,
  "columns": [
    {"name": "alarm_severity", "type": "String", "nullable": true},
    {"name": "alarm_count", "type": "Int", "nullable": false}
  ]
}
```

`limit_slot` 是最终输出上限在 bindings 中的零基索引，顶层无上限时为 null，不指内部 Top-N／分区上限。
执行适配器可复制 bindings 并调整该槽以实施自身有界获取策略；模型原样返回请求上限。

列在 transform 时从已校验模型及最终投影推导，无需连接数据库或执行 SQL；空结果和全 NULL 列也有模式。
类型词汇为 `Int`、`Float`、`Bool`、`String`、`DatetimeUtc`、`EpochMillis`、`LocalDateTime`。
DatetimeUtc 和 EpochMillis 保留显式 UTC 瞬间语义，不降为存储 String／Int。
日历桶维度保留声明时间编码；Min／Max／Latest 输出源值时保留声明瞬间类型。
Count 为 Int，Avg 为 Float，数值求和与计算度量遵循自身输出类型。
具名值域投影 String 业务 ID，包括半开放值及 `__kind` 列；排名 GraphPair 追加 Float `comparison_value`。

`nullable:false` 保证模型契约下非 NULL；true 保守允许 NULL，不预测结果必有 NULL。
可空性考虑可选字段、外连接、空聚合输入和条件表达式，谓词及排名保护不收窄模式。
逻辑类型描述值，驱动特有 Bool 和无损 Int 表示仍由执行适配器负责。

LocalDateTime 表示无时区或偏移的日期与钟表时间，是自足值，不是瞬间。
转换为 DatetimeUtc 或 EpochMillis 需显式时区／偏移，以及必要的跳时或重复时刻歧义策略。
列不提供默认时区，也不做时间转换。EpochMillis 即使带本地业务描述仍表示绝对瞬间；移位墙上时间整数需要独立编码。
仅日期及地址值在结果契约中保留基本表示，字段语义可在知识中查询。transform 不借环境时钟或时区推断列。

GraphPair 组计数和 Graph 组计数在 SQLite、PG 中均用显式结果别名 `count`，普通计数保留带节点限定的别名。
低层方言构造器及 `query_intent_lower_factory` 返回 `{sql, bindings}`，公共 transform 批次增加语义列契约。
`intent::result_columns(payload, validated_intent, ast)` 为已持有校验 Intent 和 AST 的集成提供相同静态模式。

调用方在提交 Intent 前解析相对时间。参考时间及时区可来自应用客户端或 Agent 环境，服务不读取。
使用维度声明逻辑类型的具体值，在答案中说明最终业务日期；缺少可靠参考时间或时区时，应询问缺失上下文。
时间值和窗口语义见[时间契约](ontology/docs/TIME.md)。知识发现描述模型，下文给出通用 Intent 语法；模型与 transform 决定组合是否具备合法业务含义。

当前 IC 时间类型为 `DatetimeUtc`（RFC3339 UTC 秒，`YYYY-MM-DDTHH:MM:SSZ`）、`DateUtc`（`YYYY-MM-DD`）和 `EpochMillis`（JSON 整数毫秒）。
旧空格分隔 UTC 输入被拒绝，需部署重建快照并通过 info 发现当前类型。

### Graph Intent 语法

Graph Intent 有五个必填字段，必要时使用空数组。下面可选顶层 limit 增加最终输出上限：

```json
{"op":"Graph","limit":1000,"root":"item",
 "nodes":[{"id":"item","entity":"<dataset ID>"}],
 "edges":[],
 "select":[],"count":"item"}
```

root 指定 nodes 中的节点实例，不是单独的数据集 ID。
每个节点含 id（图内唯一实例名）和 entity（稳定数据集 ID）。
每条边含 relation（稳定具名关系 ID）、from、to（节点实例 ID），方向与端点角色必须匹配模型。
edges 顺序任意，但必须形成一棵有根树，每条边引入一个从 root 可达的新节点。
select 包含 `{"node":"...","dimension":"..."}`。count 是被计数节点实例 ID，不是度量名；有 count 时必填 select 可为空。

可选顶层字段及形状：

| 字段 | 形状 |
| --- | --- |
| `constraints` | 与 edges 同形状的边对象数组 |
| `measures` | `{"node":"...","measure":"<stable measure ID>"}` 数组 |
| `filters` | `{"node":"...","dimension":"...","op":"Eq","value":...}` 数组 |
| `time_windows` | `{"node":"...","dimension":"...","start":...,"end":...}` 数组；end 必填非 null，start 可省略或为 null |
| `any_of` | `{"node":"...","dimension":"...","values":[...]}` 数组 |
| `exists` | 下述存在性对象数组 |
| `measure_having` | `{"node":"...","measure":"...","op":"...","value":...}` 数组 |
| `count` | 节点实例 ID 字符串 |
| `count_value` | `{"node":"...","dimension":"..."}`，统计不同非空值 |
| `count_having` | `{"op":"...","value":<integer>}` |
| `count_groups`、`include_empty`、`distinct` | 布尔值 |
| `group_by_identity` | 节点实例 ID 字符串数组 |
| `row_grain` | `"Root"` 或 `"Association"` |
| `order_by` | `{"node":"...","dimension":"...","direction":"Asc|Desc"}` 数组 |
| `limit` | 仅顶层 Intent 可选；正有符号 64 位整数，限制最终输出 |
| `take` | 整数 |
| `top_per` | `{"owner":"<node>","sample":"<node>","rank":"<dimension>","take":<integer>}` |
| `top_by_measure` | `{"node":"...","measure":"...","direction":"Asc|Desc","take":<integer>}` |

聚合 Top-N 中，select 指定可见维度，measures 指定排名聚合。
无 group_by_identity 时，按相同投影维度值分组排名，前提是连接图不能扩增度量源行。
显式 group_by_identity 为具名实体保留独立组，同可见值的两个实体可占不同行。
隐藏身份键可能拆分可见组时，transform 给出警告。仅在问题针对独立实体时使用身份分组，不用于类型或类别等维度值问题。

聚合阈值应发现共享 `Graph aggregate` 知识节点，了解支持的身份及上下文样本总体。
`Declared filter capabilities` 解释为什么语法操作符不能覆盖维度 ops；`Ordering and aggregate meaning` 解释 NULL 顺序、身份决胜，以及原始 Top-N 不能替代分组 Min／Max。
从 index 找到节点，原样传返回键给 info，不能仅为完成转换而改变业务含义。

时间窗口为 `[start,end)`，使用声明逻辑类型中的具体值。end 必填非 null，start 省略或 null 表示截止 end 之前全部历史。
规划时固定截止值，提交前解析 now、经过时长、日历边界及时区影响。服务拒绝相对表达式及请求 ctx。

存在性对象必填 anchor（外层节点实例 ID）、nodes（内部节点对象）、edges（连接锚点和内部节点的具名边）。
边顺序任意，但必须构成以 anchor 为根的树。
还可包含 constraints、filters、time_windows、any_of、having（与 measure_having 同形状）和布尔 negated。
exists 限定外层实体而不扩增其行；关联一对多实体只需证明存在时使用它。
请求可含多条图边和多个存在性对象，语法不固定跳数。

筛选操作符为 Eq、Ne、Gt、Ge、Lt、Le、Contains、NotContains、StartsWith、EndsWith。
模型限制每个维度允许的操作和逻辑值类型。不要发送 kind，目标维度或度量决定 JSON 值逻辑类型。
info 显示的带类型谓词输入和规范编码是模型事实，不是 JSON Intent 值语法。
从索引找到 Intent 语法入口，通过 `<domain>/info` 跟随返回键及链接。
诊断中给出的 info 键可用于读取知识以修复 Intent。业务值筛选使用稳定值 ID，不使用物理编码或本地化标签。

### 单一去重实体集合

两条或更多独立合法图路径需要返回同一实体的一个去重总体时使用 GraphUnion：

```text
{"op":"GraphUnion","limit":1000,"branches":[
  {"result_node":"<node ID>","graph":<graph Intent>},
  {"result_node":"<node ID>","graph":<graph Intent>}
]}
```

每个 Graph 完整且遵循自身声明关系、筛选、授权与粒度规则。
result_node 可不同于根及其他分支结果节点，但所有结果节点须属于同一数据集。
只选择该结果节点的维度，各分支维度顺序相同，必须包含**数据集声明身份粒度的每个字段**对应普通维度，身份可能是复合的。
当前形式中身份字段是可见结果列，其他选择维度也须跨分支一致；SQL UNION 去重完整结果行，不合并不同实体身份。

GraphUnion 至少接受两个原始行分支，可用 filters、exists 和具名图边限定行，不能使用计数、度量、身份分组、局部排序、Top-N 或分页。
不能反转有向关系，也不能将两种独立合法结果类型变成一个实体。
用户需要不同结果类别而非单实体集合时，使用独立接受的 Intent。

### 独立聚合配对

GraphPair 分别聚合两个总体，显式对齐完整身份，并选择每个输出列来自哪一侧。

```text
{"op":"GraphPair","limit":1000,"left":<Graph intent>,"right":<Graph intent>,
 "align_by":[{"left":{"node":"d"},"right":{"node":"d"}}],
 "select":[{"side":"Right","node":"d","dimension":"device_name"}],
 "rank_by":{"op":"Subtract","minuend":"Right","subtrahend":"Left",
            "direction":"Desc","take":5}}
```

每侧恰好一个度量，select 为空或省略。group_by_identity 按序与对齐节点完全一致，并从根开始。
配对节点属于同一实体，ID 可不同。外层 select 必填，可为空；展示维度来自对齐节点，绝不成为对齐键。
输出先按 select 顺序，再输出两侧度量，别名为 left_<node>_<dimension or measure> 和 right_<node>_<dimension or measure>。

排名支持 Subtract（minuend／subtrahend）、Ratio（numerator／denominator）和 GrowthRate（current／baseline）。
侧别参数显式选择不同 Left／Right，每次排名需 direction Asc|Desc 和 take 1..1000。
数值度量须为同一度量或声明相同非空单位。排除 NULL、Ratio 零分母及 GrowthRate 非正基线。
运算采用近似双精度，增长率 0.2 表示 20%；并列按完整对齐身份升序、NULLS FIRST 决胜。

总体保持独立，filters、exists、time_windows、measure_having 留在各自 Graph 内。
操作数禁止计数、distinct、include_empty、排序、Top-N。
无排名的 count_groups:true 统计全部对齐身份，不能与 rank_by 组合。

旧隐式配对需迁移，形状、别名、配置要求和步骤见[完整 GraphPair 契约](ontology/docs/GRAPH-PAIR.md)。

JSONL 服务响应使用 `telora.service/v1` 信封。成功时 ok.Document 包含 Found 或 NotFound，Found Index 节点包含完整 detail.entries 列表。
transform 的 ok 包含上述批次响应。拒绝 Intent 表现为 `ok.accepted:false`、带索引诊断和 `queries:null`；
格式错误请求及未捕获服务失败为 `error:true`，带顶层结构化诊断。
阅读诊断并用相关知识修复 Intent。接受的 Query 含参数化 sql 与 bindings，不是数据库结果。
将二者一并交给获授权执行层，绝不把值拼入 SQL，并以合适形式向用户展示数据。
没有执行层时，说明只生成了中间 Query，不得编造结果。

## 4. 本仓库领域

| 构建模块 | 领域 | 范围 |
| --- | --- | --- |
| `relation_model` | `relation` | 精简的租户、站点、设备和连通关系示例 |
| `icloud_model` | `ic` | iMaster Cloud 建模压力夹具 |

每个模型独立构建快照，暴露 `<domain>/info`、`<domain>/transform`、`<domain>/discovery` 及对应 HTTP POST 路由。
两个模块均无需外部构建源，最小构建与请求流程见[关系示例](relation_model/README.md)。
IC 夹具不是完整生产领域模型，不得猜测补全缺失知识点或合法转换路径。
