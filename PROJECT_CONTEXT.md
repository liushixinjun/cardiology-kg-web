# PROJECT_CONTEXT.md — 心血管专科知识图谱 Web 平台

> **最后更新**: 2026-09-28 | **当前版本**: v1.3.1 (VERSION) / Schema 标准 V4.1 / API v1.3
> **用途**: 新 AI 模型接手时，先读此文件了解项目全貌，避免用户重复说明。
> **口径声明**: 本文件的数字以线上实测为准（`/api/kg/stats`、`/api/kg/version`）。
> 任何历史段落中的旧数字均为当时快照，**不得据此回改线上**。

---

## 一、项目概述

这是一个**心血管内科专科知识图谱 Web 可视化与交互平台**，基于 Neo4j 图数据库，支持 132 种心血管疾病的交互式浏览、循证分析与临床审核。

- **核心数据规模（线上实测）**: 15 个疾病大类、132 种疾病、16,626 可视化实体、35,606 图谱节点、18,980 条证据、140,349 条关系；标准诊断 89 条；临床规则审核 574 条（可临床用 363 / 阻塞 209 / 待处理 2）
- **Schema 标准**: V4.1（实体类型 / 关系类型以 `/api/kg/schema-registry` 与 `schema_docs/图谱结构注册表.json` 为准）
- **知识图谱结构**: Disease → 20 个核心临床维度（17 基础 + 3 护理）+ 二跳维度 + Evidence/Guideline
- **统计口径双轨（4001 整改新增）**: 「图谱实例数」= Neo4j 中该 entityType 节点数；「CDSS 字典映射数」= 其中已具备 `cdss_dict_id` 的节点数。两者不可混用，页面上分区展示。

---

## 二、技术架构

| 层次 | 技术 | 说明 |
|------|------|------|
| 前端 | **原生 HTML + CSS + JS** | 无框架、无构建工具，单文件 SPA |
| 图表 | **ECharts 5.x** | 力导向图/雷达图/热力图 (`_shared/js/echarts.min.js`) |
| 样式 | **暗色主题 CSS 变量** | 主背景 `#0f1117`，主色调 `#4f8cff`，详见 `style.css` |
| 后端 | **Python `http.server`** | 标准库，自定义 `KGHandler`，端口 4001 |
| 图数据库 | **Neo4j** | Bolt 协议，Cypher 查询 |
| 缓存 | **Redis** | TTL 300秒，FLUSHALL 清除 |
| 部署 | **paramiko SSH** | 自动化文件上传 + 服务重启 |

---

## 三、服务器信息

| 项目 | 值 |
|------|------|
| 服务器地址 | `192.168.3.27` |
| Web 访问地址 | `http://192.168.3.27:4001` |
| SSH 用户/密码 | `root` / `zysoft@27` |
| 远程部署目录 | `/zoesoft/zoekgweb` |
| Neo4j Bolt | `bolt://192.168.3.27:7687` (neo4j/zysoft@2024) |
| Redis | `192.168.3.27:6379` |

---

## 四、文件结构与职责

