#!/usr/bin/env node
/**
 * tester-cli.mjs — 试卷「测试员」命令行
 *
 * 用途：以测试员身份驱动一个运行中的 dsh web 会话（考生），逐题发送题面、
 *       等待作答、读取答卷、记录计时，并在最后生成记录表。
 *
 * 依赖：Node >= 20（用全局 fetch / crypto.randomUUID），无第三方包。
 *
 * 快速开始：
 *   node tester-cli.mjs auth "http://127.0.0.1:10924/?token=xxxx"
 *   node tester-cli.mjs sessions --cwd /path/to/demo-ws2 --model
 *   node tester-cli.mjs use --newest --cwd /path/to/demo-ws2
 *   node tester-cli.mjs ask "第 1 题　告警级别构成\n\n统计最近 3 个完整自然日的告警数量……"
 *   node tester-cli.mjs record --out 记录表.md
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

// ────────────────────────────── 常量与状态 ──────────────────────────────

const STATE_DIR = process.env.TESTER_STATE_DIR || join(import.meta.dirname, '.tester');
const CONFIG_DIR = process.env.TESTER_CONFIG_DIR;
const STATE_FILE = join(STATE_DIR, 'state.json');
const LOG_FILE = join(STATE_DIR, 'log.jsonl');

/** 每个 RPC 端点的唯一入参名（服务端要求 payload.args 恰好有一个字段）。 */
const PARAM = {
  'session/list': '_request',
  'session/page': 'request',
  'session/prompt': 'request',
  'session/projections': 'request',
  'session/create': 'request',
  'session/rename': 'request',
  'session/create': 'request',
};

const HELP = `tester-cli — 试卷测试员命令行

用法：node tester-cli.mjs <命令> [参数] [--选项]

连接
  auth <带 token 的 URL>     用 dsh web 打印的 URL 换取会话 Cookie 并保存
  state                      打印当前连接目标、考生会话、模型与计时概况

发现考生
  sessions [--cwd 路径] [--model] [--limit N]
                             列出会话（--cwd 过滤工作区，--model 附带模型）
  use <会话ID或唯一后缀>      指定考生会话
  use --newest [--cwd 路径]   自动取最近活跃的会话
  new --cwd 路径 [--preset 名] [--id ID]
                             新建一个空会话并锁定为考生

问答
  send "<文本>"               只发送，不等待（等同人工敲回车）
  ask  "<文本>" [--tag 标签]  发送 → 等作答结束 → 打印回复，并记入日志
  wait [--timeout 秒]         等待当前会话空闲
  tail [--n 条数]             打印最近若干轮问答

批量
  run <脚本文件>              按 === 分隔的分段依次 ask（见「使用说明」）
  sample --cwd 路径 --tasks 临时题单.md --model provider/model
                             新建会话、读取考卷开场白，再逐段采样
  record [--out 文件.md]      用日志生成记录表

公共选项
  --base URL       覆盖服务地址（默认从 auth 的 URL 推导）
  --session ID     临时指定考生会话，不写入状态
  --tz 时区        计时与显示时区（默认 Asia/Shanghai）
  --timeout 秒     单次等待上限（默认 900）
  --poll 秒        轮询间隔（默认 4）
  --idle 次数      连续空闲多少次判定作答结束（默认 3）
  --effort 档位    推理档位（off/low/high；省略则用提供方默认）
  --preview 字数   回复预览长度（默认 800，0 表示全给）
  --quiet          只打印计时行
  --json           以 JSON 输出（sessions / state / record）
  --dry-run        只打印将要发送的请求体，不发网络请求
  --no-auto        关闭澄清自动应答（此时考生一发问就会挂住）
  --stop-on-ask    run 时若某段回复以问号结尾（疑似澄清）就停下
`;

// ────────────────────────────── 小工具 ──────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { flags, pos };
}

const num = (v, d) => (v === undefined || v === true ? d : Number(v));

async function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveState(s) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2) + '\n');
}

function hhmmss(date, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

function localDate(ms, tz) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(ms));
}

/** 把任意会话引用解析成完整 sessionId（支持唯一后缀）。 */
function resolveSession(items, ref) {
  if (!ref) throw new Error('还没有指定考生会话：先用 use 指定，或用 --session 临时指定');
  const exact = items.find((i) => i.sessionId === ref);
  if (exact) return exact.sessionId;
  const hits = items.filter((i) => i.sessionId.endsWith(ref) || i.sessionId.includes(ref));
  if (hits.length === 1) return hits[0].sessionId;
  if (hits.length === 0) throw new Error(`找不到会话：${ref}`);
  throw new Error(`会话引用不唯一（匹配 ${hits.length} 个）：${ref}`);
}

// ────────────────────────────── 传输层 ──────────────────────────────

/**
 * 调用 dsh web 的 /api/<method> RPC。
 * 信封形如 { type:'client-request', rpcId, method, payload:{ args:{ <param>: {...} } } }。
 */
