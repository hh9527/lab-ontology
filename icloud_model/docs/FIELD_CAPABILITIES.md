# 源字段查询能力

源元数据确立物理编码及业务描述，模型选择查询能力；索引与成本不改变操作含义。
本策略不是授权或访问控制系统，保留已有可见性、关系、身份、粒度和时间编码。

## 已审查类别

`scripts/icloud_capabilities.py` 记录已审查源词汇，由模式刷新、对齐及编译模型审计共享。
源类型、枚举、时间戳角色和主键标记优先于文本搜索类别；新增／未分类字符串保持仅精确匹配，等待审查。

| 类别 | 提供操作 | 解释 |
| --- | --- | --- |
| 名称、别名、描述、位置 | Eq、Ne、Contains、NotContains、StartsWith、EndsWith | 搜索展示／存储文本 |
| 版本、SN、资产号、部件号 | 同上文本操作 | 表示匹配，不是版本排序或标识规范化 |
| 开放产品／型号／厂商文本 | 同上文本操作 | 不虚构闭合厂商或类别词汇 |
| MAC／WWN 及原始地址表示 | 同上文本操作 | 字面表示匹配，不是地址运算 |
| 数值字段 | Eq、Ne、Gt、Ge、Lt、Le | 数值比较，不是文本匹配 |
| 已声明规范值 | 已有 Eq／Ne 值域能力 | 规范 ID 与物理编码保持分离 |
| 身份／引用键及未分类字符串 | 已有仅精确匹配能力 | 不全面开放通配 |
| 时钟和表示数值的字符串 | 已有带类型／显式能力 | 不隐式搜索文本或虚构编码 |

Eq／Ne 比较精确存储文本。文本模式仅折叠 ASCII A-Z，按字面解释 %、_ 和引号，不是 SQL LIKE 模式。
NULL 既不匹配正文本谓词，也不匹配负补集。文本搜索不承诺索引执行。
PG 显式实现相同 ASCII 折叠，不暗中替换为依赖地区设置的折叠。
各公共维度报告实际 ops 并链接共享筛选契约；Contains 被拒绝不意味着可改用 StartsWith。

## 原始地址与显式 IPv4 视图

源不保证每个地址列都是规范 IPv4。原地址维度仍为 Text，Contains 是字面子串，不是子网。
例如 device_ip_address Contains 10.4 与属于 10.4.0.0/16 是不同请求。

地址列另外提供具名计算 IPv4 维度，如 device_ip_address_ipv4。
显式 canonical_ipv4_view 仅保留四段 0..255、无前导零的规范地址；IPv6、NULL、畸形字符串及其他表示返回 NULL。
不悄悄规范化或更改源行类型，原维度保留。仅 IPv6 和子网掩码字段不生成 IPv4 地址视图。

视图支持 Eq／Ne、/0..32 的 InSubnet／NotInSubnet，网络主机位必须为零。
NotInSubnet 是**有效 IPv4 值域内**的补集，不包含 IPv6 或未识别源值；/0 选择全部有效 IPv4，而非所有源行。
投影可返回 NULL，不同值计数忽略 NULL，知识描述发布这些事实。

视图是确定性行内标量表达式，不是连接或行扩增，可筛选、投影、分组和不同值计数，无需虚构身份。
已有图扇出／粒度及作用域限制仍适用；共享同物理列的不同计算维度相等条件不会自动判为矛盾。

原字符串校验有成本，计算视图不承诺源索引访问。
领域能证明规范存储时，直接 logical_type(Ipv4) 仍合适，可按[逻辑类型](../../ontology/docs/LOGICAL-TYPES.md)使用二进制前缀范围索引。
SQLite 执行器须注册文档中的 regexp，PG 原生支持。
规范化保护使用公共正则子集，包含否定字符类，以在引擎间一致拒绝末尾换行。

## 全模型检查门槛

导出准备模型并审计来源及所有声明能力：

```sh
bin/telora -C icloud_model eval @src/source_audit:report --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 1024 > /tmp/icloud-prepared.json
python3 scripts/audit-icloud-model.py /tmp/icloud-prepared.json --metadata ../imaster-cloud/.compact/metadata
python3 -m unittest discover -s scripts/tests
bin/telora -C icloud_model test capabilities --initialization-fuel 100000 --request-fuel 500000 --with-memory-limit 1024
```

审计覆盖 48 张源表、822 字段，含重复业务载体。
验证每个可搜索维度、显式 IPv4 视图、数值操作完整性，以及文本搜索未泄漏到规范值、身份及时钟。
代表 SQL 测试覆盖六种文本操作、字面参数绑定及拒绝语义替换。

refresh-icloud-schema.py 输出可审查补丁，reconcile-icloud-capabilities.py 对齐已有声明，二者共享策略。
新语义类别需审查，不能按后缀推断逻辑类型；此字段搜索策略不虚构制造日期格式、字符串数量编码或 IPv6 运算。
