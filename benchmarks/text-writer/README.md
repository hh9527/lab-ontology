# 内部文本 writer / Fmt 融合探索

分支实验，不合入、不部署。本轮没有修改 Display 语言接口。

## 实现

- RT 的 `finish_text` 发布已完成的 Rust writer 输出；JSON 不再经过另一个 Rust String。
  Fmt 和 JSON 共用最终发布 helper，仍需向托管文本复制一次，不是零复制。
- 默认关闭的 `TELORA_EXPERIMENTAL_TEXT_WRITER=1` 消除立即消费的标准标量 Fmt：
  标准 String/Int/Float 的 Display 插值，以及 `fmt::render(fmt::from_*(value))`。
- 通过 sealed trait 实现和 native 叶子检查确认身份，保留 callee 求值/初始化检查。
  自定义或混合 Display 回退整段插值原路径；已共享、保存或参与相等性比较的 Fmt 不改写。
- 内部直接向同一个 RT Rust String 写入标量，没有公开 StringMut。
  尚未融合 `codec::encode → Value → json::stringify`，也没有实现通用 Fmt region lowering。

## 微基准

每格 3 个新 Session 的冷 invoke 中位数；编译、加载、初始化、输入导入及输出导出不计时。
自动 GC 关闭，完成后 pin 结果并显式 GC 校验完整文本。上限 8192 项，非业务稳态吞吐。

| 8192 项负载 | 原实现 ms | 标量直写 ms | fuel 变化 |
| --- | --- | --- | --- |
| json_int | 34.72 | 37.13 | +0.53% |
| json_pretty | 35.82 | 37.40 | +0.52% |
| json_string | 70.43 | 70.65 | +0.27% |
| fmt_int | 1146.82 | 1131.74 | +0.00% |
| interpolate_int | 1291.85 | 158.21 | -92.41% |
| render_int | 1295.60 | 124.58 | -94.21% |

JSON 少一次复制尚未表现出稳定收益；fuel 还略有增加，不据此宣称加速。
累计托管分配不统计 Rust writer 的隐藏分配，不能用该指标证明省去这份内存。

**放大因素**：RT `tables::telora_table_push` 每次从 0 扫描第一个空槽。
无 GC 时创建 N 个 Fmt 的槽位搜索近似 O(N²)。标量直写同时绕过这一成本，
因此约 8～10 倍的微基准提升不是“纯 StringMut 写入”收益，也不能直接外推应用。
保留的 `fmt_int` 完整 Fmt 图负载基本未改善，明确显示当前融合覆盖面的边界。
资源表问题独立记录，本轮没有混入修复，以免归因不清。

## 应用

两变体使用同一新编译器，全部 ontology 源逐字节相同，知识发布 JSON 完整一致。
此表只衡量标量 Fmt 融合；JSON 完成 helper 改动已经同时存在于两侧。

| 模型 | 准备：关 → 开 | fuel 降幅 | 累计托管分配降幅 |
| --- | --- | --- | --- |
| icloud_model | 11.28 → 11.31 s | 0.50% | 0.33% |
| ns_model | 36.31 → 35.89 s | 0.70% | 0.27% |

应用单样本没有显示明显准备加速。IC 17 组时间/SQLite/非法输入与 NS 151 Dataset、302 Relation、
48 类样本、canonical domain/非法输入检查通过。开启优化的后端回归 201 passed / 5 ignored，
过滤既有 main 失败 `guest_memory_growth_failure_is_distinct_from_managed_budget_exhaustion`。
新增用例覆盖自定义 Display、共享 Fmt、操作图相等性、负零、Unicode、GC、调试顺序、首次失败。
最后收紧 eligibility 的 native/无额外绑定检查后，微基准的 fuel/分配与此前完全一致。

## 沿 Fmt 累加器继续推进的图景

用户提出 `fn fmt(self, f: Fmt) -> Fmt`：将 Fmt 当作普通不可变容器，
格式化显式传递累加器；最终只 render 一次。

```text
f0 = fmt::empty()
f1 = append_text(f0, "value=")
f2 = Display::fmt(value, f1)
result = fmt::render(f2)
```

编译器若证明中间 Fmt 线性消费、没有旧版本观察，就可 lowering 为单个内部 StringMut。
旧版本保留、分叉、比较或未知调用要保留不可变结构/复制，不能因方法名叫 fmt 就假设独占。
接口本身不证明线性：自定义 fmt 可以忽略 f、返回旧值、共享或比较 f，分析仍须覆盖这些情况。

追加文本/整数/浮点应直接贡献 token 或字节，避免先构造临时 Fmt 再 concat。
不能简单用旧 concat 包装连续追加：这会产生深链，并触发现有 128 层渲染上限。
新容器需要明确追加表示、迭代遍历、共享与相等性边界；本轮原型未改变现有 Fmt 语义。

## 复现

Telora 当前实验分支，隔离 target：

