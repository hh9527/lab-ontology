# student transcripts tracking 领域模型 — DOMAIN.md

本文是 `spider-model` Resolver 可读的知识包之一（与 `INTENT.md` 配套）。它只描述业务
对象、领域词汇、概念关系、值域与统计口径。**不含**题目、标准答案、SQL、物理 schema 或
Join 路径；物理映射属于 `spider-model/src/model.telora` 的私有实现。`INTENT.md` 定义
输入 JSON 契约，本文词汇 id 是契约中引用 measure/dimension/entity 的稳定标识。

## 业务对象

- **Address（地址）**：邮寄地址，具有城市、国家、州/省/县、邮政编码与行文本
  （line1/line2）。
- **CurrentAddress / PermanentAddress（当前住址 / 永久住址 角色）**：Address 在
  Student 上的两个业务角色，分别表示“学生当前居住地”与“学生永久居住地”；每个角色有
  自己的城市/国家/州等属性。角色区分是显式的：当前住址与永久住址分别查询、互不混合。
- **Course（课程）**：一门课程，具有名称与描述。
- **Department（系/部门）**：开设学位项目的学术单位，具有名称与描述。
- **DegreeProgram（学位项目）**：由某系提供，具有“学位摘要名”（如 Bachelor/Master）、
  描述与业务标识。
- **Section（教学班）**：一门课程下的教学班，具有名称与描述。
- **Semester（学期）**：学期，具有名称与描述。
- **Student（学生）**：学生，具有名/中间名/姓、手机号、邮箱、首次注册日期、离校日期
  与其它详情；并记录其当前住址与永久住址两个角色引用（以地址计）。
- **StudentEnrolment（注册记录）**：一个学生在某学期注册某学位项目（一条注册）。
- **StudentEnrolmentCourse（选课记录）**：一次注册中选修一门课程。
- **Transcript（成绩单）**：成绩单，具有打印日期、业务标识与其它详情。
- **TranscriptContent（成绩单项）**：成绩单上列出的一个选课结果（把选课记录关联到某
  成绩单）。

## 概念关系

- 一个系提供多个学位项目；一个学位项目属于一个系。
- 一门课程可有多个教学班与多个选课记录。
- 一个学生可有多次注册（不同学期/项目）；一条注册对应一个学生、一个学位项目和一个
  学期。
- 一个学生有一个当前住址角色与一个永久住址角色；这两个角色指向同一类地址实体，但被
  显式区分，路径选择不会在多个外键间猜测。
- 一次注册可选修多门课程；一条选课记录可出现在多张成绩单上；一张成绩单含多个成绩
  单项。

## 领域词汇（measure/dimension/entity id）

### Measure（指标）

| id | 语义 | 类型 |
| --- | --- | --- |
| `address_count` | 地址数量 | count |
| `course_count` | 课程数量 | count |
| `department_count` | 系数量 | count |
| `degree_count` | 学位项目数量 | count |
| `degree_summary_count` | 学位项目行中“学位摘要名”非空值计数 | count |
| `section_count` | 教学班数量 | count |
| `semester_count` | 学期数量 | count |
| `student_count` | 学生数量 | count |
| `student_current_address_count` | 学生当前住址（去重后按地址计） | count |
| `enrolment_count` | 注册记录数量 | count |
| `course_enrolment_count` | 选课记录数量 | count |
| `transcript_count` | 成绩单数量 | count |
| `transcript_content_count` | 成绩单项数量 | count |

指标是对业务对象行（或对象上非空属性）的 `count` 计数；本公共协议不提供对某维度取值
去重的计数 measure。

### Dimension（维度 / 属性）

