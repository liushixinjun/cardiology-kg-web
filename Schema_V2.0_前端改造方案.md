# Schema V2.0 全平台前端改造方案

> ⚠️ **本文档为历史方案快照（2026-07-19），不是现状说明，已执行完毕。**
> 文中涉及的 `disease.html`、`instances.html`、`diagnosis.html`、`engine.html` 等页面
> **已于 2026-09-28 全部作废并从仓库移除**；文中的「17 维度」为当时口径，
> **当前为 20 个核心维度（17 基础 + 3 护理）**，Schema 标准为 **V4.1**。
> **当前口径以 `README.md` 与 `PROJECT_CONTEXT.md` 为准，切勿据此恢复任何页面。**

> **版本**: V2.0 | **日期**: 2026-07-19 | **状态**: 已执行（历史存档）
> **基线**: Schema V1.17 → V2.0；当前系统 REL_MAP=23维、DIM_NAMES=25维、ENTITY_TYPES=37种、REL_DIM_MAP=41种

---

## 零、数据库现状（2026-07-19 实测）

### 已迁移完成（V2.0）

| 项目 | 数量 |
|---|---|
| Disease 三层结构（diagnostic_role） | 132个疾病 |
| DiseaseCategory（CAT- 前缀） | 20个大类 |
| has_disease / has_clinical_subtype / has_disease_category | 308 / 38 / 20 |
| StandardDiagnosis（有效 ICD-10） | 82条 |
| has_standard_diagnosis | 82条 |
| DiseaseClassification（已清除） | 0条 |
| LabTestIndicator（已清除） | 0条 |

### 尚未迁移（仍使用 V1.x）

| V1.x 实体 | 数据库数量 | V2.0 目标 | V2.0 数量 |
|---|---|---|---|
| `Exam` | **105** | `ExamItem` | 0 |
| `LabTest` | **43** | `LabItem` | 0 |
| `ExamIndicator` | **197** | `ExamObservation` | 0 |

| V1.x 关系 | 数据库数量 | V2.0 目标 | V2.0 数量 |
|---|---|---|---|
| `requires_exam` | **1,072** | `requires_exam_item` | 0 |
| `requires_lab_test` | **493** | `requires_lab_item` | 0 |
| `exam_has_indicator` | **187** | `exam_item_has_observation` | 0 |
| `lab_test_has_indicator` | **63** | `lab_item_has_subitem` | 0 |
| `has_recommended_action` | **11,281** | `stage_has_available_action` | 0 |

### 尚不存在的 V2.0 实体类型

| 实体类型 | 中文名 | 数据库数量 |
|---|---|---|
| `StandardProcedure` | CDSS标准手术 | 0 |
| `LabSpecimen` | 检验标本 | 0 |
| `TreatmentItem` | 治疗项目 | 0 |
| `VitalSignItem` | 生命体征项目 | 0 |
| `MedicalTerm` | 医学术语 | 0 |
| `PatientState` | 患者状态 | 0（仅 Schema 定义） |
| `ClinicalEvent` | 临床事件 | 0（仅 Schema 定义） |

---

## 一、核心变更清单（V1.x → V2.0）

### 1.1 实体类型重命名（数据库尚未迁移，需兼容）

| V1.x 旧名 | V2.0 新名 | 中文名 | 数据库状态 |
|---|---|---|---|
| `Exam` | `ExamItem` | 检查项目 | **旧名有105条，新名为0** |
| `LabTest` | `LabItem` | 检验项目 | **旧名有43条，新名为0** |
| `ExamIndicator` | `ExamObservation` | 检查发现 | **旧名有197条，新名为0** |
| `LabTestIndicator` | `LabSubitem` | 检验细项 | **旧名已清除** |
| `DiseaseClassification` | **停用** | 疾病分型/分类 | **已清除** |

### 1.2 关系类型重命名（数据库尚未迁移，需兼容）

| V1.x 旧关系 | V2.0 新关系 | 数据库状态 |
|---|---|---|
| `requires_exam` | `requires_exam_item` | **旧名有1072条，新名为0** |
| `requires_lab_test` | `requires_lab_item` | **旧名有493条，新名为0** |
| `exam_has_indicator` | `exam_item_has_observation` | **旧名有187条，新名为0** |
| `lab_test_has_indicator` | `lab_item_has_subitem` | **旧名有63条，新名为0** |
| `has_recommended_action` | `stage_has_available_action` | **旧名有11281条，新名为0** |

### 1.3 新增实体类型（数据库尚无数据，预注册展示）

