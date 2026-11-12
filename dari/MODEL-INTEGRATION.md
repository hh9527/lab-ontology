# 模型静态符号、类型检查与 transform

`src/model.ts` 定义宿主接口，`fixture-model.ts` 提供小型模型，`model-bridge.ts` 连接真实 IC 实验产物。`ontology/src/typed_query.telora` 是类型/数据 ABI 实现，`icloud_model/src/dari.telora` 为独立构建入口。IC 默认服务入口与部署保持现状，NS 尚未接入。

步骤消费凭据、作者 take 与模型上界的绑定，以及公共符号发布的当前边界见 [模型证明 ABI](MODEL-ABI.md)。当前采用 dari-model/v2，完整步骤解释与领域 lowering 在模型侧完成，桥接只处理协议编码和执行绑定。

## 作者表达

```text
data readings = query_remote! {
    let a = from(ic::DeviceKpi);
    a |> filter(a.cpu_usage > request.floor)
      |> project({device: a.device_id, cpu: a.cpu_usage})
      |> order_by(desc(a.cpu_usage))
      |> take(5)
};
```

模型发布具名的静态符号：

- `ic::DeviceKpi` 是 Dataset 符号，带有稳定身份和可用成员
- `a` 是查询局部的节点绑定；编译器为其分配作用域内的节点身份
- `a.device_id` 是 dimension 引用，带有所属 Dataset、角色和 `ic::DeviceId` 类型
- `a.cpu_usage` 是 measure 引用，模型负责其聚合规则和能力约束

节点名、Dataset、dimension、measure、比较算子和排序方向都通过语法或静态符号表达。字符串留给数据值，例如 `a.name == "设备-99"`。内部序列化仍可使用字符串保存符号 ID，但它不是可由运行参数任意替换的 String。

`project` 中的 device/cpu 是输出记录的字段名，不是模型查询地址。后续 select 直接使用这些静态推导出的字段，不再依赖数据库生成的前缀列名。

## 依赖类型的位置

编译器生成有限的 IntentType：节点类型、带所属节点的成员引用、类型化表达式、投影记录、排序项和静态上界组成查询类型。

例如，成员引用决定业务类型和角色，投影决定结果 Schema，take(5) 决定上界。阈值参数以 Float 类型的槽参与检查，50 与 80 不改变结果类型。决定类型与能力的模型成员选择必须在检查期确定。

宿主接收的是这个类型描述，不是旧 Graph JSON 的字符串寻址对象。POC 用 TypeScript 对象承载有限类型构造器，不表示已经实现 Telora 原生依赖类型或任意类型级程序求值。

## 模型接口

```text
check_type(IntentType) -> CheckedIntent {
    element: Type,
    maxRows: Int,
    plan: ValidatedParameterizedPlan
}

bind(ValidatedParameterizedPlan, parameterValues) -> PreparedQuery
```

check_type 必须共享 transform 的语义分析内核：验证领域能力，同时产生合法计划及输出类型，不能另写一套只报告列形状的 describe。resolve 只给这个计划绑定值，不根据实际结果或参数值重新选关系、列和聚合。

ModelPort 发布 contractId，编译产物记录这个身份，resolve 在执行前检查它。模型发布符号、类型、codec 与协议版本的契约摘要；宿主还保存具体执行制品的 implementationId（IC 使用 Wasm SHA-256）。query 的 take_opt 作为独立步骤送入模型，模型证明其单行选择，再由输出端构造 Option(Schema)。

夹具已验证静态符号解析、成员所属关系、名义 ID、比较能力、投影类型、排序和上界。夹具将 CPU measure 编译为 AVG，并把其过滤条件放在 HAVING，普通称谓过滤放在 WHERE。绑定时校验实际 CPU 阈值范围。该夹具只支持一个 Dataset、一个节点、成员记录投影、一个过滤、排序和截取，不能据此宣称完整 transform 已经迁移。

## 与当前模型输出的结合

当前 `ontology/src/intent.telora` 的 PreparedQuery 包含：

```text
sql, bindings, columns: [{name, type, nullable}], max_rows
```

ResultType 当前为 String/Int/Float/Bool/DateTimeUtc/EpochMillis/DateTime。这些基础列类型足以描述传输形状，但不能单独保留 DeviceId、Percent、自定义 enum 等业务身份和能力。

模型需要发布薄的静态契约：Dataset/Entity/Relation 符号、成员角色、稳定业务类型身份、底层表示、可空性、能力和有限类型计算规则。类型用命名空间区分；成员引用共享这些类型，不重复生成新类型。

真实 IC 实验路径：

1. `.dari` 将完整、带步骤 ID 的 IntentType 编码给模型；所有节点、成员、投影、排序、上界和参数类型保留，检查期不传实际参数值
2. 模型用 `query_intent_ast_factory` 完成结构 Graph lowering，复用指标输出类型及聚合比较算子检查，生成 `Expr::Parameter(index)`，并经过现有计划校验器
3. 模型返回 SQL 模板、真实输出可空性、业务类型身份、行数上界和完整消费凭据；宿主核对模型计算的输入摘要、契约及步骤序列
4. resolve 只绑定已校验模板，交给 SQLite；不会重新调用模型或重新规划

