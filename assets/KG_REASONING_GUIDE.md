# 临床辅助诊疗知识图谱推理逻辑说明

> 版本：v1.0 | 日期：2026-07-06 | 样板病种：急性心肌梗死（AMI）

---

## 一、知识图谱Schema结构

### 1.1 实体类型（Node Labels + EntityType）

Neo4j中实体分两大标签，KGNode通过 `entityType` 属性区分17+2个维度：

| 标签 | entityType | 中文名 | 说明 | AMI示例实体 |
|------|-----------|--------|------|-----------|
| **Disease** | — | 疾病 | 专病节点 | 急性心肌梗死、STEMI、NSTEMI |
| **KGNode** | **Symptom** | **症状** | 患者主观感受 | 胸痛、胸闷、出汗、恶心、呼吸困难、心悸、晕厥 |
| **KGNode** | **Sign** | **体征** | 查体客观发现 | 心动过速、低血压、肺部湿啰音、颈静脉怒张、心脏杂音 |
| **KGNode** | **Exam** | **检查** | 影像/功能检查 | 心电图、ST段抬高、超声心动图、冠脉造影、冠脉CTA |
| **KGNode** | **LabTest** | **检验** | 实验室检验 | 肌钙蛋白、CK-MB、BNP、D-二聚体、血常规、血脂 |
| **KGNode** | **Medication** | **药物** | 治疗药物 | 阿司匹林、氯吡格雷、他汀、β受体阻滞剂、ACEI |
| **KGNode** | **Procedure** | **手术/操作** | 介入或外科操作 | PCI、CABG、射频消融、起搏器植入 |
| **KGNode** | **RiskFactor** | **危险因素** | 发病危险因素 | 高血压、糖尿病、高脂血症、吸烟、家族史 |
| **KGNode** | **Complication** | **并发症** | 疾病并发症 | 心力衰竭、心律失常、心源性休克、出血 |
| **KGNode** | **DifferentialDiagnosis** | **鉴别诊断** | 需排除疾病 | 主动脉夹层、肺栓塞、急性心包炎、气胸 |
| **KGNode** | **RiskStratification** | **风险分层** | 风险等级 | 低危、中危、高危、极高危 |
| **KGNode** | **TreatmentPlan** | **治疗方案** | 治疗策略 | 急诊PCI、溶栓治疗、药物保守、二级预防 |
| **KGNode** | **DiagnosisCriteria** | **诊断标准** | 诊断依据 | 诊断依据、确诊标准 |
| **KGNode** | **Etiology** | **病因** | 发病原因 | 动脉粥样硬化、斑块破裂 |
| **KGNode** | **Epidemiology** | **流行病学** | 发病分布 | 发病率、死亡率 |
| **KGNode** | **Pathophysiology** | **病理生理** | 发病机制 | 心肌缺血、心肌坏死、心室重构 |
| **KGNode** | **Prognosis** | **预后** | 预后判断 | 预后良好、预后不良 |
| **KGNode** | **FollowUp** | **随访** | 随访要求 | 定期随访、1个月复查、3个月复查 |
| **KGNode** | **Guideline** | **指南** | 诊疗指南 | ESC STEMI 2017、ACC/AHA 2013 |
| **KGNode** | **Evidence** | **证据** | 循证依据 | RCT、Meta分析、专家共识 |
| **KGNode** | **ThresholdRule** | **阈值规则** | 检查指标阈值（二跳） | 肌钙蛋白>0.04ng/mL、ST抬高≥0.1mV |
| **KGNode** | **ExamIndicator** | **检查指标** | 检查指标名（二跳） | LVEF、E/A比值、肺动脉压力 |

### 1.2 关系类型（Relationships）