```
kg-test-page/
├── server.py                 # 后端主程序（API + 静态文件服务）
├── deploy.py                 # 一键部署脚本（SSH上传 + 清缓存 + 重启）
├── refresh_cache.py          # 仅刷新缓存+重启（不上传文件）
├── VERSION                   # 版本号单一真相源
├── .server-config.json       # 服务器/数据库连接配置
│
├── index.html                # 数据总览（首页驾驶舱）
├── explore.html              # 图谱探索（疾病层级树 + 20 核心维度 + 诊疗链路）
├── network.html              # 网络探索（ECharts力导向图）
├── heatmap.html              # 专病诊疗框架覆盖分析（热力图）
├── review.html               # 临床审核
├── schema.html               # 图谱数据字典 / 实例检索
├── standard.html             # 图谱架构规范
├── guideline.html            # 指南库
├── terminology.html          # 医学术语库
├── config.html               # 系统设置（数据同步/数据库/菜单配置）
├── disease-review.html       # 疾病审核（辅助页）
├── specialty-cdss-prototype.html  # CDSS 辅助诊疗原型（独立系统，导航以外部链接打开）
├── VERSION                   # 版本号单一真相源
├── README.md                 # 部署与运维说明（含部署保护闸）
├── full_refresh.sh           # 全量刷新（清缓存 + 重启）
├── redis_refresh.sh          # 仅清 Redis 缓存
│
├── kg-audit-report/          # 图谱审计报告（独立静态页 + 图表库）
├── schema_docs/              # Schema 结构注册表快照（图谱结构注册表.json）
│
├── _shared/
│   ├── css/style.css         # 全局暗色主题样式
│   └── js/
│       ├── app.js            # 共享逻辑（版本/导航/数据加载/维度注册）
│       ├── schema-map.js     # Schema 映射层（角色/关系中文名/状态推导）
│       └── echarts.min.js    # ECharts 图表库
│
└── assets/                   # 静态资源、文档、JSON 数据

> **已作废并已从仓库移除**（勿再引用、勿再部署）：
> `diagnosis.html`（临床诊断模拟）、`engine.html`（诊疗路径编辑器）、
> `engine_test.html`、`disease.html`（孤岛页，已被 explore.html 取代）、
> `graph.html`、`instances.html`（已被 schema.html 取代）、`kg-story.html`、
> `clinical-workflow.html`、`server_fixed.py`、`_shared/js/review.js`、
> `_shared/js/version.js`、`assets/ami_graph_data.json`。
> 完整清单与移除原因见 README.md「已作废并已移除的文件」表，
> 机器可校验黑名单见 `deploy.py → RETIRED_FILES`。
```

---

## 五、核心后端 API

| 接口 | 说明 |
|------|------|
| `GET /api/kg/version` | 版本号（app / api / schema 标准 / skill 四层） |
| `GET /api/kg/full-version` | 四层版本 + 节点数的完整快照 |
| `GET /api/kg/stats` | 全局统计（Redis缓存）：含双口径实例/字典映射数、审核统计 |
| `GET /api/kg/dimensions` | **维度注册表（维度口径单一事实源）**：core_dimensions / all_dimensions / alias |
| `GET /api/kg/schema-registry` | Schema 结构注册表（V4.1 实体与关系类型） |
| `GET /api/kg/diseases` | 疾病列表 |
| `GET /api/kg/diseases/all` | 全量疾病数据 |
| `GET /api/kg/disease/<code>` | 单个疾病完整数据（20 核心维度） |
| `GET /api/kg/disease-tree` | 疾病层级树（疾病大类→宽口径/独立→子分型） |
| `GET /api/kg/entity/<code>` | 单个实体详情 |
| `GET /api/kg/schema-info` | 实体/关系类型清单与统计 |
| `GET /api/kg/guidelines` | 指南列表（当前 154 条） |
| `POST /api/kg/flush-cache` | 清除 Redis 缓存 |

---

## 六、前端核心概念

### 导航栏 (app.js → renderNav)
**10 个条目 = 9 个站内功能模块 + 1 个外部链接**（`specialty-cdss-prototype` 专科辅助诊疗，`target="_blank"` 新标签页打开），通过 `config.html` 控制显隐，存储在 `localStorage`。
站内 9 项：数据总览 / 图谱探索 / 网络探索 / 数据覆盖分析 / 临床审核 / 图谱数据字典 / Schema标准 / 指南库 / 医学术语库。
已作废页面（`diagnosis.html`、`engine.html` 等 12 个文件）**已从导航、菜单与仓库中彻底移除**，`deploy.py` 黑名单会拦截再次部署。

### 疾病层级树 (server.py → query_disease_tree)
**V2.0 三层诊断结构**：
```
Specialty → has_disease_category → DiseaseCategory(CAT- 前缀)
  → has_disease → Disease(broad_diagnosis / independent_disease)
    → has_clinical_subtype → Disease(clinical_subtype)
```
- `diagnostic_role` 决定疾病在诊断链中的位置：broad_diagnosis（疑似诊断）、clinical_subtype（具体分型）、independent_disease（独立诊断）
- 诊断名称和编码从 `has_standard_diagnosis → StandardDiagnosis(valid_flag=1)` 读取 ICD-10
- `DiseaseSubcategory` 不参与诊断链，仅保留给后台目录管理
- 核心展示结构固定为：**疾病大类 → 待分型疾病 → 具体疾病分型**

