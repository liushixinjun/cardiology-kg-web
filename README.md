# 心血管专科知识图谱 Web 平台

> 基于 Neo4j 图数据库的心血管内科专病知识图谱，支持 92 种心血管疾病的交互式浏览、诊断模拟与循证分析。

**当前版本**：v1.3.0 · 2026-07-06

---

## 核心数据

| 指标 | 数量 | 说明 |
|------|------|------|
| 疾病大类 | 12 | 冠心病、心律失常、心力衰竭等 |
| 专病 | 92 | 急性心肌梗死、房颤等具体疾病 |
| 可视化实体 | 1,145 | 排除 Evidence 后的临床核心实体 |
| 全库节点 | 34,292 | 含 33,147 个 Evidence 节点 |
| 关系 | 99,269 | 全类型关系，不排除任何类型 |
| 诊疗指南 | 100+ | ESC、ACC/AHA、中华医学会等 |

> **统计口径说明**：可视化实体排除 Evidence 节点（占总量 96%），因为 Evidence 是按指南/教材章节拆分的循证依据，不属于临床实体。详见 `assets/STATS_GUIDE.md`。

---

## 功能模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 📊 数据总览 | `index.html` | 首页驾驶舱，疾病大类完整率、17 维度成熟度、质量缺口 |
| 🧭 图谱探索 | `explore.html` | 三栏布局：疾病树 + 疾病/关系/实体三种视角 + 详情面板 |
| 🕸️ 网络探索 | `network.html` | 交互式力导向图谱，维度筛选、路径查找、全屏浏览 |
| 🗺️ 数据覆盖分析 | `heatmap.html` | 92 种专病 × 17 维度热力图矩阵，定位缺失维度 |
| 🔍 临床诊断模拟 | `diagnosis.html` | 输入病例信息，17 维度加权匹配候选疾病，展示诊疗指南依据 |
| 🔗 路径编辑 | `engine.html` | 临床路径流程引擎编辑器 |
| ✅ 临床审核 | `review.html` | 4 层审核 Tab（疾病/场景/药师/边级），筛选+导出 |
| 📐 图谱数据字典 | `schema.html` | 实体类型、关系类型、疾病分类统计 |
| 📘 Schema 标准 | `standard.html` | 专科专病图谱建模标准、字段约束、质量规则 |
| 📋 指南库 | `guideline.html` | 浏览临床指南及其关联疾病 |
| 🧬 医学术语库 | `terminology.html` | 按 17 维度分类浏览所有医学术语 |
| ⚙️ 系统配置 | `config.html` | 配置 Neo4j 服务器地址和连接参数 |

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

### 环境变量（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEO4J_URI` | `bolt://192.168.3.27:7687` | Neo4j 连接地址 |
| `NEO4J_USER` | `neo4j` | Neo4j 用户名 |
| `NEO4J_PWD` | `zysoft@2024` | Neo4j 密码 |
| `REDIS_HOST` | `127.0.0.1` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `CACHE_TTL` | `300` | 缓存过期时间（秒） |

---

## 版本管理

**单一真相源**：`VERSION` 文件

```
kg-test-page/VERSION  →  内容为 "1.3.0"
```

- `server.py` 启动时读取 `VERSION`，提供 `/api/kg/version` 接口
- `app.js` 从 API 获取版本号，自动注入页面底部
- 发版时只需修改 `VERSION` 文件，重启服务即可

```bash
# 发版流程
echo "1.4.0" > VERSION
# 重启 server.py，所有页面自动显示 v1.4.0
```

详细版本历史见 `assets/CHANGELOG.md`。

---

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/kg/version` | GET | 返回版本号 |
| `/api/kg/stats` | GET | 全局统计（Redis 缓存） |
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
├── server.py                  # Python 后端（API + 静态文件 + Redis 缓存）
├── dashboard.js               # 数据总览 Dashboard 逻辑
├── index.html                 # 数据总览
├── explore.html               # 图谱探索
├── network.html               # 网络探索
├── heatmap.html               # 数据覆盖分析
├── diagnosis.html             # 临床诊断模拟
├── engine.html                # 路径编辑
├── review.html                # 临床审核
├── schema.html                # 图谱数据字典
├── standard.html              # Schema 标准
├── guideline.html             # 指南库
├── terminology.html           # 医学术语库
├── config.html                # 系统配置
├── disease.html               # 疾病详情
├── disease-review.html        # 疾病审核详情
├── graph.html                 # 图谱可视化
├── instances.html             # 实例页
├── generate-doc.js            # Node.js 操作手册生成
├── package.json               # Node.js 依赖
├── _shared/
│   ├── css/style.css          # 全局暗色主题
│   └── js/
│       ├── app.js             # 共享逻辑（版本管理、导航、数据加载）
│       ├── echarts.min.js     # ECharts 5.x
│       └── review.js          # 临床审核逻辑
└── assets/
    ├── CHANGELOG.md           # 版本历史
    ├── STATS_GUIDE.md         # 统计口径说明
    ├── BUG_LOG.md             # 踩坑记录
    ├── DAY_LOG.md             # 开发日志
    ├── GIT_LOG.md             # Git 提交记录
    ├── kg_full_data.json      # 静态数据（降级备用）
    └── clinical_review_frontend_data.json
```

---

## 许可

内部项目，仅供学术研究和临床辅助决策参考。所有诊疗决策应以临床医生判断为准。
