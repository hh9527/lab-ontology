# 源元数据刷新

由 lab-ontology 议题 #32 跟踪，分支为 `refresh/32-icloud-source-metadata`。
准备模型覆盖全部 48 张表和 822 个字段，包含 50 个载体（含两个限定作用域的 PON 角色）、95 个有效原始关系及 28 个对齐后的业务关系别名。

## 权威性与来源

项目负责人于 2026-10-01 确认 `imaster-cloud/.compact/metadata/` 为唯一事实来源（SSOT），包括源目录使用的 `*.logical.yaml` 和 `*.relation.yaml`。
`imaster-cloud/telora/src/modeling/icloud` 中现有业务定义是次级解释，与元数据冲突时以元数据为准。
生成数据和查询示例不能建立物理或业务事实。元数据缺失或格式错误也不会使次级材料成为权威；补充或建模假设必须显式记为例外，不能悄悄改变源契约。

`../data/source_catalog.json` 记录 48 个逻辑数据集、97 个源关系、字段类型、可空性、主键标记、描述及语义属性，每个输入文件都有 SHA-256。
目录是审查证据，不是运行时数据源或模型声明替代物，由 `scripts/icloud-source-catalog.py` 使用 YAML 解析器生成。

## 已确认修正

`icloud-source-v19` 发布存储资源名称搜索、Appellation 及现有 ID 引用。
存储／FC 内存、磁盘利用率和磁盘读写 I/O 大小分别声明主算术 Avg 和样本摘要 Max／Min。
源 YAML 指定 CPU／内存／利用率为 percent，I/O 大小为 kilobyte，目录保留 unitName 和 unitType。
TODO(#58)：转换前确认千字节对应的字节乘数。磁盘身份及归属关系仍有源差异，不推断替代关系或磁盘键。

`icloud-source-v9` 声明 FC 实体粒度及共享存储／FC CPU 度量的两条归属路径。
知识目录词汇项发布规范 ID 和归属。GraphPair 拒绝按时间身份对齐的不相交窗口，主体级周期比较仍可用。

`icloud-source-v8` 增加存储／FC 及 PON 的存储 CPU 样本 Avg／Min／Max。
单位假定为 `%`，TODO(#47)：与源元数据确认。总体及权重语义见[样本统计](SAMPLE_STATISTICS.md)，协作设备没有声明 CPU 源。

`icloud-source-v7` 引入显式 GraphPair 身份对齐、逐列输出侧和比较操作数，源声明不变。
之前的 v6 用 DatetimeUtc ISO-Z 替换空格分隔 KPI 时钟，并发布 DateUtc 逻辑日期，v4 样本统计定义不变。
样本／Avg／Max／Min ID、NULL、阈值及未解决设备端口利用率公式见[样本统计](SAMPLE_STATISTICS.md)。

- 物理状态列是 EnterprisePhysicalLink.linkStatus；link_status 仍是模型字段名，不是物理拼写。
- T_CURRENT_ALARM.SEVERITY 的物理编码为整数 1～4，业务值仍为 critical、major、minor、warning；筛选、投影及过滤度量的 SQL 参数必须为整数。
- 网络设备分类增加源声明的 TianGuan、打印机、UPS、负载均衡器及其他网络设备值；打印机／UPS／负载均衡源编码有 ne.category. 前缀。刷新不从生成行推断别名。后续 #29 显式采用半开放假设，并补充裸 printer、ups、lb 编码，见下文。
- 制造商是开放源字符串，没有穷举枚举。移除设备、风扇、PSU 上仅 Huawei 的规范保护条件，保留原始制造商筛选和分组，不排除未声明厂商；2011 之类原始标识不会自动改写为 Huawei。

## 需显式处理的源差异

- 按 #29 工作假设，device_class 为半开放域，已知概念保留全部源编码，打印机、UPS、负载均衡器也显式接受裸拼写。这是已授权建模假设，不是源元数据或生成行证明的新事实。未知分类保留原始字符串及 Unknown 标签，不在投影／分组中消失。others 仍是 ne.category.unknown 编码的已知业务概念，与 Unknown 分支不同，见[共享契约](../../ontology/docs/HALF-OPEN.md)。
- EnterpriseFrame 无物理 id，已删除补充字段及虚构身份粒度。负责人确认 frameDn 是 Distinguished Name，声明唯一 dn 引用。所有可空机框字段用 Option(T) 表示源可空性；DN 缺失使引用不可用，不表示共享 NULL 对象。机框查询和关系保留，但对象计数及身份分组无已声明全行身份。
- OCCURUTC、ARRIVEUTC、OCCURTIME 为原始 long。UTC／本地区别已有说明，纪元单位未统一明确。现有业务映射将 UTC 转为时间戳，并记录单位转换未定。当前字段用 Int，暂按标准 EpochMillis，声明旁保留 TODO。ACKUTC 指定毫秒、ARRIVEUTC 指定毫秒精度，为假设提供依据。窗口绑定整数毫秒；EpochMillis 不依赖时区，特殊墙上时间整数需独立编码。
- 部分挑战关系增加原始条件没有的租户相等，从源模型删除，仅保留在独立合成压力夹具。
- 原始设备／站点 OR 关系声明 M:1，挑战模型则声明多目标。源模型独立于键形状信任 M:1。因最小参与数未定，1 映射 Optional，M／N 映射 Many0；不常见的原始 1:M 租户关系照声明保留。

## 其他修正与例外

- 设备和服务器粒度使用原始主键 id。
- 整理过的 KPI 载体也保留原始主键标记，其独立业务粒度标识采样行。Tenant.TENANT_ID 与 Site.SITE_ID 是补充业务身份，因原 isPK 为 N 而显式记录。
- 原始整数时间戳都用标准 EpochMillis；源未确立单位时声明带 TODO。按 #44，datetime KPI 用已确认 UTC 语义的 DatetimeUtc，SQLite 编码为 YYYY-MM-DDTHH:MM:SSZ，替代 #41 空格分隔 Utc1 假设。源声明 YYYY-MM-DD 制造日期用 DateUtc。这些暂定决策写在作者审计材料，不转嫁为查询 Agent 的问题；知识发布当前模型契约，见[时间覆盖](TIME_COVERAGE.md)。
- 移除固定 subject／authorize 层，查询与发现工厂仅绑定准备模型及相关后端／领域。维度可见性仍属模型能力，认证由宿主负责。
- 仅源载体暴露原始字段，不虚构采样粒度。在线率 Avg／Min／Max 表示存储值算术平均或极值，不按时间或有效计数加权，不建立样本唯一性或推断数值比例。时间按上述显式约定。UUID／IP 用 String，float／double 用 Float，integer／long 用 Int。目录保留可空性，运行时标量类型描述非空值，不构成 NOT NULL 断言。
- 每个源枚举编码都有表示。EnterpriseSlot.operstatus 的内嵌 JSON 格式错误，其 12 个值显式从当前 network/entity_sets/slot_values.telora 恢复。
- EnterpriseOpticalModule_X_TENANT_VIEW 引用不存在的 tenantId，SYS_StorageDisk_StorageHardDriveKPI 引用不存在的 SYS_StorageDisk.id；两原关系按记录原因排除。
- 派生告警／站点保护条件和物理链路 A/Z 参与仍是显式业务关系，PON ONU／OLT 载体保留限定业务角色。

## 字段能力

#34 按[字段能力策略](FIELD_CAPABILITIES.md)对齐整个源模型。
名称、别名、版本、SN、开放描述／产品标签和地址表示采用一致文本搜索能力；规范值、身份及时钟保持语义边界。
生成、对齐和编译模型审计共享该源策略，不绑定单个查询示例。

原始地址仍存为 String。17 个显式计算 IPv4 视图仅保留规范 IPv4，其他表示返回 NULL，不声称源编码已获证明。
原维度仍供字面文本搜索，不新增物理字段或关系。

完整准备模型发布 245 个可搜索文本维度和 17 个 IPv4 视图。源审计按类别报告覆盖，并检查每项发布能力，不限于代表查询。

## 验证命令

```sh
bin/telora -C icloud_model eval @src/source_audit:report --with-memory-limit 1024 > /tmp/icloud-prepared.json
mise x -- python3 scripts/audit-icloud-model.py /tmp/icloud-prepared.json --metadata ../imaster-cloud/.compact/metadata
bin/telora -C icloud_model test graph --request-fuel 10000 --with-memory-limit 1024
bin/telora -C icloud_model test knowledge --initialization-fuel 100000 --request-fuel 500000 --with-memory-limit 1024
bin/telora -C icloud_model test pressure_graph --request-fuel 10000 --with-memory-limit 1024
```

审计比较编译后的物理字段／类型、枚举编码、关系键、基数与源证据，并检查全部源哈希。
graph 和 knowledge 测试产品模型。历史 198 个压力案例使用 tests/pressure_graph/model_fixture.telora，通过不证明源正确性；DOMAIN.md 和 PRESSURE_FAMILIES.md 描述此合成夹具。

构建并验证当前发布：

```sh
bin/telora -C icloud_model build icloud_model --snapshot -o bin/icloud_model.snapshot.wasm --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 1024
mise x -- python3 scripts/check-icloud-publication.py /tmp/icloud-prepared.json bin/icloud_model.snapshot.wasm
```

发布探测读取全部 50 个数据集、126 个关系及每个授权维度文档，检查索引唯一性、引用闭包、公开操作符／类型和 IPv4 视图契约，
并转换版本后缀搜索、字面地址搜索、IPv4 子网搜索及使用整数告警严重度编码的毫秒窗口。
`../data/source_audit_summary.json` 记录最终编译覆盖检查。