| 实体类型 | 中文名 | 关系 |
|---|---|---|
| `StandardProcedure` | CDSS标准手术 | `has_standard_procedure` |
| `LabSpecimen` | 检验标本 | `lab_item_uses_specimen` |
| `TreatmentItem` | 治疗项目 | `includes_treatment_item` |
| `VitalSignItem` | 生命体征项目 | — |
| `MedicalTerm` | 医学术语 | `term_has_alias` |
| `PatientState` | 患者状态 | `applies_to_state` |
| `ClinicalEvent` | 临床事件 | `has_clinical_event` |

---

## 二、改造策略：前端显示 V2.0 + 后端查询兼容旧数据

**核心原则**：数据库实体类型尚未迁移，Cypher 查询仍需使用旧实体名。前端全部展示 V2.0 新中文名，后端查询同时匹配新旧实体类型和关系名。

### 兼容映射表（server.py 核心）

```python
# 前端显示名 → 后端查询用的实体类型（兼容新旧）
ENTITY_COMPAT = {
    'ExamItem':         ['ExamItem', 'Exam'],
    'LabItem':          ['LabItem', 'LabTest'],
    'ExamObservation':  ['ExamObservation', 'ExamIndicator'],
    'LabSubitem':       ['LabSubitem', 'LabTestIndicator'],
}

# 前端显示名 → 后端查询用的关系类型（兼容新旧）
REL_COMPAT = {
    'requires_exam_item':           ['requires_exam_item', 'requires_exam'],
    'requires_lab_item':            ['requires_lab_item', 'requires_lab_test'],
    'exam_item_has_observation':    ['exam_item_has_observation', 'exam_has_indicator'],
    'lab_item_has_subitem':         ['lab_item_has_subitem', 'lab_test_has_indicator'],
    'stage_has_available_action':   ['stage_has_available_action', 'has_recommended_action'],
}
```

---

## 三、逐页面改造清单

### ① 📊 数据总览 — `index.html`

**访问地址**: `http://192.168.3.27:4001/index.html`

| 模块 | 位置 | 改造内容 |
|---|---|---|
| KPI 横幅 | 顶部 Hero 区域 | 维度总数从 25 → 30+ |
| 知识网络图谱 | ECharts 力导向图 | 节点颜色映射：`Exam→ExamItem`、`LabTest→LabItem`、`ExamIndicator→ExamObservation` |
| 17维度全局覆盖率 | 雷达图 | 维度列表旧名→新名；移除 `DiseaseClassification`，新增 `ExamObservation`、`LabSubitem` |
| 各维度实体数量分布 | 柱状图 | 同上维度名更新 |
| 功能入口卡片 | 8个导航卡片 | 无需改 |

**修改文件**: `_shared/js/app.js` + `index.html`

---

### ② 🧭 图谱探索 — `explore.html`

**访问地址**: `http://192.168.3.27:4001/explore.html`

| 模块 | 内部位置 | 改造内容 |
|---|---|---|
| 左侧疾病层级树 | `#disease-tree` | 无需改（已用 V2.0 disease-tree API） |
| 知识总览分组 | `renderDiseaseView()` groups 数组 | `Exam→ExamItem`、`LabTest→LabItem`；移除 `DiseaseClassification`；新增 `ExamObservation`、`LabSubitem` |
| 维度卡片标题 | `.ex-card-title` | 依赖 DIM_NAMES 自动生效 |
| 关系视角图谱 | `renderGraphView()` | ECharts 节点颜色映射更新 |
| 实体详情侧边栏 | `.ex-side` | 标签：检查指标→检查发现、检验指标→检验细项 |
| CDSS 诊疗流程视图 | `renderCDSSView()` | 无需改 |

**修改文件**: `explore.html`

---

### ③ 🕸️ 网络探索 — `network.html`

**访问地址**: `http://192.168.3.27:4001/network.html`

| 模块 | 内部位置 | 改造内容 |
|---|---|---|
| 疾病选择下拉 | `#nw-disease-select` | 无需改 |
| 维度过滤器 | `#dim-filters` | `Exam→ExamItem`、`LabTest→LabItem`、`ExamIndicator→ExamObservation`、`LabTestIndicator→LabSubitem` |
| 力导向图节点 | `renderNetwork()` | 节点颜色映射 + tooltip 标签更新 |
| 节点详情面板 | `.nw-side` | 实体类型标签更新 |
| 路径查找 | BFS 算法 | 无需改 |

**修改文件**: `network.html`

---

### ④ 🔬 专病诊疗框架覆盖分析 — `heatmap.html`

