# 来源与模型维护

## 事实来源

`data/source_catalog.json` 保存来源表、字段、关系条件及文件散列。`data/source_exceptions.json` 记录已审查的补充字段、身份依据、枚举恢复和无效来源关系。数据库结构是输入现状。

`src/typed/` 是业务模型的声明来源，维护存储映射、业务类型、可用算子、统计总体和关系。来源字段类型不自动授予业务运算能力；模型作者根据证据显式增强 Property。

## 更新步骤

1. 更新 source_catalog 并核对源文件散列
2. 在对应声明模块维护类型、字段映射、能力与外置关系
3. 使用 export-icloud-audit.mjs 导出当前模型，并运行 check-icloud-source.mjs
4. 执行 [模型验收](TYPED_MIGRATION.md#验收)
5. 涉及合成数据合同的变更，同步 generation-contract.json 并核对生成数据

来源审计不参与服务初始化，也不生成另一份 Telora 模型。所有有效来源关系必须有已发布的对应条件；缺失、错配或误发布被排除关系都会使审计失败。
