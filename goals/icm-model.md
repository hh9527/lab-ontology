# ICM 领域模型目标

使用 `icm/ao/` 的自包含知识，在 `icm-model/` 中建立一个基于 `ontology` eDSL 的 ICM
EnterpriseKnowledge。组织方式可参考旧 `ent-1`，但实体、关系、指标、维度、粒度和能力边界
必须从 ICM 材料独立建模。

## 私有模型与公共边界

- `icm/ao/schema/`、物理表列、Join 路径和 mapping 属于模型实现，不进入 Resolver 公共资料。
- `icm/eval/public/` 只发布 Resolver 解题所需的稳定业务词汇、指标、维度、筛选能力、粒度规则、
  意图 JSON 契约和诊断语义。
- 公共资料不得包含评测题、选择列表、隐藏知识 K、trap、标准答案或按题编号编写的提示。
- `icm/eval/report.sqlite` 存在时，应按迭代和 Case 汇总失败类型，用它发现模型能力缺口；不要
  把具体题目或答案硬编码进模型。Host 可通过 `feedbacks/icm-model.md` 补充改进重点。

## make-query

Host 已提供 `bin/make-query` 适配器，接口固定为：

```bash
bin/make-query check <intent.json|intent-json>
```

第二个参数可以是包含单个 intent JSON 的现有文件，也可以直接是一个 JSON object；Resolver
不需要、也不应为了调用工具先创建文件。成功时 stdout 只输出一个参数化 Query 对象：

```json
{"sql":"SELECT ... WHERE ... = ?","bindings":["value"]}
```

失败时退出码非零，stderr 输出简短、确定且可归因的诊断，stdout 不得输出部分 Query。
动态值只能进入 bindings；调用者不能提交表名、列名、alias、Join、SQL 或任意表达式。
a3 负责实现适配器固定调用的 `@src/bin/make-query:main` Telora entry；不要修改适配器协议。

## 交付与验证

至少交付模型、动态查询 facade、`src/bin/make-query.telora`、契约测试、领域文档和查询设计
指南。公共文档同步到 `icm/eval/public/`，但私有模型源码只留在 `icm-model/`。

完成前运行实际可用的检查，并至少覆盖：合法 intent、未知词汇、非法枚举、类型错误、grain
放大、不支持的目标属性、排序/Top N、绑定顺序，以及同一输入的确定性。
