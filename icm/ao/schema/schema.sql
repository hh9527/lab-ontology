-- ============================================================================
-- iMasterCloud 运维数据表结构（SQLite 语法）
-- 依据：
--   1) icloud/queries/user_query_cases_ref/ 40 条参考用例的目标 SQL（表名/列名/连接键，置信度高）
--   2) icloud/umodel/ 本体模型（字段全集、类型、主键、枚举、字段业务语义）
-- 主键确定依据：
--   - 参考 SQL 中 JOIN 左表一侧的列即为实体主键（如 EntNetworkElement.id、EntTerminalElement.resId）
--   - 本体 spec.primary_key_fields 一致确认
--   - 告警表 T_CURRENT_ALARM 主键为告警流水号 CSN（本体 csn = 告警流水号）
--   - KPI 表为时序表，主键为 (资源ID, 时间戳) 复合主键
--   - 子部件表主键为自身 id，parent_res_id/ne_res_id/ref_parent_ne 关联父设备
-- 命名备注：
--   - 参考 SQL 已出现的表名直接沿用（如 SYS_Controller、PhysicalServerPSU、EnterprisePhysicalLink）
--   - 其余表名按同域同前缀惯例推断，标注 [inferred]
-- 字段业务语义来源：本体字段 description + value_mapping 枚举 + 参考 SQL 关联/过滤用法
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- 1. 设备表
-- ----------------------------------------------------------------------------

-- 网络设备：交换机(LSW)/路由器/防火墙/AC/AP 等，网络域的核心资源实体
CREATE TABLE IF NOT EXISTS EntNetworkElement (
    id              TEXT PRIMARY KEY,      -- 设备唯一标识（全局资源ID），主键；
                                           --   子部件(refParentNe)、KPI(res_id/parentId)、告警(MEDN)、链路(aNeResId/zNeResId)均通过该字段关联
    name            TEXT,                  -- 设备名称，运维界面展示名，支持按前缀匹配查询（如"名称以core开头"）
    alias           TEXT,                  -- 设备别名，仿真/网管环境别名（如 SNMPSIM_F0A9DF82014B），参考用例作为过滤条件
    classification  TEXT,                  -- 设备分类（华为设备类型枚举）：ne.category.switch(交换机)/ac(WAC)/router(路由器)/firewall(防火墙)/fatap(AP)/unknown(其他)；
                                           --   tag 字段，业务上决定设备网络域归属与可查 KPI 类型，最高频过滤条件
    ipAddress       TEXT,                  -- 设备管理 IP 地址（IPv4），参考网段 10.4.x.x；支持包含/前缀过滤，用于寻址与连通性分析
    sn              TEXT,                  -- 出厂序列号（Serial Number），厂商出厂唯一，资产溯源依据；部分设备告警用 sn 关联告警表
    manufacturer    TEXT,                  -- 厂商（如 Huawei），参考 SQL 需 LOWER() 归一后匹配 '2011'/'Huawei'/'huawei technologies co., ltd'
    productName     TEXT,                  -- 设备型号（产品型号），如 CE12800；选型与容量规划参考
    version         TEXT,                  -- 设备版本（设备软件版本），如 V200R001C00，版本合规审计依据
    neOsVersion     TEXT,                  -- 软件版本（OS 版本），如 V200R019C10、V200R019C00SPC500、V200R001C00SPC700；SPC 为补丁级版本号
    nePatchVersion  TEXT,                  -- 补丁版本，如 V200R001SPH002，安全补丁覆盖率统计
    commuState      TEXT,                  -- 通信状态，枚举：0=在线 / 1=离线（value_mapping）；tag 字段，"离线设备"是告警与故障排查重点
    mac             TEXT,                  -- MAC 地址，格式 xx:xx:xx:xx:xx:xx（如 00:1A:2B:00:00:00），二层寻址与设备定位
    location        TEXT,                  -- 资产位置（机柜位置），如 Beijing-A1-Rack01；物理资产盘点与位置定位
    language        TEXT,                  -- 系统语言（如 zh），参考用例作为过滤条件
    tenantId        TEXT,                  -- 所属租户ID，外键→X_TENANT_VIEW.TENANT_ID（belongs_to 关系）；多租户数据隔离与归属的关键字段
    projectId       TEXT,                  -- 项目ID，站点关联的另一个键（与 X_SITE_VIEW 的 JOIN 可用 projectId 或 refParentSubnet）
    refParentSubnet TEXT                   -- 站点ID，外键→X_SITE_VIEW.SITE_ID（located_at 关系）；标识设备所在站点，用于"站点下设备"统计
);

-- PON 设备：光线路终端(OLT)/光网络单元(ONU)，光接入网资源实体
CREATE TABLE IF NOT EXISTS EntPonElement (
    id              TEXT PRIMARY KEY,      -- 设备唯一标识（主键）；KPI(res_id/parentId)、告警(MEDN)、链路(aNeResId/zNeResId)关联键
    name            TEXT,                  -- 设备名称
    classification  TEXT,                  -- 设备分类枚举：olt(光线路终端，局端)/onu(光网络单元，用户侧)；
                                           --   tag 字段，决定接入层级与 KPI 口径（ONU 有光功率/光模块温度等指标）
    parentOltResId  TEXT,                  -- 所属OLT资源ID，ONU 挂接的上级 OLT（parent_of 层级关系），OLT 本字段为空；
                                           --   业务上用于"某 OLT 下挂的 ONU"聚合统计
    ipAddress       TEXT,                  -- 管理 IP 地址（IPv4），如 10.4.153.218
    sn              TEXT,                  -- 出厂序列号，ONU 常用 sn 精确查询（如 485754432B376AAB）
    manufacturer    TEXT,                  -- 厂商
    neOsVersion     TEXT,                  -- 软件版本，如 '--' 表示未知；版本合规审计
    commuState      TEXT,                  -- 通信状态（在线/离线），tag 字段
    location        TEXT,                  -- 位置
    tenantId        TEXT,                  -- 所属租户ID，外键→X_TENANT_VIEW.TENANT_ID
    projectId       TEXT,                  -- 项目ID，站点关联键之一
    refParentSubnet TEXT                   -- 站点ID，外键→X_SITE_VIEW.SITE_ID（located_at 关系）
);

