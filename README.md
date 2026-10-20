﻿﻿﻿﻿﻿﻿﻿﻿﻿# 心血管专科知识图谱 Web 平台

> 基于 Neo4j 图数据库的心血管内科专病知识图谱，支持 132 种心血管疾病的交互式浏览、循证分析与临床审核。

**当前版本**：v1.5.11f · Schema 标准 V4.1 · 数据批次 KG-V4-FOUNDATION-ENTITY-QUALITY-REPAIR-20260911

---

## 核心数据

| 指标 | 数量 | 说明 |
|------|------|------|
| 疾病大类 | 15 | 冠心病、心律失常、心力衰竭等 |
| 专病 | 132 | 急性心肌梗死、房颤等具体疾病 |
| 可视化实体 | 16,626 | 排除 Evidence 后的临床核心实体 |
| 全库节点 | 35,606 | 含 18,980 个 Evidence 节点 |
| 关系 | 140,349 | 全类型关系，不排除任何类型 |
| 诊疗指南 | 154 | ESC、ACC/AHA、中华医学会等 |

> **统计口径说明**：可视化实体排除 Evidence 节点，因为 Evidence 是按指南/教材章节拆分的循证依据，不属于临床实体。详见 `assets/STATS_GUIDE.md`。

---

## 功能模块

导航共 11 个入口（10 个站内页 + 1 个外部系统）：

| 模块 | 文件 | 说明 |
|------|------|------|
| 📊 数据总览 | `index.html` | 首页驾驶舱，疾病大类完整率、20 维度成熟度、质量缺口 |
| 🧭 图谱探索 | `explore.html` | 三栏布局：疾病树 + 疾病/关系/实体三种视角 + 详情面板 |
| 🕸️ 网络探索 | `network.html` | 交互式力导向图谱，维度筛选、路径查找、全屏浏览 |
| 🗺️ 数据覆盖分析 | `heatmap.html` | 132 种专病 × 20 维度覆盖矩阵，四层覆盖度，定位缺失维度 |
| ✅ 临床审核 | `review.html` | 4 层审核 Tab（疾病/场景/药师/边级），筛选+导出 |
| 📐 图谱数据字典 | `schema.html` | 图谱结构注册表视图（默认）+ 实体类型、关系类型、分类统计 |
| 📘 Schema 标准 | `standard.html` | 专科专病图谱建模标准、字段约束、质量规则 |
| 🤖 AI图谱解析 | `ai-parse.html` | 实例生产 Skill V5.1 解析规范：九道工序 G0–G8、三道硬闸门、字典/疾病/证据规则、必查与禁止事项 |
| 📋 指南库 | `guideline.html` | 浏览临床指南及其关联疾病 |
| 🧬 医学术语库 | `terminology.html` | 按维度分类浏览所有医学术语 |
| 🩺 专科辅助诊疗 | `specialty-cdss-prototype.html` | **外部系统**（新标签页打开），独立 CDSS 原型 |

支撑页面（不在导航菜单内）：

| 文件 | 说明 |
|------|------|
| `config.html` | 系统配置（数据同步 / 数据库 / 功能菜单 / 审计报告） |
| `disease-review.html` | 疾病审核详情页，由 `review.html` 跳转进入（`?code=xxx`） |

> **维度口径**：当前为 **20 个核心维度**（17 基础 + 3 护理，V4.0 护理批次）。旧文档中的"17 维度"为历史口径，已过时。维度的单一事实源是 `/api/kg/dimensions` 接口，`app.js` 启动时动态拉取。

---

## 技术架构

```
┌─────────────────────────────────────────────────┐
│  浏览器（原生 HTML + CSS + JS，单文件 SPA）        │
│  ECharts 5.x · 力导向图/雷达图/热力图             │
└────────────────────┬────────────────────────────┘
                     │ HTTP
┌────────────────────▼────────────────────────────┐
│  server.py（Python http.server）                  │
│  API 路由 + 静态文件服务 + Cache-Control: no-cache│
└────────┬──────────────────────┬─────────────────┘
         │ Cypher               │ GET/SET
┌────────▼──────────┐  ┌───────▼─────────────────┐
│  Neo4j 3.5+       │  │  Redis 7.0               │
│  bolt://:7687     │  │  缓存层，TTL 5min         │
│  图数据库          │  │  LRU 淘汰，256MB 上限     │
└───────────────────┘  └──────────────────────────┘
```

