# 关系模型示例

此精简模型声明租户、站点、设备、连接和有向路由，展示复合身份、具名关系及显式业务连通性。
当前 transform 声明见 [typed_relations.telora](src/typed_relations.telora)，显式区分 Entity 身份、Dataset 行粒度和具名角色，并组合维度与记录计数。
[model.telora](src/model.telora) 保留为变换等价性基线，支持与拒绝的组合见[验收说明](ACCEPTANCE.md)。

`relation_model` 服务暴露单一领域 `relation`：

| 方法 | 输入 | 结果 |
| --- | --- | --- |
| `relation/transform` | `{"intents":[...]}` | 带索引诊断及 SQLite 查询 |

各方法也有同路径加 `/` 前缀的 HTTP POST 路由。服务生成 SQL 和绑定，由宿主执行。

将兼容 Telora 二进制放在 `bin/telora` 和 `bin/telora-run` 后，从仓库根目录构建：

```sh
bin/telora -C relation_model build relation_model --staged -o "$TMPDIR/relation-model.wasm"
bin/telora-run "$TMPDIR/relation-model.wasm" --serve stdio+jsonl://
```

每行发送一个 JSON 请求：

```json
{"method":"relation/transform","input":{"intents":[{"op":"Graph","root":"device","nodes":[{"id":"device","entity":"device"}],"edges":[],"select":[{"node":"device","dimension":"device_id"}]}]}}
```

完整服务及 Intent 契约见[使用说明](../USAGE.md)。

构建期通过 `experimental::build::stage` 从同一声明准备 transform 与静态知识；插件派生导航和反向链接，运行期不挂载 info／discovery。独立 `transform::self_check` 检查模型，transform 继续校验请求。

类型级声明通过 `ontology::experimental::declarations` 接入 Telora 的 Property evidence：

```telora
use ontology::ontology as edsl;
use ontology::experimental::declarations as decl;

@edsl::entity_id("device_identity")
type DeviceIdentity = struct { id: String };

@edsl::entity_id("devices")
@edsl::entity_source("device_inventory", "d")
@edsl::dataset(edsl::DatasetKind::Entity, ["id"], None)
type DeviceRow = struct { id: String };

def device = decl::entity(DeviceIdentity.type);
def inventory = decl::dataset(DeviceRow.type);
```

`EntityModel` 要求 `EntityId`；`DatasetModel` 要求 `EntityId` 和 `EntitySource`，可选读取 `DatasetSpec`。缺省 spec 表示 Entity、空 grain 和无时钟，不会猜测主键。`EntitySource.table` 是物理来源，alias 不参与 typed 角色或连接映射。缺少必需证据会在编译期拒绝，也可以手写 trait 实现代替注解，精确实现优先。

`decl::declare(Row.type, roles, groups, counts)` 保留 spec 的种类、粒度和 UTC 时钟，返回原有 transform 声明；角色和字段映射仍显式给出。初始化只准备 transform，完整模型校验仍由独立 `transform::self_check` 完成，输入校验保留在 transform 路径中。

这一层通过 trait evidence 封闭调用方的属性需求；A 保持保守的 Property provider 求值，B 的大小收益由通用构建期专门化提供。知识事实由同源准备结果导出。

验证声明证据与编译期拒绝：`python3 scripts/check-typed-declarations.py`；关系回归及 SQLite 等价验证：`python3 scripts/check-typed-relations.py`。


当前实验服务通过 `ontology::experimental::build::stage` 在构建期间准备 transform 与静态知识。
使用支持 RFC 0318 的 Telora 以 `build relation_model --staged -o relation_model.wasm` 构建；
普通运行期不会执行该准备过程。验收与 IC 测量见 [构建期双路产出](../evaluations/build-time-staging.md)。