| 关系类型 | 含义 | 指向实体类型 | AMI示例 |
|---------|------|------------|---------|
| has_symptom | 疾病→症状 | KGNode(Symptom) | AMI→胸痛、出汗、恶心 |
| has_sign | 疾病→体征 | KGNode(Sign) | AMI→心脏杂音、颈静脉怒张 |
| requires_exam | 疾病→检查 | KGNode(Exam) | AMI→心电图、冠脉造影 |
| requires_lab_test | 疾病→检验 | KGNode(LabTest) | AMI→肌钙蛋白、CK-MB |
| treated_by_medication | 疾病→药物 | KGNode(Medication) | AMI→阿司匹林、氯吡格雷 |
| treated_by_procedure | 疾病→手术 | KGNode(Procedure) | AMI→PCI、CABG |
| has_risk_factor | 疾病→危险因素 | KGNode(RiskFactor) | AMI→高血压、糖尿病、吸烟 |
| may_cause_complication | 疾病→并发症 | KGNode(Complication) | AMI→心力衰竭、心律失常 |
| differentiates_from | 疾病→鉴别诊断 | KGNode(DifferentialDiagnosis) | AMI→主动脉夹层、肺栓塞 |
| has_risk_stratification | 疾病→风险分层 | KGNode(RiskStratification) | AMI→低危、中危、高危 |
| has_treatment_plan | 疾病→治疗方案 | KGNode(TreatmentPlan) | AMI→PCI、溶栓、药物保守 |
| has_diagnostic_criteria | 疾病→诊断标准 | KGNode(DiagnosisCriteria) | AMI→诊断依据 |
| based_on_guideline | 疾病→指南 | KGNode(Guideline) | AMI→ESC 2017、ACC/AHA 2013 |
| has_etiology | 疾病→病因 | KGNode(Etiology) | AMI→动脉粥样硬化 |
| has_epidemiology | 疾病→流行病学 | KGNode(Epidemiology) | AMI→发病率、死亡率 |
| has_pathophysiology | 疾病→病理生理 | KGNode(Pathophysiology) | AMI→心肌缺血、斑块破裂 |
| has_prognosis | 疾病→预后 | KGNode(Prognosis) | AMI→预后良好/不良 |
| has_follow_up | 疾病→随访 | KGNode(FollowUp) | AMI→定期随访、复查 |
| supported_by_evidence | 疾病→证据 | KGNode(Evidence) | AMI→循证依据 |

### 1.3 二跳关系（Two-Hop）

| 二跳维度 | 路径 | 说明 |
|---------|------|------|
| ThresholdRule | Disease→[requires_exam]→Exam→[has_threshold_rule]→ThresholdRule | 检查指标阈值 |
| ExamIndicator | Disease→[requires_exam]→Exam→[exam_has_indicator]→ExamIndicator | 检查指标名 |

---

## 二、患者案例数据

### 案例：65岁男性急性胸痛

```
{
  "chief_complaint": "胸痛2小时，向左肩放射，伴出汗、恶心",
  "ecg_result": "ST段抬高",
  "troponin": "cTnI升高",
  "ckmb": "CK-MB升高",
  "age": 65,
  "heart_rate": 90,
  "bp_systolic": 130,
  "killip": "I"
}
```

---

## 三、推理全流程（9步）

### 第1步：主诉语义解析 → 生成症状关键词

**输入**：`"胸痛2小时，向左肩放射，伴出汗、恶心"`

**解析逻辑**：从自由文本中提取医学关键词，映射到图谱中的 `Symptom` 实体。

```
输入文本 → 关键词提取 → 图谱实体映射
──────────────────────────────────────
"胸痛"     → 胸痛、胸闷
"向左肩放射" → 放射痛
"出汗"     → 出汗
"恶心"     → 恶心呕吐
```

**利用的图谱Schema**：
- 实体类型：`KGNode`，属性 `entityType: "Symptom"`
- 匹配属性：`n.name`（实体名称）

**Cypher查询**：
```cypher
MATCH (d:Disease)-[:has_symptom]->(n:KGNode {entityType: 'Symptom'})
WHERE n.name IN ['胸痛', '胸闷', '放射痛', '出汗', '恶心呕吐']
RETURN DISTINCT d.code AS code, d.name AS name, collect(DISTINCT n.name) AS matched
```

