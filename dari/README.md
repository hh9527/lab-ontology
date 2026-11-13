# DARI 类型化数据流语言

注释使用 `#`，从 `#` 到行尾。字符串中的 `#` 是普通字符。

扩展名为 `.dari`，定位是围绕数据获取、处理和展现的流水线定义语言：声明式、强类型、有边界、本地与远程两阶段证明。data 声明可缓存的数据节点，let 命名节点内部的计划片段，不产生新的物化边界。语言核心通过 JSONL 服务接入插件，模型以独立 ABI 提供类型证明和参数化查询计划。主阅读入口为 [device.dari](examples/device.dari)，展示静态模型 query_remote! 与后续 query!；[ic-device.dari](examples/ic-device.dari) 使用真实 IC 模型的符号与类型 ABI。

## 运行

需要支持直接运行 TypeScript 和 `node:sqlite` 的 Node.js，本次使用 v26.13.0。语言核心没有第三方依赖；生产展现通过 HostPort 使用 dsh-oks 的图表依赖。

在仓库根目录运行：

```sh
node dari/cli.ts check dari/examples/device.dari --fixture-model
node dari/test.ts
node dari/cli.ts resolve dari/examples/device.dari /path/to/database.sqlite '{"request":{"floor":50}}' /path/to/output --fixture-model
```

主样例使用内置的单 Dataset 模型夹具（显式加 `--fixture-model`），不是已发布的 IC 模型。数据库需要 `devices(id TEXT, name TEXT, cpu REAL, tenant TEXT)` 表。resolve 只读数据库，将 answer.md、HTML 和 SVG 写入输出目录。测试使用内存数据库，不修改外部数据库或运行产物。

source-select.dari 只能通过 `node dari/test.ts` 的测试包装器运行；enum.dari 由 `node dari/ic-test.ts /path/to/ic-dari.wasm` 内的 enum 验证运行。这两个物理表夹具不接受普通 CLI 运行。context 例子仅提供 API 入口，CLI 当前不配置 context Schema 或值。

type 和 data 按依赖顺序声明，只能引用先前定义；当前不支持前向引用。

## query! 的类型推导

整体语义与分阶段计划见 [语言设计](LANGUAGE.md)。本节的 source 样例仅用于内部物理表夹具，检查 API 必须显式设置 allowTestSources；默认检查和 CLI 不开放该能力。正式模型查询见后文。

```text
type DeviceId = struct(String);
type Identity = Schema({id: DeviceId, name: String});
type Device = Identity & Schema({cpu: Float});
data devices: Table(Device) = source("devices");
type Params = Schema({floor: Float});
data request: Params = input();

data top = query! {
    let a = from(devices);
    let projected = a |> filter(a.cpu > request.floor)
      |> project({id: a.id, cpu: a.cpu});
    projected
      |> order_by(desc(projected.cpu))
      |> take(5)
};

data highest = query! {
    let a = from(top);
    let projected = a |> project({cpu: a.cpu});
    projected
      |> order_by(desc(projected.cpu))
      |> take_opt()
};
```

query! 直接引用外部绑定，check 只读取绑定类型，resolve 才使用参数值。局部源别名优先于同名外部绑定。投影结果通过 let 显式命名，后续使用该名称访问字段；紧随投影的排序也可引用当前阶段未输出的源字段。连续 filter/project 形成新的有类型阶段；连接使用 `join({a,b}, condition)` 或 `left_join(...)`。

`project(expr)` 根据记录对象或记录引用推导 Schema 行。单列也显式命名。末端算子决定容器：

| 元素类型 T | take(n) | take_opt() |
| --- | --- | --- |
| Schema({...}) | Table(Schema({...})) | Option(Schema({...})) |

`take_opt()` 取第一项，空则 None。存在多项可能时要求排序，无分组聚合至多一行，可以直接 take_opt。`take(n)` 要求排序和静态整数 1..500。take 后仍可处理有界表；输入已证明至多 500 行时，后续映射或筛选不要求重复 take。

Option 表示有没有行，行内字段用可空标量表达。运行时将 take_opt 的结果编码为 `{tag:"Some",value:{cpu:42}}` 或 `{tag:"None"}`，SQL 空值用 null 表示。因此没有行是 None，有行但字段为空是 Some({cpu:null})，不会产生可选标量的嵌套 Option。tree! 支持 `if let Some(row) = highest [...] else [...]`，成功分支获得行 Schema；字段为空可继续解构。query 同样支持 take_opt，由模型证明 take(1) 后返回可选行。

Schema 是扁平记录，字段限逻辑标量及其可空形式，嵌套 Schema 不合法。`&` 合并字段并拒绝类型冲突。业务 newtype 保留名义身份，不同 ID 类型不能直接比较。LEFT JOIN 将右侧字段变为可空类型。聚合检查分组字段；count 返回 Int，avg 返回 Option(Float)。封闭 enum 使用模型公开 variant 和 codec；半开放映射保留原始字段，并提供含 Unknown 的计算 enum 字段。

