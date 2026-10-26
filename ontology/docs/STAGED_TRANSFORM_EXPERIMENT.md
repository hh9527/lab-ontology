# 模型自检与 transform 准备

ontology 的默认声明构造器保留类型约束和自检需要的事实；`prepare/build` 只做 transform
必需的准备。模型使用现有 `model/groups/samples/values/relations/transform` API 即可获得该行为，
无需切换建模入口。发布前显式执行模型自检，运行期继续验证请求形状、名称、类型和操作权限。

当前已通过 `experimental::build::stage` 在构建期预计算准备结果，保留同次构建的 TypeId，并输出静态知识。当前验收见[构建期双路产出](../../evaluations/build-time-staging.md)。

下文保留自检分离及 Bool 传递的历史实验；其中大小、耗时和限制不代表当前实现。

## API

- `transform::prepare(revision, declarations, profile)`：准备无关系 payload
- `transform::build(revision, declarations, relations, alternatives, links, profile)`：同时准备关系与业务连接
- `transform::self_check(...)`：参数与 build 相同；执行完整模型校验，成功返回 Bool `True`，失败通过诊断拒绝
- `checked_*`：显式严格构造或准备，供需要立即诊断的调用方使用；既有负向诊断测试显式采用该入口
- `groups::validate_facts`、`samples/values::validate_bindings`：显式检查对应的擦除后事实

`experimental::staged` 是早期生成实验的兼容别名，转发到默认 API；没有独立的构造或 lowering 实现。
它的 `self_check` 检查无关系声明，`self_check_root` 检查完整 root。

支持 Entity／Event／Metric、可空字段与身份映射、维度／度量组、采样统计、业务域、物理列映射、
行范围、字段／过滤／计算计数、native pair、关系、备选关系和业务连接。
声明保留组能力、成员完整性及维度／采样类型见证，供自检检查。
初始化仍执行必要的编码、字段索引解析、成员展开和关系 lowering；缺少生成必需数据时仍可能失败。

校验模式是 ontology 内部显式参数，默认入口关闭模型校验，自检入口打开。
共享函数中的校验分支可能仍存在于运行期 wasm；移除自检路由不等于彻底裁剪所有校验代码。

## JS 生成样本

```sh
node scripts/generate-staged-feature-samples.mjs --copies 1
node scripts/check-staged-feature-samples.mjs /path/to/generated-workspace
node scripts/check-staged-feature-self-check.mjs /path/to/generated-workspace
```

每份组合含 Entity、Metric、Event 和关系记录，共 4 个 Dataset。生成的模型全部直接使用默认 API，
验收脚本检查源码没有依赖 staged 入口。`baseline` 只在 root 显式使用 `checked_build`，
`staged` 提供单独自检方法，`runtime` 仅公开 transform。

每份组合对照 12 个合法查询的 SQL、绑定值及结果列，覆盖身份、业务域、IPv4、单位换算与速率、
数值聚合、Latest、时间分桶、字段／过滤／计算计数、关系与业务连接。
另有 11 类非法请求，覆盖未知名称、错误类型、非法域成员、无效时间、越权操作和批次原子拒绝。

11 类模型反例要求先构建成功，再由显式自检拒绝：重复采样统计、域编码重叠、关系端点来源冲突、
缺失统计成员、非 UTC 时钟、物理列冲突、计数依赖环、重复关系、维度／采样类型见证错误及非法关系条件。
构建记录和测量结果保存在临时工作区。`--skip-build` 复用已有制品和日志，仅重新检查请求行为。

2026-10-24 的默认入口样本（4 个 Dataset，单轮顺序构建）通过 12 个合法查询、11 类非法请求及显式自检。
root 严格检查的准备耗时为 0.575 秒，默认准备为 0.113 秒。
这个基线只对照 root 校验，没有把逐构造器重复校验算入基线。

规模样本工具保留普通／共享／独立 newtype 以及维度宽度等参数：

```sh
node scripts/generate-dataset-scale-samples.mjs --counts 5 --dimensions 2,40,80,160 --staged
node scripts/check-staged-dataset-samples.mjs \
  --baseline /path/to/reference.wasm --staged /path/to/generated.wasm --count 5 --dimensions 80
node scripts/check-staged-model-self-check.mjs /path/to/generated-workspace
```