### 左侧树视图模式 (explore.html)
搜索框上方有「疾病 / 疾病大类」单选切换，状态保存在 `localStorage.kg_view_mode`：
- **疾病模式**（默认）：只展示 broad_diagnosis / independent_disease，按覆盖率从高到低排序，有子分型的疾病可折叠展开
- **疾病大类模式**：保持三层层级树（大类 → 疾病 → 子分型），全部默认展开

### 20 个核心临床维度 (app.js → CORE_DIM_KEYS)
```
Symptom, Sign, ExamItem, LabItem, Drug, Procedure, RiskFactor,
Complication, DifferentialDiagnosis, RiskStratification, Prognosis, FollowUp,
TreatmentPlan, DiagnosisCriteria, Etiology, Epidemiology, Pathophysiology,
NursingCarePlan, NursingAssessment, NursingDiagnosis
```
- 构成 = **17 个基础维度 + 3 个护理维度**（Schema V4.0 护理批次）；旧文档中的「17 维度」「23 维度」「25 维度」均为历史口径，已过时。
- **维度口径的单一事实源是 `/api/kg/dimensions`**，`app.js → applyDimRegistry()` 在页面启动时拉取并刷新 `CORE_DIM_KEYS`，Schema 升级只改 `server.py`，前端自动跟随。
- V4.1 实体键名（ExamItem/LabItem/Drug）与旧静态快照键名（Exam/LabTest/Medication）通过 `CORE_DIM_ALIAS` 别名兜底，避免旧数据显示 undefined。

### 疾病编码规则 (app.js → parseParentCode)
格式 `DIS-{大类缩写}-{亚类缩写}-{序号}`，如 `DIS-CARD-CAD-AMI`
- 大类映射：CARD=冠心病, HF=心力衰竭, ARR=心律失常, VASC=血管病, VALV=瓣膜病, CONG=先心病 等

---

## 七、部署流程

### 标准部署（python deploy.py）
1. **闸1** 检查待部署清单中不含作废文件（`RETIRED_FILES` 黑名单）
2. **闸2** 检查本地文件存在且非空
3. **闸4** 检查所有 HTML 的版本戳一致（`?v=YYYYMMDD13`）
4. **闸3** 记录线上基线，SFTP 上传 **37 个文件** 到 `/zoesoft/zoekgweb/`，逐文件回读大小比对
5. Redis `FLUSHALL` 清除缓存
6. `pkill` 旧进程 + `setsid` 后台启动新 `server.py`
7. **线上回归**：进程存活 + `/api/kg/version` 可访问 + 作废页必须 404
> 任一道闸不过即 `[FAIL]` 中止，绝不允许"旧盖新"。
> 详细说明见 README.md「部署保护闸」章节。

### ⚠️ 血的教训（2026-09-28）
本地仓库曾长期落后于线上 4001 整改版本，直接执行 `deploy.py` 导致：
- 线上新版导航被旧版覆盖（10 项 → 旧 11 项）
- 已作废页面（`diagnosis.html`、`engine.html`）被重新部署上线
- `specialty-cdss-prototype.html`（专科辅助诊疗）菜单项丢失

**因此：部署前必须先 `git pull` / 确认本地与线上一致；修改线上后必须立即提交 Git。**
本项目所有变更都以 Git 为准，换机器后先 `git pull` 再动手。

### 轻量更新（仅静态页面变更）
SFTP 覆盖单个文件即可，不清 Redis、不重启服务。

### 需要重启的操作
- 修改 `server.py`（后端逻辑变更）
- 修改 `_shared/js/app.js` 或 `_shared/css/style.css`（需清除浏览器缓存）
- 新增/删除 API 接口

---

