import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { discoveryKeys } from './knowledge-export.mjs';

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const link = (key, label = key) => `<a href="#${escape(encodeURIComponent(key))}">${escape(label)}</a>`;

export function renderKnowledge(nodes) {
  if (!Array.isArray(nodes)) throw new Error('Expected an array of knowledge nodes');
  const keys = new Set();
  for (const node of nodes) {
    if (typeof node?.key !== 'string' || typeof node.type !== 'string' ||
        typeof node.description?.label !== 'string' || !Array.isArray(node.links) ||
        node.detail === null || typeof node.detail !== 'object') {
      throw new Error('Expected {key,type,description,links,detail} nodes');
    }
    if (keys.has(node.key)) throw new Error(`Duplicate knowledge key: ${node.key}`);
    keys.add(node.key);
  }
  const checkLink = (key) => {
    if (typeof key !== 'string' || !keys.has(key)) throw new Error(`Unresolved knowledge key: ${key}`);
  };
  const sections = nodes.map((node) => {
    const { key, type, description, links, detail } = node;
    for (const key of discoveryKeys(node)) checkLink(key);
    let content;
    if (['Index', 'Directory', 'Terminology'].includes(type)) {
      if (!Array.isArray(detail.entries)) throw new Error(`${type} requires detail.entries`);
      content = '<table><thead><tr><th>Node / Term</th><th>Description / Endpoints</th><th>Key</th></tr></thead><tbody>' +
        detail.entries.map((entry) => {
          checkLink(entry.key);
          return `<tr><td>${escape(entry.label ?? entry.term)}</td>` +
            `<td>${entry.from ? link(entry.from) + ' → ' + link(entry.to) : escape(entry.description ?? entry.type ?? '')}</td>` +
            `<td>${link(entry.key)}</td></tr>`;
        }).join('') + '</tbody></table>';
    } else {
      content = `<pre>${escape(JSON.stringify(detail, null, 2))}</pre>`;
    }
    return `<section id="${escape(key)}"><h2>${escape(description.label)}</h2>` +
      `<p class="identity">${escape(type)} · ${escape(key)}</p>` +
      `<p>${escape(description.summary ?? '')}</p>` +
      `<p>${(description.aliases ?? []).map(escape).join(' · ')}</p>` +
      (description.localized ?? []).map((text) => `<p lang="${escape(text.locale)}">${escape(text.label)}: ${escape(text.summary)}</p>`).join('') +
      content + `<ul>${links.map((item) => `<li>${escape(item.type)}: ${link(item.key)}</li>`).join('')}</ul></section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Knowledge map</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#202124;background:#fff}main{max-width:1100px;margin:auto;padding:24px}section{padding:20px 0;border-bottom:1px solid #ddd;scroll-margin-top:16px}h1{font-size:26px}h2{font-size:20px}a{color:#086b63;overflow-wrap:anywhere}.identity{color:#666;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}pre{overflow:auto;padding:12px;background:#f4f5f6}ul{padding-left:20px}@media(max-width:600px){main{padding:12px}th,td{padding:5px}}</style>` +
    `</head><body><main><h1>Knowledge map</h1><nav>${nodes.map((node) => link(node.key, node.description.label)).join(' · ')}</nav>${sections}</main></body></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(renderKnowledge(JSON.parse(readFileSync(process.argv[2] ?? 0, 'utf8'))));
}
