# Evaluation question 03

请只使用本目录的 `USAGE.md` 和 `icloud_model.wasm` 暴露的知识发现与
transform 服务，回答：

> 查询过去 30 个 24 小时内，每台离线 GPON 的光端口接收带宽利用率最大值。

本次请求的当前时刻为 2025-03-31T12:00:00Z，窗口为左闭右开。请通过知识
发现确定业务状态、时间类型和聚合定义，给出经 transform 接受的 Intent、SQL
与 bindings；若缺少必需的知识或能力，就说明缺口，不要改变题意。
不要手写 SQL、编造结果或读取本目录外的源码、测试、语料和网络资料。
