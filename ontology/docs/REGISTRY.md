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

`registry::payload` 与 `registry::stage` 通过根清单统一准备模型。

## IC 模型

IC 使用 semantic 建模入口，模型准备和服务验收见 [IC 类型模型](../../icloud_model/docs/TYPED_MIGRATION.md)。

## NS 模型

NS 使用 semantic 建模入口，以具名身份、Reference、联合角色及外置关系约束业务可解空间。字段 Property 声明分类映射、统计及共享维度能力。模型组织、统一发布及隔离验收见 [NS 类型模型](../../ns_model/README.md)。
