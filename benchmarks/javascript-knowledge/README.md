# 外置静态 JS 知识构图实验

> 历史方案／性能对照记录；对应 jq 实现和实验复现请使用 lab-ontology 提交 `d1683a0`／`7963c5b` 及 dsh-oks 提交 `75f6942`。当前方案见 RFC 0005。

## 结论

相同 JSON 描述下，JS 指令执行显著快于现有 jq 采集。IC 的首次构图中位数为 1962.60 → 79.38 ms，约快 24.7 倍；连同模型 JSON 解析、插件校验／导航、词表渲染和实验结果序列化，总计 2231.32 → 347.92 ms，约快 6.4 倍。

直接调用 JS 和 `[[operation,...args],...]` 指令派发的性能接近，本次三次观测不足以证明两者有稳定差距。可以按表达清晰度选择指令序列。单次 jq 消除了部分协议往返，但 IC 仍需 1551.09 ms，收益不只来自减少调用次数。

本轮只使用外置静态 JS 和现有模型 JSON，没有修改 ontology 发布、插件生产入口、构建环节或运行环境，也没有把 JS 嵌入 Wasm。**没有新的构建耗时或 Wasm 体积结论**。

## 四组对照

- `jq`：正式插件 discovery／expand／build_knowledge_graph，批量默认 128
- `jq-single`：相同 jq 领域函数，单次 reduce 完成全部构图，保留正式 jaq worker／Wasm／JSON 边界
- `js`：静态函数体通过 `new Function("data", source)` 编译，顺序调用 types／dataset／capabilities／relations
- `js-ops`：同一静态函数实现，通过 JSON 指令序列调用 types／entity／dataset／capabilities／relations

指令模式示意：

```js
const state = initialize(data.revision);
for (const [operation, ...args] of data.instructions) {
  operations[operation](state, ...args);
}
return finish(state); // { graph, vocabulary }
```

指令序列暂由实验驱动从同一 JSON 描述转换，转换成本计入构图；未要求模型改变发布格式。Entity 指令从 Dataset Role 描述拆出，因此指令 JSON 目前保留一些重复描述，不能作为最终发布体积设计。

JS 使用 Map／Set 维护索引及引用集合，原地合并事实。SHA256 实现在静态源码中，无需宿主注入哈希函数。传入的数据保持不变，同一数据可重复构图。插件仍用既有 `derivePublishedKnowledge` 校验事实并派生成员导航和反向链接，再用 `renderWholeVocabulary` 生成 va_ask 词表。

## 测量方法

2026-10-26，Node v26.12.1，x86_64。每个模型／变体启动三个独立 Node 进程，顺序运行并轮换次序，表格取各指标中位数。没有并发构建或基准任务。模型 JSON 来自相同 Prepared 描述，JS 不需要读取 jq 程序；目前复用发布 envelope 方便对照。

“构图”包括外部程序准备及执行；jq 包括 worker 启动、编译、JSON 输入／state／输出往返；JS 包括 new Function 编译及执行。“总计”额外包含文件读取／JSON 解析、正式插件派生、词表渲染和结果 JSON.stringify，不包含 Node 启动、模块导入、验证对照或写结果文件。每列分别取中位数，因此各阶段列之和不一定等于总计列。

### 首次构图

单位：ms。生成样本每个 Dataset 有 10 个独立 newtype 维度。

| 模型 | 事实 | jq 采集 | 单次 jq | JS 直接调用 | JS 指令序列 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 Dataset | 285 | 192.68 | 162.49 | 9.93 | 10.11 |
| 10 Dataset | 565 | 308.89 | 257.96 | 14.89 | 15.19 |
| 20 Dataset | 1125 | 530.22 | 427.08 | 22.31 | 23.27 |
| 40 Dataset | 2245 | 942.63 | 750.81 | 35.60 | 34.46 |
| IC | 4558 | 1962.60 | 1551.09 | 77.16 | 79.38 |

### IC 插件侧分布

单位：ms。

| 阶段 | jq 采集 | 单次 jq | JS 直接调用 | JS 指令序列 |
| --- | ---: | ---: | ---: | ---: |
| JSON 读取／解析 | 12.35 | 12.77 | 12.72 | 12.74 |
| 构图（含编译） | 1962.60 | 1551.09 | 77.16 | 79.38 |
| 事实校验与导航派生 | 239.23 | 241.76 | 231.07 | 229.15 |
| 词表渲染 | 9.65 | 11.05 | 9.32 | 10.92 |
| 实验结果序列化 | 7.71 | 9.09 | 15.82 | 15.90 |
| 总计 | 2231.32 | 1832.41 | 359.42 | 347.92 |

JS 指令版 new Function 编译约 0.46 ms，包含在构图时间中。JS 后续重复构图通常更快，但正式知识索引会缓存，本轮以首次构图作为主要评价依据。

进程峰值 RSS 中位数：jq 约 213.9 MiB、单次 jq 179.7 MiB、JS 直接版 156.2 MiB、JS 指令版 161.3 MiB。此为测量阶段结束时的进程累计高水位，含 Node、导入模块及 jq worker，非算法独占内存；不包含之后的等价性断言和 JS 重复执行。

静态 JS 约 12 KB。IC 原始 data 为 1,516,769 B；实验指令 data 为 1,547,570 B。它们只说明当前外置描述和适配器的大小，不代表嵌入后的 P2 或 Wasm 大小。

## 验收

四种模式在 5／10／20／40 Dataset 及 IC 上产生相同 graph 和 vocabulary，按事实 key／value、引用集合及词条字段逐项比较；引用去重和输出顺序不作为语义差异。每个结果均通过正式插件图及词表校验。

额外验证组合样本的 103 条事实与词条，包含 Identity／Numeric／Transfer Group、Rate／Seconds／Ipv4／UtcBucket 等表达式。SHA256 已知向量、Unicode／长字符串、URI 特殊字符、canonical JSON、空图、`__proto__` 业务身份及输入不变性通过。

原始三次观测留在隔离实验工作区，摘要及输入／JS 的 SHA256 见 [results.json](results.json)。未运行新的 transform 回归，因为模型、编译器、运行期和正式插件源码均未改动。

## 复现

从 lab-ontology 根目录执行，旁边需有已构建的 dsh-oks 工作区：

```sh
python3 benchmarks/javascript-knowledge/generate.py
python3 benchmarks/javascript-knowledge/run.py <publication-5.json> <publication-10.json> <publication-20.json> <publication-40.json> <ic-publication.json>
node --import ../dsh-oks/packages/dsh-oks/scripts/markdown-loader.mjs benchmarks/javascript-knowledge/check.mjs <feature-publication.json>
```

`generate.py` 只写隔离临时工作区，导出当前格式的对照 publication 和独立 `.data.json`；不修改原模型。IC publication 可由 `scripts/check-programmed-knowledge.py icloud_model` 在隔离目录获得。

下一步可先确定 JSON 指令的分组和静态 JS 的加载方式，再单独评估构建期嵌入。当前数据表明新的主要成本已经转移到插件事实校验和导航派生。
