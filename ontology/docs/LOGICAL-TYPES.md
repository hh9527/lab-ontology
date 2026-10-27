# 逻辑类型与字段能力

以下三个事实相互独立：

1. 物理存储编码值，如 String 或 Int。
2. 逻辑类型定义值域及操作含义。
3. 维度的 filterable／ops 声明选择该字段提供的能力，可以收窄类型操作，不能凭空创造操作。

索引、存储和查询成本可成为限制字段能力的原因，但当前 API 不检查数据库索引，也不从中推断权限。
仅支持 Eq 的 Text 维度不表示 Contains 对 Text 没有意义；反过来，String 存储也不会赋予所有逻辑类型 Text 操作。
现有时间声明按同一原则区分 DateTimeUtc、Date、DateTime 和 EpochMillis。

## IPv4 验收范围

```telora
@edsl::column("ip")
@edsl::logical_type(edsl::LogicalType::Ipv4)
@edsl::dimension("address", True, True,
    [edsl::FilterOp::Eq], [edsl::FilterInputKind::Ipv4])
ip: Option(String),
```

模型承诺规范点分十进制存储：恰好四段 0..255 八位组，无前导零、空白、端口、CIDR 后缀或其他记法。
Option(String) 允许 SQL NULL，表示缺失而非地址。准备阶段校验声明，不扫描数据库证明编码；未知格式源列不要使用此注解。

Ipv4 定义地址 Eq、Ne 以及受限网络 InSubnet、NotInSubnet。示例字段仅提供 Eq，声明 Ne 也合法。
Contains、StartsWith、EndsWith、字典序和 Min／Max 不是 IPv4 操作；独立声明的 Count 仍可用。
关系不能仅因都存为 String 就将 Ipv4 与普通 Text 等同。作用域和并集谓词保留带类型输入，不提供隐式文本视图转换。

Intent 仍使用普通 JSON 字符串，不带 kind：

```json
{"node":"host","dimension":"address","op":"Eq","value":"192.0.2.1"}
```

模型选择 Ipv4，校验后生成绑定 String 参数。在此受限规范编码下，SQLite 与 PostgreSQL 无需解析 IP。
带类型调用方使用 FilterInput::Ipv4，而非 FilterInput::Text。
字段知识发布显式 logical_type，维度知识发布 Ipv4 输入说明及实际字段 ops，字段链接指向通用逻辑类型知识契约。

这不是通用 IpAddress 支持：IPv6、原生 inet 存储及地址排序需要各自语义和后端计划，不用文本搜索近似。
现有 IC IP 列在表示形式和目标操作明确前保持不变，不从字段名自动推断类型。

对混合或未证明格式的源字符串，模型可通过 `canonical_ipv4_view`、Ipv4 输入和 Text 输出暴露独立计算维度。
这是显式部分转换：规范 IPv4 文本保留，NULL、IPv6、前导零、无效八位组及其他编码变为 NULL，原 Text 维度不改类型。
转换使用绑定正则校验和绑定 NULL 分支，在不同正则实现下均拒绝尾随换行；生成正则还使用 `?` 及否定字符类。

行内计算维度可投影、分组或统计不同值而不扩增行数。即使禁用筛选，准备时仍校验投影能力；正常图粒度、授权、作用域和逻辑操作检查继续生效。
转换有运行时校验成本，不承诺使用源列范围索引。

## 受限子网操作

字段可在 ops 中声明 InSubnet 和／或 NotInSubnet。Intent 传递不带 kind 的规范 CIDR 字符串，如 `"10.4.0.0/16"`。
操作符决定网络参数；Eq／Ne 仍要求单个地址。带类型调用方使用 FilterInput::Ipv4Subnet，any_of 仍枚举地址而非网络。

支持全部整数掩码 /0..32。网络主机位必须为零；`10.4.2.3/16` 被拒绝，不自动规范化。
不接受 IPv6 或其他掩码记法，仍要求相同规范点分十进制存储契约。