**访问地址**: `http://192.168.3.27:4001/heatmap.html`

**结论: 无需修改**（已使用 V2.0 CDSS 决策层 API，不涉及旧实体名）

---

### ⑤ 🫀 疾病详情浏览 — `disease.html`

**访问地址**: `http://192.168.3.27:4001/disease.html`

| 模块 | 内部位置 | 改造内容 |
|---|---|---|
| 左侧疾病层级树 | `#disease-tree` | 无需改 |
| 疾病头部信息 | `renderDetail()` | 无需改 |
| 分型入口面板 | `.ex-subtype-panel` | 无需改 |
| 维度卡片网格 | `renderDetail()` DIM_KEYS 循环 | `Exam→ExamItem`、`LabTest→LabItem`；移除 `DiseaseClassification`；新增 `ExamObservation`、`LabSubitem` |
| 关系统计 | `renderRelationsSummary()` | 关系名标签：`requires_exam→requires_exam_item` 等 |
| 关系图 | `renderGraph()` | 节点颜色映射更新 |

**修改文件**: `disease.html`

---

### ⑥ ✅ 临床审核 — `review.html`

**访问地址**: `http://192.168.3.27:4001/review.html`

| 模块 | 内部位置 | 改造内容 |
|---|---|---|
| 疾病级审核 | Tab 1: `renderDiseasePanel()` | 实体标签：`Exam→检查项目`、`LabTest→检验项目`、`ExamIndicator→检查发现` |
| 场景级推荐审核 | Tab 2: `renderScenarioPanel()` | 同上实体标签 + 关系标签更新 |
| 药师专项审核 | Tab 3: `renderPharmacistPanel()` | 无需改 |
| 边级证据追溯 | Tab 4: `renderDetailPanel()` | 实体类型标签更新 |
| CDSS 推荐审核 | Tab 5 | `has_recommended_action→stage_has_available_action` |
| 教材骨架审计 | Tab 6 | 无需改 |
| 维度标签映射 | `DIM_LABELS` 对象 | 4个旧名→新名 |

**修改文件**: `review.html`

---

### ⑦ 📐 图谱实例检索 — `instances.html`

**访问地址**: `http://192.168.3.27:4001/instances.html`

| 模块 | 内部位置 | 改造内容 |
|---|---|---|
| 维度下拉筛选 | `#dimension-filter` | 旧名→新名；移除 `DiseaseClassification`；新增 V2.0 实体 |
| 维度分组表格 | `SCHEMA_ORDER` + `SCHEMA_NAMES` | 4个旧名重命名；新增 `StandardProcedure`、`LabSpecimen`、`TreatmentItem`、`VitalSignItem`、`PatientState`、`ClinicalEvent` |
| 实体卡片内容 | 属性/关系展示 | 关系标签更新 |
| 统计概览 | 顶部统计条 | 维度总数更新 |

**修改文件**: `instances.html`

---

### ⑧ 📐 图谱架构规范（数据字典） — `schema.html`

**访问地址**: `http://192.168.3.27:4001/schema.html`

| 模块 | 内部位置 | 改造内容 |
|---|---|---|
| 实体类型列表 | `ENTITY_TYPES` 数组 | 4个旧名重命名；移除 `DiseaseClassification`；新增 `StandardProcedure`、`LabSpecimen`、`TreatmentItem`、`VitalSignItem`、`PatientState`、`ClinicalEvent`、`MedicalTerm` |
| 关系类型映射 | `REL_DIM_MAP` | 5个旧关系名→新关系名 |
| 关系→目标实体映射 | `REL_ENTITY_MAP` | 同步更新 |
| CSS 实体类型徽章 | `.si-entity-type-badge` | CSS 类名更新 |
| 实体详情面板 | `siLoadEntity()` | 关系标签更新 |
| 实体搜索 | `siLoadSearchResults()` | 实体类型标签更新 |
| 新建实体弹窗 | `siOpenCreate()` | 类型下拉选项更新 |
| 疾病大类下拉 | `initDiseaseSelect()` | 无需改 |

**修改文件**: `schema.html`

---

### ⑨ 📘 图谱架构规范（标准文档） — `standard.html`

**访问地址**: `http://192.168.3.27:4001/standard.html`

| 模块 | 内部位置 | 改造内容 |
|---|---|---|
| 实体类型表 | §3（37种实体列表） | 4个旧名→新名；移除 `DiseaseClassification`；新增 V2.0 实体类型 |
| 关系类型表 | §4（43种关系列表） | 5个旧关系→新关系 |
| 禁用关系清单 | §6 | 新增 V2.0 禁用项 |
| 硬闸门 | §7 | 第4条保持不变 |
| V1.x→V2.0 兼容迁移表 | §9 | 按最新 Schema 标准更新 |