## 八、已完成功能（截至 2026-09-28）

### 2026-09-28 改造内容：4001 整改落地 + 仓库基线重建（本次提交）
1. **本地仓库对齐线上**：14 个文件以线上为准回灌（导航 app.js / index / explore / network / heatmap / review / schema / standard / guideline / terminology / config / dashboard.js / server.py / VERSION），修正本地落后导致的"旧盖新"隐患
2. **作废文件彻底移除（12 个）**：`diagnosis.html`、`engine.html`、`engine_test.html`、`disease.html`、`graph.html`、`instances.html`、`kg-story.html`、`clinical-workflow.html`、`server_fixed.py`、`_shared/js/review.js`、`_shared/js/version.js`、`assets/ami_graph_data.json`
3. **`deploy.py` 新增 4 道保护闸**：黑名单拦截 / 本地完整性 / HTML 版本戳一致性 / 线上回归（作废页必须 404）；已用对抗性用例实测 4/4 通过
4. **`.server-config.json` 部署清单重写**：37 个文件（剔除 6 个作废项，补齐 disease-review.html、VERSION、README.md、.gitignore、assets、kg-audit-report、schema_docs、刷新脚本、PRD）
5. **文案与版本戳纠偏**：`schema.html` 版本戳笔误 `?v=2026092813b` → `?v=2026092813`；`config.html` 中 engine.html 提示改为实时联动说明；`app.js` 导航注释改为"已作废并已从仓库移除"
6. **README.md 全量重写**：以线上实测为准（v1.3.1 / V4.1 / 132 疾病 / 20 维度 / 10 导航项 / 4 道闸 / 作废文件表）
7. **验收**：`/api/kg/version` = 1.3.1 / v1.3 / V4.1 / skill V2.1 / 35,606 节点；`/api/kg/stats` 15 大类 / 132 疾病 / 16,626 实体 / 140,349 关系；`/api/kg/dimensions` core=20；`/api/kg/guidelines` 154 条；HTML 版本戳全站一致

### 2026-09-06 改造内容：图谱架构规范页升级 Schema V4.0（git: 004f506）
1. **standard.html 对齐 Schema V4.0**（设计原则：简单易懂）：
   - 架构升级：五层改六层，新增第 5 层"专科应用结构层"（AssessmentScale/NursingCarePlan/SpecialtyCarePathway/QualityControlRule），证据治理层顺延为第 6 层
   - 事实纠错：关系总数 138,153→139,696（与全库审计一致）；硬闸门 35→28 条；实体类型 42→63、关系类型 89→122（V4.0 口径）
   - 新增章节：证据三粒度模型（Guideline/SourceSection/Evidence 及必填字段）、禁止新增项（旧诊断角色值/旧细分推荐关系/新造关系名）、CDSS 导入与展示边界
   - 清除 V3.0 残留：推荐链表格、字段示例、JSON 示例共 9 处（仅保留 2 处历史沿革说明"V3.0 引入，V4.0 沿用"和 1 处反例示范）
2. **核心计数动态化**：节点/关系总数改为页面加载时从 `/api/kg/stats` 拉取（kg_node_count/total_relationships），API 不可用时保留静态兜底数字；共 9 处 span 挂 js-nodes/js-rels 钩子
3. **验收**：本地 node 脚本校验标签配平 PASS、33 个锚点全部可解析、29 处折叠结构配对正常；部署后线上比对 158,787 字符完全一致、V4.0×34、六层架构/证据模型/动态计数/版本戳 v=20260906 全部就位；API 实测 32,229 节点/139,696 关系与页面一致

