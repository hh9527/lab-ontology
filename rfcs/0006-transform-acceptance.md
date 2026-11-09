# RFC 0006：原 transform 能力核对

目标是让 IC 的实际领域定义采用新建模方式，并保有原有对外查询能力。旧声明只作为测试对照，不作为运行期兼容路径。复用查询规划和 SQL lowering 不等于保留旧建模。当前仅做本地实现和单元验收，不替换运行中模型、不部署。

## 验收方式

在 `ontology/tests/semantic_lowering.telora` 中增加一个原路径基线：通过现有 registry property 注册样本表，再调用 `registry::payload`，实际经过原 transform 初始化。

新路径使用同一物理表和同名查询地址，由新模型适配为 PreparedPayload。对成对测试输入比较：

- SQLite SQL 及绑定参数。
- PostgreSQL SQL 及绑定参数。
- 原有返回列类型、列顺序和可空性。

所有正向测试均显式断言。原路径对照用于核对 SQL、参数和列契约，不要求新领域代码保留原来的表达方式。

```sh
bin/telora -C ontology test semantic_lowering --request-fuel 20000
```

测试框架在整组测试间不重置 fuel。此命令的预算仅用于成对编译和多后端比较，不修改任何模型或服务运行预算。

## 已用成对测试确认

| 能力 | 结果 | 范围 |
| --- | --- | --- |
| 按投影维度分组 | 保持 | Mean 聚合 |
| 按完整行身份分组 | 保持 | 包含时间成员的样本粒度 |
| 普通排序与 take | 保持 | Desc 排序，数据库执行 take |
| 聚合排序 TopN | 保持 | 按 Mean 取前 10 |
| HAVING | 保持 | 完整根身份下的度量阈值 |
| count / count_value | 保持 | 根行计数与非 NULL 值计数 |
| DISTINCT / count_groups | 保持 | 去重投影及聚合阈值后的组数 |
| GraphUnion | 保持 | 选择完整行身份，分支同构 |
| GraphPair | 保持 | 同构样本点按完整行粒度对齐 |
| GraphPair 增长率排序 | 保持 | GrowthRate，数据库排序和 take |

跨周期 GraphPair 已补充业务实体锚点测试：不同时间窗口的样本经显式 mapping alignment 连接到设备映射，再按设备身份对齐；不把时间包含在跨周期对齐键中。

本轮之前的定向单元测试还覆盖了投影、Mean、Optional 关系及联合指代连接、可空性传播、EXISTS、反向遍历与查询越权拒绝。它们继续属于查询单元测试，不需要数据库执行。

## 首批缺口的修复结果

| 能力 | 原路径 | 新路径 | 原因 |
| --- | --- | --- | --- |
| 字段过滤 | 基线查询通过 | 成对测试通过 | 复用字段视图及 dimension lowering |
| any_of | 基线查询通过 | 成对测试通过 | 保留显式过滤许可 |
| 时间窗口 | 基线查询通过 | 成对测试通过 | 传递时间字段范围过滤许可 |
| Min / Max | 基线生成对应 SQL | 成对测试通过 | 补齐类型和场景统计授权 |
| 采样顺序 | 基线 sample_order 非空 | 对照通过 | observation clock 和粒度传递到 sample_order |
| 同实体不同表映射对齐 | 原关系模型允许同身份 role 连接 | 定向测试通过 | 显式 alignment，独立于跨实体 Reference |

最后一项没有把业务身份伪装成另一份外键。同实体映射对齐与跨实体引用关系分别表达。

## IC 实际迁移与契约对照

IC 的 50 个实际 Dataset 已使用 ontology::semantic。字段视图、分类、采样和计数由类型／字段 property 发布；关系使用 identity/Reference 字段寻址的外置 Relation。运行入口没有旧 registry 声明兜底。

旧源码只复制到临时隔离工作区，导出迁移前契约作为对照；当前源码导出同一结构。对照已覆盖全部 Dataset 的物理字段、可空性、时间角色、粒度、scope、id/dn 寻址和采样声明，以及：

| 契约 | 原有 | 当前 | 结果 |
| --- | ---: | ---: | --- |
| Dataset | 50 | 50 | 原有项一致 |
| Dimension | 892 | 934 | 原有项一致；新增 42 个仅投影属性 |
| Measure | 201 | 201 | 原有项一致 |
| Relation | 106 | 106 | 原有项一致 |
| Native pair | 1 | 1 | 一致 |
| Business link | 2 | 2 | 一致 |

过滤算子及输入类型按集合比较，采样及寻址声明按稳定键比较；不把无语义的数组顺序变化当成能力差异。

icloud_model/tests/semantic_migration.telora 导出完整契约和 7 个 IC 查询的 SQLite/PostgreSQL SQL、参数与返回列。两边结果一致。代表性查询包括设备投影、按租户计数、CPU Mean/Latest、告警分类和计算计数、ONU scope 与 IPv4 投影、UTC 日桶及物理链路两端投影。

ontology 的 semantic_model 19 项、semantic_lowering 37 项通过。SQLite 微型数据集实际执行生成 SQL，验证空值、孤立引用、联合引用、连续 LEFT JOIN、EXISTS、目标筛选及空输入聚合。PostgreSQL 只验证 SQL，不连接实际数据库。

当前 IC staged 制品可本地构建，最近一次总耗时约 19.08 秒。未部署或修改服务运行参数。构建后知识包含 50 个 Dataset、106 个关系描述；Server 保留两种指代方法，Reference 为内联构造器，不生成独立泛型知识节点。

## 概念知识发现的本地验收

query/transform 仍以 Dataset 寻址。概念层 entity + props + 可选 values 的模糊速查已在插件分支实现为 oks_discover，字段／度量／计数映射来自模型声明的 subject 及实际查询能力。模型端覆盖 50 个 Dataset，检查全部属性映射的查询地址存在，并检查 CPU、SSID、枚举类型和多主体来源。插件 49 个源码测试通过，包含工具注册、模糊匹配、可选 values、值到 Type 的属性过滤、互补命中和截断边界。

实际 IC 知识加载后可速查 CPU 度量、Critical 所属 AlarmSeverity 维度、告警计数和 SSID 指标。制品级验收已通过：从新 IC 制品发布的知识，经插件概念速查、oks_info 获取短名称，调用同一制品的 ic/transform；CPU、枚举筛选的告警计数、SSID 度量均被接受，未声明度量被拒绝。不执行数据库查询、不修改部署。插件运行产物尚未替换。

## 明确的行为改变

Graph 常规连接现在按 Relation 的遍历方向基数处理 Optional → LEFT JOIN，并传播可空性。它可能保留原先被 INNER JOIN 隐式丢弃的源实体。这是已批准的语义修正，不应要求与旧错误结果一致。显式 EXISTS 和 WHERE 仍表达筛选。

## 判断

IC 实际定义已驱动共享 transform，并通过上述契约和定向查询验收。概念速查已接入插件源码并通过单元验收；制品级发现到 transform 的验收通过，NS 尚未迁移，未部署。