async function rpc(state, method, args) {
  const param = PARAM[method] ?? 'request';
  const envelope = {
    type: 'client-request',
    rpcId: crypto.randomUUID(),
    method,
    payload: { args: { [param]: args } },
  };
  const res = await fetch(`${state.base}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: state.cookie ?? '' },
    body: JSON.stringify(envelope),
  });
  if (res.status === 401) {
    throw new Error('401 未认证：Cookie 失效或缺失，请重新执行 auth "<带 token 的 URL>"');
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
  const result = json.result ?? {};
  if (!result.ok) {
    const e = result.error ?? {};
    throw new Error(`${method} 失败：${e.code ?? 'unknown'} ${e.message ?? ''}`);
  }
  return result.value;
}

// ────────────────────────────── 会话读写 ──────────────────────────────

async function listSessions(state) {
  const v = await rpc(state, 'session/list', {});
  return v?.items ?? [];
}

async function summary(state, sessionId) {
  const items = await listSessions(state);
  const item = items.find((i) => i.sessionId === sessionId);
  if (!item) throw new Error(`会话不存在：${sessionId}`);
  return { item, items };
}

/** 读一整段历史；throughSeq 必须来自 list 的 asOfSeq。 */
async function readRecords(state, sessionId, maxMessages = 300) {
  const items = await listSessions(state);
  const item = items.find((i) => i.sessionId === sessionId);
  if (!item) throw new Error(`会话不存在：${sessionId}`);
  const v = await rpc(state, 'session/page', {
    address: { kind: 'session', sessionId },
    throughSeq: item.projections.asOfSeq,
    maxMessages,
  });
  return { item, records: v?.records ?? [] };
}

const eventOf = (r) => r?.event ?? {};

function textOf(ev) {
  const data = ev?.data?.message ?? ev?.data ?? {};
  const content = data.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((p) => p?.type === 'text').map((p) => p.text).join('');
  }
  return '';
}

/** 只保留人发的提问与助手的正式回复，按 seq 升序。 */
function transcript(records) {
  const out = [];
  for (const r of records) {
    const ev = eventOf(r);
    if (ev.type !== 'user/message' && ev.type !== 'assistant/message') continue;
    const text = textOf(ev).trim();
    if (!text) continue;
    const source = ev.data?.source?.kind;
    if (ev.type === 'user/message' && source && source !== 'user') continue; // 跳过运行时上下文/技能目录
    out.push({ seq: ev.seq, role: ev.type === 'user/message' ? 'user' : 'assistant', text });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** 从 list 的 projections 取模型（比翻 request/header 便宜且可靠）。 */
function modelLabel(item) {
  const sel = item?.projections?.values?.modelSelection;
  const c = sel?.lastUsed ?? sel?.next;
  if (!c) return undefined;
  return `${c.provider}/${c.model}${c.reasoningEffort ? ` (${c.reasoningEffort})` : ''}`;
}

async function waitIdle(state, sessionId, { timeout, poll, idle }) {
  const deadline = Date.now() + timeout * 1000;
  let idleCount = 0;
  let item;
  while (Date.now() < deadline) {
    const r = await summary(state, sessionId);
    item = r.item;
    idleCount = item.running ? 0 : idleCount + 1;
    if (idleCount >= idle) return item;
    await sleep(poll * 1000);
  }
  throw new Error(`等待超时（${timeout}s）：会话可能仍在作答，可用 wait 继续等，或调大 --timeout`);
}

// ────────────────────────────── 命令实现 ──────────────────────────────

async function cmdAuth(pos, flags) {
  const url = pos[0];
  if (!url) throw new Error('用法：auth "<dsh web 打印的带 token 的 URL>"');
  const u = new URL(url);
  const res = await fetch(url, { redirect: 'manual' });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (setCookies.length === 0) {
    throw new Error(`没有拿到 Cookie（HTTP ${res.status}）：确认 URL 里的 token 是 dsh web 刚打印的那个`);
  }
  const cookie = setCookies[0].split(';')[0];
  const state = await loadState();
  Object.assign(state, {
    base: u.origin,
    cookie,
    tz: flags.tz ?? state.tz ?? 'Asia/Shanghai',
    authedAt: new Date().toISOString(),
  });
  await saveState(state);
  console.log(`✓ 已认证 ${u.origin}（Cookie 已存入 ${STATE_FILE}）`);
}

async function cmdSessions(flags) {
  const state = await withSession(flags, { needSession: false });
  let items = await listSessions(state);
  if (flags.cwd) {
    const want = resolve(String(flags.cwd));
    items = items.filter((i) => i.cwd === want);
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  const limit = num(flags.limit, 20);
  items = items.slice(0, limit);

  const rows = [];
  for (const i of items) {
    const proj = i.projections?.values ?? {};
    const model = flags.model ? modelLabel(i) : undefined;
    rows.push({
      sessionId: i.sessionId,
      updatedAt: localDate(i.updatedAt, state.tz),
      running: i.running,
      turns: proj.sessionStats?.turns ?? 0,
      model,
      title: proj.title ?? '',
      cwd: i.cwd,
    });
  }

  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log('（没有匹配的会话）');
    return;
  }
  for (const r of rows) {
    const mark = state.sessionId === r.sessionId ? '*' : ' ';
    const id = r.sessionId.replace(/^session-/, '');
    const run = r.running ? 'RUN' : '   ';
    console.log(
      `${mark} ${id.slice(0, 8)}  ${r.updatedAt}  ${run}  turns=${String(r.turns).padStart(2)}  ` +
      `${(r.model ?? '').padEnd(28)} ${r.title}  [${basename(r.cwd)}]`
    );
  }
  console.log(`\n（* 为当前考生会话；完整 ID 用 --json 查看）`);
}

async function cmdUse(pos, flags) {
  const state = await withSession(flags, { needSession: false });
  const items = await listSessions(state);
  let target;
  if (flags.newest) {
    let pool = items;
    if (flags.cwd) {
      const want = resolve(String(flags.cwd));
      pool = pool.filter((i) => i.cwd === want);
    }
    pool.sort((a, b) => b.updatedAt - a.updatedAt);
    if (pool.length === 0) throw new Error('没有可用会话');
    target = pool[0].sessionId;
  } else {
    target = resolveSession(items, pos[0]);
  }
  state.sessionId = target;
  await saveState(state);
  const { item } = await summary(state, target);
  const proj = item.projections?.values ?? {};
  const model = modelLabel(item);
  console.log(`✓ 考生会话：${target}`);
  console.log(`  标题：${proj.title ?? '（无）'}  回合：${proj.sessionStats?.turns ?? 0}  cwd：${item.cwd}`);
  if (model) console.log(`  模型：${model}`);
  if (flags.model && model === undefined) console.log('  模型：读不到 request/header（会话可能还没跑过一轮）');
}

async function cmdNew(flags) {
  const state = await withSession(flags, { needSession: false });
  const request = { cwd: resolve(String(flags.cwd ?? process.cwd())) };
  if (flags.preset) request.agentPreset = String(flags.preset);
  if (flags.id) request.sessionId = String(flags.id);
  const created = await rpc(state, 'session/create', request);
  state.sessionId = created.sessionId;
  await saveState(state);
  const { item } = await summary(state, created.sessionId);
  console.log(`✓ 新建考生会话：${created.sessionId}`);
  console.log(`  cwd：${item.cwd}  预设：${created.agentPreset ?? item.projections?.values?.agentPreset ?? '（默认）'}`);
  console.log(`  模型：${modelLabel(item) ?? '（未选定，首轮后确定）'}`);
}

async function cmdState(flags) {
  const state = await withSession(flags, { needSession: false });
  const out = {
    base: state.base,
    authedAt: state.authedAt,
    sessionId: state.sessionId,
    tz: state.tz ?? 'Asia/Shanghai',
  };
  if (state.sessionId) {
    const { item } = await summary(state, state.sessionId);
    const proj = item.projections?.values ?? {};
    Object.assign(out, {
      title: proj.title,
      turns: proj.sessionStats?.turns,
      running: item.running,
      cwd: item.cwd,
      model: modelLabel(item),
      lastSeq: item.projections?.asOfSeq,
    });
  }
  if (existsSync(LOG_FILE)) {
    const lines = (await readFile(LOG_FILE, 'utf8')).split('\n').filter(Boolean);
    out.logged = lines.length;
    const total = lines.reduce((s, l) => { try { return s + (JSON.parse(l).seconds ?? 0); } catch { return s; } }, 0);
    out.loggedSeconds = Math.round(total * 10) / 10;
  }
  if (flags.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(12)} ${v ?? ''}`);
}


