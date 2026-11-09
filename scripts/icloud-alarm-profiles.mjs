// Source catalog names the first four broad families. FC/collaboration broad
// names and network secondary names below are demo conventions, not source enums.
export const alarmFamilies = {
  I_EntNetworkElement: 'NetworkElement', PhysicalServer: 'PhysicalServer',
  HuaweiStorageDevice: 'HuaweiStorageDevice', I_EntPonElement: 'EntPonElement',
  FCSwitchDevice: 'FCSwitchDevice', I_EntCollaborationElement: 'CollaborationElement',
};
const networkTypes = {
  LSW: 'Switch', switch: 'Switch', WAC: 'WirelessController', wac: 'WirelessController',
  router: 'Router', firewall: 'Firewall', AP: 'AccessPoint', fatap: 'AccessPoint',
  fitap: 'AccessPoint', tianguan: 'SecurityGateway', printer: 'Printer',
  ups: 'UPS', lb: 'LoadBalancer', others: 'Other',
};
export function alarmProfile(family, owner, ports) {
  const type = family === 'I_EntNetworkElement' ? networkTypes[owner.typeId] : owner.classification;
  if (!type) throw new Error(`Missing alarm secondary class: ${family}/${owner.id}`);
  return { MEDN: owner.id, MENAME: owner.name, TENANTID: owner.tenantId,
    STREXT13: owner.projectId, MANUFACTURER: owner.manufacturer ?? '',
    PRODUCTNAME: owner.productName ?? owner.productmodel ?? '',
    MECATEGORY: alarmFamilies[family], METYPE: type,
    ports: ports.filter(port => port.refParentNE === owner.id) };
}

// Device-level monitoring scenarios; these names are synthetic alarm definitions,
// not a copy of any manufacturer's alarm catalog. No fictitious component ID.
const familyEvents = {
  NetworkElement: ['配置保存失败', '配置一致性异常', '管理通道不可达', 'SNMP 采集超时',
    '路由表容量告警', 'MAC 地址表容量告警', 'ARP 表容量告警', '广播流量异常',
    '设备重启', '时间同步异常', '日志存储空间不足', '管理认证失败次数过多'],
  PhysicalServer: ['服务器异常重启', '操作系统心跳丢失', '系统盘空间不足', '文件系统只读',
    '系统负载过高', '进程句柄耗尽', '系统日志写入失败', '硬件健康状态异常',
    '虚拟化服务异常', '服务器管理接口不可达', '系统时钟偏移过大', '交换空间使用率过高'],
  HuaweiStorageDevice: ['存储池容量不足', '存储池性能下降', '存储读时延过高', '存储写时延过高',
    '存储缓存使用率过高', '存储控制服务异常', '存储管理通道异常', '存储快照空间不足',
    '存储复制链路异常', '存储数据同步滞后', '存储冗余保护降级', '存储后台巡检异常'],
  FCSwitchDevice: ['Fabric 配置冲突', 'FC 域 ID 冲突', 'FC 名称服务异常', 'Zone 配置不一致',
    'FC 登录失败次数过多', 'FC 信用耗尽', 'Fabric 拓扑频繁变化', 'FC 拥塞持续',
    'FC 管理服务异常', 'FC 路由异常', 'Fabric 合并失败', 'FC 配置备份失败'],
  CollaborationElement: ['会议注册失败', '会议呼叫建立失败', '会议异常中断', '视频画面冻结',
    '视频丢包率过高', '音频丢包率过高', '音频抖动过大', '会议媒体时延过高',
    '会议终端认证失败', '视频输入信号丢失', '会议服务不可达', '会议终端配置下发失败'],
};
const ponEvents = {
  'ne.category.olt': ['OLT 管理通道异常', 'PON 注册失败率过高', 'PON 上行拥塞', 'OLT 配置下发失败', 'PON 认证异常'],
  'ne.category.pon.onu': ['ONU 掉线', 'ONU 注册失败', 'ONU 光信号弱', 'ONU 上行带宽不足', 'ONU 配置同步失败'],
  'ne.category.pon.spl': ['无源光路衰减过大', '无源光路信号中断', '分光支路光功率异常'],
};
const specializedEvents = {
  Printer: ['打印服务异常', '打印队列阻塞', '打印机耗材不足', '打印机缺纸', '打印机卡纸'],
  UPS: ['电源供电异常', 'UPS 电池电量不足', 'UPS 电池健康度下降', 'UPS 旁路供电', 'UPS 输出过载', 'UPS 输入电压异常'],
  AccessPoint: ['无线信道干扰过高', '无线终端接入失败率过高', '无线认证失败', '无线信道利用率过高'],
  WirelessController: ['AP 注册失败', 'AP 掉线数量过多', '无线用户认证服务异常', '无线许可容量不足'],
};

export function alarmEvent(profile, load, offline, draw, variantDraw = 0) {
  // Alarm probability follows the same seeded business load as the metrics.
  // Non-compute devices must not acquire CPU/memory alarms.
  const passive = profile.METYPE === 'ne.category.pon.spl';
  const compute = !passive && !['Printer', 'UPS'].includes(profile.METYPE)
    && profile.MECATEGORY !== 'CollaborationElement';
  const events = passive ? [] : [['设备温度过高', 1], ['设备短时离线', offline ? 20 : 0.15]];
  if (compute) events.push(['CPU 利用率过高', 0.2 + load * 3], ['内存使用率过高', 0.2 + load * 2]);
  if (profile.ports.length) events.push(['链路质量下降', 1], ['端口错误率升高', 0.5 + load]);
  const specific = specializedEvents[profile.METYPE]
    ?? (profile.MECATEGORY === 'EntPonElement' ? ponEvents[profile.METYPE] : familyEvents[profile.MECATEGORY]);
  if (!specific) throw new Error(`Missing alarm scenarios: ${profile.MECATEGORY}/${profile.METYPE}`);
  // A group has a fixed total weight; adding names does not crowd out the
  // load-dependent CPU/memory scenarios. Independent draw selects its variant.
  events.push([specific[Math.min(specific.length - 1, Math.floor(variantDraw * specific.length))], 4]);
  let remaining = draw * events.reduce((sum, [, weight]) => sum + weight, 0);
  return events.find(([, weight]) => (remaining -= weight) < 0)?.[0] ?? events.at(-1)[0];
}
