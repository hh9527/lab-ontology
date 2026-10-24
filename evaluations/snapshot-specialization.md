# M → A → A.result → B 实验

日期：2026-10-24

Telora 分支 `explore/snapshot-specialization` 提供 `build --snapshot`（等价于 `--snapshot=runtime`），`--snapshot=full` 用于完整快照对照。同一次构建先保守生成和初始化 Service，再直接用本次初始化结果专门化运行期代码。结果不经外部缓存或用户编辑，不引入签名、模型指纹或重复校验流程。

## 实现边界

- A.result 使用已有 Service snapshot，保留闭包、封闭类型布局和 TypeId
- 从运行期 handler、闭包环境、可达全局值及请求 materializer 出发，保留运行期状态
- 函数调用、函数指针及全局读取依赖由链接器 relocation 提供，覆盖生成的 codec 和静态数据模块
- 已 Ready 的 demand 替换为读取准备结果的 getter，停止保留原计算依赖
- 不可达的生成函数体替换为 trap stub，保持函数表、类型、堆引用和数据布局编号不变
- 完整 RT、启动 bootstrap 和静态类型镜像仍保留；这一步尚未压缩函数索引或静态数据
- 模型自检可以在 A 中执行；运行期输入校验保留在 B 中

普通 snapshot 与专门化 snapshot 都在构建时完成初始化，比较衡量的是进一步专门化的收益。

## 复现

```sh
python3 scripts/check-snapshot-specialization.py \
  --telora /path/to/experimental/telora \
  --runner /path/to/telora-run \
  --counts 5,20,40
```

脚本调用现有 JS 生成器创建独立 newtype 的 Dataset 样本，在同一来源上分别构建普通 snapshot 和 B，并比较正确请求、重复请求、错误形状、未知 Dataset 和未知路由的完整响应。`--self-check` 将模型自检加入准备计算，两个变体使用相同源码。所有文件放在新建临时工作区，不覆盖既有模型或二进制。

## 实测结果

下表大小使用十进制 MB，构建时间是单次观测，不作为统计性能结论。

| Dataset 数 | 普通 snapshot | B | 缩减 | B 保留的生成函数 | B 中 getter |
| --- | --- | --- | --- | --- | --- |
| 5 | 10.73 MB | 8.44 MB | 21.35% | 2,634 | 895 |
| 20 | 12.22 MB | 8.66 MB | 29.13% | 2,634 | 895 |
| 40 | 14.21 MB | 8.96 MB | 36.97% | 2,634 | 895 |

40 Dataset 的 code section 从 11,841,094 字节降至 6,629,918 字节，snapshot 从 447,667 字节降至 404,435 字节。静态 data section 仍为 1,902,454 字节。

5 Dataset 加入模型自检后，普通 snapshot 为 10,953,004 字节，B 为 8,439,947 字节；B 仍保留 2,634 个生成函数。相较不做自检的 B 只增加 4,192 字节，主要计算没有继续留在运行期路径中。

专门化阶段单次约 64–72 ms。完整保守生成及 A 的执行仍然存在，因此没有宣称构建提速。40 Dataset 的总构建单次为 5.04 s → 5.11 s。

40 Dataset 各启动 3 个独立进程，观测中位数：模块加载 117.68 ms → 68.73 ms，snapshot 初始化 41.24 ms → 31.58 ms，首次请求 163.15 ms → 156.70 ms。各进程分项合计的中位数为 335.96 ms → 267.06 ms；不包括进程创建成本，也不是 IC 的测量。

## 验证与记录

Telora 验证：150 个 Wasm 测试和 98 个 CLI 测试通过。CLI 覆盖普通与专门化制品的路由、源文件删除后的外部数据恢复、跨阶段类型身份、运行期构造检查，以及 A 失败时不发布 B。HTTP 测试因沙箱禁止绑定回环端口，单独在允许本地端口的环境下通过。

实验记录位于本次临时工作区：

- 5／20 Dataset：`~/.cache/tmp/dataset-scale-ADE9Vx/specialization-report.json`
- 40 Dataset：`~/.cache/tmp/dataset-scale-NGtB3Y/specialization-report.json`
- 40 Dataset 的段分布和冷启动记录：同目录 `section-sizes.json`、`cold-response-bench.json`
- 带自检的 5 Dataset：`~/.cache/tmp/dataset-scale-Rzc2B4/specialization-report.json`

这轮规模样本没有改动 IC 或更新仓库二进制；后续对未修改 IC 的构建与验收见 [IC 实测](ic-snapshot-specialization.md)。工作分支按阶段提交、推送，保持未合入。


## 正式接口验收

`--snapshot` 默认 runtime，`--snapshot=full` 为完整快照对照。编译器内以类型化 ServiceBuild 绑定 A 与 B；RT 一次性返回快照、函数槽位与 Ready demand 索引，不缓存全局摘要，Host 不解析快照内部布局。

正式接口的 5／20／40 Dataset 样本再次通过，每个变体比较 7 个完整响应。制品分别为 10,730,231 → 8,439,699、12,224,425 → 8,664,768、14,218,262 → 8,963,854 字节，均保留 2,634 个函数体和 895 个 getter。记录位于 `~/.cache/tmp/dataset-scale-HOb6vR/specialization-report.json`。随后的 Service ABI 根收紧及统计调整通过 IC 和编译器回归验收，当前 IC 数字见下述记录。

编译器验收包括 151 项 Wasm 回归和 100 项 CLI 回归（HTTP 项单独在允许回环端口的环境下运行），以及最后一次计时与 snapshot 聚焦复核。新增覆盖强制 GC、递归闭包、运行期 Property required／optional、Type 身份、构造检查、fuel／memory trap 恢复，以及初始化或保守 provider 失败时保留旧制品。

ontology 声明适配另通过 4 项正向证据测试、3 项编译期拒绝、102 项关系 graph 回归和 6 组 SQLite 查询对照。不运行知识发现测试。
