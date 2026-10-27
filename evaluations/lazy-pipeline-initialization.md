# 惰性 pipeline 初始化实验

跟踪：[lab-ontology #66](https://github.com/hh9527/lab-ontology/issues/66)，依赖
[telora #251](https://github.com/hh9527/telora/issues/251)。本轮验收包含代码合入，不包含部署。

## 实现与范围

ontology 类型闭包的每一轮将既有类型与 pending 组合成惰性 merge 节点，然后以
collect_dict(type_id, identity) 终端一次构造不可变索引；fresh 仍由上一轮索引判定。
同一类型身份对应同一个 Type，因此同键最后值覆盖与原收集结果等价。无需额外叠加
一次 distinct_by，也不需要修改 IC 声明。显式 World 的 publication_from 直接消费
给定类型清单，保持原路径。

标准库内部使用 DictMut，应用只使用节点、终端计划和 run。ArrayMut 与 StringMut
也已在 telora 中实现；本轮没有为了覆盖它们而改写业务。StringMut 以私有字符串块
数组加一次 join 完成，尚不是直接增长字符缓冲。公开 pipeline 不暴露可变句柄。

当前后端完整物化每个访问节点，不做流式融合；同次 run 的共享节点只算一次，显式
cache 可跨 run 保留成功结果。节点保留最近结果，这可能增加长期图的存活内存。
本轮业务的节点只存活于一轮发现，完整构建 RSS 不能代替这种保留内存的专项评价。

## 测量方法

2026-10-27，同一 release 实验编译器，按 baseline／current 顺序独立构建，每组各一次。
baseline 固定读取 Git 1232a99 的数组扫描实现；current 使用上述公共实现。
5／40 Dataset 均由 JS 生成，每个 Dataset 有 10 个维度，值字段使用独立 newtype。
IC 使用现有模型。只比对完整发布 JSON 和针对性 transform，不运行模型自检、
全面知识测试或额外知识地图构建。

```sh
python3 scripts/measure-sink-initialization.py \
  --telora ../telora/target/release/telora-pipeline-experiment \
  --counts 5,40 --ic --variants baseline,current --baseline-ref 1232a99
```

测量时编译器实现为 telora 2671eb15（含此前 RFC 修订），合入提交为 7131421a。
独立二进制 SHA256：
`e9c2c4b8845dc5b7763a6e5a650b76dab1437efc12ca7cd20591e15e0b36c56e`。
运行环境使用的 telora 二进制未更新。

## 结果

| 模型 | 基线准备／总构建 s | pipeline 准备／总构建 s | 基线／pipeline 峰值 RSS MiB | 类型数 |
| --- | ---: | ---: | ---: | ---: |
| 5 Dataset | 0.583／5.365 | 0.548／5.522 | 244.44／246.08 | 65 |
| 40 Dataset | 7.439／14.261 | 4.778／11.799 | 358.89／359.47 | 485 |
| IC | 12.279／24.765 | 11.691／24.100 | 662.02／663.25 | 367 |

三组发布内容一致，仅规范化顶层类型描述的顺序；transform 响应一致。
40 Dataset 准备减少约 35.8%，IC 准备减少约 4.8%、总构建减少约 2.7%。
5 Dataset 的总构建稍增，说明固定开销不能忽略。以上单轮结果不能视为稳定性能承诺。

IC 阶段分布（基线／pipeline，秒）：frontend 8.870／8.774，codegen_link
2.733／2.732，engine_load 0.369／0.370，prepare 12.279／11.691，
initialize 0.0009／0.0008，seal 0.150／0.150，runtime_specialization
0.078／0.086，snapshot 0.136／0.157。其他打包、输出等阶段见原始报告。

IC 制品 13,300,624／13,371,324 B，新增 70,700 B；峰值 RSS 增加约 1.23 MiB。
这是完整构建进程的峰值，不是 pipeline 托管堆峰值，不能证明所有使用方式都没有内存回退。

原始报告：`~/.cache/tmp/sink-initialization-cv1ov_dy/report.json`。
基线知识源码 SHA256：`60674103bfb67cc26788538e3b202d96b0804afa83db84e422c5cf891fc82ef8`；
当前知识源码 SHA256：`267218d301e8c7953c3290c006101ee167e8d6e6eb009360c0afd10019bdbac7`。

## 判断与下一步

隐藏可变性的 API 在真实模型上可用，规模样本保留了索引去重的收益，IC 的提升有限。
本轮不把不同日期的旧 builder 数字拿来推断新 API 的净开销。历史记录见
[作用域 builder 实验](scoped-sink-initialization.md)。

后续优化应优先评估单消费者链融合、merge 直接输送给终端及共享分支的按需缓冲，
避免固定地为每层节点完整物化。先用生成样本量化，再决定是否迁移更多业务路径。
