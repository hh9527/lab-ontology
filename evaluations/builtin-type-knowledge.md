# 内置类型的知识表达

## 当前契约

Int／Float／Bool／String 与 Option(T)／Array(T)／Dict(T) 使用内联类型表达式，不发布独立的类型知识节点，也不产生指向这些内置类型的引用边或反向导航。

字段、Group、Binding 和类型定义中的类型信息仍完整保留，例如 `Option(Int)`、`Dict(Bool)`、`Array(Option(Dict(types/<业务类型地址>)))`。模型具名类型、newtype 和具名枚举保留节点；容器内部的模型类型保留明确的引用边。值域使用内置标量时，值域定义保留在 Group 中，不为标量补建类型节点或类型成员节点。

生产者通过 Fact.references 发布实际知识节点之间的关系。插件继续校验引用闭合并派生导航，无需用过滤规则隐藏已生成的内置节点。类型字段中的内联表达式不是知识节点地址。

## 验收

- 反射夹具覆盖全部七类内置类型、嵌套容器、newtype、具名数组包装、具名 None／Some 枚举，验证类型信息与业务类型引用保留
- relation full/runtime 输出一致，引用闭合，共享 Group 的多个 Binding 保留
- IC 50 Dataset transform／SQLite、canonical filters、IPv4、count、Latest、GraphPair／Union、拒绝与重复请求回归通过
- 插件验证内联类型不生成节点或反向连接，直接读取新 IC 制品通过

| IC 指标 | 调整前 | 调整后 |
| --- | ---: | ---: |
| 类型节点 | 367 | 358 |
| 全部模型事实 | 4592 | 4583 |
| 派生连接 | 13970 | 11602 |
| 制品大小 | 14662283 bytes | 14555866 bytes |

本机单次构建约 49.64 秒，其中构建期准备约 37.32 秒；此变更主要减少知识图的公共汇聚点，尚未解决知识生成的主要耗时。

```sh
python3 scripts/check-inline-type-knowledge.py --telora <telora>
python3 scripts/check-initialization-knowledge.py --telora <telora> --runner <telora-run>
```