-- 物理服务器：机架/昆仑/异构/天工机框/智能小站/机柜等，服务器域核心资源实体
CREATE TABLE IF NOT EXISTS PhysicalServer (
    id              TEXT PRIMARY KEY,      -- 服务器唯一标识（主键）；告警(MEDN)、KPI(res_id)关联键
    name            TEXT,                  -- 服务器名称
    classification  TEXT,                  -- 服务器分类枚举：ne.category.server.rack(机架服务器)/kunlun(昆仑)/heterogeneous(异构)/subrack(天工机框)/edge(智能小站)/enclosure(机柜)；
                                           --   tag 字段，决定服务器类型与部件结构差异，最高频过滤条件
    ipAddress       TEXT,                  -- 管理 IP 地址（BMC/管理口），支持包含过滤（如 IP 包含 10.4）
    sn              TEXT,                  -- 出厂序列号
    manufacturer    TEXT,                  -- 厂商
    productName     TEXT,                  -- 设备型号，如 RH2288H V3
    commuState      TEXT,                  -- 通信状态（在线/离线），tag 字段
    location        TEXT,                  -- 资产位置，如 Beijing-A1-Rack01
    version         TEXT,                  -- 固件/BMC 版本，如 BMC3.19.00.07；参考用例"固件版本为 BMC3.19.00.07 的昆仑服务器"
    biosVersion     TEXT,                  -- BIOS 版本，如 5.11.02；固件合规与升级管理
    bmcHostname     TEXT,                  -- BMC 主机名，带外管理通道标识
    firmwareVersion TEXT,                  -- 固件版本（另一口径，与 version 字段并存）
    mac             TEXT,                  -- 管理网口 MAC 地址，如 05:1A:2B:00:00:00
    assetNumber     TEXT,                  -- 资产编号，如 AN-000001；固定资产盘点与采购追踪
    serviceDuration INTEGER,               -- 服务时长（秒），如 31536000（=1年）；衡量设备服役周期，寿命/折旧分析
    tenantId        TEXT,                  -- 所属租户ID，外键→X_TENANT_VIEW.TENANT_ID
    projectId       TEXT,                  -- 项目ID，站点关联键之一
    refParentSubnet TEXT,                  -- 站点ID，外键→X_SITE_VIEW.SITE_ID（located_at 关系）
    oriResId        TEXT                   -- 原始资源ID，服务器子部件（PhysicalServerPSU.parentResId、PhysicalServerOpticalModule.neResId）
                                           --   通过该字段关联到所属服务器（参考 SQL: d.oriResId = p.parentResId / p.neResId）
);

-- 存储设备：华为SMIS/VSP/HP/分布式/闪存等，存储域核心资源实体
CREATE TABLE IF NOT EXISTS HuaweiStorageDevice (
    id              TEXT PRIMARY KEY,      -- 存储设备唯一标识（主键）；子部件(parentResId)、告警(MEDN)、KPI(res_id)关联键
    name            TEXT,                  -- 存储设备名称
    sn              TEXT,                  -- 出厂序列号
    manufacturer    TEXT,                  -- 厂商
    ipAddress       TEXT,                  -- 管理 IP 地址
    commuState      TEXT,                  -- 通信状态（在线/离线），tag 字段
    location        TEXT,                  -- 位置，如 Beijing-A1-Rack01
    productmodel    TEXT,                  -- 设备型号(productmodel)，如 OceanStor 5310；选型与容量规划（列名与原库一致，全小写）
    subClassName    TEXT,                  -- 设备子类名枚举：HuaweiSmisStorageDevice(华为SMIS)/VSPStorageDevice(VSP)/HPEStorageDevice(HP)/FusionStorageDevice(分布式)/EnterpriseStorage(闪存)；
                                           --   决定存储设备细分类型与部件结构，最高频过滤条件（无对应 value_mapping 时直接按该字段过滤）
    usedCapacityRate REAL,                 -- 容量利用率（%），如 72；存储空间水位监控，容量告警依据
    totalCapacity   REAL,                  -- 裸容量（总量），如 0.0；容量规划与使用率计算基数
    runningStatus   TEXT,                  -- 运行状态，如 '1'=正常；设备运行健康度
    healthStatus    TEXT,                  -- 健康状态，如 '1'=正常；综合健康度评估
    hotPatchVersion TEXT,                  -- 热补丁版本，如 V100R001SPH001；补丁覆盖率统计
    tenantId        TEXT,                  -- 所属租户ID，外键→X_TENANT_VIEW.TENANT_ID
    projectId       TEXT,                  -- 项目ID，站点关联键之一
    parentResId     TEXT,                  -- 父资源ID，站点关联键之一（参考 SQL: X_SITE_VIEW JOIN 用 parentResId 或 projectId 匹配 SITE_ID）
    refParentSubnet TEXT                   -- 站点ID，外键→X_SITE_VIEW.SITE_ID（located_at 关系）
);

-- 终端设备：打印机/UPS/负载均衡器等接入网络的非网管类终端
CREATE TABLE IF NOT EXISTS EntTerminalElement (
    resId           TEXT PRIMARY KEY,      -- 资源ID（主键）；告警表以 resId 关联（参考 SQL: d.resId = a.MEDN）
    name            TEXT,                  -- 终端名称
    model           TEXT,                  -- 终端型号，如 Model-5
    classification  TEXT,                  -- 终端分类（ne.category.terminal.*，如打印机/UPS/负载均衡），tag 字段
    ipAddress       TEXT,                  -- IP 地址，如 10.5.0.0
    mac             TEXT,                  -- MAC 地址
    sn              TEXT,                  -- 出厂序列号
    commuState      TEXT,                  -- 通信状态，tag 字段
    accessDeviceId  TEXT,                  -- 接入设备ID，标识终端通过哪个网络/PON 设备接入（accesses 关系）；
                                           --   业务上用于"终端接入拓扑"与"下挂设备上的告警"分析
    tenantId        TEXT,                  -- 所属租户ID，外键→X_TENANT_VIEW.TENANT_ID
    siteId          TEXT                   -- 站点ID，外键→X_SITE_VIEW.SITE_ID（located_at 关系）
);

