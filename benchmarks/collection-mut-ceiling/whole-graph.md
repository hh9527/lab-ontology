# IC/NS 整段知识构图的手写收益空间

先做可运行的手写参考，再判断自动分析值得覆盖哪些代码。
本轮允许调整算法、消除中间表示、采用类型编号直接索引；没有实现更多 alias 分析。
默认 ontology 源码保持普通不可变实现，手写片段只由基准脚本注入临时工作区。

## 特殊开关

Telora CLI 的 Rust feature `experimental-mut-oracle` 默认关闭。
只有显式 `cargo build --release -p telora --features experimental-mut-oracle`
才把 `_pipeline_mut_oracle.telora` 拼入受信任的 std::pipeline。
默认 std 不包含任何 oracle 类型和函数，应用不能导入这些可变能力。

实验入口包括 ArrayMut、MapMut、StringMut 和基于 Type 编号的访问集。
它们只服务于手写性能对照，不是公开语言 API 提案。
正常的 Node/Output/pipeline 接口和不可变语义不变。

## 覆盖的实际路径

`world::stage_prepared → prepare → publication → field_knowledge::publication_from`，
包含 Entity 根收集、类型根收集、依赖闭包发现、类型描述、Dataset/group/member
描述、capabilities/relations、最终指令与外部信息。
没有把不在该路径上的旧完整知识图算法、自检或 transform 运行期查询计入热点。

| 变体 | 实现 |
| --- | --- |
| baseline | main 原实现 |
| array | 嵌套类型根遍历共用一个 ArrayMut |
| map | 跨发现轮次复用 MapMut，直接首次插入，最终只整理一次索引 |
| string | 类型文本由 StringMut 收集片段，最后一次 join |
| object | 固定字段对象用手写 MapMut 逐项写入 |
| all | array/map/string/object 同时使用 |
| literal | 固定字段直接用 Dict(Value) 字面量，后端一次分配 K/V 列 |
| best | literal + 手写 ArrayMut + 跨轮 MapMut；保留高效的批量 map/join |
| dense | best 的类型去重/遍历改为 Type 编号访问集，不在内层字符串化、查有序 Map |
| frontier（历史，已撤掉） | dense + 在类型根入队时去重，避免反复准备相同类型的投影 |

最初的回调型写入支架也测过，因 Edit/tuple/闭包/数组头分配反而更慢，未作为收益上限。
当前直接写入支架消除了这些额外 Edit/tuple；私有缓冲复用已有数组头和 backing store。
Type 访问集使用独占的稠密 bitset，按 sealed TypeId 索引；具名类型最终发布顺序仍按原字符串键整理。
frontier 保留首次出现顺序，去重发生在投影之前；没有删减最终字段或知识节点。

## 测量结果

以同一个开启实验 feature 的隔离编译器，完整 staged 构建并保留全部知识。
没有修改 telora-config.json，也没有在 CLI 覆盖应用 fuel/memory 配额。
MB 为十进制；fuel 是运行时实际消耗值。每个变体一个样本，墙钟仅作初筛，不能据此承诺稳定的百分比加速。

结果表由同目录 JSON 数据给出。`whole-graph-results.json` 是第一轮分项与成本边界；
`type-index-results.json` 是最终同编译器的 baseline/best/dense/frontier 对照。

| 模型 | 准备 baseline → frontier | 总构建 | fuel（十亿） | 累计分配 MB | linear memory MB |
| --- | --- | --- | --- | --- | --- |
| IC | 11.42 → 9.13 s | 24.62 → 22.35 s | 25.46 → 19.74 | 50.92 → 39.18 | 38.08 → 36.90 |
| NS | 37.03 → 28.36 s | 57.61 → 48.78 s | 85.37 → 64.17 | 143.31 → 107.10 | 88.67 → 88.34 |

准备阶段约减少 20% / 23%，fuel 约减少 22% / 25%，累计分配约减少 23% / 25%。
linear memory 是运行记录中的线性内存规模，不能等同于进程 RSS；其改善不明显。

第一轮的 no-knowledge 诊断版本准备为 IC 4.19 s、NS 9.87 s；
扣除这部分 transform 准备成本，知识构图净成本的改善粗估约三成。
不同制品与 GC 存在交互，此相减不是精确函数计时，也不是可发布的完整知识方案。

## 收益来自哪里

