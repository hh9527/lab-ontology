# 字段角色与对象引用

由议题 #33 跟踪。这些声明向 Agent 和后续报表规划暴露业务用途，不增加查询操作、不自动生成链接、不解析对象，也不选择默认身份展示方式。

## 声明

```telora
@edsl::reference("local", ["tenant_id", "device_id"])
@edsl::reference("global", ["uuid"])
type Device = struct {
    tenant_id: String,
    device_id: String,
    @edsl::field_role(edsl::FieldRole::Appellation)
    uuid: String,
    @edsl::field_role(edsl::FieldRole::Appellation)
    name: String,
    @edsl::field_role(edsl::FieldRole::Classification)
    category: String,
    @edsl::field_role(edsl::FieldRole::Metric)
    cpu_usage: Float,
};
```

本例只展示语义声明。完整可查询类型还需要常规的源、列和能力注解。

| 角色 | 含义 | 不表示 |
| --- | --- | --- |
| Appellation | 参与身份展示或表达 | 唯一性、默认展示或展示模板 |
| Reference | 参与已声明的唯一地址 | 复合地址中的单个成员已经足够 |
| Classification | 描述业务分类 | 闭合值域或筛选能力 |
| Metric | 描述定量用途 | 单位、聚合规则或可查询度量 |

角色可以重叠：上例 uuid 同时具有 Appellation 和派生的 Reference。不会从属性名猜测角色。
正式 `sample_measure` 声明也派生 Metric；同一字段再显式标记 Metric 不会重复。
数值字段或计数度量不会自动成为 Metric。样本度量元数据定义单位和聚合。

## 唯一引用集合

每个具名引用都是一项可信声明：其完整元组在声明的数据集／类型内唯一确定一个对象。
同一集合的成员共同参与，不同集合是可替代地址。引用以数据集限定；相同元组在另一数据集中是不同地址。

两个租户都使用 device_id D001 时，(T1, D001) 和 (T2, D001) 是不同本地地址，单独 D001 不完整。
全局 uuid 是同一对象的另一地址。显示名称可以重复或变化，而不改变地址。
准备阶段不检查存储值来证明唯一性，本 API 也不实现地址解析。

引用 ID 和集合不得为空，ID 在类型内唯一，成员必须存在且互异。成员可为 `T` 或 `Option(T)`，T 必须是标量或闭合枚举；非标量成员导致准备失败。
仅成员顺序不同的等价集合视为重复。声明顺序被保留，但不代表优先级。
直接使用 field_role(Reference) 会失败，成员身份必须来自完整的类型级引用。

引用不改变主键、粒度、计数身份、连接或查询授权。已有键／粒度声明不会隐式转为引用。
输入地址必须包含全部成员及有效非 NULL 值；执行这一输入契约属于未来地址消费方的职责。

`Option(T)` 在类型系统中直接表示可空性。包含可选成员的引用在全部成员存在时唯一；任一成员缺失则整个地址不可用。NULL 不是地址值。
这种引用不能建立全行身份：主键或数据集粒度成员仍禁止可空字段。
没有键或声明粒度的类型仍支持原始字段查询和关系遍历；对象计数及身份分组需要独立声明的全行身份。
查询准备在按 T 校验操作数时保留可空性，包括 T 与 Option(T) 之间的连接。

## 发现

数据集详情增加 `references: [{id,fields}]` 和 `field_roles: [{field,roles}]`。
字段详情增加 `roles`、`reference_ids`，以及从模型字段 `Option(T)` 派生的 `nullable`。
成员使用模型字段名，不是 SQL 列名或维度 ID。模型字段名不是查询词汇；Agent 仍需获授权的维度或度量来获取其值。

角色不会发布原本不可见的字段。公共发现按现有可见性筛选角色，只有全部成员可见时才发布引用，绝不截断复合引用。
内部准备元数据保留全部声明。有角色／引用时，数据集链接指向共享的 `syntax/model/field_roles` 契约。

## 验收

`tests/field_roles.telora` 覆盖可替代完整引用、重叠角色、公共元数据、私有字段、查询语义不变、Metric 派生和无效声明。
设备模型将现有唯一 ID 发布为引用，name／alias 标为 Appellation，classification／vendor 标为 Classification。
已有正式度量自动派生 Metric，不为名称、IP 地址或序列号新增唯一性声明。
