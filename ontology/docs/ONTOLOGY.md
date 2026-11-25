# 本体模型与查询转换

模型作者通过 `ontology::semantic` 的 Property 声明业务身份、数据集、字段及关系。`ontology::publication::stage` 从同一份准备结果发布查询契约、知识、类型和 codec。统一模型边界见[模型发布契约](../MODEL-PUBLICATION.md)，知识结构见[知识契约](KNOWLEDGE.md)。

## 类型与物理映射

字段类型表达业务语义，`Option(T)` 表达可空性。逻辑字段默认使用同名物理列，异名使用 `@model::column("physicalName")`。标量、newtype、封闭 enum 与 Reference 的存储表示由类型准备过程确定。

```telora
use ontology::semantic as s;
use ontology::model as m;
use ontology::groups as g;

@s::entity_by("Item")
type ItemById = struct(String);

@s::subject("Item", "id")
@s::dataset("items", "items", ["id"])
type Item = struct {
    @g::exact("item_id")
    id: ItemById,
    @m::column("displayName")
    @g::search("item_name")
    name: String,
    parent: Option(s::Reference(ItemById))
};
```

`entity_by` 表达完整身份；单独指代使用 newtype，联合指代使用具名 struct。Reference 保留目标身份，阻止其来源 String／Int 的普通算术和文本操作。外置 Relation 决定可连接的端点；Reference 本身不自动产生 JOIN。

字段知识中的 `type` 是逻辑值类型，`storage_type` 是物理标量类型，`nullable` 单独表达可空性。联合字段映射到多个物理列时，各物理分量保留自己的存储信息；完整身份由 Role 的 parts 表达。知识发现与查询目录共同保留名义类型，物理存储相同不意味着可互换。

## 字段角色与查询授权

称谓、指代、分类、指标描述字段的业务用途。称谓通过 `@edsl::field_role(edsl::FieldRole::Appellation)` 显式声明；完整身份和 Reference 的 Role 映射派生指代，enum 值域绑定派生分类，上报样本声明派生指标。角色可以重叠，详细规则见[字段角色](FIELD-ROLES.md)。

角色不授予查询能力。查询操作在字段上分别声明：

- `@g::search(id)`：文本搜索与投影
- `@g::exact(id)`：等值筛选与投影，保留名义类型
- `@g::numeric(id)`：数值比较与投影
- `@g::epoch_millis(id)`：EpochMillis 比较与投影
- `@g::view(id, projectable, filters)`：从字段推导逻辑类型、可空性，显式指定直接视图能力

共享视图模板用 `g::dimension_group` 定义上限，`g::field_view` 绑定到具体字段；绑定可以收紧投影和筛选能力。自定义表达式在已发布维度之上组合，不能扩大类型或模板授权。模型自检拒绝重复名称、非法列映射及能力冲突。

字段上的 `@groups::null_if_view(id, Int.type, -1)` 可以发布将来源缺失标记转换为 NULL 的可空数值视图；原始字段另行发布，保留编码筛选。该 property 也支持 String，标记类型必须与字段一致，值通过参数绑定进入 SQL。

## 封闭值域与平行分类

来源值域封闭时，字段直接使用具名 enum；来源编码由 variant 的 `rename`、`alias`、`itag` Property 声明。非封闭来源保留原始字段，通过 `values::computed` 发布平行计算分类；未知非空来源映射为显式 Unknown，SQL NULL 保持 NULL。

可复用的映射用 `values::mapping` 定义一次，使用 `@values::computed_domain(domain, id, source, fallback)` 分别绑定来源字段与发布名。各字段的物理来源、可空性及查询权限仍独立。排序由 enum 的 `order_by_itag` 及互异整数标签授权。筛选、投影、分组、codec 与排序共用映射事实，见[字段映射](FIELD-MAPPINGS.md)。

## 记录粒度与实体身份

`dataset(id, table, grain)` 声明一条记录的完整粒度。`@semantic::bind(Identity.type, field)` 声明这条记录描述的业务身份；存在绑定时，知识主体从该身份及字段派生。额外业务主体使用 `@semantic::subject(entity, field)`，这项知识归属不证明记录唯一性。

例如采样记录的 grain 可以是 `["res_id", "tenant_id", "ts"]`，而业务身份只绑定 `res_id`。多个采样时刻可以描述同一对象。没有唯一性依据的来源可以没有 grain；对象计数和记录级身份操作仍要求相应证明。

`group_by_identity` 使用已绑定的业务身份，没有绑定时使用完整记录 grain。它可以形成带聚合指标的身份组，也可以只投影身份及其决定的属性，得到对象集合；不同身份的同名标签分别保留。

