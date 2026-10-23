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
bin/telora -C relation_model build relation_model --snapshot -o "$TMPDIR/relation-model.wasm"
bin/telora-run "$TMPDIR/relation-model.wasm" --serve stdio+jsonl://
```

每行发送一个 JSON 请求：

```json
{"method":"relation/transform","input":{"intents":[{"op":"Graph","root":"device","nodes":[{"id":"device","entity":"device"}],"edges":[],"select":[{"node":"device","dimension":"device_id"}]}]}}
```

完整服务及 Intent 契约见[使用说明](../USAGE.md)。

当前 RFC 实验初始化只准备 transform，使用 `experimental::transform::build` 独立准备 Dataset、成员和角色关系，并共享查询权限、粒度和 profile 校验。
知识地图、info／discovery 初始化和知识测试留待后续知识契约阶段处理。
