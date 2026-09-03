# SQL 惯用法与坑清单

> 从 40 条参考用例的目标 SQL 中归纳的编写惯例与易错点，按场景分类。

---

## 1. 通用惯例

| # | 惯例 | 说明 |
|---|---|---|
| 1 | 行数上限 `LIMIT 1000` | 除 `COUNT(*)` 聚合查询外，参考 SQL 一律带 `LIMIT 1000` |
| 2 | 时间窗统一闭开区间 | `k.ts >= CURRENT_TIMESTAMP - INTERVAL 'N' DAY AND k.ts < CURRENT_TIMESTAMP`（`<` 排除当前时刻） |
| 3 | "数量"去重计数 | 站点/租户数量用 `COUNT(DISTINCT s.SITE_NAME)` / `COUNT(DISTINCT t.TENANT_ID)`，而非 `COUNT(*)` |
| 4 | "信息"去重 | 关联视图查询用 `SELECT DISTINCT d.name, s.SITE_NAME` |
| 5 | 子部件计数按设备分组 | `SELECT d.name, COUNT(*) ... GROUP BY d.name` |
| 6 | 子部件信息成对投影 | `SELECT d.name as d_name, p.name as p_name ... GROUP BY d.name, p.name` |
| 7 | 多条件 + 聚合要 GROUP BY 设备 | `GROUP BY d.id, d.name` |
| 8 | 趋势查询 `ORDER BY k.ts` | 保证时序输出 |

---

## 2. JOIN 键的口径坑

| # | 场景 | 正确写法 | 易错点 |
|---|---|---|---|
| 9 | 设备→站点 | `(d.refParentSubnet = s.SITE_ID OR d.projectId = s.SITE_ID)` | 忘记双口径 OR，漏掉 projectId 挂载的设备 |
| 10 | 存储→站点 | `(s.SITE_ID = d.parentResId OR s.SITE_ID = d.projectId)` | 存储设备无 refParentSubnet，用 parentResId |
| 11 | 设备→租户 | `t.TENANT_ID = d.tenantId` | 各设备统一，无特殊口径 |
| 12 | 服务器→子部件 | `d.oriResId = p.parentResId`（电源）/ `d.oriResId = p.neResId`（光模块） | 服务器主键 id 不能直接 join 子部件，必须用 oriResId |
| 13 | 存储→子部件 | `d.id = p.parentResId` | 与服务器不同，存储直接用 id |
| 14 | 设备→告警 | `d.id / d.resId / d.sn = a.MEDN` | 终端用 resId、协作用 sn，不能一律用 id |
| 15 | 设备→KPI | 设备级 `d.id = k.resId`；AP射频/PON口 `d.id = k.parentId` | 射频、端口级 KPI 用 parentId 而非 resId |
| 16 | 下连设备 | 同一链路表 JOIN 两次：`d1 ON (d1.id = l.aNeResId OR d1.id = l.zNeResId)`，`d2 ON (d2.id = l.zNeResId OR d2.id = l.aNeResId)` | 两表必须互斥取另一端，且两端都写 OR |

---

## 3. 分类过滤写法

| # | 场景 | 写法 |
|---|---|---|
| 17 | 网络设备 | `d.classification IN ('ne.category.ac', 'AC', 'WAC')`（枚举 + 别名双写） |
| 18 | 网络设备（交换机） | `IN ('ne.category.switch', 'LSW')` |
| 19 | 网络设备（路由器） | `IN ('ne.category.router', 'AR')` |
| 20 | 网络设备（AP） | `IN ('ne.category.fatap', 'AP')` |
| 21 | PON 设备 | `d.classification = 'ne.category.olt'` / `'ne.category.onu'`（精确单写） |
| 22 | 服务器 | `d.classification = 'ne.category.server.rack'` 等（精确单写） |
| 23 | 存储设备 | `d.subClassName = 'HuaweiSmisStorageDevice'` 等（精确单写，字段是 subClassName 而非 classification） |
| 24 | 协作设备 | `d.classification = 'COLLABORATION'`（大写枚举） |

