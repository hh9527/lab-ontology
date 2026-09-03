# NL→SQL 翻译规则集

> 从 `user_query_cases_ref/` 40 条真实参考用例（Q0001–Q0040）归纳的"自然语言模板 → SQL 骨架"映射。
> 每条规则给出：模板、SQL 骨架、JOIN 键、过滤写法、对应参考用例。
> 变量说明：`<DEV>` 设备表（EntNetworkElement/EntPonElement/PhysicalServer/HuaweiStorageDevice/EntTerminalElement/EntCollaborationElement），`<PK>` 该表主键（见下）。

**设备表主键速查**：网络/服务器/存储/PON=`id`，终端=`resId`，协作=`sn`。

---

## 规则 1：设备产生的告警（信息/数量）

**模板**：`{设备属性}为{值}的{设备类型}产生的{告警属性}为{值}的{告警}` / `…数量`

```sql
-- 信息
SELECT a.* FROM <DEV> d JOIN T_CURRENT_ALARM a ON d.<PK> = a.MEDN
WHERE d.<attr> = '<val>' AND a.<ALARM_ATTR> <op> <val2> AND d.classification = '<cls>' LIMIT 1000
-- 数量
SELECT COUNT(*) FROM <DEV> d JOIN T_CURRENT_ALARM a ON d.<PK> = a.MEDN
WHERE d.<attr> = '<val>' AND a.<ALARM_ATTR> <op> <val2> AND d.classification = '<cls>'
```

| 要素 | 写法 |
|---|---|
| JOIN 键 | `d.id/d.resId/d.sn = a.MEDN`（按设备类型） |
| 告警级别 | `a.SEVERITY = 4`（数值） |
| 告警名称 | `a.ALARMNAME = 'Heartbeat'`（字符串） |
| 所属租户 | `a.TENANT = 'imastercloud24'` |
| 确认状态 | `a.ACKED = 1`（数值） |

用例：Q1–Q4。

---

## 规则 2：设备的子部件（数量/信息）

**模板**：`{设备属性}为{值}的{设备类型}的{子部件}的数量/信息`

```sql
-- 数量（按设备分组计数）
SELECT d.name, COUNT(*) FROM <DEV> d JOIN <SUBPART> p ON d.<DEVKEY> = p.<PARTKEY>
WHERE d.<attr> = '<val>' AND d.classification = '<cls>' GROUP BY d.name LIMIT 1000
-- 信息
SELECT d.name as d_name, p.name as p_name FROM <DEV> d JOIN <SUBPART> p ON d.<DEVKEY> = p.<PARTKEY>
WHERE d.<attr> = '<val>' AND d.classification = '<cls>' GROUP BY d.name, p.name LIMIT 1000
```

| 设备类型 | JOIN 写法 |
|---|---|
| 存储 | `d.id = p.parentResId`（SYS_Controller/Chassis/BackupPower） |
| 服务器 | `d.oriResId = p.parentResId`（PSU）/ `d.oriResId = p.neResId`（光模块） |

用例：Q5–Q10。

---

## 规则 3：设备所在的站点（目标属性/数量/信息）

**模板**：`{设备属性}为{值}的{设备类型}所在的站点{目标属性/数量/信息}`

```sql
-- 目标属性
SELECT s.<ATTR> FROM <DEV> d JOIN X_SITE_VIEW s ON (d.refParentSubnet = s.SITE_ID OR d.projectId = s.SITE_ID)
WHERE d.<attr> = '<val>' AND d.classification = '<cls>' LIMIT 1000
-- 数量（去重）
SELECT COUNT(DISTINCT s.SITE_NAME) FROM <DEV> d JOIN X_SITE_VIEW s ON (d.refParentSubnet = s.SITE_ID OR d.projectId = s.SITE_ID)
WHERE d.<attr> = '<val>' AND d.classification = '<cls>'
-- 信息（去重）
SELECT DISTINCT d.name, s.SITE_NAME FROM <DEV> d JOIN X_SITE_VIEW s ON (d.refParentSubnet = s.SITE_ID OR d.projectId = s.SITE_ID)
WHERE d.<attr> = '<val>' AND d.classification IN ('<cls>', '<alias>') LIMIT 1000
```

| 要素 | 写法 |
|---|---|
| JOIN 键 | 双口径 OR：`refParentSubnet` 或 `projectId` 匹配 `SITE_ID` |
| 存储特例 | `s.SITE_ID = d.parentResId OR s.SITE_ID = d.projectId` |
| 分类 | 网络设备常 `IN ('ne.category.ac','AC','WAC')` 双写别名 |

用例：Q11–Q19。

---

## 规则 4：设备所在的租户（目标属性/数量/信息）

**模板**：`{设备属性}为{值}的{设备类型}所在的租户{目标属性/数量/信息}`

```sql
SELECT t.TENANT_NAME FROM <DEV> d JOIN X_TENANT_VIEW t ON t.TENANT_ID = d.tenantId
WHERE d.<attr> = '<val>' AND d.classification = '<cls>' LIMIT 1000
SELECT COUNT(DISTINCT t.TENANT_ID) FROM <DEV> d JOIN X_TENANT_VIEW t ON t.TENANT_ID = d.tenantId WHERE ...
SELECT DISTINCT d.name, t.TENANT_NAME, t.INDUSTRY FROM <DEV> d JOIN X_TENANT_VIEW t ON t.TENANT_ID = d.tenantId
WHERE ... LIMIT 1000
```