-- 协作设备：视频会议终端等协作域资源实体
CREATE TABLE IF NOT EXISTS EntCollaborationElement (
    sn              TEXT PRIMARY KEY,      -- 序列号（主键）；告警表以 sn 关联（参考 SQL: d.sn = a.MEDN）
    id              TEXT,                  -- 唯一标识
    name            TEXT,                  -- 协作设备名称
    classification  TEXT,                  -- 设备分类，枚举 COLLABORATION（视频会议终端），tag 字段
    ipAddress       TEXT,                  -- IP 地址，如 10.5.0.0
    commuState      TEXT,                  -- 通信状态
    tenantId        TEXT                   -- 所属租户ID，外键→X_TENANT_VIEW.TENANT_ID（belongs_to 关系）
);

-- ----------------------------------------------------------------------------
-- 2. 跨域视图 / 索引
-- ----------------------------------------------------------------------------

-- 站点视图：所有实体的跨域站点维度投影（entity_source, external_sync）
CREATE TABLE IF NOT EXISTS X_SITE_VIEW (
    SITE_ID     TEXT PRIMARY KEY,          -- 站点ID（主键）；各设备 refParentSubnet/projectId/parentResId 关联到该字段
    SITE_NAME   TEXT,                      -- 站点名称，如 北京总部(site-01)、上海分部(site-02)；"站点下设备/告警"统计的维度值
    TENANT_ID   TEXT                       -- 租户ID，站点归属租户；租户→站点层级关系（tenant_view contains site_view）
);

-- 租户视图：所有实体的跨域租户维度投影（entity_source, external_sync）
CREATE TABLE IF NOT EXISTS X_TENANT_VIEW (
    TENANT_ID   TEXT PRIMARY KEY,          -- 租户ID（主键）；各设备 tenantId 关联到该字段，多租户隔离根
    TENANT_NAME TEXT,                      -- 租户名称，如 运营商A(tenant-01)、企业客户B(tenant-02)
    INDUSTRY    TEXT                       -- 行业（industry），租户画像与行业维度统计
);

-- 设备索引：跨域全量设备索引，ChatBI 资源检索缓存（entity_source, llm.search.cache=true） [inferred]
CREATE TABLE IF NOT EXISTS X_DEVICE_INDEX (
    id          TEXT PRIMARY KEY,          -- 设备ID（跨域统一标识）
    name        TEXT,                      -- 设备名称，用于模糊检索
    ip          TEXT,                      -- IP 地址，用于检索定位
    mac         TEXT,                      -- MAC 地址，用于检索定位
    category    TEXT,                      -- 设备分类，跨域归一化的分类口径
    className   TEXT                       -- 实体类名（对应各域 entity_set 名称），指明设备归属域
);

-- ----------------------------------------------------------------------------
-- 3. 告警表
-- ----------------------------------------------------------------------------

-- 当前告警：治理域事件集，未清除告警的实时视图
CREATE TABLE IF NOT EXISTS T_CURRENT_ALARM (
    CSN          INTEGER PRIMARY KEY,      -- 告警流水号（主键），告警唯一编号（本体 csn=告警流水号）
    MEDN         TEXT,                     -- 资源ID，外键→设备表主键（网络/服务器/存储用 id、终端用 resId、协作用 sn）；
                                           --   标识告警发生的资源，是"设备产生的告警"JOIN 的核心键
    ALARMNAME    TEXT,                     -- 告警名称，如 光模块收发异常/CPU使用率过高/内存使用率过高/端口流量超限/单板掉线/硬盘故障/电源故障/设备离线/Heartbeat
    ALARMTYPE    TEXT,                     -- 告警类型，tag 字段；按类型统计告警分布
    SEVERITY     INTEGER,                  -- 告警级别枚举：1=紧急/2=重要/3=次要/4=提示；按级别统计与升级处理
    ACKED        INTEGER,                  -- 确认状态：0=未确认/1=已确认；未确认告警是值班处理重点
    CLEARED      INTEGER,                  -- 清除状态：0=未清除/1=已清除；"未清除告警"是当前故障池
    RESNAME      TEXT,                     -- 资源名称（产生告警资源的名称），便于展示
    SOURCE       TEXT,                     -- 告警源（告警来源网元/模块）
    PROBABLECAUSE TEXT,                    -- 可能原因，故障定位参考
    TENANT       TEXT,                     -- 所属租户（名称或ID），如 imastercloud24；租户维度告警隔离
    ALARMTIME    TEXT,                     -- 告警发生时间；按发生时间排序/趋势统计
    STREXT13     TEXT                      -- 站点扩展字段（站点归属），用于"站点下告警"统计
);

-- ----------------------------------------------------------------------------
-- 4. 物理链路表
-- ----------------------------------------------------------------------------

-- 物理链路：两端口之间的物理连接，构成组网拓扑（网络/服务器/存储/PON 设备均可通过 a/z 端接入）
CREATE TABLE IF NOT EXISTS EnterprisePhysicalLink (
    id          TEXT PRIMARY KEY,          -- 链路唯一标识（主键）
    name        TEXT,                      -- 链路名称，如 link-001
    direction   TEXT,                      -- 链路方向枚举：bidirectional=双向/unidirectional=单向；tag 字段
    linkType    TEXT,                      -- 链路类型，如 光纤；tag 字段，链路介质分类
    aNeResId    TEXT,                      -- A端设备ID，外键→设备表 id；链路的源端设备
    zNeResId    TEXT,                      -- Z端设备ID，外键→设备表 id；链路的宿端设备；
                                           --   业务上"设备1下连设备2"（参考 SQL: d1.id = l.aNeResId OR l.zNeResId 且 d2 为另一端）即由此判断
    aPortDn     TEXT,                      -- A端端口DN（端口全称），精确到端口级
    zPortDn     TEXT,                      -- Z端端口DN（端口全称），精确到端口级
    tenantId    TEXT                       -- 租户ID，链路归属租户
);