> 注意：PON/服务器/存储/协作均精确匹配，唯网络设备带别名 `IN` 双写；网关里的 `ne.category..switch`（双点号）与库中 `ne.category.switch`（单点号）也不同，以库为准。

---

## 4. 数值/枚举过滤坑

| # | 场景 | 写法 | 说明 |
|---|---|---|---|
| 25 | 告警级别 | `a.SEVERITY = 4` | 数值，非字符串 '紧急' |
| 26 | 确认状态 | `a.ACKED = 1` | 数值 |
| 27 | 清除状态 | `a.CLEARED`（参考用例用 ACKED 口径） | 本体映射 CLEARED，0/1 |
| 28 | 存储运行/健康状态 | `d.runningStatus = '1'` / `d.healthStatus = '1'` | 字符串 '1'，带引号 |
| 29 | 服务时长 | `d.serviceDuration = 31536000` | 数值（秒） |
| 30 | 容量利用率/裸容量 | `d.usedCapacityRate = 72` / `d.totalCapacity = 0.0` | 数值 |

---

## 5. 字符串过滤坑

| # | 场景 | 写法 |
|---|---|---|
| 31 | 厂商归一 | `LOWER(d.manufacturer) IN ('2011', 'Huawei', 'huawei technologies co., ltd')`——同一厂商存在多种库内写法，必须 LOWER 归一 |
| 32 | 别名过滤 | `d.alias = 'SNMPSIM_F0A9DF82014B'`（精确） |
| 33 | IP/名称包含 | `d.ipAddress LIKE '%10.4%'` / `d.name LIKE 'core%'`（本体算子"以…开头/包含"） |
| 34 | 软件版本 | `d.neOsVersion = 'V200R019C00SPC500'`（精确，注意 SPC 补丁级） |
| 35 | 补丁版本 | 网络 `d.nePatchVersion = 'V200R001SPH002'`；存储 `d.hotPatchVersion = 'V100R001SPH001'`（字段名不同） |

---

## 6. 窗口函数 / 聚合

| # | 场景 | 写法 |
|---|---|---|
| 36 | TOP N（按设备各自排名） | `ROW_NUMBER() OVER(PARTITION BY d.id ORDER BY k.<kpi> DESC) as rn`，外层 `WHERE rn <= N` |
| 37 | 排序字段 | TOP3 按 KPI 降序；趋势按 `ts` 升序 |
| 38 | 聚合函数 | 平均/最大/最小/总和 → `AVG()/MAX()/MIN()/SUM()` |
| 39 | 聚合去重范围 | "数量"场景优先 `COUNT(DISTINCT ...)` 防同站/同租户重复计数 |

---

## 7. 方言差异提示（PostgreSQL → SQLite）

参考 SQL 是 PostgreSQL 方言，在 SQLite 中执行需改写：

| # | PG 写法 | SQLite 改写 |
|---|---|---|
| 40 | `CURRENT_TIMESTAMP - INTERVAL '7' DAY` | `datetime('now','-7 days')` / `'now','-1 month'` |
| 41 | `CURRENT_TIMESTAMP` | `datetime('now')` |
| 42 | `ROW_NUMBER() OVER(PARTITION BY ... ORDER BY ...)` | SQLite 3.25+ 原生支持，写法不变 |
| 43 | 大小写敏感比较 | SQLite 默认区分大小写，枚举/别名比较需注意与库内值一致 |

---

## 8. 常见错误汇总（Top 陷阱）

1. 站点 JOIN 漏掉 `projectId` 第二口径 → 漏数据
2. 服务器子部件 JOIN 用 `id` 而非 `oriResId` → 查不到
3. 终端/协作用 `id` 关联告警 → 应该 `resId`/`sn`
4. 网络设备分类忘了 `IN (枚举, 别名)` 双写 → 覆盖不全
5. 厂商不用 `LOWER()` 归一 → 匹配失败
6. 多条件聚合漏 `GROUP BY d.id, d.name` → SQL 报错/结果错
7. 射频级 KPI 用 `resId` 而非 `parentId` → 空结果
8. "数量"用 `COUNT(*)` 而非 `COUNT(DISTINCT)` → 重复计数