独立关系运算样例见 [source-select.dari](examples/source-select.dari)。展示使用 tree!、Answer、Report，以及展示宿主提供的图表组件，属性用 `=`。先用 `data highest_cpu = map_opt(highest, $.cpu);` 准备可选标量，再用 `UseValue(ref = highest_cpu)` 展示；空值显示无数据。Table 输出 Markdown 表格，图表直接内联，UseReport 引用报告产物。条件所有分支都检查类型，执行时只处理选中分支。SVG 内含图表最终输入数据。

## 静态模型取数

组件的字段选择使用 `$.field`，例如 `BarChart(data = top, spec = {category:$.name, value:$.cpu})`。这是内置的受限投影宏，只接受一个字段标识，由组件的 data 行 Schema 提供检查上下文，校验字段存在性和所需类型。它生成投影计划，不读取数据，也不消除可选行或字段的空值；不能独立绑定或传入任意表达式。语义相当于选择输入行的一个字段，语言不开放手写函数。

## 前序计算与展现边界

映射由 query! 的 `project({...})` 表达，可组合字段访问、有限算术、lookup 和 unwrap_or!，不需要手写函数。`lookup(value, [{value, label}, ...])` 使用非空静态表，键必须唯一且与输入逻辑类型一致，所有 label 必须是同一逻辑标量类型。未命中或输入为空时返回空值，结果类型为 Option(T)，可通过 unwrap_or! 显式提供默认值。query! 中的 lookup 编译为 SQL CASE，在数据库内完成映射；普通前序绑定也支持相同表达式。

```text
data rows = query! {
    let r = from(alarms);
    let projected = r |> project({
        label: unwrap_or!(lookup(r.severity, [
            {value: ic::AlarmSeverity::Critical, label: "紧急"},
            {value: ic::AlarmSeverity::Major, label: "重要"}
        ]), "其他"),
        count: r.count
    });
    projected |> order_by(desc(projected.count)) |> take(10)
};

```

tree! 组织组件、文本、数据引用和条件分支；字段属性使用直接投影。`UseValue(ref = a.b.c)` 只接受直接标量引用，lookup、算术等计算应先绑定或在 query! 中完成。条件仍允许有限布尔表达式及 is_empty，用于选择展示内容。

聚焦验证：`node dari/lookup-test.ts`。

## 空值默认值与标量引用

`unwrap_or!(value, default_expr)` 接收 Option(T) 和同一业务类型的 T，结果为 T。后置宏 `value.unwrap_or!(default_expr)` 展开为相同的前置形式；只有值为空时才求值默认表达式。普通计算和 query! 均支持，query! 中 lower 为 SQL COALESCE。query_remote! 仍由模型公开的表达式能力决定。

```text
data prepared = { cpu: map_opt(highest, $.cpu).unwrap_or!(default_cpu) };
answer tree! { Answer [UseValue(ref = prepared.cpu)] };
```

UseValue 的 ref 只接受直接引用，不接受字面量、调用或算术；记录与空值处理提前放在 data 中。precision 为可选展示精度，业务类型、引用标识和高亮保持不变。

## 模型 query_remote!

主样例 [device.dari](examples/device.dari) 使用静态模型符号：

~~~text
data readings = query_remote! {
    let a = from(ic::DeviceKpi);
    let projected = a |> filter(a.cpu_usage > request.floor)
      |> project({device: a.device_id, cpu: a.cpu_usage});
    projected
      |> order_by(desc(a.cpu_usage))
      |> take(5)
};
~~~

Dataset 是模型导出符号，节点是局部绑定，dimension/measure 是带类型、角色及所属 Dataset 的静态成员引用。字符串只表达数据值。输出自动推导为 Table(Schema({device: ic::DeviceId, cpu: Float}))，后续 query! 直接使用 device/cpu。

编译器构造 IntentType，模型的 check_type 校验能力并生成合法参数化计划和结果类型。resolve 才绑定实际参数，不重新规划。夹具和真实 IC 的单节点路径均已跑通，接口与边界见 [模型接入设计](MODEL-INTEGRATION.md)。

真实 IC 模型运行方式（在仓库根目录；构建不会更新部署产物）：

```sh
task_tmp_root=${TMPDIR:-$HOME/.cache/tmp}
mkdir -p "$task_tmp_root"
task_dari_dir=$(mktemp -d "$task_tmp_root/dari-ic.XXXXXX")
bin/telora -C icloud_model build @src/dari --output "$task_dari_dir/ic-dari.wasm" --staged --initialization-fuel 100000 --with-memory-limit 2048
node dari/ic-test.ts "$task_dari_dir/ic-dari.wasm"
```

IC 服务以完整 IC 载荷为基础，由模型直接发布全部 50 个 Dataset 的公共符号与类型契约，并对完整 IntentType 返回输入摘要和步骤消费凭据。测试创建内存 SQLite 表，核对 AVG、HAVING、参数绑定、业务类型保留、空结果，以及真实模型对错误阈值类型的拒绝。真实模型常驻独立进程，检查通过同步 ABI 桥接调用，执行只绑定已验证计划。