| id | 语义 | 类型 |
| --- | --- | --- |
| `address_id` | 地址业务标识 | int |
| `address_line1` / `address_line2` | 地址行文本 | text |
| `address_city` | 城市 | text |
| `address_country` | 国家 | text |
| `address_state` | 州/省/县 | text |
| `address_zip` | 邮政编码 | text |
| `current_address_id` / `permanent_address_id` | 当前/永久地址角色标识 | int |
| `current_line1` / `current_line2` | 当前住址行文本 | text |
| `permanent_line1` / `permanent_line2` | 永久住址行文本 | text |
| `current_city` / `current_state` / `current_country` | 当前住址的城市/州/国家 | text |
| `permanent_city` / `permanent_state` / `permanent_country` | 永久住址的城市/州/国家 | text |
| `course_id` | 课程业务标识 | int |
| `course_name` | 课程名 | text |
| `course_description` | 课程描述 | text |
| `department_id` | 系业务标识 | int |
| `department_name` | 系名 | text |
| `department_description` | 系描述 | text |
| `degree_program_id` | 学位项目业务标识 | int |
| `degree_summary_name` | 学位摘要名 | text |
| `degree_description` | 学位项目描述 | text |
| `section_id` | 教学班业务标识 | int |
| `section_name` | 教学班名 | text |
| `section_description` | 教学班描述 | text |
| `semester_id` | 学期业务标识 | int |
| `semester_name` | 学期名 | text |
| `semester_description` | 学期描述 | text |
| `student_id` | 学生业务标识 | int |
| `student_enrolment_id` | 注册业务标识 | int |
| `student_course_id` | 选课业务标识 | int |
| `student_first_name` | 学生名 | text |
| `student_middle_name` | 中间名 | text |
| `student_last_name` | 学生姓 | text |
| `student_cell` | 手机号 | text |
| `student_email` | 邮箱 | text |
| `student_date_registered` | 首次注册日期 | text(日期) |
| `student_date_left` | 离校日期 | text(日期) |
| `student_details` | 学生其它详情 | text |
| `student_current_address` / `student_permanent_address` | 学生当前/永久地址引用（整数标识） | int |
| `transcript_id` | 成绩单业务标识 | int |
| `transcript_date` | 成绩单打印日期 | text(日期) |
| `transcript_details` | 成绩单其它详情 | text |

文本维度支持相等/不等与包含类算子；整数维度支持相等/不等与大小比较；日期按可字典序
文本处理（用于排序/最值语义）。业务标识属性既可投影、过滤，也可用于隐藏排序。

### 同主体属性比较（field-to-field）

- 契约允许同一主体实体的**类型兼容、纯列属性对**之间做比较（`list` 形状的 FieldFilter，
  见 `INTENT.md`）。
- 本领域暴露的受支持属性对示例：`student_current_address` vs `student_permanent_address`
  （同为整数地址引用，`eq`/`ne`）。其它属性组合需类型兼容且被模型声明支持；不兼容组合
  稳定拒绝，不做字符串或 SQL 旁路。

### 值域说明

- 文本/日期/整数维度均为开放值域；动态值参数化绑定。
- 日期文本按内部统一格式可直接升/降序。
- 字符串过滤值逐字保真：领域层不改写大小写、拼写、单复数、缩写或别名，也不从 modeling
  数据猜测替代值；未知/疑似拼写按原值查询。仅当词表声明可证明的规范化规则时才适用。

## 统计口径

- 只含 measures → 全量单行聚合；含 measures+dimensions → 按全部 dimensions 分组聚合。
- 投影列序由契约形状固定：`list`/`distinct`/`top`/`exists`/`absence` 按 `dimensions`
  请求序；`aggregate` 为 measures（请求序）在前、dimensions（请求序）在后；`count` 为单
  列。`list` 可用 `output_order` 重排已选维度（见 `INTENT.md`）；其它形状不得携带
  `output_order`。
- “详情”有明确映射：`course_description`/`section_description`/`department_description`/
  `degree_description`/`semester_description`/`student_details`/`transcript_details`，
  不用姓名集合近似。
- 只含 dimensions → 行级列表；`distinct: true` → `SELECT DISTINCT`，否则保留重复行。
- 多 measures 必须同属一个业务对象粒度。
- 筛选/正反相关存在先于排序分页；动态值只进 bindings。
- `limit`/`offset` 语义同 SQL（offset 需排序）。

## 边界

- 支持：列表/去重列表、过滤、计数、分组、按已选/未选维度排序、跨关系隐藏聚合（related
  aggregate：沿一条已声明直接关系或显式 `exists_route` 的隐藏 Top-N 与隐藏 HAVING，聚合
  不进投影、HAVING threshold 参数化）、正反相关存在（含两跳 link 存在）、同主体属性
  比较、Top-N 与分页。
- 不支持（确定性 `unsupported:` 诊断，不做近似替代）：请求已含返回聚合时再按不返回
  聚合排序/HAVING（同源 `hidden_having` 与可见 `having`/`exists` 混用）；多跳或无法唯一
  证明直接关系的关联聚合；无可达路径的存在；跨主体属性比较；对维度取值去重后的计数值
  （distinct count）；一般集合运算（EXCEPT/INTERSECT）；派生标量子查询；`output_order`
  用于 `list` 以外形状。
- 一致性：同义表达与重复执行必须结果一致（受支持时逐字节相同，否则同一类
  `unsupported`）。
