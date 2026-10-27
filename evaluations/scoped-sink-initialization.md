# 作用域 builder 初始化实验（历史）

本报告记录写入句柄原型阶段；当前实现与新测量见[惰性 pipeline 初始化实验](lazy-pipeline-initialization.md)。

跟踪：[lab-ontology #66](https://github.com/hh9527/lab-ontology/issues/66)，依赖
[telora #251](https://github.com/hh9527/telora/issues/251)。

初期诊断沿用 telora `experiment/scoped-write-only-sinks` 原型，lab 使用
`experiment/scoped-sink-initialization`。初期只修改临时模型副本；该轮分支将索引去重
接入 ontology 公共实现，具体模型源码保持原样。当前环境使用的 telora CLI、服务配置
和部署环境保持原样；没有执行模型自检。

结论：类型收集的数组扫描适合替换成索引去重，规模样本收益明显；IC 的大部分剩余
准备工作不会因为提供 Dict / Array sink 而自动消失。不能直接套用逐项 Dict merge
微基准的 5 倍提速。

Dict／Array／String 共享“私有构造中间态，最终发布不可变值”的机制价值。已有容量
复用、批量构建、内部 writer 和插件侧构图已覆盖部分机会；本报告衡量这些路径之上的
剩余收益，不据此判断统一机制的全部价值。

以下历史规模及 IC 数据来自早期 Dict-only 原型。测量脚本现已适配不可变 plan 创建
DictMut；新的 plan／MutBuilder 包装需要用新报告单独评价，不能沿用下表数字。

## 该轮公共实现接入

ontology 的 `experimental/knowledge.telora` 已通过不可变 plan 创建 DictMut，按已有
知识类型身份索引发现结果。每层仅物化一次，通过上一层不可变 Dict 判定 fresh，
builder 不跨递归或闭包边界。所有走 `publication` 的模型自动使用该实现；无需改 IC
声明。显式 World 的 `publication_from` 仍直接消费给定清单。

运行依赖 telora #251 分支的编译器，本轮只构建独立命名的实验 CLI。
测量脚本固定从 Git `1232a99` 读取数组扫描基线，`current` 变体使用工作区公共实现，
报告记录基线引用、双方源码 SHA256 和编译器 SHA256。

同一编译器、独立顺序构建，各一次：

| 模型 | 数组扫描准备／总构建 | 当前 DictMut 准备／总构建 | 类型描述数 |
| --- | ---: | ---: | ---: |
| 5 Dataset | 0.588／5.645 s | 0.528／5.681 s | 65 |
| 40 Dataset | 7.547／14.741 s | 4.679／11.922 s | 485 |
| IC | 12.631／25.614 s | 11.123／23.946 s | 367 |

每组发布内容逐项一致，仅规范化顶层类型描述顺序；transform 响应一致。此次 IC
单次准备减少约 11.9%、总构建减少约 6.5%，不当作稳定收益承诺。
IC 制品增加 18,769 B；完整构建峰值 RSS 为 660.46／661.86 MiB，不能解释为局部
builder 或托管堆峰值。没有据此进行普遍 Array 改写，也没有运行全面知识测试。

```sh
python3 scripts/measure-sink-initialization.py \
  --telora ../telora/target/release/telora-sink-experiment --counts 5,40 --ic \
  --variants baseline,current --baseline-ref 1232a99
```

报告：`~/.cache/tmp/sink-initialization-pwpt90bv/report.json`。以下章节保留初期诊断证据。

## 对照方法

使用相同 release 实验编译器，每个变体独立、顺序构建；完整发布仍采用静态 JS＋JSON。
5／40 Dataset 样本来自现有 JS 生成器，每个 Dataset 有 10 个维度，9 个值字段使用独立 newtype。
IC 保持当前模型与建模方式，没有迁移到显式 World。

- baseline：现有实现，类型闭包通过 seen／fresh Array 扫描去重。
- dict：保留原有分层依赖展开，将本层合并换成 `Dict(Type)` sink，以已有类型身份字符串为 key。
  `merge_thunk` 避免重复提交，物化后与上一层 immutable Dict 对照得到 fresh。
  这是索引算法与内部 builder 的组合收益，不是只把 Array 换成可变 Array 的收益。
- array：用现有 Seq collect 实验 Array 融合，将局部 `codec::encode(array::map(...))`
  降成 map＋encode 一次收集，减少中间数组。没有实现新的 Array sink 语法，也没有重写整个初始化。
- both：以上两项叠加。
- prepare：保留声明与 transform 状态准备，删除知识构造，只返回声明数量。
- types：保留声明、类型种子与闭包，删除描述生成，只返回类型数量。

prepare／types 是累积截断制品；差值只用于估计成本，代码、活跃对象、GC 与发布大小
不同，不能当成同一次执行中的精确嵌套计时。它们不能部署。

完整变体逐项对照同一静态 JS 和全部 JSON 指令、类型描述；只规范化顶层类型描述的
输出顺序，其他数组保持顺序。各模型描述中的类型身份唯一，没有丢失类型或指令。
生成样本的所有变体还检查 transform 响应一致。

另外，对 IC 的 baseline／dict／array／both 制品用正式插件重新构图，4558 条事实及
全部 vocabulary 规范化排序后相同；同一个 device_id 查询的 transform 响应一致。
记录见首轮目录的 `verification.json`。

## 首轮观测

单位为秒，prepare 指 `service_prepare`，包含构建期 A 计算；total 是完整构建。

| 模型 | baseline 准备／总构建 | Dict 准备／总构建 | Array 融合准备／总构建 | 两者准备／总构建 |
| --- | ---: | ---: | ---: | ---: |
| 5 Dataset | 0.585／5.467 | 0.532／5.501 | 0.602／5.554 | 0.555／5.510 |
| 40 Dataset | 7.461／14.390 | 4.618／11.646 | 7.701／14.662 | 4.924／11.846 |
| IC | 12.297／24.524 | 11.269／23.644 | 12.207／24.534 | 11.583／24.041 |

40 Dataset 的 Dict 变体准备减少约 38%，总构建减少约 19%；IC 首轮准备减少约 8.4%，
总构建减少约 3.6%。小模型总构建没有收益。Array 局部融合没有显示稳定收益，不能
据此声称所有 Array sink 都无用，也不能声称增加此语法就能显著改善 IC 初始化。

## IC 的成本边界

| 累积截断路径 | 准备时间 |
| --- | ---: |
| 声明与 transform 状态 | 4.218 s |
| 再加类型种子／闭包发现 | 5.981 s |
| 当前完整准备 | 12.297 s |

因此本轮估计类型种子与闭包发现增量约 1.76 s，其余知识描述、编码及发布增量约 6.32 s。
Dict 变体省约 1.03 s，剩余部分不可能仅靠消除这一处去重来解决。
这里没有把 6.32 s 全部归因于 Array、GC 或 JSON 序列化。

## 反向复测与内存

再按 dict → baseline 顺序独立测量 40 Dataset 与 IC，没有并发其他构建。两轮
中位数如下（每组仅两次，不作为稳定性能承诺）：

| 模型 | baseline 准备 | Dict 准备 | baseline 总构建 | Dict 总构建 |
| --- | ---: | ---: | ---: | ---: |
| 40 Dataset | 7.447 s | 4.642 s | 14.435 s | 11.566 s |
| IC | 12.284 s | 11.107 s | 24.606 s | 23.513 s |

对应准备收益约 37.7%／9.6%，总构建收益约 19.9%／4.4%。IC 两轮准备分别节省
1.03／1.33 秒。Array 融合仅首轮观测，尚无足够证据支持推进全面 Array sink 改写。

IC 全构建峰值 RSS：baseline 为 658.29／658.09 MiB，Dict 为 662.92／655.61 MiB；
未观察到明显 RSS 劣化，但这不是托管堆、累计分配或局部 builder 峰值的测量，不能
推断所有内存指标均不变。IC 制品增加 12,059 B（约 0.09%）。

反向复测报告：`~/.cache/tmp/sink-initialization-jd14n490/report.json`。

建议先将类型发现的索引去重作为一个局部优化推进，避免广泛替换 batch map/from_pairs。
要继续明显缩短 IC 的剩余准备时间，需要拆解知识描述、codec／Value 构造与发布路径；
Array sink 只在能消除具体中间结果时再逐点验证。该历史观测时，公共实现尚未迁移。

## 为什么收益有限

当前 `knowledge::publication` 调用 `publication_from`，完整图合并已经放到插件 JS。
源码里的旧 `export` / `merge_facts` 不属于当前 stage 发布路径，不能把这些逐项合并当成
本轮主要优化对象。`raw_dataset` 等小对象使用的也是一次性 `dict::from_pairs`；上轮微基准
已经显示批量 from_pairs 比逐项 sink 更快，因此不应机械替换这些对象构造。

现有 Array map 已按输出长度分配；flat_map／concat 先计算总长度，再一次分配最终数组；
push 也已有符合外部不可变语义的尾部容量复用。Array sink 的机会主要在融合和避免
中间结果，而不是修复“每次 push 都复制整个数组”。本轮只融合一部分双重遍历，复杂
描述构造、codec、最终 Value 树和发布仍存在；collector 增长与计划本身也有成本。

Dict 原型每层还要复制初始 Dict、物化排序，再通过字符串 key 查上一层；并非直接以
TypeId 访问的最优实现。未来 type-keyed sink 可以进一步省掉字符串投影和反复物化，
但这不能拿来承诺剩余全部初始化耗时都能消除。

## 复现

当前 plan 接口兼容性验证已在 5 Dataset 上通过：baseline／DictMut 的知识发布逐项
等价，65 个类型描述无遗漏，transform 响应一致。本次分别准备 0.586／0.531 秒，
总构建 5.687／5.557 秒；单次小样本只用于验证接入，不外推 IC 收益。
报告：`~/.cache/tmp/sink-initialization-2ez_rjwv/report.json`。

实验编译器独立命名为 `telora-sink-experiment`，不覆盖正在使用的 release telora。

```sh
python3 scripts/measure-sink-initialization.py \
  --telora ../telora/target/release/telora-sink-experiment --counts 5,40 --ic
python3 scripts/measure-sink-initialization.py \
  --telora ../telora/target/release/telora-sink-experiment --counts 40 --ic \
  --variants dict,baseline
```

首轮报告：`~/.cache/tmp/sink-initialization-_vx76ukl/report.json`，同目录保留原始日志和制品。
`maxRssKiB` 是整个构建进程峰值，含前端及引擎，不是 builder 或托管堆的独立峰值。
