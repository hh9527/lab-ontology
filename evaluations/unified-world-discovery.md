# World 自动发现与正式 API

当前模型入口为 `ontology::{world, transform}`，不保留 `experimental` 路径。
旧版注解 EDSL 的知识接口独立保留在 `ontology::legacy_knowledge`，并非新版 API 的别名。

World 声明 Dataset、Relation 等独立根；可额外声明不被 Dataset 引用的 Entity。
Entity 默认从角色发现，具名类型沿字段、身份、绑定与表达式引用自动发现。
不提供 `type_entry`、手工类型清单或显式类型模式。
未引用的类型不发布。Int、Float、Bool、String 及 Option/Array/Dict 容器不产生独立类型知识节点；容器内部引用的具名类型继续发现。

字段类型投影用 TypeMemorizer 缓存，发布共享 field_types 表；IC 与 NS 使用同一套知识生成与渲染逻辑。

## 隔离构建测量

| 模型 | 原准备 | 当前准备 | 原总构建 | 当前总构建 | 原线性内存 | 当前线性内存 |
| --- | --- | --- | --- | --- | --- | --- |
| IC | 11.71 s | 11.19 s | 24.01 s | 23.86 s | 28.19 MiB | 35.50 MiB |
| NS | 51.16 s | 36.10 s | 71.36 s | 55.96 s | 116.81 MiB | 84.75 MiB |

IC 的缓存使线性内存增加约 7.31 MiB；NS 的重复投影消除后内存和耗时均下降。
此为单次测量，不代表统计分布。构建目录隔离，未更新部署模型。

知识对比允许正式 API 带来的标准类型限定名和派生 Group ID 变化，按完整 Group 值匹配，并验证非类型事实与具名类型字段等价及引用完整性。
IC 移除 82 个匿名类型节点；NS 移除 236 个匿名类型节点及没有入向引用的 Date。