**修改文件**: `standard.html`

---

### ⑩ 📋 指南库 — `guideline.html`

**访问地址**: `http://192.168.3.27:4001/guideline.html`

**结论: 无需修改**

---

### ⑪ 🧬 医学术语库 — `terminology.html`

**访问地址**: `http://192.168.3.27:4001/terminology.html`

| 模块 | 内部位置 | 改造内容 |
|---|---|---|
| 维度导航 | 左侧维度列表 | 4个旧名→新名；移除 `DiseaseClassification` |
| 维度描述文本 | `DIM_DESC` 对象 | 检查→检查项目、检验→检验项目、检查指标→检查发现、检验指标→检验细项 |
| 术语卡片 | 中间网格 | 依赖 DIM_NAMES 自动更新 |
| 术语详情面板 | 右侧 | 维度名更新 |

**修改文件**: `terminology.html`

---

### ⑫ 🔍 临床诊断模拟 — `diagnosis.html`

**访问地址**: `http://192.168.3.27:4001/diagnosis.html`

| 模块 | 内部位置 | 改造内容 |
|---|---|---|
| 匹配引擎 | `matchDisease()` | 维度名：`LabTest→LabItem`、`Exam→ExamItem`、`ExamIndicator→ExamObservation` |
| 图谱查询示例 | `showGraphQuery()` | `requires_exam→requires_exam_item`、`requires_lab_test→requires_lab_item` |
| 候选疾病卡片 | `renderCandidates()` | 维度标签更新 |
| 疾病详情面板 | 右侧 | 维度卡片实体类型名更新 |
| 架构说明折叠面板 | 顶部 | 实体/关系类型示例更新 |

**修改文件**: `diagnosis.html`

---

### ⑬ 🩺 专科辅助诊疗原型 — `specialty-cdss-prototype.html`

**访问地址**: `http://192.168.3.27:4001/specialty-cdss-prototype.html`（新窗口打开）

| 模块 | 内部位置 | 改造内容 |
|---|---|---|
| 推荐卡片标签 | `renderRecommendation()` | `Exam→ExamItem`、`LabTest→LabItem`；移除 `DiseaseClassification` |
| 病史采集模块 | 辅助检查区域 | 检查/检验类型标签更新 |

**修改文件**: `specialty-cdss-prototype.html`

---

### ⑭ ⚙ 系统设置 — `config.html`

**访问地址**: `http://192.168.3.27:4001/config.html`

**结论: 无需修改**

---

## 四、共享模块改造

### 4.1 `_shared/js/app.js`

| 变量 | 改造内容 |
|---|---|
| `DIM_NAMES` | `Exam→ExamItem`、`LabTest→LabItem`、`ExamIndicator→ExamObservation`、`LabTestIndicator→LabSubitem`；移除 `DiseaseClassification`；新增 `StandardProcedure`、`LabSpecimen`、`TreatmentItem` |
| `DIM_COLORS` | 同步 key 名更新 |
| `CORE_DIM_KEYS` | 同步更新 |

### 4.2 `_shared/css/style.css`

| 位置 | 改造内容 |
|---|---|
| 实体类型 CSS 类 | 如有硬编码 `.Exam`、`.LabTest` 类名，改为 `.ExamItem`、`.LabItem` |

---

## 五、后端 `server.py` 改造

| 位置 | 改造内容 |
|---|---|
| `REL_MAP` | key 从旧名改为新名（`Exam→ExamItem` 等），**但 Cypher 查询使用兼容映射**同时匹配新旧关系名 |
| `TWO_HOP_DIMS` | key 从旧名改为新名（`ExamIndicator→ExamObservation` 等），via 关系使用兼容映射 |
| `ENTITY_NAMES` | 实体类型中文名映射：`ExamItem`/`LabItem`/`ExamObservation`/`LabSubitem` |
| `RELATION_LABELS` | 关系类型中文名映射更新 |
| `query_disease_full()` | Cypher 查询使用 `WHERE type(r) IN ['requires_exam','requires_exam_item']` 兼容 |
| `query_diseases_summary()` | 同上兼容 |
| `/api/kg/schema-info` | 实体类型列表包含 V2.0 新名（数量可能为0） |

---

## 六、执行顺序

