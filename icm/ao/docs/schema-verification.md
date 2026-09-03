# Schema 校验与造数策略

> 验证 `../schema/schema.sql` 与 40 条参考 SQL 的一致性，并给出测试数据生成（造数）策略。

---

## 1. 校验结果（自动化）

对 40 条参考 SQL 中引用的表/列做存在性校验（脚本见附录）：

### 1.1 表覆盖

参考 SQL 引用 **22 张表**，全部存在于 schema 中：

```
EntCollaborationElement / EntNetworkElement / EntPonElement / EntTerminalElement /
EnterprisePhysicalLink / HuaweiStorageDevice / NetworkApRadioKPI / NetworkDeviceKPI /
NetworkDeviceOnlineKPI / PhysicalServer / PhysicalServerOpticalModule / PhysicalServerPSU /
PonDeviceKPI / PonDeviceOnuKPI / PonDevicePonPortKPI / SYS_BackupPower / SYS_Chassis /
SYS_Controller / ServerDeviceKPI / T_CURRENT_ALARM / X_SITE_VIEW / X_TENANT_VIEW
```

### 1.2 列覆盖

除 1 处外，参考 SQL 引用的列全部存在。**发现并已修复**：

| 表 | 问题 | 修复 |
|---|---|---|
| HuaweiStorageDevice | 参考 SQL 用 `productmodel`（全小写），初版 schema 写成 `productModel` | 已改为 `productmodel` |

校验后 schema 已通过 `sqlite3 .read` 全量执行。

---

## 2. 方言改写（参考 SQL → SQLite 可执行）

参考 SQL 为 PostgreSQL 方言，在 SQLite 执行前需改写：

| 场景 | PostgreSQL | SQLite |
|---|---|---|
| 时间窗 | `k.ts >= CURRENT_TIMESTAMP - INTERVAL '7' DAY` | `k.ts >= datetime('now','-7 days')` |
| 近一个月 | `INTERVAL '1' MONTH` | `datetime('now','-1 month')` |
| 当前时间 | `CURRENT_TIMESTAMP` | `datetime('now')` |
| 窗口函数 | `ROW_NUMBER() OVER(...)` | 原生支持（SQLite ≥ 3.25），写法不变 |
| 大小写 | 通常不敏感 | 默认敏感，比较时注意库内值大小写 |

---

## 3. EXPLAIN QUERY PLAN 验证索引

用 `EXPLAIN QUERY PLAN` 验证关键查询是否命中索引（以参考 SQL 骨架为例）：

```sql
-- 网络设备按分类过滤 + 站点关联
EXPLAIN QUERY PLAN
SELECT s.SITE_NAME FROM EntNetworkElement d
JOIN X_SITE_VIEW s ON (d.refParentSubnet = s.SITE_ID OR d.projectId = s.SITE_ID)
WHERE d.classification IN ('ne.category.switch','LSW');
-- 期望：SEARCH EntNetworkElement USING INDEX idx_net_classification
--       SEARCH X_SITE_VIEW USING INDEX sqlite_autoindex_X_SITE_VIEW_1 (PK)

-- 告警按设备 + 级别
EXPLAIN QUERY PLAN
SELECT a.* FROM EntNetworkElement d JOIN T_CURRENT_ALARM a ON d.id = a.MEDN
WHERE d.classification = 'ne.category.switch' AND a.SEVERITY = 4;
-- 期望：SEARCH T_CURRENT_ALARM USING INDEX idx_alarm_medn_sev

-- KPI 时间窗扫描
EXPLAIN QUERY PLAN
SELECT d.name, k.cpuUsage FROM PhysicalServer d JOIN ServerDeviceKPI k ON d.id = k.resId
WHERE k.ts >= datetime('now','-7 days');
-- 期望：SEARCH ServerDeviceKPI USING INDEX idx_kpi_server_ts
```

**索引命中清单**（schema 第 7 节 42 个索引的对应关系）：

