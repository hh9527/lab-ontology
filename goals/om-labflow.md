# OM-Labflow 目标

建立一个面向 Labflow 运行数据的 EnterpriseKnowledge，目录名为 `om-labflow`，整体组织
方式可参考 `ent-1`，但领域词汇、实体粒度、关系和公共查询面应当根据本目标独立探索，
不要机械复制物流模型。

这个资产未来会供 `lab-ob` 使用：观察者用自然语言提出统计或分析问题，Telora 工作流
将领域查询意图降低成参数化 SQLite Query，再由只读的 `labflow query` 执行。本任务只
负责 `om-labflow` 领域资产，不修改 Labflow 程序，也不负责接通最终执行链路。

约定的最终调用形式是：

```bash
labflow query-om file.json
labflow query-om -  # 从 stdin 读取 JSON
```

Labflow 将在内部调用：

```bash
"$TELORA_BIN" -C "$OM_LABFLOW_PATH" run query --source input=file.json
"$TELORA_BIN" -C "$OM_LABFLOW_PATH" run query --source input=stdin+json://
```

这是一个显式可选能力：`TELORA_BIN` 指向 Telora 可执行文件，`OM_LABFLOW_PATH` 指向
`om-labflow` crate。只有两个环境变量都存在时，`labflow query-om` 才可用；缺少任意
一个时应明确报告该功能不可用，不猜测默认路径，也不回退到 `PATH`、项目内 `bin/` 或
当前目录。Labflow 后续实现应把它们作为 subprocess argv 使用，不通过 shell 展开或
拼接命令。环境变量和输入文件都可以是相对于调用目录的路径；输入参数为 `-` 时使用
Telora 的 `stdin+json://` source，并让 Telora 子进程继承 Labflow 的 stdin。
Telora 子进程的 stderr 同样直接继承调用终端，使 diagnostics 透明输出；Labflow 只捕获
stdout 作为参数化 Query，并检查进程退出状态。

因此 `om-labflow` 必须提供 `src/bin/query.telora`：从名为 `input` 的 Value source 读取
领域查询请求，走公共 dynamic facade 完成校验与 lowering，并在 stdout 只输出
QueryBuilder 的参数化 Query：

```json
{"sql": "SELECT ... WHERE ... = ?", "bindings": ["value"]}
```

不要输出额外包装、解释文本或执行结果。`query-om` 会解析并验证这个对象，再把 SQL 与
bindings 交给 Labflow 的只读查询执行器；它不会通过 shell 拼接或解释输出。

## 需要支持的业务理解

Labflow 在一个项目中运行一个实验执行。Supervisor 持续调度 DAG 中由角色负责的任务，
Host 负责批准或刷新 Host 工件。观测者至少需要能够探索和表达以下问题：

- 某个角色或任务经历了多少轮，当前是否完成；
- 总计与最近一轮的耗时、input/output/reasoning token、最长思考时间；
- 哪些任务正在等待 Host，Host 处理或批准过多少次，最近一次发生在何时；
- session、turn、task、artifact、DAG revision 之间的活动关系；
- shell/tool action 的耗时、成功与失败、命令以及关联路径；
- 按时间、角色、任务、事件类型等维度进行筛选、分组、排序和 Top N。

不要把“表中存在的列”直接等同于“正确的业务指标”。例如一轮任务的持续时间是配对
`task_started` 与同一 `attempt_id` 的 `task_completed` 后得到的区间；最长思考来自该轮
区间内 `thinking.duration` 的最大值；一轮 token 来自区间内 reply 事件的
`input_tokens + output_tokens + reasoning_tokens`。Host 的等待状态来自 open/resolved
事件序列，Host 批准次数则应结合 Host 工件的刷新事件理解。请调查现有 `query` 和
`ontology` 能否自然表达这些语义；不能表达时，应形成清楚、可验证的能力边界，而不是
用不安全 SQL 字符串或虚假的业务定义绕过。

## events.sqlite 表结构

`events.sqlite` 是主库，Timeline schema version 为 2：

```sql
CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE timeline (
    id TEXT PRIMARY KEY,
    execution TEXT NOT NULL,
    session TEXT,
    turn TEXT,
    role TEXT,
    task_kind TEXT CHECK (task_kind IS NULL OR task_kind IN ('artifact', 'problem')),
    task_id TEXT,
    artifact TEXT,
    dag_revision TEXT,
    type TEXT NOT NULL,
    at INTEGER NOT NULL,
    duration INTEGER NOT NULL CHECK (duration >= 0),
    tokens INTEGER,
    action TEXT,
    success INTEGER,
    command TEXT,
    exit_code INTEGER,
    summary TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    payload_json TEXT,
    CHECK ((task_kind IS NULL) = (task_id IS NULL))
);

CREATE TABLE action_paths (
    event_id TEXT NOT NULL REFERENCES timeline(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    PRIMARY KEY (event_id, path)
);
```

