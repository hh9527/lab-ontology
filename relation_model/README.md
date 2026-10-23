# 关系模型示例

此精简模型声明租户、站点、设备、连接和有向路由，展示复合身份、具名关系及显式业务连通性。
声明见 [model.telora](src/model.telora)，支持与拒绝的组合见[验收说明](ACCEPTANCE.md)。

`relation_model` 服务暴露单一领域 `relation`：

| 方法 | 输入 | 结果 |
| --- | --- | --- |
| `relation/info` | `{"key":"index"}` 或发现的键 | 知识文档 |
| `relation/discovery` | `{}` | 版本、根、键模式和词汇 |
| `relation/transform` | `{"intents":[...]}` | 带索引诊断及 SQLite 查询 |

各方法也有同路径加 `/` 前缀的 HTTP POST 路由。服务生成 SQL 和绑定，由宿主执行。

将兼容 Telora 二进制放在 `bin/telora` 和 `bin/telora-run` 后，从仓库根目录构建：

```sh
node scripts/build-knowledge-snapshot.mjs --module relation_model \
  --domain relation --output /tmp/relation-model.wasm
bin/telora-run /tmp/relation-model.wasm --serve stdio+jsonl://
```

每行发送一个 JSON 请求：

```json
{"method":"relation/info","input":{"key":"index"}}
{"method":"relation/transform","input":{"intents":[{"op":"Graph","root":"device","nodes":[{"id":"device","entity":"device"}],"edges":[],"select":[{"node":"device","dimension":"device_id"}]}]}}
```

完整服务及 Intent 契约见[使用说明](../USAGE.md)。