| 查询模式 | 应命中索引 |
|---|---|
| 设备按 classification 过滤 | idx_net/pon/server/storage/terminal_classification |
| 站点下设备 | idx_net/pon/server_site 或 idx_net_site_class |
| 设备→告警 | idx_alarm_medn / idx_alarm_medn_sev |
| 告警级别+清除 | idx_alarm_sev_cleared |
| 子部件挂载 | idx_sub_*_parent |
| KPI 时间窗 | idx_kpi_*_ts |
| 主键查找 | sqlite_autoindex（PK 自带） |

---

## 4. 造数策略

### 4.1 原则
1. **枚举/取值对齐参考用例**：填充 `vocab-normalization.md` 第 9 节的值（CE12800、10.4.x.x、V200R019C10 等），保证用例可跑通。
2. **外键一致性**：子部件 parent/neResId/refParentNe 必须指向已插入设备的 id（服务器指向 oriResId）；KPI res_id/parent_id 指向设备 id。
3. **时间窗对齐**：KPI ts 与 ALARMTIME 分布在"近7天/30天/一个月"窗口内，且要覆盖 `>= now-7d AND < now`。
4. **口径双写**：同一条记录 `classification` 需可同时被枚举值匹配（网络设备）或别名（LSW/AC/WAC/AR/AP）。
5. **厂商多写法**：manufacturer 造入 'Huawei' 与 'huawei technologies co., ltd' 两种，验证 LOWER 归一。

### 4.2 推荐造数规模（示例）

| 表 | 建议行数 | 覆盖要点 |
|---|---|---|
| X_TENANT_VIEW | 2 | 运营商A/企业客户B |
| X_SITE_VIEW | 2 | 北京总部/上海分部 |
| EntNetworkElement | 60 | 各 classification 均有；部分站点/租户组合缺失以测双口径 |
| EntPonElement | 40 | OLT 20 + ONU 20（ONU 挂 parentOltResId） |
| PhysicalServer | 40 | 6 类 classification |
| HuaweiStorageDevice | 30 | 5 类 subClassName |
| EntTerminalElement / EntCollaborationElement | 各 10 | 覆盖告警关联 |
| EnterprisePhysicalLink | 40 | a/z 端覆盖 网络-PON、网络-存储、网络-网络 |
| T_CURRENT_ALARM | 200 | 级别 1-4、ACKED/CLEARED 0/1、MEDN 对齐各设备主键口径 |
| KPI 表 | 每表 2000 | 覆盖 res_id × 时间窗（7d/30d）多采样点 |
| 子部件表 | 每表 50 | parentResId 对齐设备 |

### 4.3 生成脚本建议（伪代码）

```python
# 造数核心：保证 FK 一致 + 口径双写 + 时间窗
for dev in devices:
    insert_device(dev)                       # id/name/classification/tenantId/refParentSubnet
    for part in parts[dev.type]:
        insert_part(part, parent=dev.oriResId if dev is server else dev.id)
    for t in time_window(dev, days=30):
        insert_kpi(res_id=dev.id, ts=t, kpi=rand())
    for alarm in alarms[dev]:
        insert_alarm(MEDN=dev.pk_by_type(), SEVERITY=rand(1..4), ...)
```

---

## 附录：列存在性校验脚本

```python
import json, re, subprocess
tables = set(); cols = {}
for f in ['icloud/queries/user_query_cases_ref/Q0001-0020.jsonl',
          'icloud/queries/user_query_cases_ref/Q0021-0040.jsonl']:
    for line in open(f):
        sql = json.loads(line)['目标SQL']
        for m in re.finditer(r'(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)', sql):
            tbl, al = m.group(1), m.group(2)
            tables.add(tbl); cols.setdefault(tbl, set())
            cols[tbl] |= {c.group(1) for c in re.finditer(r'\b'+al+r'\.([A-Za-z_][A-Za-z0-9_]*)', sql)}
# 载入 schema 到 sqlite3 :memory:，用 PRAGMA table_info(<tbl>) 比对每表列集合
```
