# 显式 Model World 方案探索

## 模型表达

应用提供模型的语义成员清单，构建器验证覆盖并投影为 transform 状态和知识信息。
同一个具名定义只在原声明处描述，World 引用它；完整性表示成员边界完整。

```telora
def model_world: world::World = {
    revision: "typed-relation-v1",
    types: [world::type_entry(DeviceId.type), world::type_entry(DeviceIdentity.type), world::type_entry(DeviceRow.type)],
    entities: [world::entity(device)],
    datasets: [device_declaration],
    relations: [], alternatives: [], links: [], profile,
};
```

可运行的完整例子见 [explicit_world.telora](../relation_model/src/explicit_world.telora)：15 个具名类型、5 个 Entity、5 个 Dataset、8 个 Relation、1 个 Alternative、2 个 Link。
`type_entry` 是将异构 `TypeOf(T)` 显式拓宽到 `Type` 的边界；当前编译器不能直接将这些精确证据混合进数组。

## 覆盖与发布

- World 显式列出具名模型类型；Int／Float／Bool／String 与匿名结构属于定义内部的结构
- 覆盖检查遇到具名引用时只判断是否已提供；结构递归展开到具名边界即停止，不补充 World 成员
- Entity 单独登记，独立于其是否被 Dataset 的角色引用
- Dataset 角色引用已登记 Entity；Relation 两端引用已登记 Dataset 和角色，定义必须一致
- Alternative 和 Link 引用 World 已提供的 Relation；重复类型、Entity／Dataset／Relation 标识产生诊断
- `coverage` 返回带 code、path、message 的遗漏清单；`self_check` 在覆盖成功后执行现有业务模型自检
- 构建 `world::stage(model_world, program)` 直接遍历类型和 Entity 清单，不调用类型闭包收集器，也不执行自检

发布仍使用静态 JS＋JSON。每个具名类型投影自己的匿名表示和容器结构，遇到其他具名类型即停止；共享匿名结构可能重复出现在 JSON 中，由插件静态程序按结构标识整理。这个局部结构投影不维护全局 visited，不发现新的语义成员。该实验保留现有知识形状，以便逐项比较。

自检首版的成员判断仍使用 Type 相等和数组扫描；它不在知识准备路径中。内部 TypeId 的高效索引与缓存属于 telora 能力。当前 Role／Relation／Link 的语义保持独立观察，尚未进行正交化改造。

## 类型信息缓存

显式 World 决定哪些定义属于模型；类型信息缓存避免对同一个已知类型重复计算。两者可以分别启用并测量。

telora 工作分支探索 `std::type_memorizer`：

```text
type_memorizer: for(R) Fn(Fn(Type) -> R) -> TypeMemorizer(R)
computed_with_type: for(R) Fn(TypeMemorizer(R), Type) -> R
```

构造时固定计算函数，私有缓存仅被查询闭包捕获；应用不能读取槽位、计数或命中状态。查询在内部直接使用类型身份，避免字符串 key。ontology 将字符串类型标识作为类型身份的缓存投影，外部知识地址保持相同。

## 已验证的边界

`python3 scripts/check-explicit-world.py` 在临时目录执行覆盖检查、关系查询回归，以及隐式发现／显式 World 两种构建的对照。
新编译器可通过 `TELORA`、`TELORA_RUN` 指定；实验不部署模型。

- 覆盖检查：有效清单、类型遗漏、嵌套容器内类型遗漏、重复成员、内置类型误登记、Entity／Dataset／Relation 遗漏、端点冲突、角色遗漏
- 递归类型登记后可检查与发布；没有被任何 Dataset 引用的 Entity 和类型仍被发布
- relation model：知识图 83 条事实等价，102 个 graph 回归和 6 组 SQLite 查询对照通过，分阶段制品的正常／非法请求响应一致

首轮小模型准备时间：隐式发现约 345ms，显式 World 约 345ms，单次观测差异不足以证明提速。该结果在类型缓存接入前取得；规模样本与缓存收益独立记录。

## 后续取舍

