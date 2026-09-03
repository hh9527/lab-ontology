# Entity Set 全量字段定义（27 个实体集，逐字段无损转存）

> 由 `umodel/entity_set/*.yaml` 程序化生成，字段/类型/描述/value_mapping 与原始文件逐字一致。

## imaster.collaboration.device（协作设备）

> 协作设备，如视频会议终端

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `['classification', 'commu_state']`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| classification | string | 设备分类 |  |
| ip_address | string | IP地址 |  |
| commu_state | string | 通信状态 |  |
| tenant_id | string | 租户ID |  |

## imaster.network.device（网络设备）

> 网络设备，包含交换机、路由器、防火墙、AC、AP 等

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `['classification', 'commu_state']`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| classification | string | 设备分类 | `ne.category..switch`=交换机/LSW；`ne.category..ac`=AC/WAC；`ne.category..router`=路由器/Router；`ne.category..firewall`=防火墙/Firewall；`ne.category..fatap`=AP/AP；`ne.category..unknown`=其他/Others |
| ip_address | string | IP地址 |  |
| sn | string | 序列号 |  |
| manufacturer | string | 厂商 |  |
| product_name | string | 设备型号 |  |
| version | string | 设备版本 |  |
| ne_os_version | string | 软件版本 |  |
| commu_state | string | 通信状态 | `0`=在线/Online；`1`=离线/Offline |
| mac | string | MAC地址 |  |
| location | string | 位置 |  |
| tenant_id | string | 租户ID |  |
| ref_parent_subnet | string | 站点ID |  |

## imaster.network.frame（机框）

> 网络设备中承载单板的机框

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| frame_dn | string | 机框DN |  |
| tenant_id | string | 租户ID |  |
| parent_res_id | string | 所属资源ID |  |

## imaster.network.optical_module（光模块）

> 网络端口上安装的光模块

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| vendor | string | 厂商 |  |
| wavelength | string | 波长 |  |
| tenant_id | string | 租户ID |  |
| ne_res_id | string | 设备资源ID |  |
| if_name | string | 接口名称 |  |

## imaster.network.physical_link（物理链路）

> 两个网络端口之间的物理链路

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `['direction', 'link_type']`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| direction | string | 链路方向 | `bidirectional`=双向/Bidirectional；`unidirectional`=单向/Unidirectional |
| link_type | string | 链路类型 |  |
| a_ne_res_id | string | A端设备ID |  |
| z_ne_res_id | string | Z端设备ID |  |
| a_port_dn | string | A端端口DN |  |
| z_port_dn | string | Z端端口DN |  |
| tenant_id | string | 租户ID |  |

## imaster.network.port（端口）

> 设备上的网络逻辑端口

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `['port_type', 'admin_status', 'oper_status']`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| port_type | string | 端口类型 |  |
| admin_status | string | 管理状态 |  |
| oper_status | string | 运行状态 |  |
| ip_address | string | IP地址 |  |
| mac | string | MAC地址 |  |
| speed | string | 速率 |  |
| tenant_id | string | 租户ID |  |
| ref_parent_ne | string | 所属设备ID |  |

## imaster.network.slot（单板）

> 网络设备机框内的单板

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| frame_native_id | string | 所属机框DN |  |
| tenant_id | string | 租户ID |  |
| ref_parent_ne | string | 所属设备ID |  |

## imaster.pon.device（PON设备）

> PON网络中的光设备，包含OLT和ONU

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `['classification', 'commu_state']`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| classification | string | 设备分类 | `olt`=OLT/OLT；`onu`=ONU/ONU |
| parent_olt_res_id | string | 所属OLT的资源ID |  |
| ip_address | string | IP地址 |  |
| sn | string | 序列号 |  |
| manufacturer | string | 厂商 |  |
| commu_state | string | 通信状态 |  |
| location | string | 位置 |  |
| tenant_id | string | 租户ID |  |
| ref_parent_subnet | string | 站点ID |  |

## imaster.server.device（服务器）

> 物理服务器设备

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `['classification', 'commu_state']`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| classification | string | 设备分类 |  |
| ip_address | string | IP地址 |  |
| sn | string | 序列号 |  |
| manufacturer | string | 厂商 |  |
| product_name | string | 设备型号 |  |
| commu_state | string | 通信状态 |  |
| location | string | 位置 |  |
| bios_version | string | BIOS版本 |  |
| bmc_hostname | string | BMC主机名 |  |
| firmware_version | string | 固件版本 |  |
| tenant_id | string | 租户ID |  |
| site_id | string | 站点ID |  |

## imaster.server.disk（硬盘）

> 服务器硬盘

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| disk_type | string | 硬盘类型 |  |
| capacity | string | 容量 |  |
| status | string | 状态 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.server.fan（风扇）

> 风扇

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| speed | string | 速率 |  |
| status | string | 状态 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.server.memory（内存）

> 内存条

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| capacity | string | 容量 |  |
| speed | string | 速率 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.server.nic（网卡）

> 网卡

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| mac | string | MAC地址 |  |
| speed | string | 速率 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.server.optical_module（光模块）

> 光模块

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| vendor | string | 厂商 |  |
| wavelength | string | 波长 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.server.port（端口）

> 端口

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| port_type | string | 端口类型 |  |
| speed | string | 速率 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.server.processor（处理器）

> 处理器

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| core_count | string | 核数 |  |
| frequency | string | 频率 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.server.psu（电源）

> 电源

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| power_capacity | string | 电源容量 |  |
| status | string | 状态 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.storage.backup_power（备用电源）

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| status | string | 状态 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.storage.chassis（机框）

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.storage.controller（控制器）

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.storage.device（存储设备）

> 华为存储设备

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `['commu_state']`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| sn | string | 序列号 |  |
| manufacturer | string | 厂商 |  |
| ip_address | string | IP地址 |  |
| commu_state | string | 通信状态 |  |
| location | string | 位置 |  |
| tenant_id | string | 租户ID |  |
| site_id | string | 站点ID |  |

## imaster.storage.disk（硬盘）

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| disk_type | string | 硬盘类型 |  |
| capacity | string | 容量 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.storage.fan（风扇）

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| status | string | 状态 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.storage.fc_switch（FC交换机）

> 存储网络中的FC交换机

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| ip_address | string | IP地址 |  |
| sn | string | 序列号 |  |
| tenant_id | string | 租户ID |  |
| site_id | string | 站点ID |  |

## imaster.storage.port（端口）

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| port_type | string | 端口类型 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.storage.psu（电源）

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `None`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| status | string | 状态 |  |
| parent_res_id | string | 所属资源ID |  |
| tenant_id | string | 租户ID |  |

## imaster.terminal.device（终端设备）

> 接入网络的终端设备，如打印机、UPS、负载均衡器

- primary_key_fields: `['id']`
- name_fields: `['name']`
- tag_fields: `['classification', 'commu_state']`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| id | string | 唯一标识 |  |
| name | string | 名称 |  |
| classification | string | 设备分类 |  |
| ip_address | string | IP地址 |  |
| mac | string | MAC地址 |  |
| commu_state | string | 通信状态 |  |
| access_device_id | string | 接入设备ID |  |
| tenant_id | string | 租户ID |  |
| site_id | string | 站点ID |  |