**查询结果**（Top5）：

| 疾病code | 疾病名称 | 命中症状 |
|---------|---------|---------|
| DIS-CARD-CAD-AMI | 急性心肌梗死 | 胸痛、出汗、恶心呕吐、放射痛 |
| DIS-CARD-CAD-ACS | 急性冠脉综合征 | 胸痛、出汗 |
| DIS-CARD-ARR-VT | 室性心动过速 | 胸痛 |
| DIS-CARD-HF-AHF | 急性心力衰竭 | 胸闷 |
| DIS-CARD-CAD-UA | 不稳定型心绞痛 | 胸痛、放射痛 |

---

### 第2步：体征提取 → 生命体征和查体映射

**输入**：`heart_rate=90`、`bp_systolic=130`、`killip="I"`

**解析逻辑**：从生命体征和Killip分级中提取体征，映射到图谱中的 `Sign` 实体。

```
输入数据 → 阈值判断 → 图谱实体映射
──────────────────────────────────────
HR=90      → 正常范围（60-100），不触发
BP=130     → 正常偏高，不触发
Killip=I   → 无心衰征象，不触发体征

若 HR=120   → 心动过速
若 BP=85    → 低血压
若 Killip=III → 肺部湿啰音、颈静脉怒张、心脏杂音、心音低钝
若 Killip=IV  → 面色苍白、四肢厥冷（心源性休克）
```

**利用的图谱Schema**：
- 实体类型：`KGNode`，属性 `entityType: "Sign"`
- 关系：`Disease→[:has_sign]→KGNode`
- 匹配属性：`n.name`（体征名称）

**Cypher查询**：
```cypher
MATCH (d:Disease)-[:has_sign]->(n:KGNode {entityType: 'Sign'})
WHERE n.name IN ['心动过速', '低血压', '肺部湿啰音', ...]
RETURN DISTINCT d.code AS code, d.name AS name, collect(DISTINCT n.name) AS matched
```

**本例结果**：Killip=I，HR=90，BP=130 → 无异常体征命中，signs_input为空，跳过查询。

**若Killip=III时的查询结果**：

| 疾病code | 疾病名称 | 命中体征 |
|---------|---------|---------|
| DIS-CARD-CAD-AMI | 急性心肌梗死 | 肺部湿啰音、颈静脉怒张 |
| DIS-CARD-HF-AHF | 急性心力衰竭 | 肺部湿啰音、颈静脉怒张、心脏杂音 |

---

### 第3步：ECG结果解析 → 生成检查关键词

**输入**：`"ST段抬高"`

**解析逻辑**：将ECG结果映射到图谱中的 `Exam` 实体。

```
ECG结果 → 关键词提取 → 图谱实体映射
──────────────────────────────────────
"ST段抬高" → ST段抬高、心电图异常
```

**利用的图谱Schema**：
- 实体类型：`KGNode`，属性 `entityType: "Exam"`
- 匹配属性：`n.name`（实体名称）

**Cypher查询**：
```cypher
MATCH (d:Disease)-[:requires_exam]->(n:KGNode {entityType: 'Exam'})
WHERE n.name IN ['ST段抬高', '心电图异常']
RETURN DISTINCT d.code AS code, d.name AS name, collect(DISTINCT n.name) AS matched
```

**查询结果**（Top3）：

| 疾病code | 疾病名称 | 命中检查 |
|---------|---------|---------|
| DIS-CARD-CAD-AMI | 急性心肌梗死 | ST段抬高 |
| DIS-CARD-CAD-ACS | 急性冠脉综合征 | ST段抬高 |
| DIS-CARD-CAD-UA | 不稳定型心绞痛 | ST段抬高 |

---

### 第4步：检验结果解析 → 生成检验关键词

**输入**：`"cTnI升高"` + `"CK-MB升高"`

**解析逻辑**：将检验结果映射到图谱中的 `LabTest` 实体。