// ─────────────────────── 自动应答器（WebSocket 交互通道） ───────────────────────
//
// 考生的澄清走 ask_user_question 工具，是一条阻塞式 UI 交互：服务端通过
// /api/remote.mux 这条 WebSocket 上的 $events 流，把
//   {type:"waterfall", event:"user-questions/request", eventId, agentId, request}
// 推给每个「声明愿意回答」的客户端，客户端再把
//   {clientId, eventId, outcome:{kind:"result", value:{answers:[...]}}}
// POST 回 /api/$events/result。测试员用它代替人手点选。

const QUESTIONS_LOG = join(STATE_DIR, 'questions.jsonl');

/** 本卷默认的作答策略：先过规则，再兜底。 */
const DEFAULT_RULES = [
  {
    "match": "HTML|报告|report",
    "text": "按任务性质来：需要报告的就出 HTML 报告，纯取数不用。"
  },
  {
    "match": "邮箱|地址|发给|发到|收件",
    "text": "发到 ops-demo@example.com，PDF 就行。"
  },
  {
    "match": "阈值|告警线|超过多少",
    "text": "就按 90% 算。"
  },
  {
    "match": "滞后|没有数据|取不到|空窗|0 行|数据只到|数据截止|无采样",
    "text": "就按能取到的最近一天来，注明口径变化就行。"
  },
  {
    "match": "含不含今天|是否包含今天|包括今天",
    "text": "不含今天，到今天为止已经过完的那几天。"
  },
  {
    "match": "时间窗口|最近\\s*\\d+\\s*天|窗口(如何|怎么)?(界定|定义|口径)|自然日|滚动|含当天|完整自然日",
    "text": "按已经过完的自然日算，不含今天。"
  },
  {
    "match": "网络设备.*范围|设备范围|哪些分类|算不算",
    "choose": "排除打印机"
  },
  {
    "match": "并列|同值|相同值|一样",
    "text": "你自己定一个规则，写清楚就行。"
  },
  {
    "match": "单位|字节量",
    "text": "这个我记不清，按系统里声明的来。"
  },
  {
    "match": "告警对象类型|对象类型|MECATEGORY|METYPE|MOC\\b|EVENTTYPE",
    "text": "按设备（网元）类型来分吧，不要按告警事件类型那种分法。"
  },
  {
    "match": "字段|枚举|指标|哪一个|怎么聚合|关联|表名",
    "text": "这个我记不清，按系统里声明的来。"
  }
];