### 技术栈明细

| 层次 | 技术 | 版本 |
|------|------|------|
| 前端 | 原生 HTML + CSS + JS | 单文件 SPA，无构建工具 |
| 图表 | ECharts | 5.x |
| 样式 | 自定义暗色主题 | CSS 变量体系 |
| 后端 | Python http.server | 标准库，自定义 KGHandler |
| 缓存 | Redis | 7.0.15 |
| 数据库 | Neo4j | 图数据库，Cypher 查询语言 |
| 驱动 | neo4j Python driver | bolt 协议 |
| 文档生成 | Node.js + docx | ^8.2.3（仅生成操作手册） |

---

## 快速启动

### 本地开发

```bash
# 1. 确保 Neo4j 已启动（bolt://192.168.3.27:7687）
# 2. 确保 Redis 已启动（127.0.0.1:6379）
# 3. 启动 Web 服务
cd kg-test-page
python server.py  # 默认 0.0.0.0:4001

# 访问
open http://localhost:4001/
```

### 服务器部署

```
服务器：192.168.3.27
├── Neo4j：bolt://192.168.3.27:7687（用户 neo4j）
├── Redis：/zoesoft/zoekgRedis（端口 6379）
└── Web 平台：/zoesoft/zoekgweb（端口 4001）
```

```bash
# 启动 Redis
cd /zoesoft/zoekgRedis && ./bin/redis-server redis.conf

# 启动 Web 服务
cd /zoesoft/zoekgweb && nohup python3 server.py > server.log 2>&1 &
```

### 一键部署（推荐）

```bash
cd kg-test-page
python deploy.py
```

`deploy.py` 自动完成：**部署前校验 → 上传并回读校验 → 清 Redis → 重启 server.py → 回归验证**。

**部署保护闸**（防止"旧盖新"事故复发，共 4 道校验，任一不过即中止部署）：

| 校验 | 拦截内容 |
|------|----------|
| 作废文件黑名单 | 清单含已作废页面（如 `diagnosis.html`、`engine.html`、`version.js`） |
| 文件完整性 | 清单中文件本地缺失，或为 0 字节空文件 |
| 版本戳一致性 | 任一 HTML 的 `?v=` 与统一版本戳不一致 |
| 线上回归 | 重启后服务未存活 / 版本接口无响应 / 作废页仍可访问（应 404） |

> **背景**：2026-09-28 曾发生"本地旧文件覆盖线上新版"事故——线上已完成的 4001 整改（新导航、双口径统计）被本地旧 `index.html`/`app.js` 覆盖，已作废的页面被重新部署上线。此保护闸即为防止该问题复发而加入。

**手动重启 server.py**（仅当不方便跑 deploy.py 时）：

```bash
# SSH 到服务器
ssh root@192.168.3.27

# 杀旧进程 + 启新进程
pkill -f 'python.*server.py'; sleep 2
cd /zoesoft/zoekgweb && nohup python3 server.py >> server.log 2>&1 &

# 清 Redis 缓存
/zoesoft/zoekgRedis/bin/redis-cli -h 127.0.0.1 -p 6379 FLUSHALL

# 验证进程
ps aux | grep 'python.*server.py' | grep -v grep
```

### 部署注意事项（重要）

> **反复踩坑点**：修改 `server.py` 后必须重启服务进程，否则跑的还是旧代码。

不同文件的生效方式不同，务必区分：

| 修改的文件 | 生效方式 | 原因 |
|------------|----------|------|
| `server.py`（后端 Python） | **必须重启进程** | Python 代码启动时加载到内存，改文件不会热更新 |
| 前端 `*.html` / `*.js` / `*.css` | 清 Redis 缓存 + 浏览器强制刷新 | 静态文件由 server.py 提供，带 `Cache-Control: no-cache`，但 Redis 会缓存 API 结果 |
| Neo4j 数据（节点/关系） | 自动生效（下次查询） | server.py 每次实时查询 Neo4j，无缓存层 |
| Redis 缓存数据 | 清缓存即可（`FLUSHALL`） | TTL 5min，也可手动清除 |

### 环境变量（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEO4J_URI` | `bolt://192.168.3.27:7687` | Neo4j 连接地址 |
| `NEO4J_USER` | `neo4j` | Neo4j 用户名 |
| `NEO4J_PWD` | `__NEO4J_PWD__` | Neo4j 密码 |
| `REDIS_HOST` | `127.0.0.1` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `CACHE_TTL` | `300` | 缓存过期时间（秒） |

