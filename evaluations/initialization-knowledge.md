# 初始化知识事实发布实验

2026-10-24，RFC 0003／总跟踪 #64，所有改动保持工作分支，未合入或部署

## 当前结果

同一次 Prepared 同时提供 transform payload 与知识来源事实。Service 初始化发布 ontology.knowledge，最终 Wasm 的 telora.service.metadata 段保存静态 JSON；插件无需调用 discovery/info 即可收集新图，随后装配字典、校验引用闭合、补分类导航和反向链接。名称与说明可从独立的 knowledge-items.json 补充，不能修改模型事实或权限。

IC 发布 29 个 Entity、50 个 Dataset、396 个 DimensionGroup、27 个 MeasureGroup、367 个类型和 106 个关系。插件挂载自己的工具知识后共有 4592 个可寻址项。关系键使用稳定字段地址，保留 And／Or；角色、Binding、Group 与最终公开成员分别可寻址。类型使用名义名称／参数与结构描述，匿名结构及 Group 用规范描述的 SHA-256，不发布 TypeId。

小模型包含同一个 shared_numeric Group 对 load／capacity 的两次绑定。两个 Binding 地址不同，full/runtime 元数据与 transform 响应完全一致，错误输入拒绝保持一致。IC 的 full/runtime 元数据也完全一致；两种制品均通过 50 Dataset SQL 投影与 SQLite、canonical filter、IPv4、过滤／计算计数、Latest、GraphPair／GraphUnion、确定性重复请求及混合批次原子拒绝。知识图另行通过全部正向引用闭合和真实 jq overview/card/search/nodes 验收。

## 性能边界

这一版验证了链路，并未达到知识生成的性能目标。下表 MB 使用十进制，冷启动为 telora-run 各阶段耗时之和，不含进程创建与插件知识索引派生；每个进程连续发送同一 transform 三次，3 个进程的中位数，运行次序交替。SQL 和完整响应逐次一致。

| 制品 | 体积 | 构建墙钟 | 首次请求 | 冷启动合计 | 第三次请求 |
| --- | ---: | ---: | ---: | ---: | ---: |
| runtime，不发布知识 | 11.71 MB | 16.00 s | 167 ms | 369 ms | 8.50 ms |
| full，发布知识 | 47.52 MB | 55.21 s | 313 ms | 945 ms | 9.28 ms |
| runtime，发布知识 | 16.03 MB | 56.06 s | 212 ms | 470 ms | 8.67 ms |

开启知识后的 runtime 构建前端约 8.31 s，代码生成／链接约 2.67 s，transform 准备约 4.34 s，Service 初始化导出约 39.73 s。full 与 runtime 的生成成本基本相同；精简 B 不会省去 A 的知识生成。

知识元数据为 2,929,917 bytes。runtime 相对不发布知识还多保留约 0.84 MB code section、0.54 MB snapshot，不能声称知识生成辅助代码已全部从 B 消失。图没有被 handler 捕获，但仍有辅助代码／准备状态保留，需进一步检查依赖闭包。完整制品到 runtime 从 47.52 MB 降到 16.03 MB；相对不发布知识的基线，构建、体积和冷启动均有明确回退，后续请求未见明显变化。

已修正两个明显的导出器问题：逐项复制整个待处理类型队列、逐事实复制整个不可变字典。当前分别使用按层去重、平衡合并；仍需拆解类型身份计算、事实装配与序列化成本，不能把剩余约 40 s 归咎于模型准备。

## 复现与记录

使用 Telora explore/snapshot-specialization 的 416a39b1；实验二进制位于隔离 target，没有替换仓库 bin 或运行环境。IC 模型声明源码摘要为 471d27359dcc3785c493ee9ed85c024753639b13915629a32aca40ed26b43147。

```sh
python3 scripts/check-initialization-knowledge.py --telora <telora> --runner <telora-run>
python3 scripts/build-model-preparation-sample.py icloud_model --without-knowledge --telora <telora>
python3 scripts/build-model-preparation-sample.py icloud_model --snapshot full --telora <telora>
python3 scripts/build-model-preparation-sample.py icloud_model --telora <telora>
python3 scripts/benchmark-initialization-knowledge.py --runner <telora-run> --baseline <without-knowledge.wasm> --full <full.wasm> --runtime <runtime.wasm> --output <report.json>
node scripts/check-typed-icloud-service.mjs <model.wasm> <telora-run>
```

本轮最终 full 产物在 ~/.cache/tmp/model-preparation-xilwlir1，runtime 在 ~/.cache/tmp/model-preparation-ht1v8q8l；对应 build.log 与 measurement.json 保留。对照的原始运行报告在 /tmp/initialization-knowledge-final-benchmark.json。

Telora：152 项 Wasm 回归通过；反射边界修复后 5 项反射回归和 release CLI／语言验收 103 项通过。dsh-oks：类型检查、完整测试通过；其依赖模型／数据库的集成冒烟在隔离工作区、空 SQLite 和新 IC 上通过 96 项，未改运行配置。旧知识契约回归通过。
