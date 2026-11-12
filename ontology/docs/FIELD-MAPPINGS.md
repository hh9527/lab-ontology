# 原始字段与语义投射

字段保留数据库原始类型和原始编码。字段 property 发布平行的语义维度；映射属于该来源字段，同一个 enum 在不同来源可以有不同 wire 编码。

```telora
type Kind = enum { Olt, Onu, Unknown };

@g::exact("class_raw")
@v::map_or(
    Kind.type,
    "class",
    [
        v::member(Kind::Olt, ["olt", "ne.category.olt"]),
        v::member(Kind::Onu, ["onu"])
    ],
    Kind::Unknown
)
classification: Option(String),
```

封闭映射使用 `map`，没有对应成员的非空编码在结果解码时失败。半封闭映射使用 `map_or`，未识别的非空编码投射为 `Unknown`，原始编码仍可从 raw 获取。NULL 投射为 NULL，独立于 Unknown；映射本身不增加可空性。同一来源字段的不同成员不能声明重叠 wire 集合。

## 筛选与投影

`query_remote!` 中的 `a.class == Kind::Olt` 首先按同一业务类型的相等比较检查。模型再根据该计算字段的映射，将条件下推为 `classification IN ('olt', 'ne.category.olt')`，不需要先计算 CASE。`!=` 使用对应的不相等条件。Unknown 条件匹配非 NULL 且未命中已知成员的编码；NULL 不作为 Unknown。raw 字段只与原始类型的值比较，不能直接与业务 enum 比较。

投影语义维度 `a.class` 时，模型生成 CASE，将所有已知 wire 投射为对应 variant。raw 和语义维度可以同时投影。角色范围在同一原始字段上使用 `@s::scope_equal(Kind::Olt)`，成员类型、字段归属与筛选能力在局部初始化时绑定。同一 property 接收原始类型的值时，表达原始字段相等约束。

## 独立排序能力

分类映射和可投影能力不授予排序能力。语义维度需要独立声明业务顺序，例如 enum 上的 `@ev::order_by_itag` 和各 variant 的 `@ev::itag`。标签、variant 名称及编码用的 itag 本身不隐含排序授权。

没有业务顺序的语义分类在远端和本地排序时均被拒绝。raw 排序依据原始类型处理；作者可以显式选择它，不会改变语义投影字段的类型。

验收入口：`ontology/tests/mapped_scopes.telora`、`ontology/tests/mapped-scopes-runtime.mjs`、`dari/semantic-order-test.ts`。IC 的角色和 OLT 样本聚合验收见 `icloud_model/tests/mapped_pon.telora`。
