> 历史实验记录，当前 API 与结论见 [World 自动发现](unified-world-discovery.md)。

# World 独立根与描述生成成本

## 边界

World 手工登记独立根，例如 Entity、Dataset、具名 Type、Relation。Dataset.fields、bindings 等内嵌成员从所属定义展开，不单独登记；遇到其他独立定义时保留引用，不自动补充根清单。

NS 当前已经使用这样的显式 World。实验只改变构建期知识输出，保留同一模型声明和 transform 准备过程；不执行自检，不部署制品。根清单及部分描述是成本对照，不能作为完整知识发布使用。

## 实测

运行 `python3 scripts/measure-world-roots.py`。进一步拆分使用：

```sh
python3 scripts/measure-world-roots.py --cases type_projection,type_headers,type_headers_json
```

2026-10-27，本地 release 编译器，沿用仓库配额，顺序构建。以下每组单次观测；准备阶段包括模型声明初始化与 transform 准备，不能把整列当成知识开销。总构建还包括约 15 秒 frontend、约 3.7 秒代码生成等阶段。

| 输出 | 准备耗时（秒） | 总构建（秒） | 构建期 fuel（十亿） |
| --- | --- | --- | --- |
| 仅 transform，知识输出常量 | 10.205 | 30.064 | 21.117 |
| 独立根清单 | 10.298 | 30.311 | 21.216 |
| 类型内部结构清单及标识 | 15.140 | 35.219 | 33.366 |
| 完整类型描述 | 31.435 | 51.339 | 72.773 |
| Dataset 描述，含内嵌成员 | 20.566 | 40.415 | 47.709 |
| 完整知识发布 | 51.240 | 71.747 | 122.626 |
| 类型头信息及反向引用 property，Value 输出 | 10.263 | 30.009 | 21.300 |
| 同一类型头信息，再 stringify 成文本 | 10.483 | 30.678 | 21.308 |

独立根有 129 个 Entity、151 个 Dataset、596 个显式 Type，紧凑 JSON 为 48,022 字节。类型头信息包含 id、name、kind、reverse_references，596 项共 80,023 字节。

80 KB 元数据构造相对基线只增加约 0.18 十亿 fuel；额外 stringify 只增加约 0.008 十亿 fuel。墙钟差值分别约 0.06 秒和 0.22 秒，单次样本有噪声，不能用后者推导稳定的编码吞吐量。生成这一级别的元数据并不需要几十秒。

## 重复投影

当前完整类型输出有 6,704 条描述，按标识只有 882 种，重复 5,822 条；重复项内容逐项一致。5,512 条描述属于内联类型。最高频的 `Option(String)` 描述重复 1,962 次。

完整类型描述紧凑 JSON 为 3,425,535 字节，Dataset 描述为 2,040,325 字节，完整发布为 7,372,623 字节。完整发布还含 capabilities、relations 和静态 JS，体积不能与前两者简单相加。

`world::knowledge_types` 对各根局部展开匿名结构，无全局 visited；共享结构重复进入数组，随后 `raw_type` 对重复条目再次反射、构造 Value。类型标识已有缓存，但完整描述尚未缓存。只生成内部结构标识的对照已经增加约 4.9 秒；进一步生成完整描述又增加约 16.3 秒。这些是组合路径的观测差值，不是函数级 CPU profile。

结论是独立根登记便宜；目前应关注共享内嵌结构的重复投影和描述构造，而不能将几十秒归因于约 100 KB JSON 编码。可进一步比较按 Type 缓存完整描述、内嵌结构直接表达，以及在输出前合并相同描述的收益；这些方案不要求手工登记内嵌 children。

## 验证与原始记录

五种主要对照制品的正常 transform 与非法值域输入响应一致；没有运行完整知识图测试或模型自检。实验脚本也检查根标识是否重复。

本机原始记录目录：

- `~/.cache/tmp/world-roots-334mbgmd`：transform 基线
- `~/.cache/tmp/world-roots-jguyc827`：主要对照、`combined-report.json`、`transform-verification.json`
- `~/.cache/tmp/world-roots-qqu7ztpf`：结构投影、80 KB 元数据与 stringify 对照
