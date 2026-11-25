# 时间覆盖

字段的 TimeField 保留物理编码与时间语义。DateTimeUtc 使用 UTC 语义，SQLite 采用规范毫秒精度 ISO-Z 文本，PostgreSQL 使用 timestamptz；EpochMillis 表达整数毫秒。Date 表达日历日期。

时间类型不证明唯一性、固定采集周期、样本总体或数据库当前时钟。时间窗口是否可用、允许哪些比较，以及能否分桶，由模型声明。

NetworkCellLinkQualityKPI、NetworkCellLinkTrafficKPI、PonDeviceEthernetPortKPI、PonDeviceOnuKPI 使用资源身份与 UTC 采集时间组成采样 grain。`resId` 指代采样资源，不能单独唯一定位跨时刻的采样记录。来源核对依据维护在 `source_exceptions.json` 的 sampling_grains，生成契约使用相同键。

`source_audit` 从当前准备模型导出字段时间信息，覆盖 50 个数据集的 46 项字段时间声明。来源目录用于核对编码证据；元数据缺少单位时不把字段名称当成单位证明。

```sh
node scripts/export-icloud-audit.mjs "$TMPDIR/ic-source-audit.json"
node scripts/check-icloud-source.mjs "$TMPDIR/ic-source-audit.json"
```

UTC 和地区分桶的通用证明在 ontology 的时间验收中；IC 的查询结果保留模型发布的业务时间类型。

ONU KPI 的完整采样键为 `(resId, ts)`；tenantId 表达租户归属，不区分同一资源同一时刻的重复采样。