### 2026-09-03 改造内容：风险分层评分详情面板（git: a9c1310）
1. **server.py `query_entity_detail` 新增 `risk_detail` 数据块**（仅 entityType=RiskStratification 返回，其他类型为 null）：
   - `risk_factors`：has_risk_factor 出边参数（GRACE 9 项：年龄/收缩压/静息心率/血肌酐/ST段偏移/心梗史/心衰史/心肌损伤标志物/是否行血运重建；全库 6/95 节点有参数）
   - `threshold_sentences`：`_extract_risk_threshold_sentences()` 从 evidence_text 提取含高危/中危/低危且带数值的句子（如《内科学》p.275 "GRACE＞140高危院内死亡＞3%；109~140中危1%~3%；≤108低危＜1%"），按评分名关键词优先排序（PDF 双栏噪声句靠后），上限 10 条
   - `criteria_evidence`：含"评分细则"或"项目+得分"表格的证据（如 NSTE-ACS CN 2024 p.5 表3 GRACE 细则），原文截断 1000 字
   - `inference_status` 透出（78/95 为 risk_framework_only_wait_guideline_or_textbook_detail）
2. **schema-map.js**：新增 `SCHEMA.inferenceStatus()` 细则状态中文映射（已含评分参数/框架已建·细则待补/未标注）
3. **explore.html `showEntityDetail`**：RiskStratification 实体详情面板新增"评分详情"区块（数据就绪状态之后，异步填充）：细则状态徽章 + 评分参数 chips + 阈值引文（高危红色高亮+来源标注）+ 计分细则来源（可展开原文）；`toggleRiskText()` 展开/收起
4. **验收**：本地 API 测试 4 项 PASS（GRACE 9参数/阈值句含140高危/细则含 NSTE-ACS p.5/框架节点参数0/Medication null/JSON 可序列化）；线上验证 19 项 PASS（API 结构 + 页面代码 + JS 级 DOM 渲染：中文徽章/参数 chips/阈值高亮/来源标注/展开按钮）；资源版本 v=20260903

### 2026-08-31 改造内容：Schema V3.2 图谱探索四 tab 升级（git: 115c161 + 后续补丁）
1. **公共映射层 `_shared/js/schema-map.js`（新增，所有页面可引用）**：
   - 诊断角色六值→三档双兼容（旧值 broad_diagnosis/clinical_subtype/independent_disease + V3.0 新值 suspected_parent/specific_subtype/standalone_diagnosis），数据迁移后页面不再失效
   - 关系类型中文映射（60+ 关系，对齐 server.py REL_MAP）、字典/医嘱/审核状态推导（字典状态由 cdss_dict_id 推导，审核状态覆盖全库 10 种取值）、来源格式化、连线样式规范
   - 禁止页面写裸值比较（如 `role==='broad_diagnosis'`），统一调 SCHEMA.roleGroup()/isTopDisease() 等
2. **诊疗链路 tab**（explore.html）：
   - 顶部新增 5 指标状态摘要条：标准诊断映射/资料覆盖/证据支撑/字典映射率/正式推荐链
   - 推荐卡补禁忌标识：has_contraindication 关系实体链（红色徽章 + 禁忌标签列表）
   - 诊断角色徽章新旧值双兼容（原 10 处硬编码全部改走公共映射层）
3. **知识总览 tab**（explore.html）：
   - 维度卡头部加字典映射统计（可医嘱类维度显示"字典 x/y"）；实体标签加状态徽标（字典●○/证据📄n）
   - 右侧详情面板新增"数据就绪状态"区块：资料来源/证据支撑/字典映射/医嘱状态/审核状态五项
   - 删除全部"Schema V2.x"旧标注，更新为 V3.2 口径（治疗方案下钻与正式推荐双轨说明）
4. **关系视角 tab**：连线加中文关系名标签（悬停显示）；鉴别二跳语义线（需排除检查/检验）常显橙色虚线标签；临床规则→药物/手术连线显示"推荐动作"
5. **实体视角 tab**：表格 4 列扩为 8 列（实体名称/维度/关联疾病/证据/字典/医嘱/来源/编码）
6. **server.py 四接口增量**：
   - query_disease_full 维度查询（直连+多跳两处）：补 cdss_dict_id/clinical_review_status/evidence_count
   - query_disease_recommendations：补 has_contraindication 禁忌实体链（缓存 key 升级 v3）
   - query_diseases_summary：补 cdss_dict_id/evidence_count/来源字段
   - query_entity_detail：补 entityType/cdss_dict_id/审核状态/来源/证据计数
   - 新增 SourceSection 资料覆盖统计（二跳聚合，AMI=59 章节）
   - 诊断角色查询双兼容（原 2 处旧值分支）
   - **坑**：此 Neo4j 版本不支持 `size((n)-[:rel]-())` 模式表达式，必须用 `COUNT { (n)-[:rel]-() }` 子查询，且在 f-string 中大括号需双写转义
