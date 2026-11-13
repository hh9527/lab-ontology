# 模型证明 ABI

## 输入与证明对象

DARI 内部证明后处理与展现，模型证明 query。协议版本为 dari-model/v2。

宿主将完整 IntentType 序列化为 `{intent_json}`：root、nodes、每一步的稳定 id、kind 和 body 都保留。成员引用使用模型发布的符号，并携带所属节点身份；参数只传类型和槽编号，实际值留在执行侧。字面量也分配类型化槽，因此数据值变化不改变证明对象的形状。

宿主编码器不选择关系、不改写步骤、不做领域 lowering。模型解析完整输入，验证节点、成员、算子及顺序，再调用共享语义内核生成参数化计划。节点名称由输入提供，多节点通过公开 Relation 连接；pair 声明两个独立根。未知操作、未知表达式、重复步骤 ID 和未实现的组合均明确拒绝。

## 返回与消费凭据

```text
CheckedIntent {
    element,
    container,
    maxRows,
    plan,
    receipt: {
        contractId,
        inputDigest,
        consumedStepIds
    }
}
```

实际 IC 传输以 columns、container、max_rows、SQL 模板和 receipt 表达，桥接据 columns 构造 element。模型在逐步成功处理后记录步骤 ID，底层计划验证成功后才返回 receipt。inputDigest 由模型对收到的完整 intent_json 独立计算 SHA-256。

DARI 只编码一次，将同一份 JSON、摘要、常量和参数类型槽交给模型端口，并保存预期摘要和步骤序列。收到返回后核对模型契约、摘要以及完整有序步骤列表。缺失凭据、遗漏、重复、调序和过期摘要都会使检查失败。凭据绑定受信任模型的证明对象，不是另写一套宿主领域语义检查。

结果 Schema 必须与意图 project 的有序字段名、已发布成员的业务类型和可空性逐项一致。当前模型只支持直接成员投影，计算字段在后续 query! 中表达。参数协议携带物理类型、可空性、槽编号，以及具名参数的 logical 身份；行级维度比较由模型核对业务类型，业务输入值由生成 codec 在执行侧验证。Option(T) 为空时绑定 SQL NULL，非空时使用 T 的 codec。行级可空条件使用显式 `unwrap_or!(condition, False)` 或 True，默认值本身必须为非空 Bool；模型在 SQL 侧处理未知条件，不按参数值改写查询或取消筛选。聚合阈值仍要求非空参数。

## 身份与符号发布

模型发布 contract_id，它是协议版本、Dataset/Member/Type 符号与类型契约、生成 codec 的摘要。语义规则变化须更新协议语义版本。宿主另外记录具体执行制品的 implementationId，IC 使用 Wasm SHA-256；执行前同时核对契约身份和实现身份。

模型发布 Dataset.symbol、Member.symbol 和 Type.name，内部 id/logical 与作者符号分离。宿主只按发布名称建立索引，不解码知识地址，不从内部 ID 生成别名。具名类型发布完整名称；参数化标量按构造器与参数组成名称；无歧义时模型同时发布短名称，实验输入别名也在模型中声明。所有别名引用相同业务类型与对应 codec，不复制类型定义。

Relation 公共符号同时发布端点及两端基数。字段引用的可空性由字段声明与关系上下文共同决定，投影、空值判断及可空比较使用该契约；SQL lowering 依据实际 JOIN 计划核对空值筛选能力。自关联通过显式 from/to 节点区分同一 Dataset 的不同实例。源节点身份贯穿成员检查、Graph lowering、阈值、排序和结果列映射；实现没有固定 n0。

## 上界与执行

作者 take(n) 约束模型 maxRows 不大于 n，take_opt 对应模型中的独立步骤并产生 Option 行。只有共享语义内核证明结果至多一行时，无排序截取才成立。多行仍要求排序。

