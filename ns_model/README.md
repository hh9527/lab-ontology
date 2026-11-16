# NeoSight 类型模型

NS 使用 `ontology::semantic`，从已有表结构出发，以类型和字段 Property 表达业务可解空间。模型通过一个 Wasm 同时发布全量知识、公开类型、codec 与通用 transform 契约。

## 模型组织

- `src/datasets/`：151 个数据集、2,118 个物理字段，保留表列映射、粒度、可空性、字段能力、分类映射及外置关系
- `src/identities.telora`：业务实体的具名指代，单字段使用 newtype，联合指代使用 struct；字段通过 Reference 指向完整身份
- `src/domains.telora`：141 个具名业务枚举；wire 映射由原始字段的 Property 声明，半开放值域提供 Unknown，NULL 仍保持可空
- `src/metric_values.telora`：每个业务指标独立的 newtype，保留指标身份，不因单位相同而允许相互运算
- `src/units.telora`：可复用的物理单位合同，不隐含可加性或单位转换
- `src/model.telora`：根类型、revision 与查询能力 profile
- `src/lib.telora`：统一模型服务入口，一次构建期准备知识和转换能力
- `data/source-model.json`：来源目录与声明快照，保留来源提交及文件散列
- `data/generation-contract.json`：演示数据的物理字段、wire、约束与关系条件合同
- `data/migration-decisions.json`：尚待确认的来源假定、未发布的路径和已核实的修正

身份与数据集分开表达。同一身份可在多个数据集中承担不同角色；联合角色通过 `@domain::role` 复用现有字段。关系只连接显式声明的完整身份，不因字段都使用 String 就推断连接。

分类的原始字段保留存储类型，平行计算维度发布业务枚举；既能检查原始数据，也能按具名业务分类筛选、投影。业务指标的统计能力由 samples Property 声明，物理数字类型不自动许可 Sum。

## 发布与查询

统一服务槽为 `ontology/model`，contract 发布目录、类型和 codec，transform 将类型化意图转换为经过校验的结果类型、参数化 SQLite 计划及证明凭据。执行期只绑定参数并执行计划。知识随同一制品的 ontology.knowledge 元数据发布，详见 [模型发布契约](../ontology/MODEL-PUBLICATION.md)。

公开数据集符号使用 snake_case，例如 `ns::network_element`；知识地址和数据集 ID 保留 `datasets/network-element` 与 `network-element`。成员沿用已有的维度、统计 ID，关系使用 `ns::relations::<name>`。

## 来源与约束

当前发布 302 条直接关系，包含联合键和两端的条件限制。存储前端端口关系同时要求 `logicType = "0"` 和 `portType` 属于 FC/FCoE/ETH/RoCE；正反向关系使用相同的限制。多个 guard 取合取，候选值集合取析取，且条件绑定到明确的一端。

样本关系的基数以完整的时间序列粒度判断，资源到多时点样本以及资源到多条告警历史允许多值；不能用主体身份冒充单条样本或告警记录身份。合成数据逐条检查基数上界，不豁免采样或告警历史。

来源目录中的三条关系缺少连接条件，保持待确认：OpticalModuleBondPort、BondPortBondEthPort、SubnetLocatedInSubnet。201 条具有连接条件的来源关系已由直接关系覆盖。92 条 Via 路径保留在迁移记录中，调用方可显式提供底层连接链。

`ar__fsd_rev`、`fsd__ar`、`fs__sh` 是多对多关系。知识目录保留其真实基数；当前类型化查询契约拒绝直接投影两端并展开关系行，不能将其当成单值关系。运行验收对其检查明确拒绝，其余 299 条关系从保留行粒度的一端执行 SQL。

来源目录有 152 个 Dataset，当前保留 151 个，未引入重复便利表 T_DEVICE_ALL。粒度字段的必填假定和来源 nullable 冲突保留在迁移记录中；这些假定不作为新增来源证据。缺少可加物理量合同的 118 个 Sum 声明保持待确认，既有可发布统计共 3,038 项。

## 时间

通用时间类型由 ontology 提供。告警的 occur_utc、clear_utc 按已确认约定使用 Option(EpochMillis)，保留原有可空性；可空发生时间不声明为要求非空的权威事件时钟。KPI 使用已有 DateTimeUtc 采样时钟及完整粒度。其他未确认单位的原始时间字段保持原始类型，待确认项有独立记录。

## 验收

临时制品使用 `$TMPDIR`，未设置时使用 `~/.cache/tmp`；编译器使用 release 版本。

```sh
ns_tmp="${TMPDIR:-$HOME/.cache/tmp}"
mkdir -p "$ns_tmp"
node scripts/export-ns-audit.mjs "$ns_tmp/ns-audit.json" --test
node scripts/check-ns-source.mjs "$ns_tmp/ns-audit.json"
bin/telora -C ns_model build @src/lib --staged \
  --buildtime-fuel 800000 --buildtime-memory-limit 2048 \
  --initialization-fuel 400000 --request-fuel 100000 --with-memory-limit 2048 \
  -o "$ns_tmp/ns-model.wasm"
node ns_model/tools/check_transform.mjs "$ns_tmp/ns-model.wasm" \
  /path/to/dsh-oks/packages/dsh-oks/src/telora-model.ts "$ns_tmp/ns-audit.json"
```

来源验收核对物理字段、维度、分类名称与 wire 集合、统计和关系条件；运行验收使用插件适配器及 Node 原生 WebAssembly，执行全部数据集投影、关系 SQL、统计，并用违反端口条件的行验证拒绝效果。演示数据说明见 [合成数据](docs/SYNTHETIC_DATA.md)。