当身份比记录 grain 更粗时，身份属性通过 `@semantic::attribute(...)` 声明。单次采样值、时间戳等不自动成为身份属性。记录计数、采样排序和关系保持记录粒度的证明使用 grain，不用业务身份替代。

已从关联目标节点取得类型化身份时，后续查询可直接复用该身份参数。源节点的引用属于源节点属性；相同存储编码不意味着其分组权限与目标身份相同。特别是可选关联未匹配时，多个不同源引用可能落到同一个空目标。

## 分组能力

`@groups::groupable([dimension_id, ...])` 独立授权按分类值分组，成员必须已声明且可投影。名称、编码、数值或 enum 的投影许可本身不授予分组。时间桶 Property 同时授权桶键分组，原始时刻不自动获得此能力。

身份组可以投影由该身份决定的属性。依赖可沿单值 Relation 传递：遍历方向至多返回一行，并且来源连接键和 guard 均由当前身份决定时，对端属性也可投影；多值关系或随采样变化的键不传递这种依赖。可选关系保留对端可空性。

## 外置关系与联合定位

`semantic::endpoint(Row.type, role)` 引用身份或 Reference 端点。`relations::relation(id, from, to, {from, to})` 声明连接键与两侧基数；字段及完整身份必须匹配。正向读取 to，反向读取 from；One 与 Optional 至多匹配一行，Many0 与 Many1 可能扩增行数。

Optional 关联保留根行，并使对端字段可空；原始字段是否可空与关系是否可选分别表达。基数是模型的业务契约，准备阶段检查结构，不通过运行时采样重定义它。

`@semantic::role(name, Identity.type, {part: "field"})` 将同一行已有字段组合为完整身份，所有分量必须覆盖、存储相容且互不重复。它提供定位方式，不声称这些分量唯一确定数据集的行。嵌套存储结构使用字段级 `semantic::columns`。

`semantic::role_endpoint(endpoint, classification_id, Enum::Member)` 限定端点的业务分类。分类需授权等值筛选且成员有有限来源 wire；多 wire 取析取，多个端点条件及附加 guard 取合取。限定端点不改变 Dataset、身份类型或记录粒度。

同一关联只发布一条可遍历 Relation；正反向使用同一条边。`@relations::sources(relation_id, [source_name, ...])` 记录来源名称，不创建查询别名或额外路径。角色、guard、连接键或基数不同的关系分别保留。来源追溯不增加合法查询空间。

## 数量与统计契约

`ontology::quantity` 提供单位、显示尺度及计算能力。业务 newtype 继承这些约束而保留独立身份；具体字段统计只能在类型能力内选择聚合。允许 Sum 的类型由 `calculations` 授权，不依赖某几个内置类型的名称白名单。原始数值类型遵循其数值能力，业务 newtype 可以显式收紧。

Percent 与 Ratio 分别保留百分数和归一比例的存储尺度，显示规则与计算解耦。整数数量通过 `mean_result` 指定浮点业务均值类型，极值保持原类型。单位由类型继承；字段单位与统计模板中的显式单位必须一致，不能通过重复声明偷偷换算。共享类型见[量纲类型](QUANTITIES.md)。

`@samples::field(group, names)` 声明上报值的聚合模板及发布名。模板的单位默认从类型继承。`@samples::valid_count(field)` 关联 EffectiveCount 字段，提供采集覆盖信息，不隐式改变 AVG 权重。

均值的总体为非空上报值，每个上报值等权；合并均值须重新查询完整来源，或组合各组 sum 与 non-null count。记录计数、非空观测计数、有效采集次数分别表达，不相互替代。空集 Sum／Avg／Min／Max 保留 NULL 语义；空身份集合保持空集合。

## 发布、校验与执行

模型根在封闭构建期准备一次。`publication::stage` 同时产出静态知识、公共符号、codec 和 transform 闭包，统一模型服务通过 `ontology/model` 接收 `{method, input}`。contract 返回类型与符号，transform 校验完整类型化意图并返回参数化计划、结果类型、上界及消费凭据。运行期绑定参数，不重新规划，也不执行数据库查询。

模型决定可解空间及 SQL 方言语义，执行适配器负责数据库连接。SQLite、PostgreSQL 的 QueryAst 渲染与后端能力见[查询文档](QUERY.md)和[方言契约](DIALECT-CONTRACT.md)。独立的 Graph Intent 库协议见[使用说明](../../USAGE.md)，不作为统一模型服务的请求形状。

查询成功证明方案符合模型声明，不证明自然语言意图已经理解正确。时间、样本、分类、关联和结果上界都在相应检查边界验证。模型作者不通过显示标签、知识描述或运行结果增加未声明的查询能力。