-- ----------------------------------------------------------------------------
-- 5. 子部件表（均以 id 为主键，parent 字段关联父设备；设备含多层部件时按层级拆表）
-- ----------------------------------------------------------------------------

-- 网络机框：网络设备物理机框，承载单板 [inferred]
CREATE TABLE IF NOT EXISTS EntNetworkFrame (
    id          TEXT PRIMARY KEY,          -- 机框唯一标识（主键）
    name        TEXT,                      -- 机框名称
    frameDn     TEXT,                      -- 机框DN（Distinguished Name），网管定位标识
    parentResId TEXT,                      -- 所属设备ID，外键→EntNetworkElement.id（contains 关系）
    tenantId    TEXT                       -- 租户ID
);

-- 网络单板：机框内的板卡/槽位 [inferred]
CREATE TABLE IF NOT EXISTS EntNetworkSlot (
    id            TEXT PRIMARY KEY,        -- 单板唯一标识（主键）
    name          TEXT,                    -- 单板名称
    frameNativeId TEXT,                    -- 所属机框DN，外键→EntNetworkFrame.frameDn（frame contains slot）
    refParentNe   TEXT,                    -- 所属设备ID，外键→EntNetworkElement.id（device contains slot）
    tenantId      TEXT                     -- 租户ID
);

-- 网络端口：设备上的逻辑端口，接口 KPI 的挂载点 [inferred]
CREATE TABLE IF NOT EXISTS EntNetworkPort (
    id            TEXT PRIMARY KEY,        -- 端口唯一标识（主键）
    name          TEXT,                    -- 端口名称
    portType      TEXT,                    -- 端口类型，tag 字段
    adminStatus   TEXT,                    -- 管理状态，tag 字段
    operStatus    TEXT,                    -- 运行状态，tag 字段；与 adminStatus 结合判断端口异常
    ipAddress     TEXT,                    -- 端口 IP 地址
    mac           TEXT,                    -- 端口 MAC 地址
    speed         TEXT,                    -- 端口速率（如 10Gbps）
    refParentNe   TEXT,                    -- 所属设备ID，外键→EntNetworkElement.id（device contains port）
    tenantId      TEXT                     -- 租户ID
);

-- 网络光模块：端口上安装的光模块 [inferred]
CREATE TABLE IF NOT EXISTS EntNetworkOpticalModule (
    id          TEXT PRIMARY KEY,          -- 光模块唯一标识（主键）
    name        TEXT,                      -- 光模块名称
    vendor      TEXT,                      -- 光模块厂商
    wavelength  TEXT,                      -- 波长（nm），光信号特性
    neResId     TEXT,                      -- 所属设备ID，外键→EntNetworkElement.id
    ifName      TEXT,                      -- 接口名称，关联端口
    tenantId    TEXT                       -- 租户ID
);

-- 服务器硬盘：服务器磁盘部件 [inferred]
CREATE TABLE IF NOT EXISTS PhysicalServerDisk (
    id          TEXT PRIMARY KEY,          -- 硬盘唯一标识（主键）
    name        TEXT,                      -- 硬盘名称
    diskType    TEXT,                      -- 硬盘类型（如 SSD），容量规划与性能评估
    capacity    TEXT,                      -- 硬盘容量
    status      TEXT,                      -- 状态（如 异常），"硬盘故障"告警关联部件
    parentResId TEXT,                      -- 所属服务器ID，外键→PhysicalServer.id（device contains disk）
    tenantId    TEXT                       -- 租户ID
);

-- 服务器风扇 [inferred]
CREATE TABLE IF NOT EXISTS PhysicalServerFan (
    id          TEXT PRIMARY KEY,          -- 风扇唯一标识（主键）
    name        TEXT,                      -- 风扇名称
    speed       TEXT,                      -- 转速/速率
    status      TEXT,                      -- 状态（如 异常）
    parentResId TEXT,                      -- 所属服务器ID，外键→PhysicalServer.id
    tenantId    TEXT                       -- 租户ID
);

-- 服务器内存条 [inferred]
CREATE TABLE IF NOT EXISTS PhysicalServerMemory (
    id          TEXT PRIMARY KEY,          -- 内存条唯一标识（主键）
    name        TEXT,                      -- 内存条名称
    capacity    TEXT,                      -- 容量
    speed       TEXT,                      -- 速率（如 DDR 频率）
    parentResId TEXT,                      -- 所属服务器ID，外键→PhysicalServer.id
    tenantId    TEXT                       -- 租户ID
);

-- 服务器网卡 [inferred]
CREATE TABLE IF NOT EXISTS PhysicalServerNIC (
    id          TEXT PRIMARY KEY,          -- 网卡唯一标识（主键）
    name        TEXT,                      -- 网卡名称
    mac         TEXT,                      -- 网卡 MAC 地址（查询"网卡MAC地址"目标字段）
    speed       TEXT,                      -- 网卡速率
    parentResId TEXT,                      -- 所属服务器ID，外键→PhysicalServer.id
    tenantId    TEXT                       -- 租户ID
);

-- 服务器端口 [inferred]
CREATE TABLE IF NOT EXISTS PhysicalServerPort (
    id          TEXT PRIMARY KEY,          -- 端口唯一标识（主键）
    name        TEXT,                      -- 端口名称
    portType    TEXT,                      -- 端口类型
    speed       TEXT,                      -- 端口速率
    parentResId TEXT,                      -- 所属服务器ID，外键→PhysicalServer.id
    tenantId    TEXT                       -- 租户ID
);

-- 服务器处理器（CPU） [inferred]
CREATE TABLE IF NOT EXISTS PhysicalServerProcessor (
    id          TEXT PRIMARY KEY,          -- 处理器唯一标识（主键）
    name        TEXT,                      -- 处理器名称
    coreCount   TEXT,                      -- 核数，算力评估
    frequency   TEXT,                      -- 主频（GHz）
    parentResId TEXT,                      -- 所属服务器ID，外键→PhysicalServer.id
    tenantId    TEXT                       -- 租户ID
);

