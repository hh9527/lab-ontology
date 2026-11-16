# 字段能力

业务类型限定可计算的运算范围，字段 Property 在承载场景中进一步授予或约束查询能力。字段声明维护在 `src/typed/`。

- `semantic::attribute` 表达概念属性，groups/values/samples 声明具体查询能力
- Reference 通过身份类型表达指代；JOIN 由外置 Relation 授权
- 称谓允许的匹配方式由字段声明，String 不自动授予所有文本操作
- 分类可以保留原始字段并映射到 enum；半开放分类显式声明 Unknown，wire 合并由映射表达
- 指标的均值、极值、最新值、求和与总体分别声明，不能从单位或物理 Float 推断可加性
- 时间类型与物理编码分离，时间窗口和分桶能力由模型显式发布

使用以下命令核对编译准备后的事实，避免从源码文本重新推导声明。

```sh
node scripts/export-icloud-audit.mjs "$TMPDIR/ic-source-audit.json"
node scripts/check-icloud-source.mjs "$TMPDIR/ic-source-audit.json"
```

知识与 DARI 契约共享当前模型载荷，完整验收见 [类型模型](TYPED_MIGRATION.md#验收)。