先验证成员完整性与性能，再决定清单的长期语法。具名定义与内部结构的边界、复用 Group 的顶层登记、Role／Relation／Link 的职责，以及按 typeid 建立覆盖索引，分别作为后续方案问题推进。

## 规模实验与 IC 实测

使用实验分支 release 编译器，运行：

```sh
TELORA=/opt/userhome/h00629578/ws/telora/target/release/telora python3 scripts/measure-explicit-world.py --ic
```

单位为秒；各组为单次顺序观测，知识图事实对照均等价。缓存目前仅覆盖字符串类型标识计算，未缓存完整类型描述。

| 模型 | 自动发现：准备／总构建 | 显式 World：准备／总构建 | World＋缓存：准备／总构建 |
| --- | --- | --- | --- |
| 5 Dataset | 0.832／5.734 | 0.879／5.661 | 0.603／5.449 |
| 20 Dataset | 3.805／9.447 | 3.405／9.039 | 2.459／8.203 |
| 40 Dataset | 8.992／15.908 | 6.693／13.519 | 5.124／12.073 |

40 Dataset 的准备时间减少约 43%，总构建减少约 24%。World 局部投影会重复匿名结构：该样本制品从 10,813,535 增至 10,927,576 字节；其中缓存自身仅增加 481 字节。小模型中 World 单独启用未显示准备阶段收益。

IC 尚未迁移到显式 World，本轮仅验证 ontology 类型标识缓存自动带来的收益：准备 14.350 → 12.405 秒（减少约 13.6%），总构建 26.657 → 24.767 秒；制品 13,299,640 → 13,300,131 字节（增加 491 字节）。不能将这组结果归因于显式 World。

原始报告位于本机临时目录 `~/.cache/tmp/dataset-scale-dUxdpl/world-report.json`。测量在测试结束后执行，未与完整测试并行争抢 CPU。

## IC 内存对照

同一 release 编译器、同一临时 IC 工作区、仅切换类型标识缓存；使用 `/usr/bin/time -f %M`，按关闭／开启／开启／关闭顺序独立构建。没有启用显式 World。

| 指标 | 关闭缓存 | 开启缓存 |
| --- | --- | --- |
| 构建进程峰值 RSS，两次观测（MiB） | 660.34／659.87 | 665.27／651.54 |
| 构建进程峰值 RSS，均值（MiB） | 660.10 | 658.41 |
| 运行期 snapshot 恢复后托管堆（字节） | 1,390,855 | 1,390,855 |
| 恢复并执行一次 transform 后线性内存（字节） | 9,306,112 | 9,306,112 |

RSS 包括编译器和 Wasm 引擎，不等于缓存或 Wasm 堆大小。两次样本仅支持未观察到明显 RSS 劣化，不能证明 RSS 稳定下降。运行期使用相同 device_id 查询，SQL 与响应一致。

原始数据：本机 `~/.cache/tmp/dataset-scale-dUxdpl/memory-measure/{report.json,runtime-report.json}`。构建期堆指标通过临时调用 `Session::gc_stats` 取得，测量后恢复源文件和原 release 二进制；不向正式 API 添加模型相关指标。

构建准备结束时（未额外强制 GC），关闭／开启缓存各一次：

| 指标 | 关闭缓存 | 开启缓存 | 变化 |
| --- | --- | --- | --- |
| 托管堆字节 | 13,138,919 | 13,873,929 | +735,010（+5.6%） |
| 托管存储与登记表字节 | 20,393,752 | 21,110,312 | +716,560（+3.5%） |
| Wasm 线性内存字节 | 35,258,368 | 36,175,872 | +917,504（+2.6%） |
| 累计分配字节 | 51,124,791 | 46,175,813 | −9.7% |
| GC 次数 | 53 | 47 | −6 |

这是准备阶段结束时的堆占用，包含尚未回收的临时对象，不等于缓存自身大小或托管堆峰值；线性内存在该阶段不缩小，其结束容量可观察该阶段的容量高水位。缓存以约 0.88 MiB 的额外线性内存，换来更少分配和 GC；最终运行制品恢复后的托管堆没有增加。GC 数据见同目录 `heap-report.json` 及 `heap-{discovery,memo}.log`。