```sh
TELORA_EXPERIMENTAL_TEXT_WRITER=1 TELORA_TEXT_WRITER_REPORT=/tmp/text-writer.json CARGO_TARGET_DIR=/tmp/text-writer-target cargo test --release -p telora-wasm measure_text_writer_paths -- --ignored --nocapture
```

不设融合开关得到 JSON-finish 控制版本；旧 RT 数据来自 e83351de + 同一基准文件。
应用：先构建 CLI，再在 lab-ontology 执行：

```sh
python3 scripts/measure-mut-ceiling.py --telora /path/to/telora --variants baseline text-writer --output /tmp/text-writer-apps-new
```


## 后续：不可变 Fmt 累加器（Telora 8c9acb52）

本节是后续实验，前文“未改变 Display 接口”仅描述上一轮原型。

Display 改为 `fmt: Fn(Self, Fmt) -> Fmt`，DisplayBy、插值与 codec 桥接同步迁移。
语言 API 是不可变 `Fmt` 与 `write_str/write_int/write_float/write_fmt`、
`encode_json_string/encode_json_float`；`to_string(value)` 从空 Fmt 开始并在末端 render。
旧值可复用、分叉、比较；追加链迭代渲染，2048 次追加及比较已验收。
JSON 字符串写完整字面量，与 json::stringify 共用转义 primitive。

默认关闭的 `TELORA_EXPERIMENTAL_TEXT_WRITER=1` 新增以 empty 为根、直接交给 render
的简单写入链融合，并适配新签名及泛型 to_string 的标准 Display 证据。
任意绑定、fold、自定义 Display 整段融合尚未实现；不公开可变缓冲区。
codec→Value→JSON 仍未融合，不能把 json::stringify 的后续潜力称为已有收益。

同一测试二进制，默认/融合顺序运行，2048 项，每项三个新 Session 的 invoke 中位数：

| 负载 | 默认 ms | 融合 ms | fuel 降幅 | 累计托管分配降幅 |
| --- | --- | --- | --- | --- |
| write_int 后 render | 143.87 | 47.27 | 76.92% | 43.57% |
| 三步 write 链后 render | 720.72 | 62.27 | 95.04% | 50.94% |
| 标准整数 to_string | 160.49 | 47.58 | 77.30% | 43.57% |
| 整数插值 | 160.87 | 55.89 | 74.89% | 32.87% |

自动 GC 关闭；编译、加载、初始化、导入/导出不计时，结束后 pin 并显式 GC 校验完整结果。
其中包含绕过 Fmt 资源表近似 O(N²) 扫描的收益，不能视为纯缓冲追加的倍数。
累计托管分配不包含内部 Rust String 分配，也不等于峰值 RSS。

原始样本：[accumulator-micro-results.json](accumulator-micro-results.json)。复现可设置
`TELORA_TEXT_WRITER_CASES=write_int,write_chain,to_string,interpolate_int`
和 `TELORA_TEXT_WRITER_COUNTS=2048`，沿用前述 ignored 测试命令，分别关闭/打开融合。

验收：core 211；默认/融合 Wasm 各 206 passed、5 ignored，仍过滤已确认的 main
内存增长用例；默认/融合语言验收各 441 cases。覆盖旧版本与分叉、长链比较、JSON 转义、
负零、强制 GC、构建快照、原生非有限 Float 防御与首次失败/调试顺序。
原生 Float 成功路径的逻辑地址读取错误已由独立复现修复，完整双模式回归通过。


最终提交复测的 fuel/累计托管分配逐样本与上表测量完全相同；复测时间与测试二进制
SHA-256 同时保存在 micro 报告的 certifiedDefault/certifiedFused 中。

最终 CLI 的 IC/NS 顺序构建各一次；两种变体 ontology 源码逐字节相同，完整知识 JSON
包含数组顺序在内一致；与上一轮旧 Display API 的完整发布信息也相同：

| 模型 | 准备：关 → 开 s | 总构建：关 → 开 s | fuel 降幅 | 累计托管分配降幅 |
| --- | --- | --- | --- | --- |
| icloud_model | 11.428 → 11.359 | 24.463 → 24.349 | 0.56% | 0.33% |
| ns_model | 36.732 → 36.544 | 57.155 → 56.916 | 0.82% | 0.27% |

不足以认定业务初始化有明显提速。NS 线性内存反而多 128 KiB，体现页分配的非单调性，
不能把累计分配下降等同于内存占用全面改善。相对上一轮旧 Display API，默认 IC/NS
制品分别增加约 261/262 KiB（十进制约 268 KB），fuel 增加约 0.24%/0.21%；
新签名本身是后续融合的接口基础，不是无条件的业务性能提升。

原始应用数据：[accumulator-application-results.json](accumulator-application-results.json)。
IC 17 组 SQL/时间窗口/非法输入；NS 151 Dataset、302 Relation、48 样本族、canonical domain
及非法输入验收通过。没有修改 ontology 或模型声明，没有合入或部署。
