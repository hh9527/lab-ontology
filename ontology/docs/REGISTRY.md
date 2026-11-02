# 类型驱动的领域注册

领域定义由具名类型和 property 构成。Dataset 与 Entity 是显式注册根；字段、值域、样本及关系作为所属定义的内容登记。共享业务 Type 从引用自动收集。

独立知识节点为 Entity / Dataset / Type。发现入口为 Entity / Dataset / Relation；Type 通过字段、维度、度量及实体身份的类型引用发现。关系定义以顶层描述表传给插件，插件从同一份描述派生 Dataset 的 `peers/by` 导航及 cap 路径索引，关系描述本身不计入独立知识节点。

```telora
use ontology::registry as registry;
use ontology::groups as g;

@registry::dataset("frame", "I_EnterpriseFrame", [])
type IEnterpriseFrame = struct {
    @g::search("frame_name")
    name: String,
};
```

`registry::dataset(id, source, grain)` 分别声明领域名称、物理来源和完整粒度。空 grain 表示未声明唯一粒度；reference 字段不会自动成为主键。

`@registry::entity(id)` 标注实体身份结构。`registry::dataset_of(T.type)` 和 `registry::entity_of(T.type)` 提供带类型的引用，供角色及计算表达式使用。

## 注册语义

Dataset 和 Entity 标注产生统一的 `RootSpec` property。ontology 为具有该 property 的类型提供 `Registerable` trait 实现：

```telora
trait Registerable {
    register: Fn(Registry) -> Registry,
};
```

`registry::Registerable(T).register(r)` 与 `registry::register_type(r, T.type)` 使用同一实现。注册返回新 Registry，按类型身份保证同一根重复注册的幂等性。`register_types` 批量去重后再展开根定义，使用封闭的 pipeline 收集及不可变索引；`define` 使用同一批量入口。不同类型声明相同领域名称属于冲突，在构造 World 时诊断。

`registry::define(revision, roots, relations, profile)` 从根类型清单注册得到 World。World 的 transform 准备和知识发布消费同一组定义。注册只收集定义，不读取业务数据。局部检查结果和根定义分别由 TypeMemorizer 按精确 Type 缓存；缓存只影响重复计算成本，不参与“是否已注册”的语义判断，独立 Registry 的结果与缓存预热顺序无关。引用可以前向出现。注册时检查身份、字段映射、粒度和局部能力；构造 World 时检查 profile、根名称及 Relation 边界。Relation 的 Dataset 和角色必须在显式根集合内。维度和度量名称限定在所属 Dataset 内；自动发现内容无需重复检查覆盖度。transform 准备消费已检查的定义。

## 类型上的能力

- `roles` 声明 Dataset 的实体角色
- `groups` 声明跨字段表达式或组合视图；直接字段维度使用字段 property
- `record_counts`、`field_counts`、`computed_counts` 声明统计能力
- `metric(field)`、`event(field)` 显式选择 Dataset 种类和权威时钟
- `scope` 声明固定的数据范围
- `reported_samples` 声明上报样本及其统计口径
- `native_pairs` 声明成对维度
- `relations`、`alternatives`、`links` 声明关系及遍历能力

能力标注由 ontology 转换为纯函数步骤，折叠到 Dataset 定义中。闭包由 ontology 内部创建；领域层使用标注和定义表达式。关系不要求目标先注册，且不会自动扩展独立根清单。

`registry::declaration(T.type)` 提供单个类型的派生声明，供显式模型检查及现有引用使用。最终 World 通过根清单统一生成。

## 验收 IC

```sh
bin/telora -C ontology test registry
bin/telora -C ontology test result_columns
bin/telora -C ontology test graph_pair --initialization-fuel 20000 --request-fuel 20000
bin/telora -C ontology test ontology/intent --initialization-fuel 30000 --request-fuel 30000
python3 scripts/check-ic-registry.py
```

Graph 配对和 Intent 回归套件使用独立的测试 fuel 配额，覆盖较大的测试夹具和多次查询；这些参数只作用于当前测试命令。

IC 模型自检脚本复制源码到临时工作区，以定义入口代替 MainService 入口，避免测试初始化触发服务的 build-time stage。完整模型定义在该隔离检查中使用构建阶段四倍的 fuel 上限和相同的内存配额；运行配置和部署制品不受影响。

## NS 模型

NS 的生成器将来源契约转换为 Dataset / Entity 根类型及字段 property。Dataset 类型以物理来源表命名；`model.telora` 汇总根清单和完整关系描述表。关系集中定义，避免 Dataset 模块之间的循环导入。

`@g::field_view(group, id, projectable, filters)` 将字段发布为共享维度组的视图。组保留类型及能力上限，字段声明本地发布名称、投影和过滤能力；字段基础类型必须与组类型一致。`@v::field_domain(...)` 声明带枚举映射的分类维度。跨字段、时间分桶及样本统计使用类型级能力标注。

生成器先格式化源码，再计算 `generation-contract.json` 的源码哈希。连续生成结果一致。

```sh
python3 ns_model/tools/generate_model.py
python3 scripts/check-model-registry.py ns_model
```

NS 的隔离检查使用定义入口，触发注册时局部检查及 World 关系边界检查。`world::self_check` 提供边界诊断，不重复准备完整 transform 或遍历自动发现内容。

诊断时可用 `--fuel` 显式设置隔离检查的初始化和请求 fuel，单位为百万；内存沿用构建配额，项目配置和部署制品保持原有配额。
