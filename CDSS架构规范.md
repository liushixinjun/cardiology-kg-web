## CDSS架构规范（2026-07-12）

### 关系类型语义
| 关系 | Domain → Range | 业务含义 |
|------|---------------|---------|
| has_pathway_stage | ClinicalPathway → PathwayStage | 流程结构，阶段名不与治疗方案混用 |
| has_stage_rule | PathwayStage → ClinicalRule | 阶段触发条件，规则必须结构化 |
| recommends_action | ClinicalRule → Procedure/Medication | 正式推荐，满足规则后才展示 |
| blocks_action | ClinicalRule → Procedure/Medication | 禁忌阻断，存在禁忌时展示 |
| next_pathway_stage | PathwayStage → PathwayStage | 阶段流转，不能跨越必要判断阶段 |
| has_source_section | Guideline → SourceSection | 文献分章分节，需有页码或标题 |
| section_has_evidence | SourceSection → Evidence | 章节到原文证据，必须保留原文 |
| guideline_has_evidence | Guideline → Evidence | 文献直接到证据，用于全局追溯 |
| supported_by_evidence | 临床节点 → Evidence | 疾病/症状/检查/治疗/规则等均可有证据 |
| based_on_guideline | RecommendationStatement → Guideline | 推荐来自哪份资料 |
| derived_from | RecommendationStatement → Evidence | 推荐对应原文，医生端只展示推荐直连证据 |

### CDSS硬规则
- has_recommended_action = "菜单"（阶段可能涉及的动作），recommends_action = "医嘱建议"（正式推荐）
- 医生推荐卡片只能用 recommends_action / blocks_action，不能用 has_recommended_action
- CDSS推荐卡片只展示当前RecommendationStatement直连的主证据（derived_from），不展示疾病下所有Evidence
- Evidence是从资料切出的可追溯原文片段，一份指南会产生很多Evidence是正常的
