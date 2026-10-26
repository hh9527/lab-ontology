# 程序式知识发现验收

> 历史方案／性能对照记录；对应 jq 实现和实验复现请使用 lab-ontology 提交 `d1683a0`／`7963c5b` 及 dsh-oks 提交 `75f6942`。当前方案见 RFC 0005。

## 协议与范围

模型发布 `ontology-knowledge-discovery-v1`：`discovery -> {initial_state,keys}`、`expand(state,items) -> {new_state,keys}`、`build_knowledge_graph(state) -> {graph,vocabulary}`。插件仅处理通用路径、批量队列与去重；规范地址、Group 哈希、节点展开及事实合并在模型 jq 中。

插件只接受新发布，不支持旧完整 v4 发布、运行期 discovery/info 回退或旧 Service metadata 来源。最终图仍使用 v4 结构；完整导出仅作为等价性基线。类型闭包去重算法未修改。

## IC 测量

同一 IC 源码与编译器，隔离构建，单次观测（非统计基准）：

| 指标 | 完整图构建期导出 | 紧凑描述 + 模型 jq |
| --- | ---: | ---: |
| 构建期准备 | 36.495 s | 14.257 s |
| 完整构建 | 49.131 s | 26.709 s |
| Wasm | 14,563,000 B | 13,263,077 B |
| P2 信息 | 2,822,058 B | 1,528,085 B |

插件首次采集 1.978 s、导航派生 0.237 s、词表渲染 0.010 s，共约 2.236 s。模型产生 4558 条事实和 4558 条词条。以上采集成本发生于插件首次知识加载，不是 transform 初始化。

图按稳定地址、value 和引用集合逐项等价；允许事实排序及引用重复／顺序差异。IC 覆盖 50 Dataset、90 domain 绑定、64 sample 绑定、106 relation、11 alternative 和 2 business link。模型事实与旧制品基线也逐项一致。

## 回归

- relation：83 条事实等价，准备 0.572 → 0.331 s。
- JS 组合样本：103 条事实等价，涵盖 Identity／Numeric／Transfer Group，Column／Seconds／Ipv4／UtcBucket／Rate／Identity 表达式，以及关系、业务链接、样本和业务域。
- inline 类型：88 条事实等价，含 Bool、嵌套容器和具名枚举。
- 共享 Numeric Group：90 条事实，两个独立绑定指向同一 Group；full/runtime 发布和 transform 一致。
- 插件完整 typecheck/test 通过；新 IC 制品和只读 SQLite 的隔离 smoke 96/96。
- IC 50 Dataset transform／SQLite 回归及结果列、limit 回归通过。
- jaq 纯引擎、SHA256 已知向量、批次 1/128、动态发现、最终词表、外部说明、坏路径／程序／词表、超时及中止边界通过。
- 缺少新发布或传入旧完整 v4 会拒绝，且不会调用 runner；旧 metadata 段不提供知识。

## 复现

```sh
python3 scripts/embed-knowledge-program.py --check
python3 scripts/check-programmed-knowledge.py relation_model
python3 scripts/check-programmed-knowledge.py icloud_model
python3 scripts/check-feature-knowledge.py
python3 scripts/check-inline-type-knowledge.py
python3 scripts/check-initialization-knowledge.py
```

插件测试须以新协议制品配置 `OKS_WORKSPACE` 后运行 `pnpm run check`。采集默认批量 128、总预算 60 s、单次 jq 最长 10 s、单次输出 64 MiB，最多 100000 keys／10000 轮；超预算直接失败。

本轮未合入、未部署，10923／10924 未变更。早期 JS 性能原型记录位于 `experiments/knowledge-discovery/README.md`，与正式实现测量分别记录。
