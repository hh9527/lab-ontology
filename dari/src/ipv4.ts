// Finite IPv4 operations shared by scalar evaluation and SQLite execution.
export function ipv4(value:unknown):number|null {
 if(typeof value!=='string'||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))return null;
 const parts=value.split('.');
 if(parts.some(p=>String(Number(p))!==p||Number(p)>255))return null;
 return parts.reduce((n,p)=>n*256+Number(p),0);
}
export function inSubnet(address:unknown,subnet:unknown):number|null {
 if(typeof subnet!=='string')throw Error('IPv4 subnet requires canonical address/prefix');
 const parts=subnet.split('/'),base=ipv4(parts[0]),bits=Number(parts[1]);
 if(parts.length!==2||base===null||!/^\d+$/.test(parts[1])||String(bits)!==parts[1]||bits<0||bits>32)throw Error('Invalid canonical IPv4 subnet');
 const size=2**(32-bits);
 if(base%size!==0)throw Error('IPv4 subnet must have zero host bits');
 const ip=ipv4(address);return ip===null?null:Number(ip>=base&&ip<base+size);
}