---

## 版本管理

**单一真相源**：`VERSION` 文件

```
kg-test-page/VERSION  →  内容为 "1.3.7"
```

- `server.py` 启动时读取 `VERSION`（用 `utf-8-sig` 剥离 BOM），提供 `/api/kg/version` 接口
- 版本信息分三层，语义不同，不要混用：

| 字段 | 当前值 | 含义 |
|------|--------|------|
| `version` / `app_version` | `1.3.7` | 应用版本（`VERSION` 文件） |
| `api_version` | `v1.3` | 接口代次（`server.py` 中 `API_VERSION`） |
| `schema_standard_version` | `V4.1` | 当前执行的图谱 Schema 标准（`SCHEMA_STANDARD_VERSION`） |
| `skill_version` | `V2.1` | 实例生产 Skill 版本（由查询动态统计，非硬编码） |

- `app.js` 从 API 获取版本号，自动注入页面底部版本栏
- **版本戳**：所有 HTML 引用 JS/CSS 时统一带 `?v=YYYYMMDDNN`（如 `?v=2026092915`），由 `deploy.py` 校验一致性

```bash
# 发版流程
echo "1.4.0" > VERSION
# 重启 server.py，所有页面自动显示 v1.4.0
```

详细版本历史见 `assets/CHANGELOG.md`。

---

## 数据质量

图谱数据侧的问题**统一记录在** [`assets/数据质量问题台账.md`](assets/数据质量问题台账.md)，不在其他文档里零散记录。新发现问题请追加到台账，并同步更新「问题状态总表」。

**台账内容**

| 部分 | 说明 |
|------|------|
| 〇、问题状态总表 | 一眼看清每个问题的编号、数量、严重度、**处理状态**、最近更新日期 |
| 一、当前数据规模 | 复测时的节点/关系/类型数量，便于判断数据是否仍在增长 |
| D-01 ~ D-12 | 单个问题的现象、规模、样例、影响、处理建议、**复测 Cypher** |
| 附录 A | 状态定义（待处理 / 处理中 / 待验证 / 已修复 / 待确认 / 规划中 / 已关闭） |
| 附录 B | 变更记录，每次状态变化追加一行 |
| 附录 C | 复测方法（只读查询，不改数据） |

**状态口径**：`待处理` 表示已确认、未开工；`处理中` 表示已有人在改；`待验证` 表示已改但未复测；`已修复` 表示复测通过；`待确认` 表示需业务判断（如是否合并同义实体）；`规划中` 表示非缺陷、属于后续建设范围；`已关闭` 表示不再跟进。

**当前 P0 / P1 问题**（截至 2026-10-19）

| 编号 | 问题 | 数量 | 状态 |
|------|------|------|------|
| D-02 | 关系 `type()` 与 `relationType` 属性不一致 | 1,140 条 | 待处理 |
| D-01 | 同类型 + 同起终点的重复关系 | 50 组 | 待处理 |
| D-12 | 元模型关联列表入边行样式割裂、实例数显示全量 | 出入边全部行 | **已修复** |

> D-01 / D-02 产生在**解析 / 合并 / 灌库**环节，修复前请先跑台账里对应的复测 Cypher 核对当前实际条数（数据仍在持续灌入）。D-10（属性口径 14 个零覆盖错键）/ D-11（字段标准无跳转入口）/ D-12 属元模型页问题，已随 v2026101705 部署并于 2026-10-19 复测通过。

**元模型快照自动校准**：`meta_model.json` 中登记的 `instance_count` 会由后端每 10 分钟按 Neo4j 实测值自动校准（`META_SYNC_INTERVAL` 可调，默认 600 秒），因此元模型页不再出现因数据增长导致的"不一致"误报。校准记录写入 `audit_log.jsonl`（`action = meta_model_autosync`）。

