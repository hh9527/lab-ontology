# RFC 0004：模型构建期双路产出

- 状态：工作分支实施，不合入
- 跟踪：总议题 #64

## 模型

采用 Telora 通用构建期能力，源码经 A 一次计算得到 P1／P2。ontology 的 Prepared 提供两路共同来源：P1 是 transform 所需 payload，P2 是 ontology.knowledge 信息。A 的输出不依赖 Service 请求、运行期源或环境状态。

模型以 std::build::stage 显式表达 prepare 与运行程序装配。Service init 只使用已经生成的运行程序；知识导出从 A 发布，不作为 Service init 副作用。构建采用 --staged，旧 snapshot 的配置重导入约定不作为本能力的语义。

## 协议与验收

知识领域契约 ontology-knowledge-v4 和稳定地址保持一致，外层运输改用 telora.build.information。插件补导航与外部说明；P2 不成为 B 的根。先 relation 小模型验证，再 IC，继续报告额外构建成本及 B 的体积／冷启动，避免将链路完成等同于性能目标完成。

沿用已有工作分支与总跟踪 issue，不创建阶段 issue；各阶段验收后自主提交，保持未合入及运行环境不变。
