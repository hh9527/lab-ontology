# RFC 0007：Enum 编码与字段映射

- 状态：IC 实验链路验证通过
- 分支：`experiment/dari-telora-expression`
- 范围：IC 全量模型、共享映射内核、DARIT 类型与 JS 制品；不部署

## 值与表达

Enum 是封闭业务值集合。默认字符串 codec 使用 PascalCase variant 名称；声明 itag 后同时支持整数 codec。order_by_itag 声明业务排序，不取决于源字段的物理类型。

源编码属于字段映射。多个原始编码可以映射到同一业务值，映射不是 Enum 的 codec，也没有唯一的逆变换。

## 原始字段与计算字段

每个分类字段发布两个独立维度：原 ID 为计算字段，`原ID_raw` 为原始字段。原始字段保留数据库类型；计算字段由具名映射产生，可独立筛选、投影、分组和排序。同一源字段可以声明多组映射。

严格映射返回 Enum，无法映射时执行失败。半封闭映射通过字段 property 指定兜底 variant，例如无载荷的 `Unknown`；源字段有值但未命中时返回 `Unknown`。只有可空源字段产生 `Option(Enum)`，源字段为空时返回 `None`。因此缺失值与未识别值保持区别，原始字段保留全部事实。Enum 不携带 Unknown 载荷，不发布 Known/Unknown 附加列。

## 建模

```telora
type DeviceClass = enum { Wac, Lsw, Unknown };

@domain::dataset("device", "Device", ["id"])
type Device = struct {
    id: String,
    @g::exact("device_class_raw")
    @v::map_or(
        DeviceClass.type,
        "device_class",
        [v::member(DeviceClass::Wac, ["ne.category.ac", "AC", "WAC"]),
         v::member(DeviceClass::Lsw, ["ne.category.switch", "LSW"])],
        DeviceClass::Unknown
    )
    category: String,
};
```

模型通过类型和 property 声明业务含义、源字段及映射。`v::map` 声明严格映射，`v::map_or` 声明兜底 variant；原始字段是否可空由字段自身的 `Option(T)` 表达。注册、局部校验、SQL lowering 和 JS 映射生成由 ontology 的通用实现承担。模型不手写转换、初始化或注册函数。

映射兜底不是 Enum codec 的行为。`DeviceClass` 的字符串 codec 只接受 `Wac`、`Lsw`、`Unknown`；`LSW` 等源编码只由字段映射解释。`None`、`Unknown` 和任一正常 variant 都可明确区分。

整数 itag 不自动成为外部编码映射。即使源字段也是整数，两者仍分别声明。描述、itag 与排序属于 Enum，源编码列表属于映射。

## 制品与验收

IC 全部 Dataset 发布静态成员、可空性、Enum codec 和字段映射 JS。check_type 共享 Graph 语义与 SQL lowering；resolve 本地绑定执行。验收覆盖全量构建、类型契约与可执行映射遍历、严格/半封闭行为、多源编码合并、原始与业务排序、真实 SQLite 查询。旧服务保持原部署产物。

实验验证覆盖 50 个 Dataset、96 组字段映射及 605 个源编码。生成的 JS 模块独立发布 `codecs` 与 `mappings`；严格映射的非法结果由 DARIT 执行期 codec 拒绝。查询 ABI 当前支持单节点、成员投影、指标阈值、排序与上界，完整 Graph 关系语法不属于本轮验收范围。