| 阶段 | 内容 | 涉及文件 | 预估工时 |
|---|---|---|---|
| **Phase 0** | 后端兼容映射 + REL_MAP + TWO_HOP_DIMS + Cypher 兼容 + 中文名映射 | `server.py` | 1h |
| **Phase 1** | 共享 DIM_NAMES + DIM_COLORS + CORE_DIM_KEYS | `_shared/js/app.js` | 15min |
| **Phase 2** | 页面改造（按依赖顺序）| 见下表 | 3h |
| **Phase 3** | 部署 + 全页面浏览器验证 | deploy.py | 30min |

### Phase 2 细分（按改造量排序）

| 顺序 | 菜单名 | 文件 | 改造量 | 说明 |
|---|---|---|---|---|
| 2.1 | 📐 图谱架构规范 | `schema.html` | **大** | ENTITY_TYPES(37→44)+REL_DIM_MAP(41→46)+CSS+渲染函数 |
| 2.2 | 📘 Schema标准 | `standard.html` | **大** | 实体/关系表+禁用清单+迁移表 |
| 2.3 | ✅ 临床审核 | `review.html` | **大** | 6个Tab的DIM_LABELS+实体/关系标签 |
| 2.4 | 🔍 临床诊断模拟 | `diagnosis.html` | **中** | 匹配引擎+图谱查询示例+候选卡片 |
| 2.5 | 🧭 图谱探索 | `explore.html` | **中** | 知识总览分组(groups数组)+侧边栏标签 |
| 2.6 | 📐 图谱实例检索 | `instances.html` | **中** | SCHEMA_ORDER(32→38)+SCHEMA_NAMES+下拉构建 |
| 2.7 | 🧬 医学术语库 | `terminology.html` | **小** | DIM_DESC+维度导航 |
| 2.8 | 🫀 疾病详情浏览 | `disease.html` | **小** | 维度卡片+关系标签 |
| 2.9 | 🕸️ 网络探索 | `network.html` | **小** | 维度过滤器+节点颜色映射 |
| 2.10 | 📊 数据总览 | `index.html` | **小** | 雷达图/柱状图维度列表 |
| 2.11 | 🩺 专科辅助诊疗 | `specialty-cdss-prototype.html` | **小** | 推荐卡片标签映射 |

---

## 七、无需修改的页面

| 菜单名 | 文件 | 原因 |
|---|---|---|
| 🔬 专病诊疗框架覆盖分析 | `heatmap.html` | 已使用 V2.0 CDSS 决策层 API |
| 📋 指南库 | `guideline.html` | 只使用 Guideline 实体 |
| ⚙ 系统设置 | `config.html` | 无实体/关系引用 |
| （已废弃） | `engine.html` | 已从导航移除 |

---

## 八、兼容策略

### 8.1 后端查询兼容（数据库未迁移）

所有 Cypher 查询必须同时匹配新旧实体类型和关系名：

```cypher
-- 查询疾病关联的检查项目（兼容新旧实体类型）
MATCH (d:Disease {code: $code})-[r]->(n)
WHERE type(r) IN ['requires_exam', 'requires_exam_item']
  AND n.entityType IN ['Exam', 'ExamItem']
  AND (n.status IS NULL OR n.status <> 'deprecated')
RETURN n.code, n.name
```

### 8.2 前端显示统一

前端全部展示 V2.0 新名（检查项目、检验项目、检查发现、检验细项），即使底层数据仍使用旧实体类型。

### 8.3 数据库迁移后

当 Codex 完成 Exam→ExamItem、LabTest→LabItem、ExamIndicator→ExamObservation 的数据迁移后：
- 删除 `ENTITY_COMPAT` 和 `REL_COMPAT` 兼容映射
- Cypher 查询简化为只查新名
- 前端无需改动

---

## 九、验收标准

| 检查项 | 通过标准 |
|---|---|
| 导航栏 | 11个菜单项全部正常访问 |
| 疾病层级树 | 13个大类、132个疾病、V2.0 三层结构 |
| 维度覆盖 | 所有页面显示 V2.0 新名（ExamItem/LabItem/ExamObservation/LabSubitem） |
| 关系标签 | 所有页面显示 V2.0 新关系名（requires_exam_item 等） |
| 数据兼容 | 后端查询同时返回 Exam(105) 和 ExamItem(0) 数据，前端统一显示为"检查项目" |
| 诊断模拟 | 匹配引擎正常工作，返回候选疾病 |
| 网络探索 | 力导向图正常渲染，节点颜色正确 |
| 图谱架构规范 | ENTITY_TYPES 包含 V2.0 实体类型（44种） |
| CDSS 覆盖分析 | 热力图/覆盖表正常展示 |
