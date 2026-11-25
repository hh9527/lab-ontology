# Sum type 字段与计算分类

模型按来源值域选择两种声明：封闭值域直接使用具名 enum 类型；非封闭来源保留原始类型，通过行上的 `values::computed` 发布平行的计算分类字段。计算字段不增加物理列，查询可以分别或同时使用原始字段和计算字段。

## 封闭字段

```telora
@ev::order_by_itag
type AlarmSeverity = enum {
    @ev::itag(1) Critical,
    @ev::itag(2) Major,
    @ev::itag(3) Minor,
    @ev::itag(4) Warning
};

@domain::dataset("alarm", "alarms", ["id"])
type Alarm = struct {
    id: String,
    @g::exact("alarm_severity")
    severity: AlarmSeverity
};
```

字段类型保留业务身份，variant property 描述来源编码；`itag` 使用整数来源编码，没有源标签时默认使用 PascalCase variant 名称。字符串来源使用 `rename`，同一 variant 的其他来源编码使用 `alias`。同一类型的来源编码只能使用同一种物理存储类型；不同 variant 的 wire 集合必须互斥。字段可用 `Option(AlarmSeverity)` 表达 SQL NULL。

```telora
type State = enum {
    @ev::rename("active")
    @ev::alias("up")
    Up,
    @ev::rename("inactive")
    Down
};
```

来源值域是封闭契约：未声明的非空编码在结果解码时失败，不能悄悄解释为其他 variant。公开值使用 variant 身份，查询筛选 lower 到来源 wire；多个 wire 对应同一 variant 时使用 IN，投影负责规范化为 variant。存储表示不授予 enum 原始 Int/String 的算术或文本能力。

## 平行计算分类

```telora
type Kind = enum { Olt, Onu, Unknown };

@domain::dataset("device", "devices", ["id"])
@v::computed(
    "kind", "classification_raw", Kind.type,
    [
        v::member(Kind::Olt, ["olt", "ne.category.olt"]),
        v::member(Kind::Onu, ["onu"])
    ],
    Kind::Unknown
)
type Device = struct {
    id: String,
    @g::exact("kind_raw")
    classification_raw: Option(String)
};
```

`kind_raw` 保留来源编码；`kind` 是独立发布的具名分类字段，类型为 Kind，并继承来源可空性。未识别的非空值映射为 Unknown，SQL NULL 仍是 NULL。源字段必须存在且物理类型匹配；计算字段名称不能重复。模型作者声明映射，不手写转换函数。

查询可以使用 `a.kind_raw` 精确保留来源细节，使用 `a.kind` 归一化分类，或同时投影二者。`a.kind == Kind::Olt` 按同一业务类型检查，再下推为来源字段 IN ('olt', 'ne.category.olt')；Unknown 条件匹配非 NULL 且未命中已知成员的来源值。raw 字段只与原始类型比较。

## 共享映射

同一业务类型在多个来源字段使用相同编码时，先定义 `values::mapping(id, Business.type, Wire.type, members)`，再使用 `@values::computed_domain(domain, publish_id, source_field, fallback)` 绑定。映射定义只保存一份 wire 集合；每个来源的发布名、可空性与能力分别准备。来源编码不同的映射保持独立。

## Itag 排序

排序由 enum 类型上的 `@ev::order_by_itag` 授权，每个 variant 必须有一个互异 itag；顺序按整数标签数值确定，作者无需另列语义顺序表。没有该授权的 enum 不能因 variant 名称、来源字符串或编码为整数而自动排序。

来源字符串和整数排序标签可以共存，先声明 itag，再用 rename 指定来源字符串：

```telora
@ev::order_by_itag
type Priority = enum {
    @ev::itag(-3)
    @ev::rename("zzz")
    High,
    @ev::itag(7)
    @ev::rename("aaa")
    Low
};
```

此时 High 排在 Low 前，与来源字符串的字典序无关。codec 默认接受 PascalCase variant 身份，有完整 itag 时也接受整数标签。原始字段按自己的类型排序；计算分类字段只使用其 enum 授权的 itag 排序。选择哪一个字段由查询决定。

验收入口为 `ontology/tests/sum_type_fields.telora` 和 `ontology/tests/sum-type-fields-runtime.mjs`，后者消费前者导出的 `runtime_fixture`。角色范围和物理链路条件同样保留业务 enum 类型，再由模型转换为来源编码。
