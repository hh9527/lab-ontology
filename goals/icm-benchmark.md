# ICM Benchmark 目标

使用 Labflow 内置 `/bench` 流程，以 `icm/eval/questions.jsonl` 为问题全集、
`icm/eval/selected.jsonl` 为当前重点改进子集完成全部 selected Cases，并生成独立的
`benchmarks/icm-eval.sqlite`。`icm/eval/` 不存放报告或其它运行资料。不要自行安排题目顺序、
维护外部进度文件或手工拼装报告。

每个 Resolver Session 可连续测评默认 10 题。Resolver 只获得 `icm-model/docs/*` 的稳定、
自包含公开背景和 `make-query` 工具，不读取 `icm/**`；Broker 按 Case 将题目发给 Resolver，
并只在确有必要时依据该题私有 K 发起有限澄清。每批结果提交 stage 后必须删除 Resolver
Session，再开始下一批。

超时、工具诊断、不可表达、澄清耗尽和未作答均是合法测评结果。完成所有可执行批次后调用
`labflow bench finish` 封闭本次迭代并生成 SQLite Artifact，不为获得成功状态而协商或改写
结果。
