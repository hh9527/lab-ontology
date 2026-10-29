# Display writer region 应用对照

跟踪 [telora#256](https://github.com/hh9527/telora/issues/256)，Telora 分支
`perf/display-writer-regions`。业务源码与 main 一致，不手写 mut、不修改 ontology 算法。

对照使用同一编译器：baseline 设置 `TELORA_DISABLE_FORMAT_REGIONS=1`，automatic
不设置任何 formatter/collection 实验开关。完整 build information JSON（含数组顺序）相等。

| 模型 | 构建 fuel（十亿）baseline → automatic | 线性内存 MiB | 制品 MiB |
| --- | --- | --- | --- |
| icloud_model | 25.481 → 26.336 | 34.94 → 28.62 | 13.04 → 13.99 |
| ns_model | 85.566 → 84.751 | 79.69 → 81.88 | 20.37 → 21.32 |

IC fuel 增加约 3.4%，NS 减少约 1.0%；两者制品均增加约 0.95 MiB。
这些结果不足以说明应用整体加速。专用函数的代码复制、间接调用分派和 ABI 转发仍有成本。
测量时同时有回归测试与微基准运行，原始 phase 时间保留作诊断，不用于墙钟提速结论。

IC 通过 17 组 SQL/时间/非法输入验收；NS 通过 151 dataset、302 relation SQL、
48 sample families、canonical domain 与非法输入验收。

复现：

```bash
python3 scripts/measure-display-regions.py --telora /path/to/isolated/telora --output /tmp/fresh-display-regions
```

微基准通过 `cargo test -p telora-wasm measure_display_regions -- --ignored --nocapture` 运行。
`TELORA_DISPLAY_REGION_REPORT` 指定 JSON 报告路径；使用相同的诊断 opt-out 做对照。
输入导入、编译、初始化、输出检查不计入 invoke 时间；每个路径使用三个新 Session。
自动 GC 关闭，仍包含 Fmt 资源表扫描收益。托管分配不含内部 Rust String，
线性内存不等于峰值 RSS，不能据此声称所有内存指标改善。

## 256 项微基准

| 路径 | fuel 降幅 | 托管累计分配变化 |
| --- | --- | --- |
| custom | 65.0% | -24.3% |
| property | 39.0% | +4.5% |
| nested_property | 57.5% | +1.9% |
| interpolation | 37.1% | +7.0% |
| codec | 46.0% | +6.0% |

时间原始样本也在 JSON 中；此轮并行运行，正文只报告确定性的 fuel 和分配。
自定义 Display 的分配下降，而 property/codec 的部分路径分配增加，
不能把绕过中间 Fmt 节点等同于总分配下降。

## 验收范围

6 项 formatter 专项测试和 441 项语言案例通过。默认 Wasm 全量回归中 211 项已完成
并通过；既有 `collection_space_variants_preserve_complete_values_and_gc_roots` 多变体
强制 GC 压力用例长时间未结束，主动停止，不能报告全量通过。
`guest_memory_growth_failure_is_distinct_from_managed_budget_exhaustion` 是此前 main
已知失败，本轮过滤。两条微基准对照均已完整运行并通过输出校验。
