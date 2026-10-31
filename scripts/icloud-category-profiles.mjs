import { createHash } from 'node:crypto';

// Independent deterministic draws: adding a field does not reshuffle other categories.
export function categoryRandom(seed, table, index, key) {
  return createHash('sha256').update(JSON.stringify([seed, table, index, key])).digest().readUInt32LE() / 0x100000000;
}
function choose(values, random) {
  const weights = values.map((_, i) => [55, 25, 15, 5][i] ?? 5);
  let at = random * weights.reduce((a, b) => a + b, 0);
  return values.find((_, i) => (at -= weights[i]) < 0) ?? values.at(-1);
}
function vendors(table) {
  if (/Memory/.test(table)) return ['三星', 'SK海力士', '美光'];
  if (/Processor/.test(table)) return ['Intel', 'AMD', '海光'];
  if (/Disk/.test(table)) return ['希捷', '西部数据', '三星'];
  if (/OpticalModule/.test(table)) return ['华为', '中际旭创', '光迅科技'];
  if (/FCSwitch/.test(table)) return ['博科', '思科'];
  if (/Storage|^SYS_/.test(table)) return ['华为', '联想', 'HPE'];
  if (/PhysicalServer/.test(table)) return ['华为', '戴尔', '浪潮'];
  if (table === 'EntTerminalElement') return ['联想', '戴尔', '惠普', '苹果'];
  return ['华为', '新华三', '锐捷', '思科'];
}
const categories = {
  language: ['zh_CN', 'en_US'], timeZone: ['Asia/Shanghai'],
  boardType: ['控制板', '接口板', '扩展板'], logicType: ['业务', '管理', '备份'],
  systemSupplyMode: ['双路供电', '单路供电'], curSupplyMode: ['双路供电', '单路供电'],
  backupPowerType: ['锂电池', '铅酸电池'],
  belongSeries: ['企业级', '园区级', '分支级'],
  DOMAIN: ['园区网络', '计算资源', '存储资源'],
  ORIGINSYSTEMNAME: ['园区网管', '数据中心网管'], ORIGINSYSTEMTYPE: ['NMS', 'EMS'],
  ACKUSER: ['值班员A', '值班员B', '值班员C'], CLEARUSER: ['值班员A', '值班员B', '系统恢复'],
  COMMENTUSER: ['值班员A', '值班员B'],
  INDUSTRY: ['制造业', '信息技术', '教育', '金融', '医疗'],
  assetManager: ['基础设施运维组', '园区网络组', '业务平台组'],
  osName: ['Windows 11', 'Ubuntu 24.04', 'Windows 10', 'macOS 15'],
  vlanId: [10, 20, 30, 40], duplexMode: ['full', 'half'],
  ifMtu: [1500, 9000], bandwidth: [1000000000, 10000000000, 100000000],
  redundancyMode: ['N+1', 'N+N'], workMode: ['主用', '备用'],
  processorType: ['通用计算', '高密计算'], transType: ['光模块', '电模块'],
  portType: ['以太网', '光纤通道'], powerMode: ['交流', '直流'], powerType: ['冗余电源', '标准电源'],
  driverName: ['ixgbe', 'i40e', 'mlx5_core'],
};
const tableCategories = {
  PhysicalServerMemory: {type: ['DDR4', 'DDR5'], capacity: [32768, 65536, 16384], frequency: [3200, 4800, 2666], bitWidth: [64, 72]},
  PhysicalServerDisk: {capacity: [960, 1920, 3840]},
  SYS_Fan: {type: ['调速风扇', '定速风扇']},
  SYS_Controller: {cpuCount: [2, 4], memorySize: [64, 128, 256]},
};

export function categoryValue(table, column, index, seed) {
  const draw = key => categoryRandom(seed, table, index, key);
  const vendor = choose(vendors(table), draw('manufacturer'));
  if (/^(manufacturer|MANUFACTURER|vendor|vendorName|cardManufacturer)$/.test(column)) return vendor;
  // These model names are intentionally synthetic; keep manufacturer/model consistent.
  if (/^(productName|productmodel|productModel|model|cardModel)$/.test(column)) {
    return `${vendor}-${table}-系列${choose(['A', 'B', 'C'], draw('product-series'))}`;
  }
  if (/^(version|neOsVersion|biosVersion|softVersion|softVer|firmware|firmwareVer|firmwareVersion|hardVersion|driverVersion|powerVersion)$/.test(column)) {
    return choose(['V3.2', 'V3.1', 'V2.8'], draw(column));
  }
  if (/^(nePatchVersion|hotPatchVersion)$/.test(column)) return choose(['SPH003', 'SPH002', 'SPH001'], draw(column));
  if (column === 'ssidName') return choose(['Campus-Office', 'Campus-Guest', 'Campus-IoT'], draw(column));
  if (column === 'location') return choose(['A楼/一层机房', 'A楼/二层机房', 'B楼/中心机房', 'B楼/接入间'], draw(column));
  const values = tableCategories[table]?.[column] ?? categories[column];
  return values ? choose(values, draw(column)) : undefined;
}

