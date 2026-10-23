# 半开放值域

半开放值域包含已声明的已知业务概念，以及保留原字符串的未识别分支。
每个已知概念可有多个显式声明的物理编码。这相当于包含已知变体与 `Unknown(String)` 的枚举；名为 Other 的业务概念仍是已知变体。

```telora
@edsl::value_type("DeviceClass", String.type, [
    {id: "LoadBalancer", label: "Load balancer", wires: [
        edsl::FilterInput::Text("lb"),
        edsl::FilterInput::Text("ne.category.lb")
    ]},
    {id: "Other", label: "Other device", wires: [edsl::FilterInput::Text("other")]}
])
@edsl::half_open()
type DeviceClass = struct {};

@edsl::dimension("device_class", True, True,
    [edsl::FilterOp::Eq, edsl::FilterOp::Ne], [edsl::FilterInputKind::Text])
@edsl::dimension_type(DeviceClass.type)
classification: String,
```

声明要求具名值类型采用 String 存储且成员非空。已知 ID 互异，物理编码集合互不重叠。
编码精确且区分大小写，不隐式规范化前缀、拼写或标签。未声明编码即使等于已知业务 ID，仍是 Unknown。
空存储字符串也属于 Unknown，除非模型改变存储契约；NULL 表示缺失，不是未知字符串。

是否半开放由模型决定；准备和查询生成不会抽样存储数据来推断。

## 输入

Agent 通过发现将自然语言解析为已列出的业务 ID。已知输入仍用普通 JSON 字符串。
未知输入必须显式带标签；未列出的无标签字符串直接失败，不做猜测。

| Intent `value` | 含义 |
| --- | --- |
| `"LoadBalancer"` | 已知概念，匹配 `lb` 或 `ne.category.lb` |
| `{"unknown":"future-device"}` | 一个精确的未识别物理编码 |
| `{"unknowns":true}` | 所有已知概念之外的非 NULL 编码 |

支持 Eq 和 Ne。Ne 是非 NULL 值域上的补集，包含已知和未知分支。
因此 Ne LoadBalancer 包含未知值；Ne Unknowns 选择所有已知编码。
带标签 Unknown 若指定已知物理编码会被拒绝；Unknown 对象必须恰好包含一个标签。

`any_of` 接受相同输入，可混合已知与未知值。带类型模型谓词使用 `FilterInput::Unknown(raw)` 和 `FilterInput::Unknowns`。
全部物理值均使用绑定参数。

## 结果

SQL 结果列为标量，因此半开放选择产生两列：

| `<node>_<dimension>` | `<node>_<dimension>__kind` | 解释 |
| --- | --- | --- |
| `LoadBalancer` | `Known` | 规范化的已知业务 ID |
| `LoadBalancer` | `Unknown` | 恰好具有该拼写的未识别原始编码 |
| `future-device` | `Unknown` | 另一个未识别原始编码 |
| NULL | NULL | 缺失值 |

两列共同参与分组和行 DISTINCT。已知别名折叠为一个概念，未知值按原始编码分组。
选择半开放值域不会增加闭合域保护条件，未知和缺失行都保留；消费方必须保留 kind 列才能正确解释值。
GraphPair 将所选各侧的 kind 列保留为展示载荷。对齐使用 NULL 安全相等比较显式对齐的完整身份；展示值及 kind 不成为身份键。

`count_value` 统计不同已知 ID 数加不同未知原始字符串数，NULL 不计入任一部分。
两个计数是内部聚合依赖，公共结果仍只有一列；这要求查询配置允许 Add。
半开放投影／筛选除已有规范化能力外，还要求 Not、IsNotNull、And、Or。

闭合 `canonical_order` 无法排列任意未知字符串。准备阶段拒绝其与 `half_open` 组合；在显式建模未知值排序策略前，不能对该维度做业务排序或 Top-N。
按其他已投影维度排序仍然可用。

维度发现文档暴露 `half_open`、已知 `values` 和 `value_contract`；共享筛选语法说明带标签输入。
闭合规范值域维持现有行为。
