# Spider `student_transcripts_tracking` 领域模型目标

开始任务时，参考 `goals/telora-context.md`，按当前需要阅读语言与工具资料；准备工作属于本次任务。

使用计划显式提供的 schema、SQLite 数据库和 modeling 用例，在 `spider_model/` 中建立一个
基于 `ontology` eDSL 的 EnterpriseKnowledge，并实现自然语言意图到参数化 SQL Query 的确定性入口。
当前 `spider_model/` 中的旧演唱会领域资产只是上一轮实验遗留；必须完整替换为学生成绩单跟踪领域，
不得保留 Singer、Concert 或 Stadium 词汇、示例和映射。

## 数据边界

- modeling 用例用于理解问法、领域语义和预期 SQL；它们可以进入测试。
- `spider-data-1/eval/` 是严格 held-out 的评测集，不得读取、搜索、推断或复制其中内容。
- 物理表列、Join 路径和 mapping 属于私有实现，不进入 Resolver 公共资料。
- `spider_model/docs/DOMAIN.md` 与 `spider_model/docs/INTENT.md` 是 Resolver 唯一可读的知识包，
  必须自包含，但不得包含 modeling/eval 题目、SQL、标准答案、物理 schema 或 Join 路径。
- `DOMAIN.md` 描述业务对象、领域词汇、概念关系、值域和统计口径。
- `INTENT.md` 完整定义 `spider-eval/input.json` 的 JSON 契约，包括字段、类型、枚举、过滤、
  聚合、排序和 Top N 语义，并给出不复用数据集问题的通用示例。

## make-query 协议

Host 提供固定适配器：

```bash
bin/spider-make-query check
```

Resolver 将符合 `INTENT.md` 的 JSON 写入 `spider-eval/input.json`。适配器调用
`@src/bin/make-query:main`，把 stdout 写入 `spider-eval/ok.json`，stderr 写入
`spider-eval/diagnostic.jsonl`，并显示 `exit code: N`。

成功时 `ok.json` 只包含：

```json
{"sql":"SELECT ... WHERE ... = ?","bindings":["value"]}
```

动态值只能进入 bindings；输入不得接受表名、列名、alias、Join、SQL 或表达式。失败时返回
非零退出码、清空 `ok.json`，并留下确定且可归因的诊断。不要修改 Host 适配器协议。

## 交付

交付 `docs/DOMAIN.md`、`docs/INTENT.md`、`src/model.telora`、
`src/bin/make-query.telora`、`tests/query.telora` 和 `telora-crate.json`。不得保留领域
`src/query.telora`：直接把 prepared payload 交给
`ontology/intent::query_intent_lower_factory`。真实业务差异必须表达为本体知识；公共封闭
Intent 缺少领域无关形状时，反馈 Foundation 缺口，不得补领域查询分支。测试至少覆盖各类合法
modeling 意图、未知词汇、类型错误、非法组合、参数绑定顺序和相同输入的确定性。