- 固定形状对象使用批量字典字面量，消除键值对数组和重复排序；这是普通不可变写法的收益。
- 类型闭包采用 TypeId 访问集，避免内层反复生成字符串键、查找有序 Map。
- 根收集共用私有 ArrayMut，跨发现轮复用私有 MapMut；入队前去重避免重复投影。
- 最后的前置去重收益已较小。单独将所有对象改为逐项 MapMut 写入反而更慢：
  第一轮 NS all 为 39.54 s，baseline 为 36.67 s。
- StringMut 在当前类型文本 map/join 路径没有证明收益，因此较优版本保留原批量实现。

这说明“所有容器都改成 Mut”不是空间上限。批量构造、少创建中间表示、按类型编号索引，
与局部缓冲复用共同形成了本次已验证的较优参考；尚未证明是绝对上限。
本轮结果也不是自动 alias 分析已经实现的收益。

## 正确性与边界

所有完整变体均逐项比较整个 `telora.build.information` JSON，包含数组顺序；没有删减知识。
最终 frontier 通过 IC 17 组时间查询和 SQLite/非法输入检查，
NS 151 Dataset、302 Relation、48 类样本及非法输入检查；生产插件知识程序也能处理发布信息。

实验后端测试覆盖空数组、扩容、重复键、循环发现、TypeId 首次访问、强制 GC 以及原输入不变。
默认构建不包含 oracle 源，实际编译手写 frontier 时报告 unknown binding，且不生成制品。
正常 ontology 文件保持 main 的不可变实现；实验只存在于临时副本及基准片段。

## 复现

在 Telora 仓库以隔离 target 构建开启 feature 的 CLI：

```sh
CARGO_TARGET_DIR=/tmp/telora-mut-oracle-target cargo build --release -p telora --features experimental-mut-oracle
```

在 lab-ontology 仓库运行：

```sh
python3 scripts/measure-mut-ceiling.py --telora /tmp/telora-mut-oracle-target/release/telora --variants baseline literal best sealed --output /tmp/mut-ceiling-reproduce
```

额外诊断可选择 `array map string object all no-knowledge types-only`；第一项须为 baseline。
脚本不修改当前应用配置、部署文件或默认工具链接。
历史报告保留当时 compiler 路径和 SHA；该路径可能已被后续构建替换，
最终轮实验二进制另保留在报告的 preservedCompiler 路径，SHA 已核对。

## 访问状态的语义修正

历史 frontier 版本让应用在收集根时调用 `oracle_type_first`。该结果随访问历史变化，
不能当作 TypeMemorizer 的缓存命中，也不能作为普通不可变语言接口。
前面的历史结果保留作探索证据，不代表合法的自动优化能力。

当前移除访问集类型、构造器和首次访问函数的导出，只提供完整的
`oracle_type_unique` / `oracle_type_discover` 操作；每次调用内部创建并消费访问集，
只返回不可变数组。应用不获得访问集，也不能根据缓存命中作分支。
脚本撤掉 frontier 路径；`sealed` 对应原 dense 算法，增加缓存保留和无访问状态引用的检查。
其余 ArrayMut/MapMut 支架仍是特殊开关下的手写实验能力，不因此升级为正常语言接口。

ontology 已在字段投影、根描述、类型名称处使用 TypeMemorizer；本轮核实它们内部原本就是
按 TypeId 直接索引 Empty/Pending/Ready 槽位。无需新增缓存，也不能把它改造成访问标志。
完整遍历的去重状态与描述计算缓存是两个独立机制。

最新对照以 `sealed-results.json` 为准，复现命令改为：

```sh
python3 scripts/measure-mut-ceiling.py --telora /tmp/telora-mut-oracle-target/release/telora --variants baseline literal best sealed --output /tmp/mut-ceiling-sealed
```

| 模型 | 原实现 | 仅批量对象 | 再加 ArrayMut/MapMut | 再加封闭 TypeId 遍历 |
| --- | --- | --- | --- | --- |
| icloud_model | 11.38 s | 10.21 s | 10.09 s | 9.11 s |
| ns_model | 36.67 s | 31.48 s | 30.69 s | 29.09 s |

本轮每格一个样本。表中分步差异依赖前序改动，不能视作各优化独立相加的收益。
封闭遍历仍含专用 TypeId 算法，不是通用 MapMut 自动替换的收益。
访问状态不可导入负例、完整操作强制 GC/循环/重复调用测试，以及原有 5 项 TypeMemorizer 测试通过。

自动编译器优化的后续对照见 [automatic-lowering.md](automatic-lowering.md)，不应将前面的手写数据视作自动优化结果。