```
检验结果 → 关键词提取 → 图谱实体映射
──────────────────────────────────────
"cTnI升高" → 肌钙蛋白升高、心肌标志物升高
"CK-MB升高" → CK-MB升高
```

**利用的图谱Schema**：
- 实体类型：`KGNode`，属性 `entityType: "LabTest"`
- 匹配属性：`n.name`（实体名称）

**Cypher查询**：
```cypher
MATCH (d:Disease)-[:requires_lab_test]->(n:KGNode {entityType: 'LabTest'})
WHERE n.name IN ['肌钙蛋白升高', '心肌标志物升高', 'CK-MB升高']
RETURN DISTINCT d.code AS code, d.name AS name, collect(DISTINCT n.name) AS matched
```

**查询结果**（Top3）：

| 疾病code | 疾病名称 | 命中检验 |
|---------|---------|---------|
| DIS-CARD-CAD-AMI | 急性心肌梗死 | 肌钙蛋白升高、CK-MB升高 |
| DIS-CARD-CAD-ACS | 急性冠脉综合征 | 肌钙蛋白升高 |
| DIS-CARD-HF-AHF | 急性心力衰竭 | 心肌标志物升高 |

---

### 第5步：多维度聚合 → 置信度计算

**逻辑**：将前四步的查询结果按疾病code聚合，计算综合置信度。

```
聚合规则（四维度：症状+体征+检查+检验）：
  置信度 = min(0.55 + 命中实体数×0.08, 0.98) + 命中维度数×0.05
```

**聚合结果**：

| 疾病 | 症状 | 体征 | 检查 | 检验 | 总命中 | 维度数 | 置信度 |
|------|------|------|------|------|--------|--------|--------|
| **急性心肌梗死** | 4 | 0 | 1 | 2 | **7** | **3** | **0.98** |
| 急性冠脉综合征 | 2 | 0 | 1 | 1 | 4 | 3 | 0.92 |
| 不稳定型心绞痛 | 2 | 0 | 1 | 0 | 3 | 2 | 0.84 |
| 急性心力衰竭 | 1 | 0 | 0 | 1 | 2 | 2 | 0.81 |

**利用的图谱Schema**：
- 四轮查询分别命中 `has_symptom`、`has_sign`、`requires_exam`、`requires_lab_test` 四种关系
- 同一疾病在多个维度命中 → 置信度叠加

---

### 第6步：强信号检测 → AMI置信度提升

**逻辑**：当三个强信号同时出现（胸痛 + ST抬高 + 肌钙蛋白阳性），强制将AMI提升到Top1。

```
强信号条件：
  ✅ 主诉含"胸"/"痛" → 存在缺血症状
  ✅ ECG含"ST段抬高" → 心电图异常
  ✅ 肌钙蛋白含"升高" → 心肌损伤标志物

→ 强信号触发，AMI置信度提升至 0.98
```

**利用的图谱Schema**：
- `Disease→[:has_symptom]→KGNode{entityType:'Symptom'}` → 胸痛
- `Disease→[:requires_exam]→KGNode{entityType:'Exam'}` → ST段抬高
- `Disease→[:requires_lab_test]→KGNode{entityType:'LabTest'}` → 肌钙蛋白升高

---

### 第7步：分型判断 → STEMI/NSTEMI

**逻辑**：根据ECG和检验结果，判断AMI亚型。

```
分型规则：
  STEMI = ST段抬高 或 新发LBBB + 肌钙蛋白升高
  NSTEMI = 无ST段抬高 + 肌钙蛋白动态变化

本例：
  ECG = "ST段抬高" ✅
  troponin = "cTnI升高" ✅
  → 分型 = STEMI
```

**利用的图谱Schema**：
- `Disease` 节点属性：`d.parentCode`（父分类，AMI属于SUB-CARD-CAD-ACS）
- AMI知识包中的 `subtypes.STEMI.criteria`

---

### 第8步：风险评分计算 → GRACE/TIMI/Killip

