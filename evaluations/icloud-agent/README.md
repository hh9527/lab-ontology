# IC 本体 Agent 评测

每次使用一个编号问题。可信宿主构建快照，MCP 适配器启动一个常驻 `telora-run --serve stdio+jsonl://` 子进程。
只向候选 Agent 提供面向 Agent 的指南、一个 QUESTION.md，以及通过受限宿主端点访问 info 和 transform 两个 MCP 工具的能力。
Agent 的文件系统和 shell 不得读取快照、runner、源代码、测试、RUBRIC.md 或先前对话记录。
适配器单次 ontology_transform 接受一至五个独立 Intent。Agent 调用前须从应用或环境上下文解析相对时间，服务不注入请求时钟。
适配器一次将整批转发给底层 transform；全部成功时，在 ONTOLOGY_EVAL_OUTPUT_DIR 指定的现有宿主专用目录写入权限 0600 的 JSON，包含有序 Intent 和生成 Query。
工具仅返回接受回执，Agent 无法通过这两个工具获取 SQL 或绑定。
任一计划失败时返回全部计划的带索引诊断，不写部分记录；不跨计划合并或去重。
OpenCode 重跑使用精确模型 ID `deepseek/deepseek-flash`。
指南和问题由宿主选为附件，完全禁用 Agent 通用读文件工具。
候选指南使用 AGENT_USAGE.md，承接根 USAGE.md 的通用 Intent 语法，但将直接服务 Query 响应替换为仅回执流程。
不要向 Agent 提供构建／启动说明或产物路径。

启动适配器前，将 ONTOLOGY_EVAL_RUNNER、ONTOLOGY_EVAL_ARTIFACT、ONTOLOGY_EVAL_OUTPUT_DIR 设置为宿主绝对路径。
输出目录位于 Agent 沙箱之外，只允许可信宿主和评测者访问。适配器持有子进程，仅转发 ic/info 和 ic/transform JSONL 请求。
不要将 runner 或产物挂载进 Agent 沙箱。不需独立 Telora TCP／Unix 监听器，防止 Agent 直接调用绕过受限工具。
仅向不受限工作目录复制较少文件不满足隔离要求，宣称硬隔离前须确认 Agent 无文件系统路径访问产物。
适配器支持 stdio MCP，但本评测明确允许 OpenCode 1.18.32 使用回环 HTTP MCP 端点。
宿主仍通过 stdio 运行 telora-run，不开放第二个 Telora 监听器。
本地 MCP 桥可通过两个宿主持有、权限 0600 的 FIFO 转发 stdio，无需挂载 runner 或产物。
在文件系统／PID 隔离沙箱内，桥上的直接 MCP 初始化、工具列表及知识查询已成功；但 OpenCode 的 local MCP 进程在发请求前关闭 stdin，报告 Connection closed，因此纯 stdio OpenCode 访问不是本轮门槛。
桥只是实验传输组件，尚未完整替代回环端点。
当前 opencode.json 的 remote MCP 配置已从文件系统／PID 隔离 OpenCode 进程连通，这仅验证传输，不验证任何业务问答。
源代码、runner、产物、评分准则和宿主进程表均留在沙箱外；禁用 shell／文件工具是附加防护，不替代此隔离边界。

问题测试模型支持的转换、不支持含义的拒绝，以及歧义下的业务解释。
成功回执不是通用通过条件，必须将存储的 Intent、Query 与 Agent 业务说明和真实用户请求对照。
RUBRIC.md 只供评测者使用。问题文件只含模拟业务请求，流程指令放在通用指南中。
评分前先理解业务目的：总体已明确时，不能因语料 SQL 形状或措辞不自然就强迫澄清。
SQL 和绑定是宿主专用中间产物，生产答案应执行 Query 并展示数据。
澄清应解释业务选择，不能要求用户选择 Intent 字段、SQL 形状或连接路径。

RESULTS.md 的初始运行采用旧产物／runner 候选布局，仅作基线，不是硬隔离结果；它们早于图边规范化及新模型声明。
新比较须记录快照、指南和服务版本。

问题来自 IC 语料族 Q0014、Q0050、Q0075、Q0184、Q0328、Q0354、Q0428、Q0442、Q0444。
语料 SQL 是观察材料，不是业务定义。每次运行记录快照哈希及 runner 版本。