const KNOWLEDGE_HINT = /单位|字段|枚举|指标|聚合|关联|表名|字段名|怎么算出来/;

function loadRules(state) {
  const file = state.policyFile ?? (CONFIG_DIR ? join(CONFIG_DIR, 'policy.json') : undefined);
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed.rules)) return parsed.rules;
    } catch (err) {
      console.warn(`! 策略文件 ${file} 解析失败，退回默认规则：${err.message}`);
    }
  }
  return DEFAULT_RULES;
}

function firstQuestion(request) {
  const queue = [request];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node.questions) && node.questions.length > 0 && node.questions[0]?.id) {
      return node.questions;
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') queue.push(v);
    }
  }
  return undefined;
}

/** 规则 + 兜底，产出一条 answer。返回 {answers, rule}。 */
function decideAnswer(questions, rules) {
  const answers = [];
  const applied = [];
  for (const q of questions) {
    const options = Array.isArray(q.options) ? q.options.map((o) => o.label) : [];
    const haystack = `${q.header ?? ''} ${q.question ?? ''}`;
    let chosen = null;
    let ruleName = 'fallback';

    for (const rule of rules) {
      if (!rule.match) continue;
      if (!new RegExp(rule.match, 'i').test(haystack)) continue;
      if (rule.text) {
        chosen = { id: q.id, selected: [], custom: rule.text };
        ruleName = `rule:${rule.match}`;
        break;
      }
      if (rule.choose) {
        const hit = options.find((label) => label.includes(rule.choose));
        if (hit) {
          chosen = { id: q.id, selected: [hit] };
          ruleName = `rule:${rule.match}`;
          break;
        }
      }
    }

    if (!chosen) {
      const recommended = options.find((label) => label.includes('推荐'));
      if (recommended) {
        chosen = { id: q.id, selected: [recommended] };
        ruleName = 'fallback:recommended';
      } else if (KNOWLEDGE_HINT.test(haystack)) {
        chosen = { id: q.id, selected: [], custom: '这个我记不清，按系统里声明的来。' };
        ruleName = 'fallback:knowledge';
      } else if (options.length > 0) {
        chosen = { id: q.id, selected: [options[0]] };
        ruleName = 'fallback:first-option';
      } else {
        chosen = { id: q.id, selected: [], custom: '按你的判断来，写清楚依据就行。' };
        ruleName = 'fallback:free';
      }
    }
    answers.push(chosen);
    applied.push({ id: q.id, header: q.header, question: q.question, options, rule: ruleName, answer: chosen });
  }
  return { answers, applied };
}