`--staged` 在生成服务中提供显式自检方法，`--runtime-only` 移除该方法；默认构造器均采用新的准备行为。
`--field-types plain|shared|distinct` 控制 newtype 共享方式，`--value-fields N` 固定记录字段宽度。
发布前必须自检同一组声明，不能把缺少自检路由当作已验证的证明。

## 未修改 IC 模型的实测

```sh
python3 scripts/build-model-preparation-sample.py icloud_model
python3 scripts/build-model-preparation-sample.py icloud_model --self-check
node scripts/check-typed-icloud-service.mjs /path/to/icloud_model.wasm
```

脚本将 ontology 与模型复制到隔离临时工作区，保持模型源码不变，并核对源码 SHA256。
`--self-check` 只在隔离库的 build 包装器中先调用 `transform::self_check`，再执行正常准备，
用于验证同一份未修改模型的完整 root；不向 IC 服务添加接口。
该模式属于自检驱动，不是运行期的默认构建路径。

2026-10-24，使用相同本地 Telora 编译器，初始化 fuel 400000、请求 fuel 100000、内存上限 2048 MiB。
下表是旧严格路径已有测量与当前默认路径单轮测量，大小为十进制 MB。

| 指标 | 旧严格路径 | 默认必要准备 |
|---|---:|---:|
| wasm 大小 | 65.549 MB | 51.180 MB |
| 运行期制品构建总耗时 | 168.750 秒 | 14.963 秒 |
| service_prepare | 157.538 秒 | 4.394 秒 |
| frontend | 7.614 秒 | 7.650 秒 |
| codegen_link | 2.283 秒 | 1.787 秒 |
| load_module | 0.450 秒 | 0.349 秒 |

模型源码 SHA256 为 `3585e76b01a6319b1496fdf058b93f2f875fca34a3423ecaf9dc093bb4800b79`。
源码哈希涵盖 IC src 树；普通制品与显式自检使用相同模型源码。
普通制品为 51,180,285 字节，已有严格路径参考制品为 65,548,819 字节，减少约 21.9%。
大小变化包含构造依赖和快照数据的变化，不能全部归因于删除自检函数。

独立自检构建通过，本轮总耗时约 155.456 秒，其中准备阶段含显式模型检查约 144.890 秒。
自检运行时同时存在其他验收负载，此耗时只作为校验成本记录。
校验成本被分离，并未消失；同时执行自检与运行期制品构建的完整发布成本不能按 14.963 秒计算。
没有预计算 transform 初始化结果。

IC 的运行期制品通过全部 50 Dataset 的公开投影和实际 SQLite 执行；有数据检查覆盖行数限制、
规范值／IPv4 过滤、过滤与组合计数、Latest 的 NULL 与均值语义、GraphPair、GraphUnion、确定性和混合批次拒绝。
本阶段没有运行知识发现或知识测试，没有修改模型源码、demo 配置、模型文件或数据库。

## 构建值 Bool 的独立链路实验

以下工具保留最小 Bool 链路的实验能力，单独评价传递机制：

```sh
node scripts/generate-dataset-scale-samples.mjs --counts 5 --dimensions 2 --staged
node scripts/generate-dataset-scale-samples.mjs --counts 5 --dimensions 2 \
  --staged --runtime-only --verification-input
node scripts/build-verified-service.mjs \
  --verification /path/to/scale_5_staged \
  --runtime /path/to/scale_5_staged_runtime_verified --output /path/to/new-model.wasm
node scripts/run-verified-service.mjs /path/to/new-model.wasm < /path/to/request.json
node scripts/check-service-build-value.mjs /path/to/new-model.wasm /path/to/new-model.wasm.verification.wasm
node scripts/check-service-build-gate.mjs /path/to/scale_5_staged /path/to/scale_5_staged_runtime_verified
```

构建期自检必须返回 true，才构建运行期变体并将 Bool 及声明、依赖、编译器和制品哈希写入自定义段。
host 校验段与制品哈希，将 Bool 作为 Service source 注入初始化。缺少／错误类型／false 输入会拒绝。
自检失败、声明或依赖不一致时不生成运行期制品。输出路径必须全新，保留两阶段对照制品。
最小样本元数据增加 535 字节。

这是实验性 `experiment.service-build-value` 段与 host 适配脚本，未修改 Telora core。
A/B 从相同模型声明分别编译，尚未实现同一二进制裁剪；哈希用于绑定产物，不是签名认证。
当前仅传递内建 Bool，没有通用对象图恢复或跨构建 TypeId 一致性证明。