- JOIN 键固定：`d.tenantId = t.TENANT_ID`（所有设备统一）
- 信息查询返回 `d.name, t.TENANT_NAME, t.INDUSTRY`

用例：Q20–Q27。

---

## 规则 5：在{时间}的{kpi}趋势

**模板**：`{设备属性}为{值}的{设备类型}在{时间算子}的{kpi}趋势`

```sql
SELECT d.name, k.<kpi>, k.ts FROM <DEV> d JOIN <KPI> k ON d.id = k.<KEY>
WHERE d.<attr> = '<val>' AND k.ts >= CURRENT_TIMESTAMP - INTERVAL '7' DAY AND k.ts < CURRENT_TIMESTAMP
AND d.classification = '<cls>' ORDER BY k.ts LIMIT 1000
```

| 要素 | 写法 |
|---|---|
| KPI JOIN 键 | 设备级 `k.resId`；射频/端口级 `k.parentId` |
| 时间窗 | `k.ts >= CURRENT_TIMESTAMP - INTERVAL 'N' DAY`（近7天/最近30天），`INTERVAL '1' MONTH`（近一个月） |
| 排序 | `ORDER BY k.ts`（趋势按时间） |

用例：Q28–Q30。

---

## 规则 6：设备1下连设备2上的告警

**模板**：`{设备属性}为{值}的{设备类型1}下连{设备类型2}上的告警信息`

```sql
SELECT a.* FROM EnterprisePhysicalLink l
JOIN <DEV1> d1 ON (d1.id = l.aNeResId OR d1.id = l.zNeResId)
JOIN <DEV2> d2 ON (d2.id = l.zNeResId OR d2.id = l.aNeResId)
JOIN T_CURRENT_ALARM a ON d2.id = a.MEDN
WHERE d1.<attr> = '<val>' AND d1.classification IN ('<cls1>', '<alias1>') AND d2.classification IN ('<cls2>', '<alias2>') LIMIT 1000
```

- 同一张链路表 JOIN 两次设备表（别名 d1/d2），两端用 `OR` 双向判断
- 告警挂在 d2（下连的目标设备）上
- 用例：Q31–Q33

---

## 规则 7：每个{设备}的TOP3 {kpi}

**模板**：`{设备属性}为{值}的每个{设备类型}在{时间算子}的TOP3 {kpi}`

```sql
SELECT name, <kpi>, ts FROM (
  SELECT d.name, k.<kpi>, k.ts,
         ROW_NUMBER() OVER(PARTITION BY d.id ORDER BY k.<kpi> DESC) as rn
  FROM <DEV> d JOIN <KPI> k ON d.id = k.<KEY>
  WHERE d.<attr> = '<val>' AND k.ts >= CURRENT_TIMESTAMP - INTERVAL '7' DAY AND k.ts < CURRENT_TIMESTAMP
  AND d.classification = '<cls>'
) t WHERE rn <= 3
```

- 窗口函数 `ROW_NUMBER() OVER(PARTITION BY d.id ORDER BY k.<kpi> DESC)` 实现"每个设备各自 TOP N"
- TOP N 改为 `WHERE rn <= N`
- 用例：Q34–Q36

---

## 规则 8：多条件 + KPI 聚合

**模板**：`{设备属性1}为{值1}，{设备属性2}为{值2}的{设备类型}，{时间算子}{kpi}{聚合算子}`

```sql
SELECT d.id, d.name, SUM(k.<kpi>) FROM <DEV> d JOIN <KPI> k ON d.id = k.<KEY>
WHERE d.<attr1> = '<val1>' AND LOWER(d.manufacturer) IN ('2011','Huawei','huawei technologies co., ltd')
AND k.ts >= CURRENT_TIMESTAMP - INTERVAL '1' MONTH AND k.ts < CURRENT_TIMESTAMP
AND d.classification = '<cls>' GROUP BY d.id, d.name LIMIT 1000
```

| 要素 | 写法 |
|---|---|
| 厂商过滤 | `LOWER(d.manufacturer) IN (...)` 归一匹配 |
| 聚合 | AVG/MAX/SUM/MIN → 函数名 |
| 多条件 + 聚合 | 必须 `GROUP BY d.id, d.name` |

用例：Q37–Q40。

---

## 附：模板→用例覆盖总览

| 参考模板 | 用例数 | 规则 |
|---|---|---|
| `{设备属性}为{值}的{设备类型}产生的{告警属性}为{值}的{告警}`（+数量） | 4 | 规则 1 |
| `…的{子部件}的数量/信息` | 6 | 规则 2 |
| `…所在的站点{目标属性}/数量/信息` | 9 | 规则 3 |
| `…所在的租户{目标属性}/数量/信息` | 9 | 规则 4 |
| `…在{时间}的{kpi}趋势` | 3 | 规则 5 |
| `…{设备类型1}下连{设备类型2}上的告警信息` | 3 | 规则 6 |
| `…每个{设备类型}在{时间}的TOP3 {kpi}` | 3 | 规则 7 |
| `{属性1}…，{属性2}…，{时间}{kpi}{聚合}` | 3 | 规则 8 |
