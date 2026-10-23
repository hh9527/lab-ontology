# UQL 后端

`ontology::uql` 通过 `build_query(QueryAst) -> Query` 渲染共享 `QueryAst`。
实现移植自 Semora 提交 `0ca8adf585292fd5af6929f27b3422254d8d8421`，复用现有本体准备和转换流程，包括初始化优化。

在构造服务处理函数时选择渲染器：

```telora
use ontology::intent as intent;
use ontology::uql as uql;

def lower: Fn(Value) -> Value =
    intent::query_request_method_factory(payload, uql::build_query);
```

`payload` 是模型已有的 `PreparedPayload`；`Value` 从 `std::value` 导入。
后端由服务选择，所有请求使用同一后端。现有 SQLite 服务入口保留当前渲染器，无需依赖 Semora。

## 渲染契约

- 标识符使用反引号，必须通过共享标识符校验。
- 参数使用 `$n`，保留原始 `BuildCtx` 绑定索引和 `Query.bindings` 顺序，包括重复引用和嵌套查询。
- 处理全部七种 `QueryPlan`：Rows、DistinctRows、GroupCount、SetRows、SetCount、JoinedGroups、JoinedGroupCount；也处理限定作用域的源、连接、EXISTS、标量／排名比较、Latest、分区 Top-N 和最终输出上限。
- 筛选聚合在聚合内部使用 `CASE`。通过显式排序键保证升序 NULL 在前、降序 NULL 在后。
- ASCII 大小写折叠使用 `replace`，非 ASCII 文本保留原大小写。
- UTC 函数要求执行器以 UTC 解释时间。纪元小时／日分桶使用精确整数向下取整，包括负纪元；月分桶使用日历函数。超出受支持日历范围的输入返回 NULL。
- 由于此 UQL 契约未定义二进制文本排序规则，`BinaryText` 显式失败。没有 GROUP BY 的 HAVING 也显式拒绝。使用二进制前缀范围的 IPv4 子网筛选因此失败，而非改变比较语义。渲染失败通过现有带索引的批量诊断返回。

执行适配器必须支持所生成的 UQL 函数、窗口函数、参数化上限和 `$n` 绑定。
能完成渲染并不证明不同 UQL 引擎或底层数据源的执行等价性。

## 验证

从仓库根目录使用 release 版 Telora：

```sh
TELORA=../telora/target/release/telora
"$TELORA" --with-memory-limit 1024 -C ontology test uql
"$TELORA" --with-memory-limit 1024 -C ontology test uql_intent
python3 scripts/check-uql.py --telora "$TELORA"
```

`uql` 覆盖渲染契约与拒绝场景。`uql_intent` 覆盖模型转换、三种后端的绑定一致性、结果列、上限槽位和带索引的批量失败，包括不支持的二进制排序规则。
Python 检查在内存 SQLite 中执行 35 条生成查询，覆盖可移植 SQL 子集及纪元小时／日边界。
它不验证真实 UQL 引擎；日历／格式化函数和引擎专有正则行为仍需引擎集成检查。
