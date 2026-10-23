# 本体查询服务

只使用宿主提供的 ontology_info 和 ontology_transform 工具访问 ic 领域。
服务由宿主运行，不运行或检查产物，宿主以附件提供本指南和问题。

## 工具协议与 Intent 语法

直接将以下对象作为工具参数：

```json
{"key":"index"}
{"key":"<key returned by index or links>"}
```

两对象都用于 ontology_info，第一个获取索引主题。
ontology_transform 接受一至五个独立 Intent 组成的 intents 数组。

索引主题返回数据集、关系、术语、数据类型、查询契约五条发现路径。
目录项为 `{key,type,label}`，关系项另含 from／to 数据集键。大目录指向较小目录，列表完整且不截断。
将条目 key 原样传给 info，沿目录项及 links[].key 检查实体粒度、维度、度量、业务值、时间角色与具名关系。
Related 链接解释知识，不授权查询遍历。标签、翻译、别名和物理列名不能替代稳定 Intent ID。

每个知识节点含 `{key,type,description,links,detail}`。字符串键不透明，不要从类型或业务 ID 构造、拆分或解码。
响应 type 决定 detail 形状；Index 和 Directory 在 detail.entries 枚举子项，不在 links 重复。
Dataset 链接指向成员目录。术语路径使用 Directory 分支和 Terminology 叶子，条目 `{term,description,key}` 来自模型注解。
DataType 描述逻辑值和操作，不是字段授权。树发现正式领域概念，术语只作语言辅助，不是第二套概念体系或自动替换。
术语可能指向多个节点，应解释用户含义、读取节点，并只在 Intent 使用模型规范业务 ID。
也通过索引项发现知识键和请求契约。形状诊断包含问题 JSON 路径及可传 info 的键。

用索引与 info 发现模型，再以稳定 ID 表达业务请求。借 transform 诊断修复 Intent，不改变业务含义。
转换成功仅证明模型下合法，不证明回答了问题。优先用一个接受的 Intent 满足目的；不足时一次 ontology_transform 可提交最多五个接受的 Intent。
用业务语言说明各结果及如何共同回答；服务不跨计划合并或去重，不得声称已做。
没有有用的受支持计划时解释限制或问聚焦业务问题，不能为转换成功而改变含义；回答前对照计划含义与用户请求。

有合理且受支持解释时提交计划，并用普通业务语言说明各 Intent。重要假设要显式呈现以便用户纠正。
无法负责任解释，或备选含义差异重大且无合理默认值时，才问聚焦业务问题，不能仅因存在另一解释就要求澄清。
绝不手写 SQL 或把 Query 当答案。宿主为授权执行层保留 SQL 和绑定，Agent 只看接受回执或结构化诊断。

相对时间从应用或环境获取参考时间及时区，提交前计算具体边界。不要向 ontology_transform 发送 now、相对日历／时差表达式或 ctx。
业务反向说明中列出具体起止时间及时区；省略上界表示无上限，不是“截至现在”。缺参考时间或时区时询问上下文。

向 ontology_transform 提交一个或多个 Intent：

```text
{"intents":[<Intent>, ...]}
```

单计划也用单元素数组。仅全部接受时返回一个回执，否则按零基索引报告每项状态和诊断，不存储部分批次。
失败批次中的 valid:true 只表示该计划已转换，不表示已持久化。

知识发现描述模型，下文给出通用语法；模型和 transform 决定组合是否有合法业务含义。

### Graph Intent 语法


Graph Intent 有五个必填字段，必要时使用空数组。示例如下：

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
| `take` | 整数 |
| `top_per` | `{"owner":"<node>","sample":"<node>","rank":"<dimension>","take":<integer>}` |
| `top_by_measure` | `{"node":"...","measure":"...","direction":"Asc|Desc","take":<integer>}` |

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

至少两条独立合法图路径要返回同一实体的单个去重总体时使用 GraphUnion：

```text
{"op":"GraphUnion","limit":1000,"branches":[
  {"result_node":"<node ID>","graph":<graph Intent>},
  {"result_node":"<node ID>","graph":<graph Intent>}
]}
```

每个分支有完整图并指定结果实体节点，所有结果节点须属于同一数据集。
各分支选择相同顺序的相同维度，包含完整身份粒度每个字段的普通维度，身份列保持可见。
分支是原始行计划，不支持计数、度量、分组、局部排序、Top-N、分页。
并集去重完整行，不只是展示标签；不合并不同实体类型，不反转有向关系。
不同结果类别应提交独立 Intent。

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

旧隐式配对需迁移，形状、别名、配置要求和步骤见[完整 GraphPair 契约](../../ontology/docs/GRAPH-PAIR.md)。


index 和 info 暴露知识点和引用。成功 transform 返回 `{"accepted":true,"receipt":"<id>","count":N}`，
宿主在该分组回执下存储每个 Intent 及生成 Query；失败返回带索引结构化诊断供修复。
两种响应都不是数据库结果。本评测无数据执行层：返回回执并用业务语言解释各计划结果，不能编造数值或 SQL。
接入执行层后应展示实际返回数据。

转发适配器为每个顶层 Intent 设置 limit:100，覆盖传入值。它独立于业务 take 和 Top-N 限制最终行数，达到 100 行不证明完整。