-- 服务器电源（PSU） [inferred]
CREATE TABLE IF NOT EXISTS PhysicalServerPSU (
    id           TEXT PRIMARY KEY,         -- 电源唯一标识（主键）
    name         TEXT,                     -- 电源名称
    powerCapacity TEXT,                    -- 电源容量
    status       TEXT,                     -- 状态（如 异常），"电源故障"告警关联部件
    parentResId  TEXT,                     -- 所属服务器ID，外键→PhysicalServer.oriResId（参考 SQL: d.oriResId = p.parentResId）
    tenantId     TEXT                      -- 租户ID
);

-- 服务器光模块 [inferred]
CREATE TABLE IF NOT EXISTS PhysicalServerOpticalModule (
    id          TEXT PRIMARY KEY,          -- 光模块唯一标识（主键）
    name        TEXT,                      -- 光模块名称
    vendor      TEXT,                      -- 光模块厂商
    wavelength  TEXT,                      -- 波长（nm）
    neResId     TEXT,                      -- 所属服务器ID，外键→PhysicalServer.oriResId（参考 SQL: d.oriResId = p.neResId）
    tenantId    TEXT                       -- 租户ID
);

-- 存储控制器：存储设备双控/多控架构下的控制器部件 [inferred]
CREATE TABLE IF NOT EXISTS SYS_Controller (
    id          TEXT PRIMARY KEY,          -- 控制器唯一标识（主键）
    name        TEXT,                      -- 控制器名称
    parentResId TEXT,                      -- 所属存储设备ID，外键→HuaweiStorageDevice.id（参考 SQL: d.id = p.parentResId）
    tenantId    TEXT                       -- 租户ID
);

-- 存储机箱/机框 [inferred]
CREATE TABLE IF NOT EXISTS SYS_Chassis (
    id          TEXT PRIMARY KEY,          -- 机箱唯一标识（主键）
    name        TEXT,                      -- 机箱名称
    parentResId TEXT,                      -- 所属存储设备ID，外键→HuaweiStorageDevice.id
    tenantId    TEXT                       -- 租户ID
);

-- 存储备用电源 [inferred]
CREATE TABLE IF NOT EXISTS SYS_BackupPower (
    id          TEXT PRIMARY KEY,          -- 备电唯一标识（主键）
    name        TEXT,                      -- 备电名称
    status      TEXT,                      -- 状态（如 异常），"备电"查询的目标字段
    parentResId TEXT,                      -- 所属存储设备ID，外键→HuaweiStorageDevice.id
    tenantId    TEXT                       -- 租户ID
);

-- 存储硬盘 [inferred]
CREATE TABLE IF NOT EXISTS SYS_Disk (
    id          TEXT PRIMARY KEY,          -- 硬盘唯一标识（主键）
    name        TEXT,                      -- 硬盘名称
    diskType    TEXT,                      -- 硬盘类型（如 SSD）
    capacity    TEXT,                      -- 硬盘容量
    parentResId TEXT,                      -- 所属存储设备ID，外键→HuaweiStorageDevice.id；
                                           --   存储硬盘 KPI（StorageHardDriveKPI.res_id）关联到该字段
    tenantId    TEXT                       -- 租户ID
);

-- 存储风扇 [inferred]
CREATE TABLE IF NOT EXISTS SYS_Fan (
    id          TEXT PRIMARY KEY,          -- 风扇唯一标识（主键）
    name        TEXT,                      -- 风扇名称
    status      TEXT,                      -- 状态（如 异常）
    parentResId TEXT,                      -- 所属存储设备ID，外键→HuaweiStorageDevice.id
    tenantId    TEXT                       -- 租户ID
);

-- 存储端口 [inferred]
CREATE TABLE IF NOT EXISTS SYS_Port (
    id          TEXT PRIMARY KEY,          -- 端口唯一标识（主键）
    name        TEXT,                      -- 端口名称
    portType    TEXT,                      -- 端口类型（查询"存储设备的端口类型"目标字段）
    parentResId TEXT,                      -- 所属存储设备ID，外键→HuaweiStorageDevice.id
    tenantId    TEXT                       -- 租户ID
);

-- 存储电源 [inferred]
CREATE TABLE IF NOT EXISTS SYS_PSU (
    id          TEXT PRIMARY KEY,          -- 电源唯一标识（主键）
    name        TEXT,                      -- 电源名称
    status      TEXT,                      -- 状态（如 异常）
    parentResId TEXT,                      -- 所属存储设备ID，外键→HuaweiStorageDevice.id
    tenantId    TEXT                       -- 租户ID
);

-- FC 交换机：存储网络中的光纤通道交换机 [inferred]
CREATE TABLE IF NOT EXISTS StorageFcSwitch (
    id          TEXT PRIMARY KEY,          -- FC交换机唯一标识（主键）
    name        TEXT,                      -- 交换机名称
    ipAddress   TEXT,                      -- 管理 IP 地址
    sn          TEXT,                      -- 出厂序列号
    tenantId    TEXT,                      -- 租户ID
    siteId      TEXT                       -- 站点ID，外键→X_SITE_VIEW.SITE_ID
);

-- ----------------------------------------------------------------------------
-- 6. KPI 表（时序数据，复合主键 (资源ID, 时间戳)；res_id/parent_id 均为资源归属键，
--    按设备/子部件 id 关联；ts 为采集时间，参考 SQL 常用"近7天/最近30天/近一个月"时间窗过滤）
-- ----------------------------------------------------------------------------

-- 网络设备 KPI：设备级 CPU/内存/在线率/端口利用率等指标
CREATE TABLE IF NOT EXISTS NetworkDeviceKPI (
    resId             TEXT NOT NULL,       -- 资源ID，外键→EntNetworkElement.id（参考 SQL: d.id = k.resId）；指标归属设备
    tenantId          TEXT,                -- 租户ID
    classification    TEXT,                -- 设备分类冗余，按分类聚合 KPI 时免 JOIN
    cpuUsage          REAL,                -- CPU使用率（%），avg 聚合语义；"CPU使用率过高"告警的来源指标
    memUsage          REAL,                -- 内存使用率（%）
    onlineRate        REAL,                -- 在线率
    ifUtilizationRate REAL,                -- 端口利用率（%）
    portCount         REAL,                -- 端口总数，sum 聚合语义
    portUsedCount     REAL,                -- 已使用端口数，sum 聚合语义
    ts                TEXT NOT NULL,       -- 采集时间戳（时序主键之一），时间窗过滤/趋势排序依据
    PRIMARY KEY (resId, ts)
);

