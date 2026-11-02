# NeoSight 类型化模型

模型以具名类型和 property 声明 Dataset / Entity，Registry 汇总根类型和 Relation 描述表，自动发现被引用的具名类型，发布 `ns/transform`，生成 SQLite 查询。构建采用 A/B 两阶段；A 准备 transform 数据和知识发布信息，运行期 B 消费已准备的数据。

## 模型组织

- `src/datasets/`：151 个 Dataset、2,118 个字段，保留源表与列映射、行粒度和内部 KPI 桥接表
- `src/identities.telora`：具名身份类型，以及由源关系明确连接的引用身份空间；身份与 Dataset 分开表达
- `src/groups.telora`：按类型、过滤能力及统计策略复用 DimensionGroup、采样 MeasureGroup
- `src/domains.telora`：140 个业务值域及其源编码映射，显式开启类型反向引用，支持业务名词从值追溯到维度和 Dataset
- `src/units.telora`：按源单位合同复用具名类型，例如 `Percent`、`Watts`、`BytesPerSecond`；同一单位的整数表示使用 `Integer` 前缀（计数默认整数，非整数计数使用 `Fractional` 前缀）。不同源单位拼写仍保留独立类型，不因改名合并；单位证据和待确认假定保留在源声明记录中，不隐含可加性或单位转换
- `src/model.telora`：Registry 根清单及关系描述表；Dataset / Entity 显式注册，业务 Type 按引用自动发现，未引用类型不发布
- `data/generation-contract.json`：与类型化声明同次生成的演示数据合同，包含最终类型和源码哈希

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

`python3 ns_model/tools/check_model.py --telora "$TELORA"` 在隔离工作区使用定义入口，执行注册时局部检查和 World 关系边界检查。局部定义及字段元数据按 Type 缓存；Relation 端点要求在显式根中。自动发现的内容不重复进行全图覆盖检查。隔离测试使用独立 fuel 和构建内存配额，不改变部署模型的运行配额。

SQL 验收覆盖 Dataset 投影、直接关系、样本、枚举映射及错误输入。知识发布由插件的 owned-knowledge 验收检查独立节点、精确读取和反向引用策略。

## 构建配额

根目录 `telora-config.json` 统一设置配额；fuel 单位为百万，内存单位为 MiB。构建阶段为 `buildtimeFuel: 150000`、`buildtimeMemoryLimit: 256`；初始化为 `initializationFuel: 5000`，请求为 `requestFuel: 10000`，两者共享 `memoryLimit: 64`。这些字段需要支持阶段配额的 Telora 版本。

NS Registry 模型带知识发布及注册检查的一次完整构建约 82.09 秒，其中准备约 63.23 秒；消耗 140,041,929,835 fuel，准备结束时线性内存 96,665,600 字节。构建配额保持 150000 百万 fuel 和 256 MiB。

同机迁移前构建约 55.27 秒，制品 22.26 MiB。生成源码从 70,606 行降到 47,782 行；准备成本留在构建期 A，运行期 B 消费准备后的数据。

## 演示数据

使用 `node scripts/generate-ns-data.mjs --output bin/ns-data` 生成 SQLite 数据和覆盖清单。固定种子、窗口及实际模型 SQL 验收方式见[演示数据说明](docs/SYNTHETIC_DATA.md)。
