# discovery／expand 知识采集实验

> 历史方案／性能对照记录；对应 jq 实现和实验复现请使用 lab-ontology 提交 `d1683a0`／`7963c5b` 及 dsh-oks 提交 `75f6942`。当前方案见 RFC 0005。

日期：2026-10-26。基于 lab-ontology `a589466`、Telora `54aa4e21` 和 dsh-oks `c15e457`。所有变更和产物均在本地诊断分支及隔离临时工作区，没有修改正式插件、部署配置或服务。

## 实验协议

```text
discovery() -> { initial_state, keys }
expand(state, items) -> { new_state, keys }
items = [{ key, data }, ...]
```

模型的构建期 P2 包含紧凑描述数据和模型提供的 jq 程序。discovery 生成初始状态及类型描述表的获取请求；expand 整理类型事实、给出 Dataset 获取请求，再构造完整图。宿主只按通用 path 读取数据，维护获取队列和去重集合，反复执行 jq，直到队列为空。

地址拼接、URI 编码、Group 内容哈希、成员节点展开、事实合并及引用整理都在 jq 中。宿主采集器没有 Entity／Dataset／Group 的内部结构或寻址规则。采集依赖与最终知识关系独立：附加的 Detached 类型描述没有知识图入边，也能通过类型目录采集出来。

实验 P2 使用 `experiment.knowledge-discovery/v1`，为了复用已有 build stage 驱动，暂存于 `ontology.knowledge` 信息条目。它不是正式插件已支持的新发布契约。

## 范围与对照

使用原 JS 生成器，5／10／20／40 个 Dataset，每个 10 个维度、11 个 Row 字段、复合身份、独立字段 newtype 和一个记录计数。覆盖 Dataset、Entity、Role、字段、DimensionGroup、绑定、维度、记录计数及具名／结构类型。关系、业务连接、业务域、采样统计、时间角色和其他表达式尚未实现；原型遇到超出范围的输入会明确失败。

类型依赖收集及其数组去重算法保持原样。类型身份仍由 Telora 计算；图地址则在 jq 中构造。原型尚未共享所有重复 Group 描述，且 Dataset 序列化仍逐表筛选权限信息，因此这些测量只评价当前数据搬运方案。

基线和实验使用相同生成模型及 transform 程序，均以 `--staged` 实际构建。构建耗时为每个变体单次测量，顺序执行、不并发；宿主采集为三次中位数，每次使用新 Wasm 实例。jq 编译、输入／state 序列化、求值及输出反序列化均计入采集时间；单独加载 Wasm module 的约 3～4 ms 不计入该列。

为保持既有内容哈希地址，隔离复制插件的纯 jaq 引擎，仅增加通用 `sha256` builtin（sha2 0.10.8）。验证了 SHA256 已知向量；引擎没有 Host imports。正式 dsh-oks 引擎目前没有该函数，没有把这次扩展部署到运行环境。

## 测量结果

单位为秒，P2 大小是实际 custom section 中信息 envelope 的字节数，包含 jq 程序。

| Dataset | 基线准备 | 实验准备 | jq 完整采集中位数 | 基线构建总计 | 实验构建总计 | P2 基线／实验字节 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 1.586 | 0.787 | 0.069 | 6.259 | 5.430 | 149,619／91,345 |
| 10 | 3.405 | 1.621 | 0.122 | 8.476 | 6.655 | 299,496／177,594 |
| 20 | 7.189 | 3.598 | 0.215 | 12.683 | 9.145 | 599,666／349,784 |
| 40 | 16.958 | 8.888 | 0.406 | 23.582 | 15.636 | 1,200,006／694,164 |

40 Dataset：准备时间减少约 47.6%；完整构建时间减少约 33.7%。把 0.406 秒宿主采集另加到实验构建后，单次总计约 16.04 秒，仍低于基线 23.58 秒。两者通常发生于不同生命周期，这个相加只用于说明没有把大量工作隐藏到采集端；不是部署冷启动测试。

40 Dataset 的 Wasm 为 11,244,025 → 10,732,930 字节，减少约 4.5%；P2 为 1,200,006 → 694,164 字节，减少约 42.2%。B 的 transform 程序没有改变，体积收益主要来自较小的知识信息。

## state 与批次成本

40 Dataset，类型表作为一个 item，Dataset 每个一个 item，共 41 个获取请求。不同批次输出同一份知识图。

| 每批最多 items | expand 调用次数 | 完整采集中位数 |
| --- | ---: | ---: |
| 全部 | 2 | 0.406 秒 |
| 5 | 9 | 0.675 秒 |
| 1 | 41 | 1.875 秒 |

整个 state 经 JSON／jq 往返具有成本，逐个处理比批量明显慢。当前规模下，保留简单协议并批量处理足够；尚未验证更大规模、远程 fetch、正式插件 worker 调度或取消行为。无需仅凭本轮结果引入 updates／patch 协议。

## 等价性验收

各规模的基线与 jq 输出具有相同契约、节点 key 和完整 value。比较时忽略 facts 数组次序，并将 references 按集合比较；引用顺序与重复次数不作为语义。两边均检查 key 唯一及引用闭合。

| Dataset | 事实数量 | 类型节点 | 图等价 | transform 响应一致 |
| --- | ---: | ---: | --- | --- |
| 5 | 285 | 64 | 通过 | 通过 |
| 10 | 565 | 124 | 通过 | 通过 |
| 20 | 1125 | 244 | 通过 | 通过 |
| 40 | 2245 | 484 | 通过 | 通过 |

补充检查：40 Dataset 在全量／5／1 items 批次下完整图等价；向 5 Dataset 的紧凑类型目录追加无入边的 `experiment::Detached` 描述后，正确新增一个事实，其余图保持不变。这验证了采集发现不依赖最终知识图从根可达。

本次 transform 冒烟只使用生成器自带的前五个 Dataset 投影请求，比较所有基线／实验响应；没有宣称覆盖生成模型的全部查询能力。没有运行模型自检或 IC 验收。

## 复验

```sh
python3 experiments/knowledge-discovery/prepare-engine.py
python3 experiments/knowledge-discovery/run.py \
  --engine <上一步输出的隔离 oks_wti.wasm> \
  --counts 5,10,20,40 --dimensions 10 --field-types distinct
```

批次复验可对同一个实验 publication 调用：

```sh
node experiments/knowledge-discovery/collect.mjs \
  <engine.wasm> <sample-discovery.json> <output-graph.json> 5 3
```

源文件：

- `raw-export.telora`：样本范围内的紧凑数据导出，注入隔离 ontology 副本
- `expand.jq`：随模型写入 P2 的 discovery／expand 程序
- `collect.mjs`：不理解模型结构的通用队列与 path 读取器
- `run.py`：真实构建、图等价及 transform 对照驱动
- `prepare-engine.py`：隔离编译支持 SHA256 的实验 jaq 引擎

本轮原始报告：

- `~/.cache/tmp/discovery-experiment-kqb8r_13/report.json`
- `~/.cache/tmp/discovery-experiment-qhp0t61k/report.json`
- `~/.cache/tmp/discovery-experiment-qhp0t61k/batch-measurements.json`

## 判断

该协议在生成模型上可行：把完整图组装移至模型提供的 jq，取得了实际的构建时间和 P2 体积收益，宿主不需要理解 ontology 内部模型结构。类型去重仍是独立问题，没有将两种优化混在一起。

下一步可先正式化这份最小协议，再补齐关系、业务域、采样统计等紧凑描述，验证 IC 的图等价和总成本。当前原型还不能替换正式插件及全部模型的发布路径。
