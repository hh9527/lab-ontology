# ICM 领域模型目标

使用 `icm/ao/` 的自包含知识，在 `icm-model/` 中建立一个基于 `ontology` eDSL 的 ICM
EnterpriseKnowledge。组织方式可参考旧 `ent-1`，但实体、关系、指标、维度、粒度和能力边界
必须从 ICM 材料独立建模。

## 私有模型与公共边界

- `icm/ao/schema/`、物理表列、Join 路径和 mapping 属于模型实现，不进入 Resolver 公共资料。
- `icm-model/docs/*` 是交付给 Resolver 的唯一公开背景知识包，必须自包含；交付后 Resolver
  不读取或依赖 `icm/**`。`icm/ao/` 仅是 icm-modeler 的私有建模输入；`icm/eval/` 包含完整测试集合
  `suite-1.jsonl` 和当前重点改进集合 `suite-1-b1.jsonl`。Benchmark 记录由 Labflow 管理在
  `.labflow/benchmarks/icm-eval.sqlite`，不属于模型 artifact。
- `icm-model/docs/DOMAIN.md` 表达业务对象、领域词汇、概念关系、分类、状态、值域、单位、
  时间语义和统计口径。可公开 measure/dimension ID 及其业务含义，但不写 CLI/SQL/bindings、
  物理 schema、Join 路径或实现细节。
- `icm-model/docs/INTENT.md` 是 Resolver 使用的完整公共输入契约。它必须准确说明 intent JSON
  的顶层结构、必填与可选字段、dimension/filter/measure/ordering 的结构、所有公开枚举的 JSON
  表示、值类型、操作符、分页与 Top N 语义，并提供与评测题无关的通用示例。Resolver 只依据
  `DOMAIN.md` 和 `INTENT.md` 就应能构造合法输入，不得依赖源码、测试或通过诊断猜测类型。
  `INTENT.md` 不得暴露物理 schema、Join 路径、SQL、bindings、隐藏知识或标准答案。
- 公共资料不得包含评测题、选择列表、隐藏知识 K、trap、标准答案或按题编号编写的提示。
- icm-modeler 不读取 Benchmark SQLite 报告。Host 负责汇总测评结论，并通过
  `feedbacks/icm-model.md` 提供改进重点；icm-modeler 不把具体题目或答案硬编码进模型。

## make-query

Host 已提供 `bin/make-query` 适配器，接口固定为：

```bash
bin/make-query check
```

适配器只读取固定输入 `icm-eval/input.json`。调用前 Resolver 将一个完整 intent JSON
写入该文件；不得向命令传递路径或 JSON 参数。适配器将 Telora stdout 写入
`icm-eval/ok.json`，将 stderr 写入 `icm-eval/diagnostic.jsonl`，并在终端显示
`exit code: N`。成功时 `ok.json` 只包含一个参数化 Query 对象：

```json
{"sql":"SELECT ... WHERE ... = ?","bindings":["value"]}
```

失败时退出码非零，`ok.json` 为空，`diagnostic.jsonl` 包含确定且可归因的诊断。
成功时退出码为零；`diagnostic.jsonl` 保留 Telora 实际产生的诊断，没有诊断时为空。
动态值只能进入 bindings；调用者不能提交表名、列名、alias、Join、SQL 或任意表达式。
icm-modeler 负责实现适配器固定调用的 `@src/bin/make-query:main` Telora entry；不要修改适配器协议。

## 交付与验证

至少交付模型、动态查询 facade、`src/bin/make-query.telora`、契约测试，以及自包含且相互一致的
`docs/DOMAIN.md` 和 `docs/INTENT.md`。不交付 README，也不向 `icm/eval/public/` 复制文档；
私有模型源码只留在 `icm-model/`。

完成前运行实际可用的检查，并至少覆盖：合法 intent、未知词汇、非法枚举、类型错误、grain
放大、不支持的目标属性、排序/Top N、绑定顺序，以及同一输入的确定性。
