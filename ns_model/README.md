# NeoSight 类型化模型

模型以 `World` 显式列出类型、身份、Dataset 和 Relation，发布 `ns/transform`，生成 SQLite 查询。构建采用 A/B 两阶段；A 准备 transform 数据和知识发布信息，运行期 B 消费已准备的数据。

## 模型组织

- `src/datasets/`：151 个 Dataset、2,118 个字段，保留源表与列映射、行粒度和内部 KPI 桥接表
- `src/identities.telora`：具名身份类型，以及由源关系明确连接的引用身份空间；身份与 Dataset 分开表达
- `src/groups.telora`：按类型、过滤能力及统计策略复用 DimensionGroup、采样 MeasureGroup
- `src/domains.telora`：140 个业务值域及其源编码映射，显式开启类型反向引用，支持业务名词从值追溯到维度和 Dataset
- `src/units.telora`：按源单位合同复用名义类型；单位证据和待确认假定保留在源声明记录中，不隐含可加性或单位转换
- `src/model.telora`：显式 World 清单；覆盖检查不自动发现或补全模型

同一身份空间可以在一个 Dataset 中承担多个角色。例如子网身份分别用于自身主键和父子网引用。关系只连接显式声明的身份角色，不因为两个字段都使用 String 就推断可连接。

## 时间约定

| 类型 | 含义 |
|---|---|
| `Date` | 不含时区的日历日期 |
| `DateTime` | 不含时区的日期时间 |
| `DateTimeUtc` | UTC 绝对时刻，当前使用规范 UTC 文本编码 |
| `EpochMillis` | 毫秒编码的绝对时刻 |

`DateTimeTz` 和 `DateTimeOffset` 尚未实现。UTC 日历分桶是转换规则，不赋予 Date 时区。源字段仅声明整数而没有毫秒证据时保留原始类型，不能把旧模型的单位假定当成源事实。

## 生成与验收

```sh
python3 ns_model/tools/import_source.py
python3 ns_model/tools/generate_model.py
# 使用支持 std::pipeline、build::stage 和独立 buildtime 配额的 Telora CLI
$TELORA -C ns_model check --lib --only-types
$TELORA -C ns_model build ns_model --staged -o "$TMPDIR/ns.wasm"
node ns_model/tools/check_transform.mjs "$TMPDIR/ns.wasm"
```

`data/source-model.json` 记录来源提交、文件散列、原始元数据和声明。生成器不在运行期导入旧注解模型。`data/migration-decisions.json` 记录待确认时间单位、源 nullable 与声明粒度冲突，以及未迁移路径。

## 首版边界

旧声明中的 Sum 样本缺少当前类型系统要求的明确可加物理量合同；这些 Sum 名称暂未发布，Max/Min 仍保留。待确认项逐字段记录为 `unconfirmed_additive_sample`，不把未知单位的 Float 冒充 Bytes，也不绕过可加性校验。


当前生成 302 条直接关系，其中包括复合键和源侧等值条件。92 条 Via 路径声明保留在迁移记录中，尚未发布为快捷关系；调用方可显式提供底层桥接链。

这些关系来自旧声明，不等价于全部源关系已审计通过。源目录中的三条关系缺少连接条件；企业前端端口关系中的 IN 条件未由旧声明完整表达，不能据此宣布语义等价。源端口条件需要进一步核对后才能作为正式合同验收。

源目录有 152 个 Dataset；当前按既有模型保留 151 个，重复便利表 `T_DEVICE_ALL` 暂未引入。粒度字段沿用旧声明的必填合同，与源 nullable 冲突的部分有明确记录。

`python3 ns_model/tools/check_model.py --telora "$TELORA"` 用于单独诊断模型自检。脚本先核对完整 World 覆盖，再逐 Dataset 检查 transform 合同，最后对整份关系清单执行严格 lowering。目前该自检在 400000 百万 fuel 下仍耗尽预算，尚未通过；已通过的带知识构建和 transform SQL 验收不代表完整自检通过。

验收聚焦 transform、SQL 和输入拒绝，不运行完整知识地图测试。当前分支是迁移工作，不部署运行环境。

## 构建配额

根目录 `telora-config.json` 统一设置配额；fuel 单位为百万，内存单位为 MiB。构建阶段为 `buildtimeFuel: 150000`、`buildtimeMemoryLimit: 256`；初始化为 `initializationFuel: 5000`，请求为 `requestFuel: 10000`，两者共享 `memoryLimit: 64`。这些字段需要支持阶段配额的 Telora 版本。

NS 带知识发布的实测构建消耗 122,790,062,443 fuel，准备结束时线性内存 122,486,784 字节，完整构建约 72.8 秒。构建 fuel 留约 22% 余量。这不是完整模型自检的配额保证；自检仍需单独诊断。