async function postEventResult(state, clientId, eventId, value) {
  const body = {
    type: 'client-request',
    rpcId: crypto.randomUUID(),
    method: '$events/result',
    payload: { args: { clientId, eventId, outcome: { kind: 'result', value } } },
  };
  const res = await fetch(`${state.base}/api/$events/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: state.cookie ?? '' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`$events/result HTTP ${res.status}: ${text.slice(0, 120)}`);
  return text;
}

/**
 * 打开交互通道并自动应答。
 * @returns {{close: () => void, stats: () => object}}
 */
async function startAnswerer(state, flags = {}) {
  const stats = { answered: 0, seen: 0, errors: 0, manual: 0 };
  if (flags['no-auto']) return { close() {}, stats: () => stats };

  const rules = loadRules(state);
  const wsUrl = `${state.base.replace(/^http/, 'ws')}/api/remote.mux`;
  let clientId;
  let ws;
  try {
    ws = new WebSocket(wsUrl, { headers: { cookie: state.cookie ?? '' } });
  } catch (err) {
    console.warn(`! 交互通道建立失败（澄清将无法自动应答）：${err.message}`);
    return { close() {}, stats: () => stats };
  }

  const streamId = crypto.randomUUID();
  let ready = false;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events', payload: { args: {} } }));
  });

  ws.addEventListener('error', () => {
    stats.errors += 1;
    if (!ready) console.warn('! 交互通道连接出错（澄清将无法自动应答）');
  });

  ws.addEventListener('message', async (message) => {
    let frame;
    try {
      frame = JSON.parse(String(message.data));
    } catch {
      return;
    }
    if (frame.type !== 'item' || !frame.value) return;
    const value = frame.value;

    if (value.type === 'ready') {
      ready = true;
      clientId = value.clientId;
      return;
    }
    if (value.type !== 'waterfall' || value.event !== 'user-questions/request') return;

    stats.seen += 1;
    const questions = firstQuestion(value.request);
    if (!questions) {
      stats.errors += 1;
      console.warn('! 收到提问但解析不出 questions，已忽略');
      return;
    }

    const { answers, applied } = decideAnswer(questions, rules);
    const record = {
      at: new Date().toISOString(),
      eventId: value.eventId,
      agentId: value.agentId,
      applied,
      answers,
    };
    try {
      await postEventResult(state, clientId, value.eventId, { answers });
      stats.answered += 1;
      await mkdir(STATE_DIR, { recursive: true });
      await appendFile(QUESTIONS_LOG, JSON.stringify(record) + '\n');
      if (!flags.quiet) {
        for (const a of applied) {
          const picked = a.answer.selected?.length ? a.answer.selected.join(' / ') : a.answer.custom;
          console.log(`  ⟐ 澄清：${a.question ?? a.header ?? a.id}\n    → ${picked}  [${a.rule}]`);
        }
      }
    } catch (err) {
      stats.errors += 1;
      // 手动先点了、或事件已结束，都算正常收场
      if (/not found|expired|cancel|settled|unknown/i.test(err.message)) {
        stats.manual += 1;
      } else {
        console.warn(`  ! 澄清回包失败：${err.message}`);
      }
    }
  });

  return {
    close() {
      try { ws.close(); } catch { /* 已关闭 */ }
    },
    stats: () => stats,
  };
}

async function cmdSend(pos, flags) {
  const state = await withSession(flags);
  const text = pos.join(' ');
  if (!text) throw new Error('用法：send "<文本>"');
  if (state.dryRun) {
    console.log(JSON.stringify(promptBody(state, text), null, 2));
    return;
  }
  await rpc(state, 'session/prompt', promptBody(state, text));
  console.log(`✓ 已发送（${hhmmss(new Date(), state.tz ?? 'Asia/Shanghai')}）`);
}

function promptBody(state, text) {
  return {
    requestId: crypto.randomUUID(),
    sessionId: state.sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
    clientTimeZone: state.tz ?? 'Asia/Shanghai',
  };
}

async function cmdAsk(pos, flags) {
  const state = await withSession(flags);
  const text = pos.join(' ');
  if (!text) throw new Error('用法：ask "<文本>" [--tag 标签]');
  const entry = await ask(state, text, flags);
  if (!flags.json) return;
  console.log(JSON.stringify(entry, null, 2));
}

async function ask(state, text, flags) {
  const tz = state.tz ?? 'Asia/Shanghai';
  const timeout = num(flags.timeout, 900);
  const poll = num(flags.poll, 4);
  const idle = num(flags.idle, 3);
  const preview = num(flags.preview, 800);
  const tag = flags.tag ?? undefined;

  const before = await summary(state, state.sessionId);
  if (before.item.running && !flags.force) {
    throw new Error('会话还在作答上一题；先 wait，或加 --force 直接排队');
  }
  const askedAt = new Date();
  const seqBefore = before.item.projections.asOfSeq;

  if (!flags.quiet) console.log(`${hhmmss(askedAt, tz)} ▶ ${tag ? `${tag} ` : ''}发送 ${text.length} 字`);

  const answerer = await startAnswerer(state, flags);

  if (state.dryRun) {
    console.log(JSON.stringify({ method: 'session/prompt', payload: { args: { request: promptBody(state, text) } } }, null, 2));
    return null;
  }

  await rpc(state, 'session/prompt', promptBody(state, text));

  let after;
  try {
    after = await waitIdle(state, state.sessionId, { timeout, poll, idle });
  } finally {
    const st = answerer.stats();
    if (st.seen > st.answered) {
      console.warn(`  ! 有 ${st.seen - st.answered} 个澄清未获自动应答（可能已由人工处理，或回包失败）`);
    }
    answerer.close();
  }
  const doneAt = new Date();
  const seconds = Math.round((doneAt - askedAt) / 100) / 10;
  const seqAfter = after.projections.asOfSeq;

  const { records } = await readRecords(state, state.sessionId, 60);
  const replies = transcript(records).filter((t) => t.role === 'assistant' && t.seq > seqBefore);
  const reply = replies.length ? replies[replies.length - 1].text : '';
  const model = modelLabel(after);

  const entry = {
    tag: tag ?? `step-${Date.now()}`,
    askedAt: askedAt.toISOString(),
    doneAt: doneAt.toISOString(),
    askedLocal: hhmmss(askedAt, tz),
    doneLocal: hhmmss(doneAt, tz),
    seconds,
    seqBefore,
    seqAfter,
    model,
    mayAsk: /[？?]\s*$/.test(reply.trim().split('\n').pop() ?? ''),
    promptHead: text.split('\n')[0].slice(0, 80),
    reply,
  };

  await mkdir(STATE_DIR, { recursive: true });
  await appendFile(LOG_FILE, JSON.stringify(entry) + '\n');

  if (!flags.quiet) {
    console.log(`${hhmmss(doneAt, tz)} ■ ${tag ? `${tag} ` : ''}用时 ${seconds}s  seq ${seqBefore}→${seqAfter}${model ? `  ${model}` : ''}`);
    if (reply && preview !== 0) console.log(`\n${preview > 0 ? reply.slice(0, preview) : reply}\n`);
  }
  return entry;
}

async function cmdWait(flags) {
  const state = await withSession(flags);
  const item = await waitIdle(state, state.sessionId, {
    timeout: num(flags.timeout, 900), poll: num(flags.poll, 4), idle: num(flags.idle, 3),
  });
  console.log(`✓ 空闲，seq=${item.projections.asOfSeq}`);
}

async function cmdTail(flags) {
  const state = await withSession(flags);
  const n = num(flags.n, 3);
  const { records } = await readRecords(state, state.sessionId, Math.max(200, n * 4));
  const t = transcript(records);
  for (const m of t.slice(-n * 2)) {
    console.log(`\n[${m.seq}] ${m.role === 'user' ? '问' : '答'}\n${m.text.slice(0, 4000)}`);
  }
}

function parseBlocks(text) {
  const blocks = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^===\s*(.*)$/.exec(line);
    if (m) {
      cur = { tag: m[1].trim(), body: [] };
      blocks.push(cur);
    } else if (cur) {
      cur.body.push(line);
    } else if (line.trim()) {
      cur = { tag: '', body: [line] };
      blocks.push(cur);
    }
  }
  return blocks
    .map((b, i) => ({ tag: b.tag || `step-${i + 1}`, text: b.body.join('\n').trim() }))
    .filter((b) => b.text);
}

async function cmdRun(pos, flags) {
  const file = pos[0];
  if (!file) throw new Error('用法：run <脚本文件>');
  const blocks = parseBlocks(await readFile(file, 'utf8'));
  if (blocks.length === 0) throw new Error('脚本里没有内容（用 === 标签 分段）');
  const state = await withSession(flags);
  console.log(`共 ${blocks.length} 段，开始：${blocks.map((b) => b.tag).join(', ')}\n`);
  const entries = [];
  for (const b of blocks) {
    const entry = await ask(state, b.text, { ...flags, tag: b.tag });
    if (!entry) continue;
    entries.push(entry);
    if (entry.mayAsk && flags['stop-on-ask']) {
      console.log(`\n⚠ ${b.tag} 的回复以问号结尾，疑似在请求澄清；已停止后续分段，请人工应答后继续。`);
      break;
    }
  }
  const total = Math.round(entries.reduce((s, e) => s + e.seconds, 0) * 10) / 10;
  console.log(`\n全部完成：${entries.length} 段，合计 ${total}s`);
}

async function cmdQuestions(flags) {
  if (!existsSync(QUESTIONS_LOG)) {
    console.log('（本轮还没有自动应答记录）');
    return;
  }
  const rows = readFileSync(QUESTIONS_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const [i, row] of rows.entries()) {
    console.log(`\n#${i + 1}  ${row.at}`);
    for (const a of row.applied ?? []) {
      const picked = a.answer?.selected?.length ? a.answer.selected.join(' / ') : a.answer?.custom;
      console.log(`  问：${a.question ?? a.header ?? a.id}`);
      if (a.options?.length) a.options.forEach((o, k) => console.log(`      ${k + 1}) ${o}`));
      console.log(`  答：${picked}   [${a.rule}]`);
    }
  }
  console.log(`\n共 ${rows.length} 次澄清，${rows.reduce((n, r) => n + (r.applied?.length ?? 0), 0)} 个问题`);
}