`at` 与 `duration` 的单位均为毫秒。`action_paths` 当前记录 action 关联的文件路径；一个
事件可能有多个 path，因此 join 后必须留意统计粒度。

Timeline 的合法 `type` 为：

```text
thinking, action, reply,
session_started, session_ended, turn_started, turn_ended,
task_started, task_completed,
artifact_refreshed, artifact_deleted,
host_request_opened, host_request_resolved, dag_revised
```

关键事件语义如下：

- `task_started`：`payload_json` 含 `attempt_id`；带 role、session、task_id 和 dag_revision。
- `task_completed`：同一 `attempt_id` 与 start 配对；payload 另含任务 `status`。
- `thinking`：一次 assistant message 中未被 tool action 占用的时间段；`duration` 是该段
  时长。只有整条 message 恰好一个 thinking span 时，通用 `tokens` 才能精确归因为该
  span 的 reasoning token。
- `action`：一次已结束的 tool 调用；`action` 是工具类别，shell action 可带 `command`、
  `exit_code`、`success`，关联路径在 `action_paths`。
- `reply`：assistant 的文本回复；明确记录 input/output/reasoning/cache token 列。
- `turn_started/turn_ended`：assistant message 的边界；turn 值是 message id。
- `artifact_refreshed/artifact_deleted`：Host 工件 marker 被刷新或删除；带 artifact、
  task_id 和 dag_revision。
- `host_request_opened/host_request_resolved`：某个 Host 工件进入或离开等待集合；
  `payload_json.optional` 区分必要与可选请求。
- `session_started`：payload 含 OpenCode `backend_id`；session 列是 Labflow 会话标题。
- `dag_revised`：新的 DAG revision 已被 Supervisor 应用。

## states.sqlite 表结构

`labflow query` 将状态库以 schema 名 `states` 只读 ATTACH：

```sql
CREATE TABLE states.state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE states.task_records (
    kind TEXT NOT NULL CHECK (kind IN ('active', 'history')),
    identity TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (kind, identity)
);
```

`value` 与 `payload` 都是 JSON 文本。`state` 保存控制面状态，例如 root session、active
control 和 session registry；`task_records` 保存按角色索引的 active task，以及按
attempt id 索引的 history task。它们适合查询“当前状态”，而 `timeline` 是分析历史与
统计的主要事实来源。需要明确判断现有 QueryBuilder 对 attached schema 和 JSON 的能力；
不要假定它已经支持未在公共文档中声明的 SQL 或 JSON 操作。

## 安全与公共边界

- 所有动态值只能进入 Query bindings，不拼接到 SQL。
- 公共请求使用业务词汇，不让调用者提交表名、列名、alias、join、SQL 片段或任意表达式。
- grain 不兼容、关系会放大统计、未知词汇、非法筛选或当前能力无法表达时，原子失败，不
  返回看似可信的部分 Query。
- 保持只读分析边界；不要在本资产中直接读取、修改或管理 Labflow 数据库。
- 私有物理 mapping 与公共查询面分离，且来自同一个 prepared knowledge root。

## 探索与交付

先阅读 `query/docs/`、`ontology/docs/` 和 `ent-1/`，通过 Telora `query`/`check` 探索
实际类型与能力。自行决定合理的 v1 业务 vocabulary 和实现范围，并在文档中解释选择、
不能表达的场景及未来所需的底层能力。

交付结构应与 `ent-1` 同等级，至少包括：

- `om-labflow/telora-deps.json`；
- `om-labflow/src/model.telora`：私有模型；
- `om-labflow/src/query.telora`：公共 typed/dynamic query facade（可以复用其他内部模块）；
- `src/bin/query.telora`：实现上述 `input` Value source 到参数化 Query 的稳定入口；
- 合法查询演示、严格验证以及关键非法场景；
- 模型和公共查询面的契约测试；
- `om-labflow/docs/DOMAIN.md`：领域说明与能力边界；
- `om-labflow/docs/QUERY-DESIGN-GUIDE.md`：公共查询设计指南。

所有成功路径必须产生确定性的参数化 SQLite Query；测试应覆盖 grain 安全、绑定顺序、
筛选/排序/Top N、动态 JSON 边界和能力不足时的失败语义。完成时列出并运行实际可用的
`bin/telora -C om-labflow ...` 验证命令。
