# 不暴露 XxxMut 的自动优化：IC/NS 对照

在同一编译器上比较原始 ontology、自动优化原始源码、手写封闭参考。
`baseline` 与 `automatic` 的全部 ontology/src/*.telora（递归）已逐字节核对一致。
自动版没有注入 oracle，不改应用写法；只有编译器开关不同。
开启 experimental-mut-oracle feature 仅为同轮构建手写 sealed 参考；
自动优化已另用不含该 feature 的编译器构建、通过应用数据对照。

## 结果

单样本，秒为墙钟初筛；fuel 和累计分配另列，不能将累计分配当作 RSS 峰值。
全部完整 build information JSON 相同，包含数组顺序。

| 模型 | 原准备 | 自动准备 | 手写参考准备 | 原总构建 → 自动 | fuel 十亿：原 → 自动 | 分配 MB：原 → 自动 |
| --- | --- | --- | --- | --- | --- | --- |
| IC | 11.64 | 10.13 | 9.07 | 24.48 → 22.97 | 25.46 → 22.25 | 50.92 → 43.31 |
| NS | 36.75 | 31.01 | 28.77 | 56.69 → 50.80 | 85.37 → 71.81 | 143.31 → 118.45 |

自动版准备耗时减少约 IC 13%、NS 16%；相比手写参考仍慢约 IC 12%、NS 8%。
按“省掉的准备时间”衡量，取得本轮手写降幅约 59% / 72%，没有完全追平。
各格单样本，差值/比值不作为稳定性能承诺。

## 已实现的分析与实现

1. 固定键临时 pair 数组的跨函数单消费分析与消除。按结构识别封闭包装函数，
   不识别 ontology/IC/NS 的业务函数名称。证明键唯一且静态、参数只流向 dict::from_pairs、
   临时数组不逃逸后直接生成 K/V 列。两模型均命中 37 个静态构造位置。
2. 既有私有 pipeline ArrayMut/MapMut 复用内部头；初始输入复制、finish seal、发布不可变值。
   String collector 的 chunk 缓冲也复用 ArrayMut 实现。这依赖私有 builder 合约，
   不能算作任意用户容器的 alias 证明。

所有优化默认关闭，通过 TELORA_EXPERIMENTAL_LITERAL_PAIRS 和
TELORA_EXPERIMENTAL_PRIVATE_BUILDERS 开启；无需公开可变类型、sink 或写操作符。
TELORA_EXPERIMENTAL_LITERAL_PAIRS_REPORT 输出证明和命中位置，原始记录包含在 JSON 报告。

固定对象构造单项初筛见 /tmp/mut-ceiling-auto-literal：IC 11.28→10.13 s、NS 36.02→31.60 s。
该轮为另一个编译器构建，不把两个轮次差值解释为稳定头复用的独立贡献。

## 尚未自动化的部分

手写参考改用了 TypeId 专用去重与闭包发现。现有代码的 key 是 Fn(Type)->String，
不能一般性地证明它是单射、无失败，也不能随意跳过回调。不会根据函数名或 Type 输入
就将字符串去重替换成 TypeId bitset。这是算法选择边界，不能伪装成 alias 优化。
普通 TypeMemorizer 已按 TypeId 索引，自动版继续复用，不暴露缓存命中。

本轮尚未实现通用的 fold/尾递归所有权 region lowering；不要将上述结果表述为完整 alias 分析。
可达的结论是：不暴露 XxxMut，已有可证明的编译优化能取得相当部分收益，运行耗时接近手写参考。

## 验证与复现

默认后端回归 198 passed / 4 ignored；其后增加顺序用例，最终优化开启回归
199 passed / 4 ignored。两次均过滤 main 已知的
`guest_memory_growth_failure_is_distinct_from_managed_budget_exhaustion`。
随后四项优化专项用例全部通过：共享原值、动态键回退、重复键诊断、强制 GC、
来源保持、调试求值顺序及首次失败后短路。
IC 17 组时间查询、SQLite 边界及非法输入检查通过；NS 151 Dataset、302 Relation、48 类样本、canonical domain 及非法输入检查通过。

在 Telora 隔离 target 构建：

```sh
CARGO_TARGET_DIR=/tmp/telora-auto-target cargo build --release -p telora --features experimental-mut-oracle
```

在 lab-ontology 执行：

```sh
python3 scripts/measure-mut-ceiling.py --telora /tmp/telora-auto-target/release/telora --variants baseline automatic sealed --output /tmp/mut-auto
```

只测自动路径可移除 Rust feature，并将 variants 设为 baseline automatic。
不修改默认工具链接、部署配置或服务。
