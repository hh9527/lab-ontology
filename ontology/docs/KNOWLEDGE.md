# 模型知识契约

模型发布领域知识事实：稳定身份、描述、关系、逻辑类型、值和已声明业务约束。
工具用法、请求语法、检索方法和 Agent 工作流由消费方负责。宿主收集完整图，并可向 Agent 暴露紧凑投影。

## 构建期发布与静态程序

IC 通过 `ontology::publication::stage` 从同一准备结果导出模型知识、类型与查询契约。
Wasm custom section `telora.build.information` 使用 `{version:1,entries:{...}}` envelope。
`entries["ontology.knowledge"]` 为 `{knowledge_contract:"ontology-knowledge-javascript-v1",program,data}`。

program 是 ontology 的固定 JS 函数体，同一版本对所有模型完全一致。模型标注只派生 JSON，不生成 JS 源码。
data 为 `{revision,instructions}`，instructions 的每项为 `[operation,...args]`。当前顺序为完整类型表 types、Entity、Dataset、能力和关系；领域操作由静态程序解释，插件无需理解其含义。

插件 JSON.parse 构建信息后执行：

```js
const buildKnowledge = new Function("data", publication.program);
const { graph, vocabulary } = buildKnowledge(publication.data);
```

插件信任模型代码，直接同步执行。静态程序使用 Map／Set 和原地更新，负责规范地址、SHA256 Group 哈希、类型内联、节点展开与事实合并；输入 JSON 保持不变。构图状态只在一次调用中使用，不经跨调用序列化。

最终 graph 使用 `ontology-knowledge-v5` 图结构，含 facts 和 items。vocabulary 每项为 `{key,kind,name,doc,aliases,owner,ownerValue}`，供消费方词汇发现使用。插件验证词条身份及唯一性，外部展示文件可补充说明和别名。编译、执行或验证错误直接拒绝加载，成功结果按模型及外部展示身份缓存。

库的 `knowledge::export` 保留完整图等价验收参考实现；默认构建使用 `knowledge::publication`。

## 最终知识事实
每条独立事实为 `{key,value,references,reference_sites}`。独立根为 Dataset、Entity、Type；字段、角色、维度、指标和值域成员作为所属根的内容发布；关系通过顶层描述表交换。references 连接独立根，reference_sites 记录内容中的精确引用位置。
消费方必须校验契约与引用闭合，再从事实派生成员导航、语义链接和反向链接；展示条目不授予查询权限。

Entity 表达独立业务身份，Dataset 表达来源、粒度与时钟。Role 以完整身份映射关联 Dataset 与 Entity。
DimensionGroup／MeasureGroup 和绑定用于模型内部复用，发布时将语义展开到 Dataset 的维度和指标内容。关系保留完整端点信息，由插件生成来源 Dataset 的 peers/by 导航。具体地址以输出 key 为准。

Int、Float、Bool、String 及内置 Option、Array、Dict 不生成类型节点，也就没有其反向链接。
类型字段内联表达，例如 `Array(Option(Dict(types/<业务类型地址>)))`；其中具名业务类型的引用仍保留。
领域 newtype、领域枚举保留节点。Dataset 行记录和 Entity 身份记录内联展开；独立领域记录通过 `@knowledge_policy::independent_type()` 声明。
仅当领域类型显式允许反向导航，且拥有封闭或半封闭的已知成员时，才生成从类型到使用位置的反向连接。
源编码取值清单保存在对应维度的 `canonical_values` 中，不产生具名 Type。领域 enum 的成员编码来自 variant property，同一份声明支撑 transform 与知识发布。

P1 支撑运行期程序，P2 支撑上述外部知识；运行期不重跑准备或发现。
宿主直接读取 custom section，并可从 `<model>.knowledge-items.json` 补充名称和文档。
插件只读取 `telora.build.information`；重复或损坏的新段均拒绝，旧 `telora.service.metadata` 不作为知识来源。

## 字段与关系的一致性

字段的 `type` 保留业务逻辑类型，`storage_type` 保留物理标量表示，`nullable` 单独描述可空性。具名类型及 Reference 继续参与引用闭合；物理列的 String／Int／Float 不替代业务类型。单位从逻辑类型继承，显式字段单位与类型一致。维度与度量仍独立发布各自的查询能力。

字段角色由完整身份及 Reference 映射、enum 值域和样本声明派生，并合并显式称谓／分类／指标标注。它们提供知识用途，不授予查询权限；完整 Role 的 parts 同时保留，单个复合身份分量不被当作完整身份。

Relation 的 `source_names` 记录来源定义名称，不创建额外的路径或查询符号。canonical 关系的正反向基数、端点、连接键与 guard 保持独立可读；来源追溯与遍历语义分别表达。
