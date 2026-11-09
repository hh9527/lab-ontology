# RFC 0006：指代类型、字段语义与外置关系

- 状态：IC 实际定义已迁移，正在本地验收；未部署，NS 未迁移
- 跟踪：[#73](https://github.com/hh9527/lab-ontology/issues/73)
- 分支：`rfc/type-and-field-semantics`

## 两层目标

1. 表达业务允许的解空间，对计算进行刚性校验，并 lowering 为数据库操作。
2. 从同一份声明派生可发现的知识，帮助 Agent 构造合法计算。

发现不授予计算许可。通过校验表示计算符合模型声明，不证明源数据正确，也不保证解答符合用户意图。数据库既有设计是输入现状，不是本实验要重新设计的对象。

## 概念层知识速查

查询和 transform 继续使用 Dataset 地址。知识速查允许以 `{ entity: [], props: [], values: [] }` 同时起手，不要求调用方先知道 Dataset 或 query ID。

- entity：模糊匹配业务实体的名称、别名和解释，确定概念范围。
- props：在该范围内模糊匹配属性，统一包含 dimension、measure 和 counter，返回各属性的承载 Dataset、字段及可用查询地址。
- values（可选；省略或空数组时不做值匹配）：模糊匹配具名枚举值及其别名，定位所属 Type，再以该 Type 作为属性匹配条件。返回实际值及原查询需要的值编码；不能只匹配属性标题。

每组数组内保留各词命中的候选及依据；entity 限定概念范围，props 和 values 提供两类属性线索。values 命中的类型约束由值反查的属性，不把同一请求中独立命中的度量也要求为该枚举类型。例如“设备、CPU、紧急”需要分别保留 CPU 度量和紧急值对应的告警分类属性，不因类型不同删除 CPU。

发现返回候选和匹配依据，不隐式选择唯一 Dataset、不修改查询许可。多个映射或多种实体角色必须保留区别，不能把 Dataset 中任意 Reference 的目标都当作所有度量的主体。计数需区分记录数、非空值数和去重实体数。

Dataset 显式声明业务主体，字段本身的维度、度量和计数声明继续是查询能力的事实来源：

```telora
@domain::subject("Device", "res_id")
@domain::dataset("device_kpi", "NetworkDeviceKPI", ["res_id", "tenant_id", "ts"])
@domain::metric("ts")
type NetworkDeviceKPI = struct { ... };
```

subject 仅建立知识归属，不授予 JOIN，不声明字段全局唯一，也不把样本记录数解释为去重实体数。具名指代或 Reference(By) 的实体必须与主体一致。多态来源允许多个显式 subject。SSID 样本的 Device 外键不会自动将 SSID 度量归属于 Device。

发布数据在 Dataset 内包含 subjects 和 props；每项属性保留来源字段、dimension/measure/counter 查询地址及逻辑类型。具名值通过 Type 匹配反查属性。没有唯一键的来源也可声明知识主体，原有 grain 与查询权限不改变。

IC 的 50 个 Dataset 已发布该元数据；插件分支 feat/concept-knowledge-discovery 增加 oks_discover({entity, props, values?})，复用现有模糊匹配，同时保留 oks_search 定域检索。省略 values 和空数组等价。返回精确属性／查询地址、逻辑类型、值命中及无命中项，每词最多 10 项并显式提示截断。该入口与自动选择映射并生成查询是两项不同能力。

## 实体与指代方式分离

Entity 是业务概念，指代类型是能够唯一指代该概念中一个对象的完整信息。

单一指代用 newtype，联合指代用具名 struct：

```telora
@s::entity_by("Tenant")
type TenantById = struct(String);

@s::entity_by("Device")
type DeviceById = struct(String);

@s::entity_by("Device")
type DeviceByTenantAndCode = struct {
    tenant: s::Reference(TenantById),
    code: String,
};
```

`entity_by` 标注指代类型，不标注数据库表，也不要求实例化一个含全部业务属性的实体对象。结构的所有成员共同构成指代，因此不再额外指定哪个成员是 id。

`Reference(DeviceById)` 已经表达“引用 Device，采用 DeviceById 这种指代方式”。它不继承底层 String 的原生算子，不自动导航，也不自动选择目标表。

同一个实体可以有多种指代。`DeviceById` 与 `DeviceByTenantAndCode` 不可自动互换；即使两个单一指代底层都是 String，也不代表可以互换。后续如需转换，应通过明确映射表达。

当前身份叶子支持 Int/String 及其标量 newtype；联合成员也可为另一指代的 Reference，以成员路径标识展开后的叶子。指代不能为空，内部成员不可为 Option。`Option(Reference(T))` 则表示整条引用可缺失，不能解释为联合身份的一部分可缺失。

已有 `FieldRole::Reference` 表示唯一指代集合的成员，不等同于这里的语义引用类型。

## 从表结构逐步增强

先描述已有表结构，再逐字段增加语义，不要求一次完成整个概念模型。

| 阶段 | 字段示例 | 获得的能力 |
| --- | --- | --- |
| 物理结构 | `cpu: Option(Float)` | 可空性与物理投影 |
| 类型增强 | `cpu: Option(Percent)` | 单位与名义类型约束；尚不许可聚合 |
| 身份增强 | `id: DeviceById` | 表达这行以哪种方式指代 Device |
| 引用增强 | `tenant: Option(Reference(TenantById))` | 确定被引用实体及指代方式；尚无 JOIN |
| 场景增强 | `@s::observation("cpu_usage", "ts", [Mean])` | 在类型许可范围内授予该位置的统计能力 |
| 外置关系 | `s::relation("tenant", devices, "tenant", tenants)` | 选择具体目标映射，校验后授予 JOIN |

类型级 property 表达跨场景稳定的约束；字段 property 决定具体使用位置的能力，不能突破类型约束。原生表示能力不等于业务运算许可。

## 单列映射与外置 Relation

最小实验使用以下写法；完整可编译示例见 `ontology/tests/semantic_model.telora`。

```telora
@s::table("I_EntNetworkElement")
@s::bind(DeviceById.type, "id")
@s::grain(["id"])
type Devices = struct {
    id: DeviceById,
    @m::column("tenantId")
    tenant: Option(s::Reference(TenantById)),
};

@s::table("X_TENANT_VIEW")
@s::bind(TenantById.type, "id")
@s::grain(["id"])
type Tenants = struct {
    @m::column("TENANT_ID")
    id: TenantById,
    @m::column("TENANT_NAME")
    @s::attribute("name")
    name: String,
};

def devices: s::Prepared = s::prepare(Devices.type);
def tenants: s::Prepared = s::prepare(Tenants.type);
def belongs_to: s::Relation = s::relation("tenant", devices, "tenant", tenants);
```

Binding 声明该映射以哪个非空字段表达其实体指代；grain 独立声明行粒度，同一实体可以在采样表中出现多行。

Relation 不重复指定业务目标及指代方式，因为 Reference 已有这些信息。它选择目标表映射，检查目标绑定与引用使用的是同一个指代类型，并要求目标粒度恰好为该身份，避免 JOIN 放大源行。

目标唯一性来自模型的可信粒度声明，不扫描数据验证。关系的 Optional 表达目标允许缺失；常规 Graph 沿这一方向读取属性使用 LEFT JOIN，不因关联属性缺失而删除源实体。

`discover_relation` 发布业务实体、目标指代类型及列映射；适配层消费同一份已准备关系，交给现有查询链路生成 SQL。没有 Relation 时不自动授予 JOIN。

## 联合指代的物理展开

逻辑字段可以对应多个物理列，必须显式列出映射，不能猜列名：

```telora
@s::table("scoped_devices")
@s::bind(DeviceByTenantAndCode.type, "key")
@s::grain(["key"])
type ScopedDevices = struct {
    @s::columns({tenant: "tenantId", code: "deviceCode"})
    key: DeviceByTenantAndCode,
    @s::attribute("name")
    name: String,
};
```

映射以逻辑成员路径为键，避免依赖反射字段顺序。嵌套联合 Reference 使用 `parent.child` 形式的路径；引用单一 newtype 指代时，使用该引用成员名即可。源引用也声明自己的列映射。两端的同一个指代类型确保语义相容，Relation 生成每个对应分量的相等条件，并用 AND 连接。列数不完整或路径不存在直接报错。

单列继续使用已有 `m::column`；同一字段不能同时声明 column 与 columns。当前联合引用的可空性只表达整条引用，不建模物理列部分为 NULL 的状态；数据库若存在这种状态，需要另外声明解码策略，不能当作有效联合身份。

## 类型能力与字段能力

CPU 样本与 CPU 阈值可以使用同一个 Percent，但不是同一种计算场景：

```telora
@q::unit("%", "ratio", 0.01)
@s::numeric([s::Statistic::Mean])
type Percent = struct(Float);

@s::table("NetworkDeviceKPI")
@s::bind(DeviceById.type, "id")
@s::grain(["id", "ts"])
type DeviceKpi = struct {
    @m::column("resId")
    id: DeviceById,
    ts: DateTimeUtc,
    @m::column("cpuUsage")
    @s::observation("cpu_usage", "ts", [s::Statistic::Mean])
    cpu: Option(Percent),
    @s::attribute("cpu_limit")
    threshold: Percent,
};
```

类型允许 Mean，不代表所有 Percent 字段均可求平均。样本声明授予 Mean；阈值只有属性声明，不授予聚合。请求 Sum 超过该类型许可，应拒绝。

模型仍保留 Percent 的名义身份和单位。现有结果列协议表达物理结果形状，因此 Mean 输出 Float，并不额外传输 Percent 的名义类型或单位。SQL 聚合在空输入上可为 NULL，所以结果即使来自非空字段，也保留可空性。指代类型与 Reference 均不会因物理表示是 Int 自动获得聚合能力。

## 复用现有查询表达式

不增加另一套查询接口。适配层位于 `ontology/src/semantic_lowering.telora`：

```text
指代、字段和外置关系声明
    → Prepared / Relation
    → 现有 PreparedPayload
    → 现有 Graph 表达式及语义校验
    → 现有 SQL AST
    → SQLite / PostgreSQL renderer
```

适配层用 `mapping("device", Devices.type)` 为具体表映射指定查询地址。一个业务实体可以有多个映射；此时沿用 Graph 的 `entity` 字段填写映射地址，而不是自动选择概念实体对应的表。

为避免不同映射上的同名属性冲突，维度地址为 `<mapping>__<property>`，度量地址为 `<mapping>__<property>_<statistic>`。例如设备和租户均可声明属性 `name`，分别产生 `device__name` 与 `tenant__name`；CPU 均值为 `sample__cpu_mean`。这些地址由 PreparedPayload 发布，不要求作者手动为每个业务属性加前缀。

只有原始表结构时，单列字段也可以通过 `<mapping>__<field>` 投影，保留物理类型与可空性。这不自动产生概念属性、聚合许可或关系。联合值暂不直接投影，但可以参与已声明关系的 JOIN。

查询仍使用原来的写法：

```json
{
  "op": "Graph",
  "root": "d",
  "nodes": [{"id": "d", "entity": "device"}],
  "edges": [],
  "select": [{"node": "d", "dimension": "device__name"}],
  "limit": 500
}
```

没有注册的度量或关系由现有查询校验器拒绝。原实验的 `lower_column/lower_statistic/lower_reference` 已删除，避免形成平行的查询 API。

Graph 常规关系连接按照 Relation 在当前遍历方向上的基数决定：Optional 使用 LEFT JOIN，One 使用 INNER JOIN。如果上游节点已可缺失，后续至多一个目标的连接继续使用 LEFT JOIN，传播这一可空性，避免间接删除根实体。反向遍历读取 Relation 的另一端基数。

这不是 empty：源实体存在，只是关联属性为 None。`include_empty` 保留原来处理计数/度量空集合的用途，不用于决定单值关联属性是否可缺失；一对多关系也保持现有粒度规则。

查询若要求关联存在，使用已有 EXISTS；显式目标属性筛选仍在 WHERE 中筛选源行，不自动移入 ON。LEFT JOIN 输出列推导为可空，即使目标表字段本身非空。关联条件与来源作用域仍放在现有连接或来源准备位置，不增加新查询参数。

查询 limit、结果列协议和宿主的 500 行硬限制均保持原有职责。本实验的运行样例显式传入 `limit: 500`，没有新增执行入口或绕过宿主限制。

## 实验实现与边界

模型实验证明位于 `ontology/src/semantic_model.telora`，现有查询适配位于 `ontology/src/semantic_lowering.telora`。身份准备与表映射准备分别通过 TypeMemorizer 共享结果。准备过程中完成局部声明检查，发现与 lowering 消费同一份结果。

已覆盖：

- 原始表结构、单位类型与字段场景能力的渐进组合。
- 单一和联合指代准备、引用目标的实体及指代类型传播。
- 单列与多列关系校验、关系发现、现有 Graph 的目标标量属性投影。
- Mean/Sum 授权；现有 Graph 解析器、返回列推导及 SQLite/PostgreSQL renderer 的接入。
- 原始表结构的投影，不自动授予业务聚合或连接。

定向验证包括原始与语义化模型、越权查询拒绝，以及执行真实生成 SQL 的 SQLite 小型数据集。SQLite 验证投影、忽略 NULL 的均值、单列/联合 LEFT JOIN、可空连接链、显式 EXISTS、目标筛选及空输入聚合；相同 code 位于不同租户的数据用于确认联合身份的所有分量均参与连接。NULL 引用及非 NULL 但无目标的数据均保留源行。另有 One 基数及反向遍历的结构断言。PostgreSQL 仅验证 SQL 生成，未执行真实数据库。

原 transform 的后续单元验收见 [能力核对](0006-transform-acceptance.md)。按维度/身份分组、排序、TopN、HAVING、计数、GraphUnion、GraphPair、字段过滤、时间窗口、Min/Max、采样顺序及同实体映射对齐已有定向测试。这不表示原查询语言缺少这些能力，也不能把共用 renderer 当成能力完整保留的证据。

尚无多映射自动选择或身份转换。多态引用使用 Reference(String/Int) 加显式 targets 解释及外置 Relation，不从存储类型猜测目标。联合身份可用于 JOIN，尚无通用多列值投影及运行时解码接口。字段过滤来自显式 property，不根据物理类型自动开放。

IC 实际定义已迁移，并完成本地契约、SQL 对照和 staged 构建；NS 尚未迁移。当前不修改查询协议、不部署，概念速查及插件衔接尚未完成。Relation 驱动连接种类的改动位于共享 Graph lowering，构建后也适用于既有模型的 Optional 关系；其结果可能多出此前被隐式筛掉的源实体。后续先讨论哪些能力应属于类型、字段和关系，再扩大支持范围。