完整八位组构成二进制文本范围：前缀 `10.4.` 转为 `address >= bound("10.4.") AND address < bound("10.4/")`，排除 `10.40.0.1`。
SQLite 应用 COLLATE BINARY，PG 应用 COLLATE "C"。部分八位组增加生成的绑定正则，如 /20 枚举第三段的 16 个合法值；/1..7 仅使用正则，没有前缀预筛选。
生成模式使用公共子集：锚点、分组、十进制备选、`[.]` 和 `[0-9]{1,3}`。这些不是调用方提供的 SQL 或正则片段，全部边界和模式由不可变上下文分配绑定。

/32 使用绑定地址相等；/0 使用地址自身相等。NotInSubnet 对整个成员条件取反，而非仅正则或前缀。
NULL 不匹配任一操作。不使用原生 inet 或 SQL 反向解析。

PG 原生支持正则。SQLite 执行连接必须注册 `regexp(pattern, value)`：任一参数为 NULL 时返回 NULL，否则返回 1／0。
sqlite3 命令行的实现不代表 Python 或 Node 库连接也具备此能力。Node 的 node:sqlite 示例：

```js
db.function('regexp', { deterministic: true }, (pattern, value) => {
  if (pattern === null || value === null) return null;
  return new RegExp(pattern).test(value) ? 1 : 0;
});
```

范围条件使索引访问成为可能，并不强制使用。索引必须使用相同排序规则（SQLite BINARY，PG "C"）；数据库统计和优化器决定计划，否定成员判断可能无法受益。

准备阶段探测每种不同转换形状，并按需拒绝不足的标量配置：Eq／Ne、Ge／Lt、BinaryText、And、RegexMatch、Not。
发现将逻辑类型及筛选契约链接到子网契约。

从仓库根目录运行专项执行检查，需要支持 node:sqlite 的 Node：

```sh
bin/telora -C ontology eval @test/subnets:runtime_cases --request-fuel 10000 > /tmp/subnets.json
bin/telora -C ontology eval @test/subnets:runtime_views --request-fuel 10000 > /tmp/ipv4-views.json
node ontology/tests/subnets-runtime.mjs /tmp/subnets.json /tmp/ipv4-views.json
```

检查执行全部掩码及地址边界的生成查询，验证两种补集、NULL，以及 /16 和 /20 的索引范围访问。

等价 PG 检查在回滚事务内使用临时表，以绑定参数执行模板：

```sh
bin/telora -C ontology eval @test/subnets:postgres_runtime --request-fuel 10000 > /tmp/subnets-pg.json
node ontology/tests/subnets-postgres.mjs /tmp/subnets-pg.json > /tmp/subnets-pg.sql
psql --dbname postgres --set ON_ERROR_STOP=1 --file /tmp/subnets-pg.sql
```

# 具名业务类型

具名业务类型拥有公共身份、成员值和物理存储编码。通过 Telora 类型上的 `@edsl::value_type(id, storage, members)` 声明，维度用 `@edsl::dimension_type(TypeName.type)` 绑定。
物理字段是数据库标量载体，必须匹配声明存储类型。类型级注解定义别名、本地化成员标签、规范顺序和半开放契约；维度保留自身作用域及允许操作。

不同具名类型不能仅因都使用 String 或 Int 就连接。例如 Dn 键与 Id 键需要相同声明业务类型才能连接，不做隐式转换。
存储编码不同的类型即使成员名称相同，仍是不同类型。

知识发布 `Ty/{ty}` 和 `Value/{ty}/{value}`。类型文档包含 `storage`、`half_open`、`canonical_order` 和单一 `values` 数组；
各成员携带 ID、标签、别名、本地化标签及物理编码。维度显式发布 `ty` 和数据集归属，独立 `links` 导出支持发现引用该类型的维度。