模型证明协议见 [MODEL-ABI.md](MODEL-ABI.md)。`node dari/proof-test.ts` 检查消费凭据校验；`node dari/abi-test.ts /path/to/ic-dari.wasm` 直接检查真实模型的步骤拒绝、符号发布和节点身份；`node dari/ic-contract-test.ts /path/to/ic-dari.wasm` 遍历全部 Dataset 的类型查询。

模型侧 `@js_codec::number_range(0.0, 100.0)` 声明输入 newtype 的约束，构建时生成 ES module，包含 `parse / encode / decode`。宿主加载生成模块，在 JS 本地完成参数解析、存储编码及结果解码，不回调模型。范围沿 newtype 包装继承。该模块同时写入构建信息 `dari.codecs`，可导出为文件：

```sh
node dari/export-codecs.ts "$task_dari_dir/ic-dari.wasm" "$task_dari_dir/codecs.mjs"
```

基础类型的解析与编码由 DARI 内置。模型只为去重后的自定义类型生成 codec，覆盖 newtype 数值范围、enum 编码与排序；源字段映射独立发布。生成模块导出 `createCodecs(primary)` 工厂，由宿主注入基础类型 codec。任意用户函数和跨参数校验尚未生成。IC 样例的 `ic::CpuFloor` 是实验输入类型，范围规则在模型中声明，宿主不包含对应业务常量。

## 阶段与执行

context 由宿主传入，不在语言中猜测时间或时区。检查时通过 `check(source, model, {contextType})` 提供 Schema，执行时通过 `resolve(program, db, inputs, {context})` 提供值。一次执行只解析一次 context 快照；模型计划还绑定 contractId 和 implementationId，模型契约或具体执行制品变化时必须重新检查。

1. 解析声明，计算有限类型；模型查询调用 check_type，关系运算推导投影和容器类型
2. resolve 校验输入，从 Answer 依赖开始按需求值，绑定已经检查的模型计划
3. 将 query! lowering 为 SQL，模型 SQL 可作为其子查询；数据库完成排序、筛选、连接、聚合和截取
4. 校验返回值类型，渲染回答与产物

没有 eval 或任意函数执行入口。运行缓存按声明保存结果；下游 SQL 引用前序计划时会内联，尚无跨 SQL 的物化复用。

## 验证与性能边界

聚焦验证覆盖 Schema 合并、字段诊断、名义 ID、LEFT JOIN、行投影串联、take_opt、可选行与可空字段、聚合分组、上界、参数绑定顺序、无数据分支，以及模型能力检查、生成的 JS codec 与参数绑定分离。

1,000 行内存 SQLite 样本，本机一次测试的热运行均值：check 约 0.19 ms（1,000 次），resolve 约 0.31 ms（200 次）。resolve 包括两段查询和回答/报告/图表的内存渲染，不包括进程启动、文件 I/O、模型加载和附件发布。尚未与现有 DARI 做等价端到端对照，不能据此宣称不劣化已经验收。

真实 IC 单节点样例通过持久 JSONL 桥接调用模型。运行 ic-test.ts 可获得当前构建的契约加载、首次及后续 check、resolve 和按值 transform 的单次测量；测量不等同于完整 agent loop 的性能验收，尚未确认与现有 DARI 完整链路相比不劣化。

## 能力与边界

- 真实 IC 契约覆盖全部 50 个 Dataset；查询支持多节点 Relation、成员投影、多个聚合阈值、文本和布尔维度筛选、隐藏排序、两期排名及可组合中间计划；支持 enum codec、字段映射和兼容量纲运算；模型示例入口为 IC
- 独立 source 的契约由作者声明，仅用于验证；生产 query_remote! 的契约必须由模型检查产生
- 单个 query! 支持两源连接、连续筛选和投影、分组、排序截取，可串联多个 query!
- project 始终产生 Schema 行，单列也需要列名；不支持标量 Table 或嵌套记录字段
- Option 支持 tree 内的 if let Some 分支；map_opt 可提前提取可选行字段，unwrap_or! 可提供完整行回退
- 图表复用全部 16 类生产组件，支持 Markdown 表格、受控 HTML 报告、图内 CSV/spec 和源码/context/执行溯源
- context 的类型和值由宿主分别提供；宿主通过 dari 配置接入工具、符号查询和提示词，context 契约为 dari-context/v2；日历窗口通过宿主提供；不开放自定义函数或递归类型，尚无 LSP

## 关系组合与完整输入验收

relation-test.ts 验证 Relation 的可选关联与模型检查；pair-test.ts 验证两期完整聚合、身份对齐和增长排名；model-composition-test.ts 验证未物化模型查询的 1,200 行聚合与 2,400 行集合合并；set-test.ts 验证集合、半连接、去重和分组 TopN。所有交付上界在 check 阶段证明，中间无上界计划只作为 SQL 子查询消费。
