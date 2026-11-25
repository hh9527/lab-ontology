# IC 类型模型

## 模型定义

`src/typed.telora` 声明 revision、roots、plan_profile，并从 `ontology::semantic` 准备模型。`src/typed/` 按源数据集组织声明，身份和分类共享 inventory、classifications 等模块。设备清单与设备采样通过同一个 device_class_domain 绑定来源映射。

业务身份使用 newtype 或具名 struct，字段使用 Reference 表达指代，外置 Relation 声明连接键、方向及基数。联合定位可用 `@domain::role(name, Identity.type, {part: "field"})` 将多个现有字段映射到完整身份，而不增加物理列或声明唯一粒度。字段的物理映射、查询能力和统计含义由 Property 声明。封闭值域字段直接使用 enum；非封闭来源通过类型级 `values::computed` 声明平行计算分类字段，原始字段仍独立发布。排序由 enum 的 `order_by_itag` 与互异整数标签共同授权。

字段视图使用 `g::view` 从字段类型推导类型与可空性；业务类型继承单位，主体由明确的身份绑定派生。查询授权、记录 grain 与业务身份保持独立。来源同义关系合并为一个可正反向遍历的符号，原始名称保留在 `relations::sources`。

当前模型包含 50 个数据集，对应 48 张来源表；PON 角色数据集可共享物理表。没有来源唯一性证据的表允许没有 grain，主体字段本身不证明唯一性。

## 服务边界

- `src/lib.telora`：统一模型服务，通过 publication::stage 一次准备并发布知识、公开类型、codec 和转换契约
- `src/hosted.telora`：主服务的部署入口
- `src/source_audit.telora`：来源审计导出，供隔离审计工具使用

服务槽为 `ontology/model`，请求为 `{method, input}`：`contract` 返回公开目录与 codec，`transform` 将类型化意图转换为参数化 SQL、结果类型、上界及证明凭据。全量知识随同一个 Wasm 的 `ontology.knowledge` 元数据发布。

类型、codec、契约摘要及查询证明由 ontology 的通用发布器生成。参数值在执行期通过 codec 绑定到既定计划；执行期无需模型调用。服务不执行数据库查询。

## 验收

临时目录由调用环境指定，使用 release 编译器。

```sh
node scripts/export-icloud-audit.mjs "$TMPDIR/ic-source-audit.json"
node scripts/check-icloud-source.mjs "$TMPDIR/ic-source-audit.json"
bin/telora -C icloud_model build @src/lib --staged \
  --initialization-fuel 400000 --request-fuel 100000 --with-memory-limit 2048 \
  -o "$TMPDIR/ic-service.wasm"
node scripts/check-model-publication.mjs "$TMPDIR/ic-service.wasm" \
  /path/to/dari/packages/dari-model/src/telora-model.ts
node scripts/check-icloud-resource-roles.mjs "$TMPDIR/ic-service.wasm" \
  /path/to/dari/packages/dari-model/src/telora-model.ts
node scripts/check-icloud-grain-quantities.mjs "$TMPDIR/ic-service.wasm" \
  /path/to/dari/packages/dari-model/src/telora-model.ts
node icloud_model/tests/semantic-knowledge.mjs "$TMPDIR/ic-service.wasm"
```

来源审计核对物理字段，以及全部 97 条来源关系条件；网络光模块租户和存储磁盘 KPI 的连接字段采用 corpus 已补齐的来源契约，依据记录在 source_exceptions。统一制品验收核对全量知识与查询目录一致，并为全部 50 个数据集转换查询计划；关闭模型通道后，在内存 SQLite 上复用同一计划绑定不同参数及常量。查询内核的样本统计、空总体、分类映射、IPv4、计数、Latest、GraphPair、GraphUnion 等能力由对应的内核测试独立验收。

必要的通用查询能力由 ontology/tests/semantic_model、semantic_lowering 和 publication 验收；IC 的具名映射由 tests/mapped_pon 及其运行脚本验收；tests/source-relations.json 列出需要独立 SQL 种子验收的关系，包括联合键、射频父设备及物理链路 A/Z 端点。

## 来源契约补齐

来源目录在原始字段基础上纳入 `icloud-corpus` 的五列补充：

| 表 | 字段 | 依据 |
| --- | --- | --- |
| NetworkDeviceKPI | nePingRespTime | corpus `c7982fd`，RFC 0005 GAP-3 补回设备响应时间 |
| NetworkAPKPI | hwApMemoryUseRate | corpus `c7982fd`，RFC 0005 GAP-4 补回 AP 内存利用率 |
| EnterpriseOpticalModule | id、tenantId | corpus `adb57f7`，MD-2 补齐身份和已声明租户关系的连接列 |
| SYS_StorageDisk | id | corpus `adb57f7`，MD-1 补齐身份和已声明硬盘 KPI 关系的连接列 |

前两列有原始 schema 遗漏的核对记录；后三列采用 corpus 演化后的契约，不能用这些补齐记录倒推旧快照或生产库已有对应列。逐项来源保存在 `data/source_exceptions.json` 的 `source_updates`，生成器按同一版目录构造物理表。

本批验收：

```sh
node --experimental-strip-types scripts/check-icloud-fact-gaps.mjs "$TMPDIR/ic-model.wasm" "$DARI_MODEL_ADAPTER"
just --justfile "$EXAM_REPO/justfile" test-data "$PWD/icloud_model/data/generation-contract.json" "$PWD/icloud_model/data/source_catalog.json"
```
