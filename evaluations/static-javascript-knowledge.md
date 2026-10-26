# 静态 JS 与模型 JSON 知识构图验收

## 实现

`ontology-knowledge-javascript-v1` 同时携带固定 JS 和 `{revision,instructions}` JSON。模型标注仅派生 JSON，program 对不同模型完全一致；插件 JSON.parse 后用 `new Function("data", program)` 物化函数并传入 data，得到 `{graph,vocabulary}`。

静态程序使用 Map／Set 和原地合并，不修改输入；插件验证事实与词条并派生导航和反向链接。只消费本协议，模型运行期不提供知识发现。用于旧 jq 方案的运行时 SHA256 扩展与依赖已撤除，哈希由静态程序实现。

## IC 构建

同一编译器、模型和隔离目录，完整图参考导出与新发布各真实构建一次。单次观测不作为统计基准。

| 指标 | 完整图参考导出 | 静态 JS + JSON |
| --- | ---: | ---: |
| 构建期准备 | 36.428 s | 14.352 s |
| 总构建 | 49.023 s | 26.903 s |
| Wasm | 14,563,496 B | 13,277,253 B |
| P2 信息 envelope | 2,822,058 B | 1,541,567 B |

新构建分布：

| 阶段 | 耗时 |
| --- | ---: |
| 前端，含类型检查 | 8.974 s |
| 代码生成与链接 | 2.696 s |
| 数据打包 | 0.166 s |
| 加载构建期 Wasm | 0.371 s |
| transform 状态与知识 JSON 准备 | 14.352 s |
| 运行状态初始化 | 0.0008 s |
| 状态封存 | 0.146 s |
| 运行期制品生成 | 0.147 s |
| 写出制品 | 0.040 s |

总计 26.903 s，另有少量阶段间开销。运行期制品生成包含约 0.085 s 特化，不重复相加。类型闭包原数组去重算法未改；JS 构图发生在插件侧，不计入构建时间。

## 实际制品首次知识加载

从新 IC Wasm 读取 custom section，走正式插件执行与导航／词表代码；三个独立 Node 进程顺序测量，各阶段取中位数，不计 Node 启动和模块导入。

| 阶段 | 中位数 |
| --- | ---: |
| 读取 Wasm 并 JSON.parse 信息 | 20.72 ms |
| new Function 编译并构图 | 79.80 ms |
| 事实／词条验证与导航派生 | 226.19 ms |
| 词表渲染 | 9.92 ms |
| 总计 | 337.11 ms |

每列分别取中位数，和不必等于总计。4558 条模型事实、4558 条词条，词表文本 564924 B。源码 SHA256 为 `404b83ff915ee66a40df38758293efae84c37b0fa22ecd624c808a512dcc5e8b`。此前相同 JSON 的 jq 对照约 2.23 s，见历史实验；本次新制品体积和准备时间与此前紧凑 jq 发布接近，主要额外收益在插件构图。

## 验证

- IC 4558 条、relation 83 条、组合样本 103 条与完整导出逐项等价；IC graph／vocabulary 与外置实验结果一致
- 5／10／20／40 Dataset：285／565／1125／2245 条事实等价，跨模型 program 与静态资源逐字节一致
- Bool／嵌套容器／具名枚举 88 条事实，内置类型内联、具名类型引用保持
- 共享 Numeric Group 90 条事实，两个独立绑定；full/runtime 信息和 transform 响应相同
- 静态资源 SHA256 已知向量、Unicode／长字符串、URI 特殊字符、canonical JSON、空图、坏指令、`__proto__` 身份、输入不变及重复构图通过
- 插件完整 typecheck/test 在隔离副本通过，新 IC + SQLite smoke 96/96
- IC 50 Dataset SQL 投影、canonical／IPv4／filtered 与 computed count／Latest／GraphPair／GraphUnion、坏输入原子拒绝、结果列及 limit 回归通过
- 插件编译／执行／输出错误、旧协议拒绝、外部展示／词表渲染和不调用模型运行期知识路由通过
- 生成字符串漂移及 diff 格式检查通过

## 复现

```sh
python3 scripts/embed-knowledge-program.py --check
python3 scripts/check-programmed-knowledge.py relation_model
python3 scripts/check-programmed-knowledge.py icloud_model
python3 scripts/check-generated-knowledge.py
python3 scripts/check-feature-knowledge.py
python3 scripts/check-inline-type-knowledge.py --telora bin/telora
python3 scripts/check-initialization-knowledge.py --telora bin/telora --runner bin/telora-run
node --import ../dsh-oks/packages/dsh-oks/scripts/markdown-loader.mjs scripts/check-static-knowledge.mjs <publication.json> ...
node --import ../dsh-oks/packages/dsh-oks/scripts/markdown-loader.mjs scripts/measure-static-knowledge.mjs <model.wasm>
```

插件完整检查在隔离副本执行，`OKS_WORKSPACE` 指向新 IC 及只读数据库。10924 体验部署已通过，部署产物再次 smoke 96/96；过程和结果在 Issue #65 记录，10923 保持不变。
