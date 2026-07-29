# 统计口径说明

本文档说明心血管专科知识图谱 Web 平台中各项统计指标的定义、计算方式和对齐标准。

---

## 核心指标定义

### 1. 疾病大类（12）

从 Disease 节点的 `parentCode` 属性解析出的二级分类。

| 大类 | 代码前缀 | 疾病数 |
|------|----------|--------|
| 冠心病 | CAD | 按数据变动 |
| 心律失常 | ARR | 按数据变动 |
| 心力衰竭 | HF | 按数据变动 |
| 心肌病 | CM | 按数据变动 |
| 瓣膜性心脏病 | VHD | 按数据变动 |
| 心包疾病 | PERICARD | 按数据变动 |
| 高血压 | HTN | 按数据变动 |
| 先天性心脏病 | CHD | 按数据变动 |
| 感染性心内膜炎 | IE | 按数据变动 |
| 心脏骤停/猝死 | SCD | 按数据变动 |
| 主动脉/外周血管 | AORTA/PAD | 按数据变动 |
| 心脏神经症 | NEUROSIS | 按数据变动 |

**计算方式**：`MATCH (d:Disease) RETURN DISTINCT d.parentCode` → 解析前缀去重

---

### 2. 专病（92）

Disease 节点的总数，每种具体疾病（如"急性心肌梗死"、"房颤"）为一个专病。

**计算方式**：`MATCH (d:Disease) RETURN count(d)`

---

### 3. 可视化实体（1,145）

**定义**：排除 Evidence 类型后的唯一临床实体（KGNode 节点）。

**为什么不包含 Evidence？**
- Evidence 节点有 33,147 个，占全库节点总量的 96%
- Evidence 是按诊疗指南/教材的章节、页码拆分的循证依据片段，不是临床实体
- 如果计入，会严重稀释临床实体的可见性，让医生无法快速定位有用信息

**计算方式**：
```cypher
MATCH (n:KGNode)
WHERE n.entityType <> 'Evidence'
RETURN count(n)
-- 结果：1,145
```

**前端调用**：`/api/kg/stats` → `visual_entity_count` 字段

---

### 4. 全库节点（34,292）

**定义**：Neo4j 中所有节点的总数，包含所有标签（Disease、KGNode、Guideline）。

**计算方式**：`MATCH (n) RETURN count(n)`

**组成**：
| 标签 | 数量 |
|------|------|
| Disease | 92 |
| KGNode（含 Evidence） | 33,147 + 1,145 = 34,292 |
| 其中 Evidence | 33,147 |

---

### 5. 关系（99,269）

**定义**：Neo4j 中所有关系的总数，**不排除任何关系类型**。

**为什么不排除 `belongs_to_*` 关系？**
- 旧版代码排除了 4 种结构关系（`belongs_to_category`、`belongs_to_subcategory`、`has_category`、`has_subcategory`），少统计了 260 条
- Codex 验收标准要求统计全部关系

**计算方式**：`MATCH ()-[r]->() RETURN count(r)`

**关系类型分布**（Top 5）：
| 关系类型 | 数量 | 说明 |
|----------|------|------|
| supported_by_evidence | ~86,000 | 实体→Evidence |
| guideline_has_evidence | ~7,000 | 指南→Evidence |
| has_symptom | 按数据 | 疾病→症状 |
| treated_by_medication | 按数据 | 疾病→药物 |
| requires_exam | 按数据 | 疾病→检查 |

---

## 历史口径差异说明

| 指标 | 旧口径（v1.2.0 前） | 新口径（v1.3.0+） | 差异原因 |
|------|---------------------|-------------------|----------|
| 实体 | 8,273 | 1,145 | 旧版按疾病累加计数（同一实体被多个疾病引用时重复计算），新版按唯一 code 去重 |
| 关系 | 99,009 | 99,269 | 旧版排除了 4 种 `belongs_to_*` 关系（-260），新版不排除 |

---

## API 返回示例

`GET /api/kg/stats`

```json
{
  "disease_category_count": 12,
  "disease_count": 92,
  "visual_entity_count": 1145,
  "kg_node_count": 34292,
  "evidence_count": 33147,
  "total_relationships": 99269,
  "total_nodes": 34292,
  "shell_entity_count": 0
}
```

| 字段 | 说明 |
|------|------|
| `disease_category_count` | 疾病大类数 |
| `disease_count` | 专病数 |
| `visual_entity_count` | 可视化实体数（排除 Evidence） |
| `kg_node_count` | 全库节点数 |
| `evidence_count` | Evidence 节点数 |
| `total_relationships` | 全库关系数 |
| `total_nodes` | 兼容旧字段，等于 kg_node_count |
| `shell_entity_count` | 空壳实体数（已归零） |