// ─────────────────────────────── 快速采样 ───────────────────────────────
//
// T1/T2/T3/T6/T11 作为固定采样集：建会话 → 发开场 → 跑五题 → 采指标 → 出报告。
// 指标包含每题的用时、步数、工具回执、工具序列、resolve 的 true/false 分布，
// 以及该题实际采用的统计窗口（用于发现"最近 N 天"口径漂移）。

const SAMPLES_DIR = join(STATE_DIR, 'samples');
const EXAM_FILE = join(import.meta.dirname, '分析能力考核-IC卷.md');

function examOpening() {
  const text = readFileSync(EXAM_FILE, 'utf8');
  const section = text.match(/^## 二、开场白[^\n]*\n([\s\S]*?)(?=^## )/m)?.[1];
  const lines = section?.split(/\r?\n/).filter(line => line.startsWith('>'));
  if (!lines?.length) throw new Error('考卷缺少第二章的定稿开场白');
  return lines.map(line => line.replace(/^> ?/, '')).join('\n').trim();
}

const tokEst = (text) => Math.round(text.length / 3.2);

/** 从一段答案里抽出实际使用的统计窗口。 */
function windowOf(text) {
  // 答案里的 Markdown 会把 - 和 + 转义成 \- \+，先归一化再匹配
  const flat = text.replace(/\\/g, '');
  const m = /统计(?:范围|窗口)[：:][\s\S]{0,40}?(20\d{2}-\d{2}-\d{2})[\s\S]{0,25}?至[\s\S]{0,25}?(20\d{2}-\d{2}-\d{2})/.exec(flat);
  return m ? `${m[1]}→${m[2]}` : '';
}

/** 按轮次汇总一次会话的执行指标。 */
async function collectMetrics(state, tags) {
  const items = await listSessions(state);
  const item = items.find((i) => i.sessionId === state.sessionId);
  if (!item) throw new Error('会话不存在');
  const v = await rpc(state, 'session/page', {
    address: { kind: 'session', sessionId: state.sessionId },
    throughSeq: item.projections.asOfSeq,
    maxMessages: 4000,
  });
  const evs = (v?.records ?? []).map((r) => r.event).filter((e) => e && e.data);
  const names = new Map();
  for (const e of evs) if (e.type === 'tool/call') names.set(e.data.callId, e.data.name);

  const byTurn = new Map();
  for (const e of evs) {
    const t = e.data?.turn;
    if (t === undefined) continue;
    if (!byTurn.has(t)) byTurn.set(t, { steps: 0, tok: 0, tools: {}, ins: 0, del: 0, ms: 0, start: 0, text: '' });
    const o = byTurn.get(t);
    if (e.type === 'turn/start') o.start = e.time;
    if (e.type === 'turn/end') o.ms = e.time - o.start;
    if (e.type === 'step/start') o.steps += 1;
    if (e.type === 'tool/call') {
      o.tools[e.data.name] = (o.tools[e.data.name] ?? 0) + 1;
      if (e.data.name === 'dari_resolve') {
        let a = {};
        try { a = JSON.parse(e.data.arguments); } catch {}
        a.answer === true ? (o.del += 1) : (o.ins += 1);
      }
    }
    if (e.type === 'tool/result') {
      o.tok += tokEst((e.data?.message?.content ?? []).map((p) => p.text ?? '').join(''));
    }
    if (e.type === 'assistant/message') {
      const txt = (e.data?.message?.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('');
      if (txt.trim()) o.text = txt;
    }
  }

  const rows = [];
  // 第 1 轮是开场，任务从第 2 轮开始，按顺序对应 tags
  for (let i = 0; i < tags.length; i++) {
    const o = byTurn.get(i + 2);
    if (!o) continue;
    rows.push({
      tag: tags[i],
      seconds: Math.round(o.ms / 100) / 10,
      steps: o.steps,
      tokens: o.tok,
      inspect: o.ins,
      deliver: o.del,
      window: windowOf(o.text),
      tools: o.tools,
    });
  }
  const total = {
    seconds: Math.round(rows.reduce((s, r) => s + r.seconds, 0) * 10) / 10,
    steps: rows.reduce((s, r) => s + r.steps, 0),
    tokens: rows.reduce((s, r) => s + r.tokens, 0),
    inspect: rows.reduce((s, r) => s + r.inspect, 0),
    deliver: rows.reduce((s, r) => s + r.deliver, 0),
  };
  const pressure = item.projections?.values?.contextPressure;
  return { rows, total, sessionId: state.sessionId, pressure, model: modelLabel(item) };
}

function renderSample(m, { label, notes = [] }) {
  const lines = [
    `# 快速采样 ${label}`,
    '',
    `- 会话：\`${m.sessionId}\``,
    `- 模型：${m.model ?? '—'}`,
    `- 上下文压力：${m.pressure ? `${Math.round(m.pressure.pressureTokens / 1000)}k / ${Math.round(m.pressure.contextWindow / 1000)}k` : '—'}`,
    '',
    '| 任务 | 用时(s) | 步数 | 回执(k) | 调试/交付 | 统计窗口 |',
    '|---|---:|---:|---:|---|---|',
    ...m.rows.map((r) => `| ${r.tag} | ${r.seconds} | ${r.steps} | ${(r.tokens / 1000).toFixed(1)} | ${r.inspect}/${r.deliver} | ${r.window || '—'} |`),
    `| **合计** | **${m.total.seconds}** | **${m.total.steps}** | **${(m.total.tokens / 1000).toFixed(1)}** | **${m.total.inspect}/${m.total.deliver}** | |`,
    '',
    '## 工具序列',
    '',
    ...m.rows.map((r) => `- **${r.tag}**：${Object.entries(r.tools).map(([n, c]) => `${n}×${c}`).join(' ')}`),
  ];
  if (notes.length) lines.push('', '## 备注', '', ...notes.map((n) => `- ${n}`));
  return lines.join('\n');
}

async function cmdSample(pos, flags) {
  if (!flags.tasks) throw new Error('sample 需要 --tasks <临时题单.md>；请按需从考卷提取任务，以 === T1 等标记分段');
  const state = await withSession(flags, { needSession: false });
  const label = String(flags.label ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));

  // 只重算已有会话，不重跑
  if (flags.report) {
    state.sessionId = String(flags.report);
    const tags = parseBlocks(readFileSync(flags.tasks, 'utf8')).map((b) => b.tag);
    const m = await collectMetrics(state, tags);
    const md = renderSample(m, { label });
    await mkdir(SAMPLES_DIR, { recursive: true });
    const out = join(SAMPLES_DIR, `${label}.md`);
    await writeFile(out, md + '\n');
    console.log(md);
    console.log(`\n✓ 写入 ${out}`);
    return;
  }

  const cwd = resolve(String(flags.cwd ?? ''));
  if (!flags.cwd) throw new Error('用法：sample --cwd <考生工作区> [--label 名称]');
  if (!existsSync(cwd)) throw new Error(`工作区不存在：${cwd}`);
  const leftover = readdirSync(cwd).filter((f) => f.endsWith('.dari'));
  const notes = [];
  if (leftover.length) {
    notes.push(`⚠ 工作区残留 ${leftover.length} 份旧稿（${leftover.slice(0, 4).join(', ')}${leftover.length > 4 ? ' …' : ''}），采样结果不可比`);
    console.warn(notes[notes.length - 1]);
  }

  const created = await rpc(state, 'session/create', { cwd, agentPreset: String(flags.preset ?? 'data-seer') });
  state.sessionId = created.sessionId;
  if (flags.model) {
    const [provider, model] = String(flags.model).split('/');
    if (!provider || !model) throw new Error('--model 用法：provider/model，例如 openai/gpt-6.1-terra');
    const picked = await rpc(state, 'session/selectModel', { sessionId: created.sessionId, provider, model, ...(flags.effort ? { reasoningEffort: String(flags.effort) } : {}) });
    console.log(`✓ 模型切换 ${JSON.stringify(picked.selected ?? picked)}`);
  }
  await saveState(state);
  console.log(`✓ 采样会话 ${created.sessionId}`);

  const opening = examOpening();
  await ask(state, opening, { ...flags, tag: '开场', quiet: true, preview: 0 });

  const blocks = parseBlocks(readFileSync(flags.tasks, 'utf8'));
  for (const b of blocks) {
    const entry = await ask(state, b.text, { ...flags, tag: b.tag, preview: num(flags.preview, 0) });
    if (entry?.mayAsk && flags['stop-on-ask']) {
      notes.push(`⚠ ${b.tag} 的回复以问号结尾，采样中断`);
      break;
    }
  }

  const m = await collectMetrics(state, blocks.map((b) => b.tag));
  const md = renderSample(m, { label, notes });
  await mkdir(SAMPLES_DIR, { recursive: true });
  const out = join(SAMPLES_DIR, `${label}.md`);
  await writeFile(out, md + '\n');
  console.log(md);
  console.log(`\n✓ 写入 ${out}`);
}

async function cmdRecord(flags) {
  if (!existsSync(LOG_FILE)) throw new Error('还没有日志（先 ask 或 run）');
  const lines = (await readFile(LOG_FILE, 'utf8')).split('\n').filter(Boolean);
  const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (entries.length === 0) throw new Error('日志为空');

  const total = Math.round(entries.reduce((s, e) => s + e.seconds, 0) * 10) / 10;
  const md = [
    '| 标签 | 提问 | 完成 | 用时(s) | 可能追问 | 回复摘要 |',
    '|---|---|---|---:|---|---|',
    ...entries.map((e) => `| ${e.tag} | ${e.askedLocal} | ${e.doneLocal} | ${e.seconds} | ${e.mayAsk ? '是' : ''} | ${String(e.reply ?? '').replace(/\s+/g, ' ').slice(0, 60).replace(/\|/g, '\\|')} |`),
    '',
    `合计 ${entries.length} 段，${total}s（${Math.round(total / 60)} 分 ${Math.round(total % 60)} 秒）`,
  ].join('\n');

  if (flags.json) {
    console.log(JSON.stringify({ entries, total }, null, 2));
    return;
  }
  if (flags.out) {
    await writeFile(String(flags.out), md + '\n');
    console.log(`✓ 记录表已写入 ${flags.out}`);
  }
  console.log(md);
}

// ────────────────────────────── 入口 ──────────────────────────────

/** 组装运行期状态：状态文件 + 命令行覆盖。 */
async function withSession(flags, { needSession = true } = {}) {
  const saved = await loadState();
  if (!saved.base) throw new Error(`还没有连接信息：先执行 auth "<带 token 的 URL>"`);
  const state = {
    ...saved,
    base: flags.base ?? saved.base,
    tz: flags.tz ?? saved.tz ?? 'Asia/Shanghai',
    dryRun: Boolean(flags['dry-run']),
  };
  if (flags.session) state.sessionId = String(flags.session);
  if (needSession && !state.sessionId) {
    throw new Error('还没有指定考生会话：先 use --newest / use <ID>');
  }
  return state;
}

async function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const cmd = pos.shift();
  if (!cmd || cmd === 'help' || flags.help) {
    console.log(HELP);
    return;
  }
  switch (cmd) {
    case 'auth': return cmdAuth(pos, flags);
    case 'sessions': return cmdSessions(flags);
    case 'new': return cmdNew(flags);
    case 'use': return cmdUse(pos, flags);
    case 'state': return cmdState(flags);
    case 'send': return cmdSend(pos, flags);
    case 'ask': return cmdAsk(pos, flags);
    case 'wait': return cmdWait(flags);
    case 'tail': return cmdTail(flags);
    case 'run': return cmdRun(pos, flags);
    case 'record': return cmdRecord(flags);
    case 'sample': return cmdSample(pos, flags);
    case 'questions': return cmdQuestions(flags);
    default:
      console.error(`未知命令：${cmd}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
});