export function enumCategoryValue(table, column, index, seed, values) {
  const preferred = values.find(v => /^(normal|online|up|active|enabled|running)$/i.test(v.label));
  if (!/status|state/i.test(column) || !preferred) return undefined;
  // Operational inventories are mostly healthy, rather than uniform over failure states.
  const random = categoryRandom(seed, table, index, column);
  return random < 0.82 ? Object.values(preferred.wires[0])[0]
    : Object.values(values[Math.floor((random - 0.82) / 0.18 * values.length)]?.wires[0] ?? values.at(-1).wires[0])[0];
}

export function tenantLayout(resources, seed) {
  // Keep a reusable tenant population smaller than the inventory. Small samples
  // round the 20/30/50 tenant cohorts; the device cohorts remain near 60/30/10.
  const count = Math.min(10, Math.max(3, Math.floor(resources / 3)));
  const sizes = [Math.max(1, Math.round(count * 0.2)), Math.max(1, Math.round(count * 0.3))];
  sizes.push(count - sizes[0] - sizes[1]);
  const deviceCounts = [Math.round(resources * 0.6), Math.round(resources * 0.3)];
  deviceCounts.push(resources - deviceCounts[0] - deviceCounts[1]);
  const tiers = sizes.map((size, i) => ({tenantStart:sizes.slice(0,i).reduce((a,b)=>a+b,0), tenants:size, deviceShare:[0.6,0.3,0.1][i]}));
  const allocation = tiers.flatMap((tier, i) => {
    const order = Array.from({length:tier.tenants},(_,j)=>tier.tenantStart+j)
      .sort((a,b)=>categoryRandom(seed,'tenants',a,'order')-categoryRandom(seed,'tenants',b,'order') || a-b);
    return Array.from({length:deviceCounts[i]},(_,j)=>order[j%order.length]);
  });
  // Shuffle the assignment, so tenant size is independent of equipment index.
  const order = Array.from({length:resources},(_,i)=>i)
    .sort((a,b)=>categoryRandom(seed,'inventory',a,'tenant')-categoryRandom(seed,'inventory',b,'tenant') || a-b);
  const assignments = [];
  order.forEach((index,i)=>{assignments[index]=allocation[i];});
  return {count, tiers, assignments};
}


// Resolve all source encodings through the model's canonical value mapping.
// A display label is a fixture label, never a replacement for a query value.
export function networkDeviceCategory(value, members) {
  const canonical = members.find(member => member.wires.some(wire =>
    (wire !== null && typeof wire === 'object' ? Object.values(wire)[0] : wire) === value));
  if (!canonical) throw new Error(`Unknown network device classification: ${value}`);
  const labels = {
    WAC:'无线控制器', wac:'无线控制器', LSW:'园区交换机', switch:'园区交换机',
    router:'路由器', firewall:'防火墙', AP:'无线接入点', fatap:'无线接入点', fitap:'瘦AP',
    tianguan:'天关设备', printer:'打印机', ups:'UPS电源', lb:'负载均衡器', others:'其他网络设备',
  };
  const label = labels[canonical.id];
  if (!label) throw new Error(`Name the network device class explicitly: ${canonical.id}`);
  return {id:canonical.id,label};
}

export function networkDevicePresentation(value, members, manufacturer, index, originalProduct) {
  const category=networkDeviceCategory(value,members);
  const name=`${category.label}-${String(index+1).padStart(2,'0')}`;
  const series=originalProduct?.match(/系列([ABC])$/)?.[1] ?? 'A';
  return {name,alias:name,productName:`${manufacturer}-${category.label}-系列${series}`,typeId:category.id};
}

export function networkDeviceClass(index, seed, table, members) {
  // Keep witnesses for each declared class in small fixtures, then draw a
  // switch-heavy inventory instead of cycling classes uniformly forever.
  let member=members[index];
  if (!member) {
    const weights={LSW:55,switch:55,router:14,AP:10,fatap:7,fitap:3,WAC:8,wac:8,firewall:5};
    let draw=categoryRandom(seed,table,index,'classification')*members.reduce((sum,m)=>sum+(weights[m.id]??1),0);
    member=members.find(m=>(draw-=weights[m.id]??1)<0)??members.at(-1);
  }
  const wire=member.wires[0];
  return wire!==null&&typeof wire==='object'?Object.values(wire)[0]:wire;
}
