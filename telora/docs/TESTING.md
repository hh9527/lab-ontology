# Telora 开发期测试最佳实践

本文说明开发 Telora 库和应用时，如何在不改变领域错误模型的前提下尽量收集诊断，
以及如何把探索性失败用例转化为可重复的回归门禁。

## 先区分三件事

- `telora check MODULE` 检查整个模块。它使用 best-effort 求值策略：一个定义失败后仍尽量
  分析其他独立定义并输出 JSONL 诊断，最后以非零状态表示模块含错误。
- `telora query ...` 查询模块、导出和语义事实。它不会调用导出的函数，也没有
  `--best-effort` 选项，因此不能代替行为测试。
- `telora eval`、`eval-with` 和 `run` 才执行指定的公开入口。其中 `run` 和 `serve`
  支持 `--best-effort`，用于应用初始化或请求失败时扩大诊断覆盖。

不要为了在测试中捕获 `fail!`，给领域 API 增加 `try/catch`、`Result` 或诊断数组。
只有调用者本身确实需要恢复或组合失败时，失败才应成为公开领域值。

## 一次观察多个失败点

排查编译、类型、准备或普通值求值问题时，把互不依赖的场景写成独立定义：

```telora
export def valid_control = prepare(valid_input);
export def rejects_fanout = prepare(fanout_input);
export def rejects_ambiguous = prepare(ambiguous_input);
export def rejects_missing = prepare(missing_input);
```

然后运行：

```bash
telora check @test/route-diagnostics
```

`check` 会尽量保留健康定义的事实，并为多个失败定义分别报告诊断。该模块预期非零，
适合开发期探索；不要把它伪装成绿色测试。需要观察哪些事实仍然可用时，再查询：

```bash
telora query exports @test/route-diagnostics
telora query at @test/route-diagnostics -k def,type
```

注意：若导出的是 `Fn(...) -> ...`，`check` 只检查函数定义，不会调用函数。要让 `check`
观察某个确定输入的失败，应导出该调用所得的普通值，或把具体调用写成独立普通定义。

## 验证真实执行边界

模块检查通过不等于入口行为已经验证。按入口类型选择命令：

```bash
# 公开 Value
telora eval @test/model:valid_case

# entry.Eval，由 Context 显式提供 source、env 和 args
telora eval-with @test/model:evaluate --source request=request.json -- case-id

# entry.Run 应用
telora run @src/app:run --source request=request.json

# 初始化失败时尽量收集更多诊断
telora run --best-effort @src/app:run --source request=request.json
```

对需要逐请求观察的应用，可使用 `serve --best-effort --bind stdio://`，让每个 JSONL 响应
分别携带 `ok`、`error` 和 `diagnostics`，避免一个请求失败掩盖后续请求。

## 把预期失败变成回归门禁

预期失败的行为测试应由 Host 判断，而不是让 Telora 内部吞掉失败。一个稳定的 Host
门禁至少检查：

1. 进程退出状态符合预期；
2. stdout 没有发布部分结果；
3. stderr/JSONL 中存在预期诊断类别和可归因信息；
4. 多个用例相互隔离，一个失败不覆盖另一个用例的诊断；
5. 同一输入重复执行时，诊断顺序和关键字段稳定。

建议把确定性输入、成功输出和诊断输出分开保存。例如 adapter 可写 `ok.json` 与
`diagnostic.jsonl`，Host 再显示并核对 exit code。不要用最终自然语言回答反推执行结果。

如果只需验证快速的可行性判断，可同时提供无副作用的 `*_ok(...) -> Bool` probe：绿色
单元测试断言非法输入返回 `False`；Host 的预期失败用例则验证真实 lowering 的 `fail!`
诊断。两层测试互补，probe 不能取代真实失败路径。

## 推荐工作流

1. 先用多个独立定义和 `check` 收集尽可能完整的静态/求值诊断。
2. 用 `query` 定位仍然健康或不可计算的语义事实，而不是把 `query` 当执行器。
3. 用 `eval`、`eval-with` 或 `run` 验证具体公开入口。
4. 对预期失败建立 Host 门禁，核对 exit code、无部分输出和稳定诊断。
5. 保留至少一个相邻成功对照，防止“所有输入都拒绝”被误判为安全实现。