SQL 载荷中的 FieldEntry.ty 已经是物理存储类型。契约因此从原始记录声明读取业务类型，避免把 Percent 和 Reference 身份丢成 Float/String。业务身份当前以有限名义类型承载，支持兼容量纲算术，Reference 不获得原始存储的数值算术能力。Avg(Int) 等改变表示的聚合使用实际输出表示，不直接复用输入的 Int newtype。

类型 ABI 当前发布 IC 的全部 50 个 Dataset 及其成员，查询结构支持 Relation 多节点、完整输入成员投影、多个指标阈值、维度复合筛选、隐藏排序与两期比较。符号参数仅实现 SQLite 渲染；Postgres/UQL 会明确拒绝未绑定的符号参数。原有按值 transform 继续使用实际值绑定。

真实 IC 样例显式使用 `group_by_identity(a)`，保留 Dataset 的完整身份粒度（设备、租户、时间），并在这个粒度上筛选指标。它与“跨时间按设备计算平均值”是不同查询。模型的原 transform 和类型 ABI 共用 `graph_root_measure_grain_ok`；不满足阈值粒度要求时，类型检查拒绝查询。按其他字段聚合后的再次筛选，可以在后续 select 中表达，不能绕过模型的 Graph 阈值约束。

完整接入仍需：

1. check_type 读取静态成员、结构和参数类型，检查关系、维度、指标、过滤、聚合、连接和上界，产出合法参数化计划及结果类型
2. bind 读取实际参数，检查范围、时间窗口顺序等值约束，产生现有 PreparedQuery
3. 现有按值调用 transform 的入口，也经过同一套分析和绑定规则

不能虚构参数值调用现有 transform，再把结果当类型检查。真实类型导出也不能只给一张可用字段表，就绕过 transform 的能力规则。

## query 与 select

query 通过模型解释业务成员、关系与聚合；select 消费 query 的有类型结果，完成有限关系运算。query 的语义约束不是 select 中任意物理列操作能够代替的。

[device.dari](examples/device.dari) 演示 query_remote! → query! → take_opt → Answer。执行器将已校验的模型 SQL 作为 query! 的子查询，在数据库内完成计算。绑定后核对基础列类型、可空性和上界是否与检查期契约一致。

业务类型在投影中保留；带量纲算术与完整关系连接仍需后续实现。query 和 select 都产生 Schema 行，take_opt 返回 Option(Schema)，行内可空字段独立保留。

select 可连续组合筛选、投影和有界截取，各阶段编译为嵌套 SQL。上游结果上界向下传播，已证明有界的输入无需重复 take。投影后的 out 表示当前行 Schema；紧随投影的排序可用当前阶段未输出的源字段。query 使用相同的算子结果语义，模型仍负责决定某种组合在领域中是否成立；IC 桥接当前不支持任意连续模型投影。

## 运行时 JS codec

`ontology/src/js_codec.telora` 从模型属性生成 ES module 源码。实验的 CpuFloor 包装 BoundedPercent，后者声明 `@js_codec::number_range(0.0, 100.0)`；包装链上的范围约束合并执行。模块由构建信息 `dari.codecs` 发布，也随类型契约提供，可导出为 `.mjs` 文件。

宿主初始化时加载模型构建生成的模块；`.dari` 文本不作为 JavaScript 执行。parse 负责 JSON 参数的严格类型与范围检查，encode 转换为数据库绑定值，decode 验证并转换数据库结果。业务约束不在宿主中重写，resolve 不调用模型。模型检查返回的名义类型携带对应 codec，后续行投影继续保留它。

基础类型的严格解析和 SQLite 编码由 DARI 内置实现。模型生成器覆盖 newtype 数值范围、enum 编码与排序及源字段映射；字段级能力约束和跨参数规则尚未完整生成。时间窗口先后等跨参数规则仍需独立的计划绑定校验器。

## Enum 与源字段映射

IC 模型通过字段 property 声明严格映射 `@v::map` 或带兜底值的 `@v::map_or`。原始值与计算值分别发布，映射允许多个源编码对应同一 enum variant。兜底 `Unknown` 是无载荷 variant，源字段可空时才产生 Option(Enum)，NULL 与 Unknown 保持区别。

生成的 ES module 导出 `createCodecs(primary)` 与 `mappings`。宿主注入 DARI 内置的基础类型 codec，工厂只初始化模型自定义类型；无额外约束的 newtype 共享基础类型实现，业务身份独立保留。Enum 的默认字符串编码是 PascalCase variant；完整声明 itag 时另外导出整数 codec。字段映射以 `dataset/dimension` 为键，包含映射表、兜底 variant 和 map 方法，转换逻辑来自 ontology 的通用实现。源编码不作为 enum codec 别名。

query 输出与输入类型别名共享业务身份，字段可空性独立保留；select 排序读取生成的业务顺序，声明 order_by_itag 的类型按 itag 顺序排序。resolve 绑定已校验 SQL 并在 JS 侧执行 codec，模型无需再次 transform。

## 类型收集与初始化

成员契约只携带业务类型身份、存储表示和可空性。构建期一次遍历维度和指标、按 Dataset 归组，同时收集自定义类型引用。基础类型由宿主提供，不进入模型的 codec 发布集合；自定义类型先按身份和编码方式去重，再生成源码。输入类型的短名称只作为别名，引用相同的类型定义。

IC 本轮发布 1,231 个成员引用、212 个自定义类型 codec（含 enum 的不同编码）和 96 组独立字段映射。生成模块不包含基础类型 codec 定义，成员不嵌入源码。
