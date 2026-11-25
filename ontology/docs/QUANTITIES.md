# 量纲类型

`ontology::quantity` 提供跨领域可复用的具名量类型。物理表示、单位、计算能力和展现规则分别表达，单位倍率只描述尺度，不自动换算数据。

| 类型 | 存储表示 | 单位 |
| --- | --- | --- |
| Percent / Ratio | Float | 百分数 / 归一比例 |
| Dbm | Float | dBm |
| DegreesCelsius | Float | °C |
| Bytes / IntegerBytes | Float / Int | byte |
| Megabytes / IntegerMegabytes | Float / Int | MB，十进制百万字节 |
| Watts / IntegerWatts | Float / Int | W |
| BitsPerSecond | Float | bit/s |
| KilobitsPerSecond / IntegerKilobitsPerSecond | Float / Int | kbit/s |
| MegabitsPerSecond / IntegerMegabitsPerSecond | Float / Int | Mbit/s |
| PacketsPerSecond | Float | packets/s |
| Seconds / Milliseconds | Float | s / ms |
| BytesPerSecond | Float | byte/s |

`TextDegreesCelsius`、`TextMegabytes`、`TextDays`、`TextMegabitsPerSecond`、`TextGigabitsPerSecond` 保留字符串存储。它们提供明确的名义类型和单位信息，数字解析及数值运算需要显式模型能力。

## 业务类型与计算

业务模型可以继续用 newtype 表达指标身份：

```telora
type LinkDelay = struct(quantity::Milliseconds);
type LinkJitter = struct(quantity::Milliseconds);
```

两者继承毫秒单位，但保留不同的业务类型。`quantity::unit_of` 沿 newtype 与 Option 读取单位。字段默认继承单位；`field_unit` 可以补充来源尺度，其量纲和尺度须与已有名义类型一致。采样模板单位也默认继承类型，显式单位须一致；换单位需要显式转换。

`calculations` 声明允许的计算，字段统计再决定实际提供哪些聚合。采样与数值 Group 共同读取该 property；允许 Sum 的业务 newtype 与其基类型遵循同一能力规则，不用类型名称白名单额外收窄。dBm、摄氏度允许比较、均值、极值、舍入和差值，不继承 Float 的任意代数。线性数量允许同量相加、求和与差值，不把两个同量相乘的结果冒充原量纲。Percent、Ratio 保留自身的比例计算规则。

整数数量的均值可能有小数。公共类型声明相应的浮点结果类型，`mean_result_type` 读取该映射；例如 IntegerBytes 的均值返回 Bytes，IntegerKilobitsPerSecond 的均值返回 KilobitsPerSecond。原始字段和极值仍保留整数表示。

模型发布业务类型、单位和运算能力。具体来源字段可以使用独立 newtype 隔离其编码，研发核对依据维护在领域仓库的来源记录中。

`ReportedCount` 保留整数上报计数，允许比较、均值、极值与舍入，不授予累计差分、求和或速率。它的均值类型是 `MeanReportedCount`（Float）；业务包装可以通过 `mean_result` 指定对应的业务均值类型。`EffectiveCount` 表达有效采集次数，允许比较、求和及同类加减，不自动充当指标均值权重。

`mean_result` 声明同时进入模型公开类型目录与 codec 模块的 `meanResults` 映射。DARI 的本地 `avg` 与远端查询共同消费该结果类型，整数来源的均值可以保留小数及业务身份；`min/max` 仍返回原类型。均值结果必须使用 Float 存储，缺失值由聚合器的 Option 处理。

带宽速率的 bit/s、kbit/s、Mbit/s 类型共享线性计算能力，单位尺度不改变算子许可。统计声明进一步限定数据集实际提供的聚合；允许同量相加不代表可以把连续时间采样直接相加。