7. **验收记录**：schema-map.js 单测 60/60 通过（角色 43 + 审核状态 17）；部署后线上验证 25/25 PASS（文件字节一致 + 4 API 新字段 + 静态资源）；浏览器 DOM 级验证：摘要条 5 卡、禁忌徽章 3 处、字典统计 4 项、实体表 8 列 198 行、详情面板五项状态、审核状态中文化无英文原始键，console 无报错

### 2026-08-16 改造内容
1. **知识总览-鉴别诊断维度修复**（server.py + explore.html）：
   - `REL_MAP` 中 DifferentialDiagnosis 关系从废弃的 `differentiates_from` 改为 `has_differential_diagnosis`，修复维度数为 0 的问题
   - 维度二跳新增 ClinicalRule 链路聚合：`(DD)-[:has_differential_rule]->(ClinicalRule)-[:requires_exclusion_exam/lab]->(检查/检验)`，产出 `exclusion_labs`、`differential_rules` 新字段，与旧 DD 直连 `requires_exclusion_exam` 合并去重
   - explore.html 三处渲染补充：知识总览鉴别详情（排除检验/鉴别规则行）、关系图二跳（`[排检]` 节点）、右侧实体详情面板
   - 验收：AMI 4 鉴别对象（主动脉夹层含肌钙蛋白/D-二聚体排除检验）、HCM 3 鉴别对象（心肌炎含肌钙蛋白/CRP/ESR），DOM 级 PASS

2. **关系视角图谱异常数据修复**（server.py + explore.html drawGraph）：
   - 图谱 `has_differential_point` 实际指向 ClinicalRule 规则节点，导致关系图出现"[鉴别]心衰与肺栓塞鉴别规则"这类规则名冒充鉴别要点的节点；server.py 聚合规则后剔除与规则重名的伪要点（AMI/HCM 全部 7 个 DD 均中招）
   - 标准诊断实体名与疾病名相同（如 AMI 的 STDDX 节点也叫"急性心肌梗死"），`seen` 去重后曾生成"标准诊断分组→疾病中心"回环边；drawGraph 现按同名实体过滤分组/维度/实体三级渲染，分组名与维度名相同时不建自环边
   - 验收：AMI 关系图 198 节点/236 连线，无 [鉴别] 规则名节点、无自环、无回环边、DD 实体正确挂载 [排除]/[排检] 节点，6/6 断言 PASS

### 历史改造（2026-07-16）— 含已移除页面，仅作沿革记录
> 注：以下段落中的 `disease.html` 已于 2026-09-28 作为孤岛页移除（功能由 `explore.html` 承接），
> 保留原文仅为追溯历史，**不要据此恢复该页面**。

1. **疾病层级树优化**：
   - 去掉了 DiseaseClassification 中间层（分型节点），改为子疾病通过 `has_classification → maps_to → Disease` 直接挂在父疾病下
   - 子疾病（如 AMI 下的 STEMI/NSTEMI）通过 `▼` 折叠按钮控制，默认展开
   - 同名大类/亚类自动合并，消除重复层级
   - 修复了 `disease.html` 中 `.grp-items` 缺少 `display:none` 导致无法收缩的 bug（后续已同步到 `explore.html`）

2. **视图模式切换**：
   - 左侧搜索框上方新增「疾病 / 疾病大类」单选切换
   - 疾病模式：扁平列表，按覆盖率从高到低排序（100% 在前）
   - 疾病大类模式：保持原层级树
   - 状态保存在 `localStorage.kg_view_mode`
   - 当时两个页面同步改造：`explore.html` + `disease.html`（现仅 `explore.html`）