---

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/kg/version` | GET | 版本号（简洁） |
| `/api/kg/full-version` | GET | 完整版本信息（Schema 标准 / Skill / 实例版本分布） |
| `/api/kg/stats` | GET | 全局统计（Redis 缓存，双口径：图谱实例 vs CDSS 字典映射） |
| `/api/kg/dimensions` | GET | 维度注册表（**前端维度口径的单一事实源**） |
| `/api/kg/schema-registry` | GET | 图谱结构注册表（实体/关系类型注册视图） |
| `/api/kg/diseases` | GET | 疾病列表（Redis 缓存） |
| `/api/kg/diseases/all` | GET | 全量疾病数据 |
| `/api/kg/disease/<code>` | GET | 单个疾病完整数据 |
| `/api/kg/entity/<code>` | GET | 单个实体详情 |
| `/api/kg/guidelines` | GET | 指南列表 |
| `/api/kg/diseases/summary` | GET | 疾病摘要 |

---

## 目录结构

```
kg-test-page/
├── VERSION                    # 版本号（单一真相源）
├── README.md                  # 本文件
├── PROJECT_CONTEXT.md         # 项目上下文交接文档（换机必读）
├── server.py                  # Python 后端（API + 静态文件 + Redis 缓存）
├── deploy.py                  # 一键部署（含 4 道保护闸）
├── refresh_cache.py           # 仅清缓存 + 重启（不上传文件）
├── dashboard.js               # 数据总览 Dashboard 逻辑
├── index.html                 # 数据总览
├── explore.html               # 图谱探索
├── network.html               # 网络探索
├── heatmap.html               # 数据覆盖分析
├── review.html                # 临床审核
├── disease-review.html        # 疾病审核详情（review.html 跳转入口）
├── schema.html                # 图谱数据字典
├── standard.html              # Schema 标准
├── ai-parse.html              # AI图谱解析（Skill V5.1 执行规范）
├── guideline.html             # 指南库
├── terminology.html           # 医学术语库
├── config.html                # 系统配置
├── specialty-cdss-prototype.html  # 专科辅助诊疗（外部系统）
├── 专科辅助诊疗PRD.html/.md    # 专科辅助诊疗 PRD
├── 专科辅助诊疗泳道图.svg      # 专科辅助诊疗业务泳道图
├── generate-doc.js            # Node.js 操作手册生成
├── package.json               # Node.js 依赖
├──kg-audit-report/            # 图谱质量审计报告（config.html 在线查看入口）
│   ├── kg-audit-report.html
│   ├── assets/charts.js
│   └── _shared/js/echarts.min.js
├── schema_docs/
│   └── 图谱结构注册表.json     # Schema 机器注册表（后端交付快照）
├── _shared/
│   ├── css/style.css          # 全局暗色主题
│   └── js/
│       ├── app.js             # 共享逻辑（版本管理、导航、维度注册、数据加载）
│       ├── echarts.min.js     # ECharts 5.x
│       └── schema-map.js      # Schema V4.1 实体/关系中文名映射
└── assets/
    ├── CHANGELOG.md           # 版本历史
    ├── STATS_GUIDE.md         # 统计口径说明
    ├── 数据质量问题台账.md     # 数据侧问题统一记录（含处理状态 / 复测语句）
    ├── BUG_LOG.md             # 踩坑记录
    ├── DAY_LOG.md             # 开发日志
    ├── GIT_LOG.md             # Git 提交记录
    ├── KG_REASONING_GUIDE.md  # 图谱推理指南
    ├── ami_knowledge_pack.json
    ├── kg_full_data.json      # 静态数据（降级备用）
    └── clinical_review_frontend_data.json
```

### 已作废并已移除的文件

以下文件曾存在，现已作废并**从仓库和服务器彻底移除**（线上访问返回 404）。请勿重新加入：

| 文件 | 作废原因 |
|------|----------|
| `diagnosis.html` | 临床诊断模拟（功能已下线） |
| `engine.html` | 诊疗路径编辑器（功能已下线） |
| `engine_test.html` | engine.html 的自动化测试残留 |
| `disease.html` | 孤岛页，已被 `explore.html` 取代 |
| `graph.html` | 孤岛页，已被 `network.html` 取代 |
| `instances.html` | 孤岛页，已被 `schema.html` 取代 |
| `kg-story.html` | 孤岛页，零入链 |
| `clinical-workflow.html` | 零引用 |
| `server_fixed.py` | 历史临时文件 |
| `_shared/js/review.js` | 零引用（`review.html` 已内联全部逻辑） |
| `_shared/js/version.js` | 零引用（版本号已由 `/api/kg/version` 提供） |
| `assets/ami_graph_data.json` | 零引用 |

---

## 许可

内部项目，仅供学术研究和临床辅助决策参考。所有诊疗决策应以临床医生判断为准。
