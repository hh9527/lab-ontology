# RFC 0005：静态 JavaScript 与模型 JSON 共同构建知识图

- 状态：已实现并通过隔离验收及 10924 体验部署
- 跟踪：https://github.com/hh9527/lab-ontology/issues/65
- 范围：ontology 静态知识构图程序、模型 JSON 描述及 dsh-oks 执行入口

## 目的

同一模型在构建期间准备 transform 状态和知识 JSON。静态 JavaScript 表达通用构图规则，JSON 表达具体模型的声明；插件将二者组合，得到 `{graph,vocabulary}`。

静态 JS 是 ontology 源码资源，同一版本对所有模型内容完全一致。模型标注只派生 JSON，不拼接、生成或插值 JS 调用代码。插件理解函数入口及结果结构，领域操作含义由静态程序定义。

## 发布结构

Wasm custom section `telora.build.information` 的 `entries["ontology.knowledge"]` 为：

```json
{
  "knowledge_contract": "ontology-knowledge-javascript-v1",
  "program": "静态 JS 函数体",
  "data": {
    "revision": "模型版本",
    "instructions": [
      ["types", []],
      ["entity", {}],
      ["dataset", {}],
      ["capabilities", {}],
      ["relations", {}]
    ]
  }
}
```

JS 作为静态资源原样嵌入构建信息，与 JSON 成对发布，保证模型和解释规则版本一致。资源嵌入工具只把固定源码编码为 Telora 字符串，并提供漂移检查；不根据具体模型生成代码。

JSON 指令按依赖顺序发布：先一次性建立类型描述表，再构造 Entity、Dataset、能力和关系。`types` 接收完整类型表以支持前向类型引用。每条指令为 `[operation,...args]`；静态程序维护 state，完成后统一 finish。

## 插件执行

插件从 custom section 读取并 JSON.parse 发布信息，取得解析后的 data，然后执行：

```js
const buildKnowledge = new Function("data", publication.program);
const { graph, vocabulary } = buildKnowledge(publication.data);
```

静态程序的语义为：

```js
const state = initialize(data.revision);
for (const [operation, ...args] of data.instructions) {
  operations[operation](state, ...args);
}
return finish(state);
```

插件信任模型代码，直接同步执行 new Function，不使用 eval，不设计沙箱或宣称其拥有隔离和强制超时能力。只传模型 JSON，不传文件、网络、Service 或 transform handler。错误向上传播，失败不进入知识索引缓存；成功结果继续按模型与外部展示身份缓存。

程序以 Map／Set 索引和去重，原地合并事实，不反复序列化 state。规范地址、内容哈希、类型表达、Group 展开和事实组织均由静态 JS 完成。不同模型共用同一程序，模型输入数据可重复使用且不被修改。

## 输出与领域边界

最终 graph 使用 `ontology-knowledge-v4` 图结构，包含 facts 和 items。vocabulary 含 Term 字段 `{key,kind,name,doc,aliases,owner,ownerValue}`，用于 va_ask。插件继续验证地址、事实唯一性、引用闭合及词条身份，并派生成员导航与反向链接；外部展示条目可补名称和文档。

紧凑 JSON 涵盖类型、Entity／Dataset／Role、字段与时钟、DimensionGroup／MeasureGroup 绑定、业务域、样本、查询能力、关系、备选关系及业务连接。来源是同一个 Prepared，不重新解释 transform 权限。类型闭包去重算法保持原样，单独处理性能优化。

插件知识入口只支持本 RFC 发布。旧完整 v4 发布、jq discovery／expand 和运行期 discovery/info 不作为知识来源。完整图导出仅保留为等价性验收参考，v4 仍是最终图格式。

## 验收

先更新 RFC，再实施模型 JSON、静态 JS 嵌入及插件执行。跨模型检查 program 字节一致，证明构图源码不包含具体模型数据。

使用完整导出作为基线，逐项比较事实地址、value、引用集合及 vocabulary。覆盖 5／10／20／40 Dataset、relation、共享 Group、Bool／内置容器／具名类型、组合表达式及 IC。验证 JSON 指令产生与静态 JS 协议一致、输入不变、坏指令和坏输出拒绝、外部展示与 va_ask 接通。

在隔离目录重新测量构建期准备、总构建、P2／Wasm 体积、插件首次构图及导航／词表分项，并运行 transform／SQLite、插件完整检查及新 IC smoke。合入和部署另行授权。

## 决策依据与历史

早期 jq discovery／expand 实现和评测留在历史提交及实验记录，不继续作为正式方案推进。原因是本场景数据在构建期封闭，动态路径采集和 state 往返增加了复杂度与成本。

[外置静态 JS 实验](../experiments/javascript-knowledge/README.md)在相同 IC JSON 上测得：jq 构图 1962.60 ms、单次 jq 1551.09 ms、JS 指令 79.38 ms；包含插件校验／导航／词表和实验序列化的总计为 2231.32 → 347.92 ms。三次独立进程取中位数，4558 条事实及词表等价。直接调用 JS 与指令派发差异小，因此选择表达清晰的 JSON 指令。

这些是外置程序实验数据；正式嵌入及重构后的构建和首次加载收益须重新验收。

正式制品、构建阶段与插件侧分布及验收结果见 [验收记录](../evaluations/static-javascript-knowledge.md)。