3. **专科辅助诊疗菜单**：
   - 从本地 `D:\BigMouse\0.CDSS文献诊疗指南材料PDF\AI专科知识图谱生成\原型设计_prototype\specialty-cdss-prototype.html` 同步最新版到服务器
   - 导航栏点击在新浏览器标签页打开（`target="_blank"`）

---

## 九、已知问题与待办

1. **~~版本号不一致~~（已修复）**：VERSION 文件已统一为 `1.3.1`，`app.js` 不再硬编码版本默认值，改为启动时从 `/api/kg/version` 拉取
2. **左侧树圆点样式**：疾病大类/亚类的圆点标记样式已从 emoji 改为 CSS 圆点（`.cat-dot` / `.sub-dot`）
3. **维度口径文档残留**：`Schema_V2.0_前端改造方案.md`、`generate-doc.js`、`assets/BUG_LOG.md`、`assets/CHANGELOG.md` 中仍有"17 维度"历史表述，属当时快照，**以本文件与 README.md 的 20 核心维度为准**
4. **旧静态快照兼容**：`assets/clinical_review_frontend_data.json` 内仍含 `E:\BigMouse\...` 旧盘符路径，仅供离线兜底展示，不影响线上运行

---

## 十、开发规范

### 代码风格
- **前端**：纯 ES5+ 原生 JS，不用箭头函数（兼容性），不用 `let/const`（部分旧代码），不使用 npm 构建
- **CSS**：CSS 变量体系（`var(--accent)` 等），BEM 无严格遵循，组件前缀如 `ex-`（explore）、`di-`（disease）
- **后端**：Python 3.6+，标准库为主，Neo4j Bolt 驱动

### 文件修改规则
- 前端共享逻辑改 `_shared/js/app.js`
- Schema 映射/中文名改 `_shared/js/schema-map.js`
- 样式改 `_shared/css/style.css`
- 页面特定逻辑改对应 `.html` 文件中的 `<script>` 标签
- 后端改 `server.py`
- 修改后运行 `python deploy.py` 部署（会自动跑 4 道保护闸）
- **涉及线上变更的，部署验证通过后必须立即 `git commit`**，保持仓库 = 线上

### 数据库查询
- 所有 Neo4j 查询在 `server.py` 中（**只读**，不得写入）
- 疾病层级树查询：`query_disease_tree()`（有 Redis 缓存）
- 疾病数据查询：`query_disease_data()`（按编码查，有 Redis 缓存）
- 全局统计：`query_stats()`（有 Redis 缓存）
- 维度注册表：`query_dimensions()`
- Schema 注册表：`query_schema_registry()`

---

## 十一、给 AI 模型的使用说明

### 接手新会话时的开场白模板：
```
请先阅读 PROJECT_CONTEXT.md 和 README.md 了解项目现状（含线上实测口径）。
今天需要你做 [具体任务]。
```

### 关键注意事项：
1. 这个项目**没有前端框架**，都是原生 JS，不要引入 React/Vue
2. 所有前端页面共享 `_shared/js/app.js`、`_shared/js/schema-map.js` 和 `_shared/css/style.css`
3. 修改代码后必须运行 `python deploy.py` 部署到服务器；**部署前先确认本地已是最新（`git pull`），部署后立即提交**
4. 疾病编码格式为 `DIS-{大类}-{亚类}-{序号}`，修改时注意保持一致
5. 左侧树的疾病层级结构在 `server.py → query_disease_tree()` 中构建
6. 疾病树逻辑现集中在 `explore.html` 单页（`disease.html` 已移除），改动无需再同步两处
7. `specialty-cdss-prototype.html` 是独立的 CDSS 原型，有自己的侧边栏菜单体系，不共享导航栏；导航中以 `external:true` 新标签页打开
8. 浏览器验证地址：`http://192.168.3.27:4001`
9. **维度口径以 `/api/kg/dimensions` 为准（当前 20 核心维度）**，不要把旧文档的"17/23/25 维度"当作现状
10. 已作废的 12 个文件已从仓库移除，`deploy.py` 黑名单会拦截；**不要重新创建或部署它们**
