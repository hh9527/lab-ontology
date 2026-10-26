# 独立构建期双路产出验收

## 表达与实现

`std::build::stage(prepare, program)` 在显式构建期作用域执行 A，返回
`Output(P1) {runtime: P1, information: Dict(Value)}`，再由 `program(P1)` 装配 B。
通用根、封存、闭包可达性及构建信息不依赖 Service。P2 编码为 JSON 后保存到
`telora.build.information`；P1 在编译器内部保留类型与对象关系，不提供结果重导入入口。

ontology 的 `experimental::build::stage` 从同一个 Prepared 取 payload 和有限知识事实。
relation／IC 的顶层 lower 使用此入口；Service.init 只装配已准备的 lower。
插件读取新段、兼容旧段并派生反向 links，未新增运行期发现或模型自检。

## 验收结果

- Telora Wasm：154 项通过，包含无 Service 的普通函数构建／新实例恢复、P1 闭包及 newtype 类型信息保留、普通运行期拒绝 stage
- Telora：28 项单元与 104 项 CLI／语言回归通过，包含 staged full/runtime、拒绝运行期源及冲突参数、失败不覆盖原制品
- relation：full/runtime 的 92 个事实相同，共享 Group 两个 Binding，成功／拒绝／重复 transform 响应一致
- IC：50 Dataset SQL／空 SQLite／种子数据、canonical filters、IPv4、filtered/computed counts、Latest、GraphPair／GraphUnion、重复请求和混合批次拒绝通过
- dsh-oks：类型检查、完整测试通过，隔离 smoke 96/96；直接读取 IC 新段得到 4592 个事实及 13970 个派生 links，包含 29 Entity、50 Dataset、396 DimensionGroup、27 MeasureGroup、367 Type、106 Relation
- 新段损坏、同名重复及新旧段同时提供 ontology.knowledge 均拒绝，即使知识内容相同

## 本机单次测量

| 制品 | 大小（十进制 MB） | 构建总耗时 | 构建期准备 |
| --- | ---: | ---: | ---: |
| relation runtime | 8.64 | 5.22 秒 | 0.54 秒 |
| IC runtime | 14.66 | 52.92 秒 | 40.57 秒 |

最终 IC：14662283 bytes，代码段 6734197 bytes，snapshot 1747549 bytes。
16042 个生成函数中保留 2631 个，13411 个函数体被替换为 trap stub，893 个 Ready getter。
与之前知识发布 runtime 16.03 MB 的记录相比，本轮尺寸更小；不是严格隔离变量的性能对比。
构建期知识计算仍是主要成本，本轮没有完成这一算法的性能优化。

一次新进程连续执行三次 device count：读文件 9.70 ms，元数据 1.72 ms，模块加载
79.55 ms，实例化 6.37 ms，状态恢复 116.89 ms，三次请求分别为
161.82／7.91／7.80 ms。此为单次观测，不作为统计性性能承诺。

## 复现

```sh
python3 scripts/build-model-preparation-sample.py icloud_model --telora <experimental-telora>
python3 scripts/check-initialization-knowledge.py --telora <experimental-telora> --runner <experimental-telora-run>
node scripts/check-typed-icloud-service.mjs <artifact.wasm> <experimental-telora-run>
```

构建脚本默认使用 `--staged=runtime`；`--mode full` 用于完整状态对照。
旧测量参数 `--snapshot full` 保留为模式别名，但执行的仍是新 staged 构建。
普通函数首版使用 Rust StagedBuild／staged_build::load API，保留 tooling manifest，
不直接交给 telora-run。普通函数 API 暂不支持 data module，Service 适配允许显式打包的
构建输入。10923／10924 配置和部署二进制均未修改。