-- 网络设备在线率 KPI：设备在线率时序
CREATE TABLE IF NOT EXISTS NetworkDeviceOnlineKPI (
    resId     TEXT NOT NULL,               -- 资源ID，外键→EntNetworkElement.id（参考 SQL: d.id = k.resId）
    tenantId  TEXT,                        -- 租户ID
    onlineRate REAL,                       -- 在线率（参考 SQL: MAX(k.onlineRate) 取最大值）
    ts        TEXT NOT NULL,               -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- 网络 AP KPI：AP 在线率时序 [inferred]
CREATE TABLE IF NOT EXISTS NetworkApKPI (
    resId     TEXT NOT NULL,               -- 资源ID，外键→EntNetworkElement.id
    tenantId  TEXT,                        -- 租户ID
    onlineRate REAL,                       -- 在线率
    ts        TEXT NOT NULL,               -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- AP 射频 KPI：AP 射频口无线指标（信号强度/丢包/用户数等）
CREATE TABLE IF NOT EXISTS NetworkApRadioKPI (
    parentId           TEXT NOT NULL,      -- 资源ID，外键→EntNetworkElement.id（参考 SQL: d.id = k.parentId）；射频归属 AP
    tenantId           TEXT,               -- 租户ID
    userCount          REAL,               -- 在线用户数，sum 聚合语义（查询"在线用户数总和"）
    channelUtilization REAL,               -- 信道利用率（%）
    rssi               REAL,               -- 信号接收强度（RSSI，dBm）（参考 SQL: k.rssi 趋势查询）
    packetLossRate     REAL,               -- 丢包率（参考 SQL: SUM(k.packetLossRate)）
    ts                 TEXT NOT NULL,      -- 采集时间戳
    PRIMARY KEY (parentId, ts)
);

-- AP 射频 SSID KPI：AP 射频下各 SSID 的用户/信道指标 [inferred]
CREATE TABLE IF NOT EXISTS NetworkApRadioSsidKPI (
    resId              TEXT NOT NULL,      -- 资源ID，指标归属（射频/SSID）
    tenantId           TEXT,               -- 租户ID
    userCount          REAL,               -- 在线用户数
    channelUtilization REAL,               -- 信道利用率（%）
    ts                 TEXT NOT NULL,      -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- 网络单板 KPI：单板级 CPU/内存指标 [inferred]
CREATE TABLE IF NOT EXISTS NetworkBoardKPI (
    resId     TEXT NOT NULL,               -- 资源ID，外键→EntNetworkSlot.id；单板指标归属
    tenantId  TEXT,                        -- 租户ID
    cpuUsage  REAL,                        -- CPU使用率（%）
    memUsage  REAL,                        -- 内存使用率（%）
    ts        TEXT NOT NULL,               -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- 网络接口 KPI：端口级流量/利用率/误码率指标 [inferred]
CREATE TABLE IF NOT EXISTS NetworkInterfaceKPI (
    resId         TEXT NOT NULL,           -- 资源ID，外键→EntNetworkPort.id；端口指标归属
    tenantId      TEXT,                    -- 租户ID
    inTrafficRate REAL,                    -- 入方向流量速率（bps）
    outTrafficRate REAL,                   -- 出方向流量速率（bps）
    inUtilization REAL,                    -- 入方向利用率（%）
    outUtilization REAL,                   -- 出方向利用率（%）
    inErrorRate   REAL,                    -- 入方向误码率
    outErrorRate  REAL,                    -- 出方向误码率
    ts            TEXT NOT NULL,           -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- 蜂窝链路质量 KPI：蜂窝链路参考信号接收功率/信干噪比 [inferred]
CREATE TABLE IF NOT EXISTS NetworkCellLinkQualityKPI (
    resId    TEXT NOT NULL,                -- 资源ID，指标归属（蜂窝链路）
    tenantId TEXT,                         -- 租户ID
    rsrp     REAL,                         -- 参考信号接收功率（dBm）
    sinr     REAL,                         -- 信干噪比（dB）
    ts       TEXT NOT NULL,                -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- 蜂窝链路流量 KPI：蜂窝链路入/出流量 [inferred]
CREATE TABLE IF NOT EXISTS NetworkCellLinkTrafficKPI (
    resId         TEXT NOT NULL,           -- 资源ID
    tenantId      TEXT,                    -- 租户ID
    inTrafficRate REAL,                    -- 入方向流量速率（bps）
    outTrafficRate REAL,                   -- 出方向流量速率（bps）
    ts            TEXT NOT NULL,           -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- PON 设备 KPI：OLT 级 CPU/内存指标
CREATE TABLE IF NOT EXISTS PonDeviceKPI (
    resId     TEXT NOT NULL,               -- 资源ID，外键→EntPonElement.id（参考 SQL: d.id = k.resId）
    tenantId  TEXT,                        -- 租户ID
    cpuUsage  REAL,                        -- CPU使用率（%）
    memUsage  REAL,                        -- 内存使用率（%）（参考 SQL: TOP3 memUsage）
    ts        TEXT NOT NULL,               -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- ONU KPI：光功率/光模块温度/内存等 ONU 专属指标
CREATE TABLE IF NOT EXISTS PonDeviceOnuKPI (
    resId                  TEXT NOT NULL,  -- 资源ID，外键→EntPonElement.id（参考 SQL: d.id = k.resId）
    tenantId               TEXT,           -- 租户ID
    onlineRate             REAL,           -- 在线率
    opticalPower           REAL,           -- 光功率（光链路质量）
    memUsage               REAL,           -- 内存使用率（%）（参考 SQL: k.memUsage 趋势查询）
    onuhwOpticsTemperature REAL,           -- 光模块温度（参考 SQL: MAX(k.onuhwOpticsTemperature)）
    ts                     TEXT NOT NULL,  -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- PON 端口 KPI：PON 口流量/光功率/发送带宽利用率
CREATE TABLE IF NOT EXISTS PonDevicePonPortKPI (
    parentId      TEXT NOT NULL,           -- 资源ID，外键→EntPonElement.id（参考 SQL: d.id = k.parentId）
    tenantId      TEXT,                    -- 租户ID
    inTrafficRate REAL,                    -- 入方向流量速率
    outTrafficRate REAL,                   -- 出方向流量速率
    opticalPower  REAL,                    -- 光功率
    ifOutBandRate REAL,                    -- 光端口发送带宽利用率（参考 SQL: k.ifOutBandRate 趋势查询）
    ts            TEXT NOT NULL,           -- 采集时间戳
    PRIMARY KEY (parentId, ts)
);

-- PON 以太网端口 KPI：以太网口流量指标 [inferred]
CREATE TABLE IF NOT EXISTS PonDeviceEthernetPortKPI (
    resId         TEXT NOT NULL,           -- 资源ID
    tenantId      TEXT,                    -- 租户ID
    inTrafficRate REAL,                    -- 入方向流量速率
    outTrafficRate REAL,                   -- 出方向流量速率
    ts            TEXT NOT NULL,           -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- PON 设备在线率 KPI [inferred]
CREATE TABLE IF NOT EXISTS PonDeviceOnlineKPI (
    resId     TEXT NOT NULL,               -- 资源ID
    tenantId  TEXT,                        -- 租户ID
    onlineRate REAL,                       -- 在线率
    ts        TEXT NOT NULL,               -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- 服务器 KPI：CPU/内存/硬盘使用率时序
CREATE TABLE IF NOT EXISTS ServerDeviceKPI (
    resId     TEXT NOT NULL,               -- 资源ID，外键→PhysicalServer.id（参考 SQL: d.id = k.resId）
    tenantId  TEXT,                        -- 租户ID
    cpuUsage  REAL,                        -- CPU使用率（%）（参考 SQL: TOP3 cpuUsage）
    memUsage  REAL,                        -- 内存使用率（%）
    diskUsage REAL,                        -- 硬盘使用率（%）
    ts        TEXT NOT NULL,               -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- 存储设备 KPI：CPU/内存/IOPS/吞吐量 [inferred]
CREATE TABLE IF NOT EXISTS StorageDeviceKPI (
    resId     TEXT NOT NULL,               -- 资源ID，外键→HuaweiStorageDevice.id
    tenantId  TEXT,                        -- 租户ID
    cpuUsage  REAL,                        -- CPU使用率
    memUsage  REAL,                        -- 内存使用率
    iops      REAL,                        -- 每秒IO次数（查询"每秒IO次数平均值"）
    throughput REAL,                       -- 吞吐量（查询"吞吐量平均值"）
    ts        TEXT NOT NULL,               -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- 存储硬盘 KPI：硬盘使用率/温度/IOPS [inferred]
CREATE TABLE IF NOT EXISTS StorageHardDriveKPI (
    resId       TEXT NOT NULL,             -- 资源ID，外键→SYS_Disk.id（存储硬盘）
    tenantId    TEXT,                      -- 租户ID
    diskUsage   REAL,                      -- 硬盘使用率（查询"硬盘使用率平均值"）
    temperature REAL,                      -- 温度（查询"硬盘温度平均值"）
    iops        REAL,                      -- 每秒IO次数
    ts          TEXT NOT NULL,             -- 采集时间戳
    PRIMARY KEY (resId, ts)
);

-- ----------------------------------------------------------------------------
-- 7. 索引（依据本体 tag_fields + 参考 SQL 的 WHERE/JOIN 列推导）
--    命名前缀：net=网络, pon=PON, server=服务器, storage=存储, terminal=终端,
--            collab=协作, alarm=告警, link=链路, sub=子部件, kpi=指标
-- ----------------------------------------------------------------------------

-- 设备表：tag_fields（classification / commu_state）+ 外键 + WHERE 高频列
CREATE INDEX IF NOT EXISTS idx_net_classification ON EntNetworkElement (classification);
CREATE INDEX IF NOT EXISTS idx_net_commu_state   ON EntNetworkElement (commuState);
CREATE INDEX IF NOT EXISTS idx_net_tenant        ON EntNetworkElement (tenantId);
CREATE INDEX IF NOT EXISTS idx_net_site          ON EntNetworkElement (refParentSubnet);
CREATE INDEX IF NOT EXISTS idx_net_name          ON EntNetworkElement (name);
CREATE INDEX IF NOT EXISTS idx_net_version       ON EntNetworkElement (neOsVersion);
CREATE INDEX IF NOT EXISTS idx_net_site_class    ON EntNetworkElement (refParentSubnet, classification);

CREATE INDEX IF NOT EXISTS idx_pon_classification ON EntPonElement (classification);
CREATE INDEX IF NOT EXISTS idx_pon_commu_state    ON EntPonElement (commuState);
CREATE INDEX IF NOT EXISTS idx_pon_tenant         ON EntPonElement (tenantId);
CREATE INDEX IF NOT EXISTS idx_pon_site           ON EntPonElement (refParentSubnet);
CREATE INDEX IF NOT EXISTS idx_pon_parent_olt     ON EntPonElement (parentOltResId);

CREATE INDEX IF NOT EXISTS idx_server_classification ON PhysicalServer (classification);
CREATE INDEX IF NOT EXISTS idx_server_commu_state    ON PhysicalServer (commuState);
CREATE INDEX IF NOT EXISTS idx_server_tenant         ON PhysicalServer (tenantId);
CREATE INDEX IF NOT EXISTS idx_server_site           ON PhysicalServer (refParentSubnet);
CREATE INDEX IF NOT EXISTS idx_server_ori            ON PhysicalServer (oriResId);
CREATE INDEX IF NOT EXISTS idx_server_location       ON PhysicalServer (location);

CREATE INDEX IF NOT EXISTS idx_storage_subclass ON HuaweiStorageDevice (subClassName);
CREATE INDEX IF NOT EXISTS idx_storage_commu    ON HuaweiStorageDevice (commuState);
CREATE INDEX IF NOT EXISTS idx_storage_tenant   ON HuaweiStorageDevice (tenantId);
CREATE INDEX IF NOT EXISTS idx_storage_site     ON HuaweiStorageDevice (refParentSubnet);
CREATE INDEX IF NOT EXISTS idx_storage_parent   ON HuaweiStorageDevice (parentResId);

CREATE INDEX IF NOT EXISTS idx_terminal_classification ON EntTerminalElement (classification);
CREATE INDEX IF NOT EXISTS idx_terminal_commu_state    ON EntTerminalElement (commuState);
CREATE INDEX IF NOT EXISTS idx_terminal_tenant         ON EntTerminalElement (tenantId);
CREATE INDEX IF NOT EXISTS idx_terminal_site           ON EntTerminalElement (siteId);
CREATE INDEX IF NOT EXISTS idx_terminal_access         ON EntTerminalElement (accessDeviceId);

CREATE INDEX IF NOT EXISTS idx_collab_tenant     ON EntCollaborationElement (tenantId);

-- 告警表：tag_fields（severity / cleared / alarm_type）+ JOIN + WHERE 高频列
CREATE INDEX IF NOT EXISTS idx_alarm_medn        ON T_CURRENT_ALARM (MEDN);
CREATE INDEX IF NOT EXISTS idx_alarm_severity    ON T_CURRENT_ALARM (SEVERITY);
CREATE INDEX IF NOT EXISTS idx_alarm_name        ON T_CURRENT_ALARM (ALARMNAME);
CREATE INDEX IF NOT EXISTS idx_alarm_type        ON T_CURRENT_ALARM (ALARMTYPE);
CREATE INDEX IF NOT EXISTS idx_alarm_cleared     ON T_CURRENT_ALARM (CLEARED);
CREATE INDEX IF NOT EXISTS idx_alarm_acked       ON T_CURRENT_ALARM (ACKED);
CREATE INDEX IF NOT EXISTS idx_alarm_tenant      ON T_CURRENT_ALARM (TENANT);
CREATE INDEX IF NOT EXISTS idx_alarm_time        ON T_CURRENT_ALARM (ALARMTIME);
CREATE INDEX IF NOT EXISTS idx_alarm_medn_sev    ON T_CURRENT_ALARM (MEDN, SEVERITY);
CREATE INDEX IF NOT EXISTS idx_alarm_sev_cleared ON T_CURRENT_ALARM (SEVERITY, CLEARED);

-- 链路表：a/z 端设备 JOIN + tag_fields（direction / link_type）
CREATE INDEX IF NOT EXISTS idx_link_ane         ON EnterprisePhysicalLink (aNeResId);
CREATE INDEX IF NOT EXISTS idx_link_zne         ON EnterprisePhysicalLink (zNeResId);
CREATE INDEX IF NOT EXISTS idx_link_direction   ON EnterprisePhysicalLink (direction);
CREATE INDEX IF NOT EXISTS idx_link_type        ON EnterprisePhysicalLink (linkType);
CREATE INDEX IF NOT EXISTS idx_link_tenant      ON EnterprisePhysicalLink (tenantId);

-- 视图：租户/站点关联
CREATE INDEX IF NOT EXISTS idx_site_tenant      ON X_SITE_VIEW (TENANT_ID);
CREATE INDEX IF NOT EXISTS idx_site_name        ON X_SITE_VIEW (SITE_NAME);
CREATE INDEX IF NOT EXISTS idx_tenant_name      ON X_TENANT_VIEW (TENANT_NAME);

-- 子部件表：parent 关联键（JOIN 到父设备）
CREATE INDEX IF NOT EXISTS idx_sub_net_frame_parent ON EntNetworkFrame (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_net_slot_parent  ON EntNetworkSlot (refParentNe);
CREATE INDEX IF NOT EXISTS idx_sub_net_port_parent  ON EntNetworkPort (refParentNe);
CREATE INDEX IF NOT EXISTS idx_sub_net_opt_parent   ON EntNetworkOpticalModule (neResId);
CREATE INDEX IF NOT EXISTS idx_sub_server_disk_parent  ON PhysicalServerDisk (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_server_fan_parent   ON PhysicalServerFan (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_server_mem_parent   ON PhysicalServerMemory (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_server_nic_parent   ON PhysicalServerNIC (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_server_port_parent  ON PhysicalServerPort (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_server_cpu_parent   ON PhysicalServerProcessor (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_server_psu_parent   ON PhysicalServerPSU (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_server_opt_parent   ON PhysicalServerOpticalModule (neResId);
CREATE INDEX IF NOT EXISTS idx_sub_sys_controller_parent ON SYS_Controller (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_sys_chassis_parent    ON SYS_Chassis (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_sys_backup_parent     ON SYS_BackupPower (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_sys_disk_parent       ON SYS_Disk (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_sys_fan_parent        ON SYS_Fan (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_sys_port_parent       ON SYS_Port (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_sys_psu_parent        ON SYS_PSU (parentResId);
CREATE INDEX IF NOT EXISTS idx_sub_fc_switch_site        ON StorageFcSwitch (siteId);

-- KPI 表：PRIMARY KEY(res_id, ts) 已覆盖 res_id 前缀查询；ts 单列索引加速时间窗扫描
CREATE INDEX IF NOT EXISTS idx_kpi_net_ts         ON NetworkDeviceKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_net_online_ts  ON NetworkDeviceOnlineKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_ap_ts          ON NetworkApKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_ap_radio_ts    ON NetworkApRadioKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_ap_ssid_ts     ON NetworkApRadioSsidKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_board_ts       ON NetworkBoardKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_if_ts          ON NetworkInterfaceKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_cell_quality_ts ON NetworkCellLinkQualityKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_cell_traffic_ts ON NetworkCellLinkTrafficKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_pon_ts         ON PonDeviceKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_onu_ts         ON PonDeviceOnuKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_pon_port_ts    ON PonDevicePonPortKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_eth_ts         ON PonDeviceEthernetPortKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_pon_online_ts  ON PonDeviceOnlineKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_server_ts      ON ServerDeviceKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_storage_ts     ON StorageDeviceKPI (ts);
CREATE INDEX IF NOT EXISTS idx_kpi_hdd_ts         ON StorageHardDriveKPI (ts);
