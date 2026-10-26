# IC 的初始化结果专门化实测

日期：2026-10-24

使用 Telora 本地分支 `explore/snapshot-specialization` 的同一实验二进制，对当前 IC 的 50 Dataset 模型分别构建普通 snapshot 与专门化 B。IC 源码未修改，模型源码指纹均为 `3585e76b01a6319b1496fdf058b93f2f875fca34a3423ecaf9dc093bb4800b79`。

两者都在构建时完成 transform 准备。本次没有加入耗时的完整模型自检，也没有初始化知识发现或发送知识请求；比较的是普通 snapshot 与消费同次初始化结果后派生的 B。

## 大小与代码

| 项目 | 普通 snapshot | B |
| --- | --- | --- |
| 文件大小 | 43,419,922 B | 11,524,730 B |
| code section | 37,184,898 B | 6,737,299 B |
| snapshot section | 3,189,610 B | 1,742,018 B |
| static data section | 2,993,447 B | 2,993,447 B |
| 保留的生成函数体，含 getter | 15,471 | 2,634 |
| 替换为准备结果 getter 的函数 | 0 | 895 |

文件缩减 31,895,192 字节，即 73.46%。B 保留的生成函数体数量与 5／20／40 Dataset 样本一致，支持“具体模型的声明计算主要可以在 A 中完成，B 通过数据消费这些差异”的判断。

当前实现保留函数签名、表槽位、完整 RT、bootstrap 和静态镜像；不可达的生成函数体替换为 trap stub。上述函数数量排除了这些 stub，没有重排函数表或 TypeId。

## 构建耗时

同一机器顺序构建，每个变体各一次，单位为秒。单次波动不能作为构建提速的证据。

| 阶段 | 普通 snapshot | B |
| --- | --- | --- |
| 前端，含类型检查 | 7.778 | 7.746 |
| 代码生成与链接 | 2.667 | 2.659 |
| 构建时加载引擎与模块 | 0.353 | 0.352 |
| transform 准备，service_prepare | 4.302 | 4.280 |
| service_seal | 0.290 | 0.121 |
| 专门化 | — | 0.084 |
| 总构建 | 15.774 | 15.491 |

专门化属于 snapshot 阶段，表格未另外累加 snapshot 父阶段。完整 A 的生成和执行仍然存在，当前没有避免前端、完整代码生成或约 4.3 秒的 transform 准备成本。

## 冷启动与请求

查询为 `device` 的 `device_id`、`device_name` 投影，`limit = 2`。各变体交替启动 3 个独立进程，取中位数；冷启动指新引擎和实例，不代表清空操作系统文件缓存。

| 阶段 | 普通 snapshot | B |
| --- | --- | --- |
| 读取制品 | 27.92 ms | 7.14 ms |
| 模块加载 | 347.01 ms | 75.71 ms |
| snapshot 恢复与初始化 | 263.91 ms | 119.32 ms |
| 首次 transform 请求本身 | 313.92 ms | 168.84 ms |
| 冷启动分项合计 | 962.73 ms | 378.26 ms |
| 进程内第三次请求 | 12.08 ms | 10.81 ms |

冷启动分项合计按每个进程的 read、metadata、module、instance、initialize、reset、request 相加后取中位数，因此不等于各分项中位数直接相加，也不包含进程创建成本。冷启动分项合计减少约 60.7%。

后续请求另启动 3 个进程，每个连续请求 3 次，读取第三次的 request_ms；没有把首次请求的 JIT/延迟编译成本算入后续请求。小样本测量说明后续请求没有明显退化，不据此断言稳定的 10% 吞吐收益。

## 验收

两个制品均通过 `check-typed-icloud-service.mjs`：50 Dataset 投影 SQL 的 SQLite 执行，以及填充样本后的 limit、canonical filter、IPv4、过滤计数、计算计数、Latest、GraphPair、GraphUnion、确定性重复请求和混合批次原子拒绝。性能测试中的完整响应也在两制品之间逐次比较一致。

## 复现与产物

```sh
python3 scripts/build-model-preparation-sample.py icloud_model --telora /path/to/experimental/telora --snapshot full
python3 scripts/build-model-preparation-sample.py icloud_model --telora /path/to/experimental/telora --snapshot runtime
node scripts/check-typed-icloud-service.mjs /path/to/icloud_model.wasm /path/to/telora-run
```

- 普通 snapshot 工作区：`~/.cache/tmp/model-preparation-xjvv8n5m`
- B 工作区：`~/.cache/tmp/model-preparation-uj5nwrsa`
- 两目录各有 `icloud_model.wasm`、`build.log`、`measurement.json`
- B 目录另有 `comparison.json`、`transform-bench.json`、`measure-transform.py`

没有覆盖仓库二进制或已有模型，没有部署或重启服务。工作分支按阶段提交、推送，保持未合入。


## 正式接口整改后的验收

本轮使用 `--snapshot=full` 与 `--snapshot=runtime` 重新构建同一份 IC 源码，模型源码指纹仍为上述值。两种制品均再次通过完整的 50 Dataset transform／SQLite 验收，没有执行知识发现或完整模型自检。

| 项目 | full | runtime |
| --- | --- | --- |
| 文件大小 | 43,423,939 B | 11,528,748 B |
| code section | 37,188,770 B | 6,741,172 B |
| snapshot section | 3,189,610 B | 1,742,018 B |
| static data section | 2,993,651 B | 2,993,651 B |
| 生成函数总数 | 15,471 | 15,471 个原槽位 |
| 非 stub 函数体 | 15,471 | 2,634 |
| getter／stub | 0／0 | 895／12,837 |

文件缩减 73.45%。两制品的 type、function、table、element、data 段逐字节一致；运行期代码身份保持原编号。两者均无 tooling、临时依赖元数据或函数名称段。专门化统计的 code bytes 指函数体字节，不含 code section 的计数及函数体长度编码；snapshot bytes 指 Guest 快照，不含外层制品封装。

runtime 构建单次约 15.61 s：前端（含类型检查）7.96 s，代码生成与链接 2.52 s，构建时引擎加载 0.36 s，Service 准备 4.32 s，封存 0.14 s，B 专门化 0.084 s。本轮构建为集成验收观测，期间另有验收进程，不用于判断构建速度差异。完整 A 仍需生成并执行。

构建与功能验收完成后，交替运行各 3 个独立进程，得到冷启动分项合计中位数 959.34 → 376.84 ms；其中模块加载 347.86 → 75.78 ms，初始化 260.01 → 117.76 ms，首次请求本身 314.55 → 167.76 ms。另起各 3 个进程、每进程连续 3 次请求，第三次请求中位数 11.59 → 11.00 ms。测量口径与上文一致，完整响应逐次比较相同，不据此断言吞吐提升。

本轮正式接口产物：

- full：`~/.cache/tmp/model-preparation-5z1vvo9p/icloud_model.wasm`
- runtime：`~/.cache/tmp/model-preparation-01o66mwh/icloud_model.wasm`
- 两目录均含 `build.log`、`measurement.json`；runtime 目录另含 `comparison.json`、`transform-bench.json`

本轮完成了类型绑定、单次 RT 依赖导出、正式 CLI、结构化统计、失败与恢复测试和实际模型验收。A 范围收缩涉及 provider 调度及间接调用的独立语义决策，本轮保持保守初始化；不将 B 裁剪前移描述为已消除 A 生成成本。两仓库工作分支提交、推送，保持未合入。