**逻辑**：从患者数据中提取评分字段，计算GRACE、TIMI、Killip评分。

#### GRACE评分

| 评分字段 | 患者数据 | 分值 |
|---------|---------|------|
| 年龄 | 65岁 | 55 |
| 心率 | 90次/分 | 24 |
| 收缩压 | 130mmHg | 24 |
| Killip分级 | I级 | 0 |
| 肌钙蛋白升高 | 是 | 14 |
| ST段偏移 | 是 | 28 |
| 心脏骤停 | 否 | 0 |
| 肌酐 | 未填 | 0 |
| **总分** | | **164** |
| **风险等级** | | **高危（>140）** |

#### TIMI评分（NSTEMI/UA）

| 评分字段 | 患者数据 | 分值 |
|---------|---------|------|
| 年龄≥65 | 是 | 1 |
| ≥3个CAD危险因素 | 是 | 1 |
| 已知冠脉狭窄≥50% | 未填 | 0 |
| ST段偏移≥0.5mm | 是 | 1 |
| 24h内心绞痛≥2次 | 未填 | 0 |
| 近7天服用阿司匹林 | 未填 | 0 |
| 心肌标志物升高 | 是 | 1 |
| **总分** | | **3（中危）** |

#### Killip分级

| 分级 | 标准 | 本例 | 判断依据 |
|------|------|------|---------|
| I | 无心衰征象 | ✅ | killip="I"，无肺部啰音 |
| II | 轻-中度心衰 | | |
| III | 急性肺水肿 | | |
| IV | 心源性休克 | | |

**利用的图谱Schema**：
- `Disease→[:has_risk_stratification]→KGNode{entityType:'RiskStratification'}`
- AMI知识包中的 `risk_scales.GRACE.fields`、`risk_scales.TIMI.fields`、`risk_scales.Killip.levels`

---

### 第9步：治疗方案匹配 → 推荐PCI

**逻辑**：根据分型 + 风险评分 + 禁忌证，匹配最优治疗方案。

```
治疗方案匹配流程：

  分型 = STEMI
    → 候选方案：STEMI_emergency_pci、STEMI_thrombolysis
    → 优先级：PCI > 溶栓

  检查PCI禁忌证：
    ✅ 无活动性出血
    ✅ 无严重凝血障碍
    ✅ 无主动脉夹层
    ✅ 收缩压130mmHg，未达>200/120标准
    → PCI禁忌证检查通过

  最终推荐：STEMI急诊PCI（首选）
```

**利用的图谱Schema**：
- `Disease→[:treated_by_medication]→KGNode{entityType:'Medication'}` → 阿司匹林、氯吡格雷
- `Disease→[:treated_by_procedure]→KGNode{entityType:'Procedure'}` → PCI
- `Disease→[:has_treatment_plan]→KGNode{entityType:'TreatmentPlan'}` → 治疗方案
- AMI知识包中的 `treatment_plans.STEMI_emergency_pci`

---

## 四、推理链路全景图