检查时核对模型上界与作者选择，绑定时核对 SQL 模板列和上界，执行时核对实际行数，不静默截断超额数据。模型查询计划绑定后不重新调用模型、不重新选字段或聚合。当前模型响应不发布可跨节点传递的有序键契约，结果进入新的 select 时不声称具有这项证明。

## 验证与边界

proof-test.ts 验证凭据篡改、遗漏、调序、重复与缺失。abi-test.ts 直接调用真实模型协议，验证未知步骤、重复 ID、错误节点、缺失投影、断连节点拒绝、隐藏排序及别名改名，同时核对宿主索引完全来自模型发布的符号。ic-contract-test.ts 遍历全部 Dataset；ic-test.ts 验证单行、上界、参数绑定和 enum codec。

模型允许合法的隐藏维度和度量排序；隐藏维度不能隐式改变聚合粒度。维度比较接纳成员在左、参数在右，可用 &&/|| 组合，也支持文本包含和前后缀算子；多个聚合阈值使用独立 filter。计算投影在 select 中表达。

Relation 和 Pair 由模型证明，时间窗口为宿主有限函数，量纲运算由后处理类型规则约束。每个顶层 query_remote! 数据节点在 check 时必须证明至多 500 行，本地下游不能补救远端无界取数。query! 可保留无界 SQL 计划供后续组合；物化要求已证明至多 500 行，单个表格或图表输入要求至多 110 行，不自动截断。运行期继续核对上界。语言诊断包含行列。context 可由宿主提供独立 contextContractId，执行时必须匹配；10924 宿主使用 dari-context/v2，输入和 context 的额外字段也会被拒绝。通用显示格式尚未提供。

## 共享语义、编码与展示契约

生成模块分别导出 createCodecs、semantics、presentations。索引使用相同的逻辑类型与存储类型键；semantics 发布直接 identity 和继承的 semantic。共享根类型的计算能力须与语言契约一致；业务 newtype 继承语义而保留自己的名义身份。presentation 包含展示缩放、后缀及可选的小数精度，由 Value、表格、图表读取，不参与 codec 或算术能力推断。三份契约均纳入模型 contract_id。

## UTC 时间投影

模型投影的时间表达式使用显式组合节点，单位为静态枚举名称：

```json
{"kind":"utc_bucket","value":{"kind":"to_datetime_utc","value":{"kind":"member","node":"a","member":"timestamp"}},"unit":"Day"}
```

`to_datetime_utc` 接受直接 EpochMillis / DateTimeUtc 维度，结果为 DateTimeUtc，保留来源可空性；可单独投影。`utc_bucket` 消费直接 DateTimeUtc 维度或上述转换结果，单位为 Year/Quarter/Month/Week/Day，Week 从周一 UTC 开始。模型独立检查源成员、存储编码、投影权限与单位。

模型把这些表达式降低为查询局部的派生维度，再复用 Graph 分组、聚合、排序和上界检查。EpochMillis 源使用明确的毫秒到 UTC 转换，不隐式按秒解释。公开结果类型为 DateTimeUtc，宿主按作者的表达式核对 Schema 和可空性。回执 digest 仍针对含完整组合节点的原始意图，不能改为降低后的内部意图；派生维度不进入知识发布目录。

地区分桶表达式为 `{kind:"calendar_bucket",value:<UTC表达式>,unit:"Day",timeZone:<parameter>}`。TimeZone 是 ontology 提供的共享类型，物理编码为 String，表示地区时区身份；模型字段可直接声明为 `scalars::TimeZone`，导出的 codec 保留该语义。timeZone 参数的逻辑标记为 TimeZone，必须非空；宿主以 TimeZone codec 校验并绑定值，模型检查标记、编码、索引和非空性。它参与完整意图摘要与参数编号分配。SQLite lowering 使用已约定的 dari_calendar_bucket UDF，PostgreSQL lowering 使用三参数 date_trunc；后端适配遵循模型决定的语义，不执行隐式降级。当前分桶仅支持参数化地区，尚不支持逐行引用模型的 TimeZone 字段作为分桶时区。