```
患者输入数据                    知识图谱推理                    临床输出
──────────                    ────────────                    ────────

"胸痛2小时"  ──────────→  has_symptom → 胸痛/胸闷/放射痛  ──┐
"出汗、恶心" ──────────→  has_symptom → 出汗/恶心呕吐     ──┤
                                                            ├──→ 四维度聚合
HR=90,BP=130 ──────────→  has_sign → (正常，无命中)        ──┤     置信度计算
Killip=I     ──────────→  has_sign → (I级，无心衰体征)     ──┤
                                                            ├──→ 疾病排名
"ST段抬高"   ──────────→  requires_exam → ST段抬高         ──┤     #1 AMI 98%
                                                            │
"cTnI升高"   ──────────→  requires_lab_test → 肌钙蛋白升高 ──┤
"CK-MB升高"  ──────────→  requires_lab_test → CK-MB升高    ──┘
                                                            │
┌──────────────────────────────────────────────────────────┘
│
├──→ 分型判断（ST抬高+cTn阳性 → STEMI）
│
├──→ 风险评分
│    ├── GRACE: 164（高危）  ← age+HR+BP+Killip+cTn+ST
│    ├── TIMI: 3（中危）     ← age+ST+cTn
│    └── Killip: I           ← killip输入
│
├──→ 治疗方案匹配
│    └── treated_by_procedure → PCI（首选，无禁忌证）
│
├──→ 鉴别诊断
│    └── differentiates_from → 主动脉夹层/肺栓塞/心包炎/气胸
│
├──→ 推荐检查
│    └── requires_exam → D-二聚体、心超、CTA
│
├──→ 指南依据
│    └── based_on_guideline → ESC 2017、ACC/AHA 2013（27条）
│
└──→ 医嘱集（来自知识包）
     ├── 急诊首诊：心电图、cTn、CK-MB、血常规、凝血、血气、BNP、D-二聚体
     ├── STEMI即刻：阿司匹林300mg、氯吡格雷600mg、肝素、阿托伐他汀
     └── 出院带药：DAPT+他汀+β阻滞剂+ACEI，随访1/3/6/12月
```

---

## 五、每步利用的图谱Schema汇总

| 推理步骤 | 查询关系 | 实体类型 | 关键属性 | 输出 |
|---------|---------|---------|---------|------|
| 1. 症状提取 | `has_symptom` | KGNode (Symptom) | n.name | 命中疾病列表 |
| 2. 体征提取 | `has_sign` | KGNode (Sign) | n.name | 命中疾病列表 |
| 3. 检查提取 | `requires_exam` | KGNode (Exam) | n.name | 命中疾病列表 |
| 4. 检验提取 | `requires_lab_test` | KGNode (LabTest) | n.name | 命中疾病列表 |
| 5. 多维聚合 | 跨4种关系聚合 | Disease | d.code, d.name | 置信度排名 |
| 6. 强信号提升 | 3维度同时命中 | Disease+KGNode | — | AMI置顶 |
| 7. 分型判断 | Disease属性 | Disease | d.parentCode | STEMI/NSTEMI |
| 8. 风险评分 | 知识包字段 | — | 评分字段映射 | GRACE/TIMI/Killip |
| 9. 治疗匹配 | `treated_by_procedure` + `treated_by_medication` | KGNode (Procedure/Medication) | n.name | 推荐方案 |
| 鉴别诊断 | `differentiates_from` | KGNode (DifferentialDiagnosis) | n.name | 鉴别列表 |
| 指南依据 | `based_on_guideline` | KGNode (Guideline) | n.name | 指南列表 |
| 推荐检查 | `requires_exam` | KGNode (Exam) | n.name | 检查列表 |

---

## 六、知识图谱在不同阶段的角色变化

| 阶段 | 图谱作用 | 利用的关系 | 输出 |
|------|---------|-----------|------|
| 疾病推荐 | 从症状/检查/检验反向匹配疾病 | has_symptom, requires_exam, requires_lab_test | 候选疾病列表 |
| 鉴别诊断 | 从疾病节点获取鉴别方向 | differentiates_from | 鉴别疾病列表 |
| 分型分层 | 判断AMI亚型 | Disease.parentCode + 知识包subtypes | STEMI/NSTEMI |
| 风险评估 | 提供评分依据字段 | has_risk_stratification | GRACE/TIMI/Killip |
| 治疗推荐 | 从疾病获取治疗方案 | treated_by_procedure, treated_by_medication, has_treatment_plan | PCI/溶栓/药物 |
| 医嘱推荐 | 从治疗方案获取药物 | treated_by_medication | 医嘱集 |
| 指南追溯 | 从疾病获取指南依据 | based_on_guideline | 指南列表 |
| 路径中支撑 | 禁忌证、并发症、风险因子 | has_risk_factor, may_cause_complication | 风险预警 |
| 随访管理 | 复查计划、二级预防 | has_follow_up, has_prognosis | 随访计划 |
