/* === Schema V3.2 公共展示映射层 ===
 * 所有页面的字段中文名、关系中文标签、诊断角色、字典/医嘱/审核状态推导统一走本文件。
 * 禁止在页面里写裸值比较（如 role==='broad_diagnosis'），必须调用 SCHEMA.roleGroup()。
 */
var SCHEMA = (function () {
  'use strict';

  /* ---- 诊断角色：新旧值六值 → 三档（Schema V3.0 新值 + V2.x 旧值双兼容） ---- */
  var ROLE_GROUPS = {
    broad_diagnosis: 'broad',      // 旧值：疑似/宽泛诊断
    suspected_parent: 'broad',     // V3.0 新值
    clinical_subtype: 'subtype',   // 旧值：具体分型
    specific_subtype: 'subtype',   // V3.0 新值
    independent_disease: 'independent', // 旧值：独立诊断
    standalone_diagnosis: 'independent' // V3.0 新值
  };
  var ROLE_LABELS = { broad: '疑似诊断', subtype: '具体分型', independent: '独立诊断' };
  var ROLE_CLASSES = { broad: 'broad', subtype: 'subtype', independent: 'independent' };
  var ROLE_LONG_LABELS = {
    broad: '疑似/宽泛诊断', subtype: '具体分型', independent: '独立诊断'
  };

  function roleGroup(role) { return ROLE_GROUPS[role] || ''; }
  function roleLabel(role) { return ROLE_LABELS[roleGroup(role)] || ''; }
  function roleClass(role) { return ROLE_CLASSES[roleGroup(role)] || ''; }
  function roleLongLabel(role) { return ROLE_LONG_LABELS[roleGroup(role)] || '未标注'; }
  function roleBadge(role) {
    var g = roleGroup(role);
    if (!g) return '';
    return '<span class="dx-role-badge ' + ROLE_CLASSES[g] + '">' + ROLE_LABELS[g] + '</span>';
  }
  /* 判定函数：替代页面里的裸值比较 */
  function isBroad(role) { return roleGroup(role) === 'broad'; }
  function isSubtype(role) { return roleGroup(role) === 'subtype'; }
  function isIndependent(role) { return roleGroup(role) === 'independent'; }
  /* 顶层疾病 = 疑似诊断组 或 独立诊断组（疾病树收集用） */
  function isTopDisease(role) { var g = roleGroup(role); return g === 'broad' || g === 'independent'; }

  /* ---- 关系类型中文映射（对齐 server.py REL_MAP / MULTI_HOP_DIMS / V3.1 新关系 / 推荐链） ---- */
  var RELATION_LABELS = {
    /* 疾病知识维度关系 */
    has_symptom: '有症状', has_sign: '有体征', has_risk_factor: '有危险因素',
    may_cause_complication: '可能有并发症', has_differential_diagnosis: '需鉴别诊断',
    has_risk_stratification: '有风险分层', has_prognosis: '有预后', has_follow_up: '有随访',
    has_treatment_plan: '有治疗方案', has_diagnostic_criteria: '有诊断标准',
    has_etiology: '有病因', has_epidemiology: '有流行病学', has_pathophysiology: '有病理生理',
    has_prevention: '有预防措施', has_definition: '有定义',
    supported_by_evidence: '有证据支撑', based_on_guideline: '依据指南',
    /* 检查检验（ExamPlan 中转） */
    has_exam_plan: '有检查方案', includes_exam_item: '含检查项目', includes_lab_item: '含检验项目',
    exam_item_has_observation: '检查可见', lab_item_has_subitem: '检验含细项', has_threshold_rule: '有阈值规则',
    /* 治疗（TreatmentPlan 中转） */
    includes_medication: '含药物', includes_procedure: '含手术操作', includes_treatment_item: '含治疗项目',
    has_specific_medication: '含具体药品',
    /* 结构与字典 */
    has_clinical_subtype: '有临床分型', has_category: '属疾病大类', has_subcategory: '属疾病亚类',
    belongs_to_category: '属疾病大类', belongs_to_subcategory: '属疾病亚类',
    maps_to_standard_diagnosis: '映射标准诊断', maps_to_standard_procedure: '映射标准手术',
    has_definition_component: '含定义明细', has_diagnostic_component: '含诊断明细',
    has_differential_rule: '有鉴别规则',
    /* 推荐链（Schema V3.0/V3.1） */
    has_recommendation_statement: '有推荐陈述', triggers_recommendation: '触发推荐',
    recommends_action: '推荐动作', recommends_medication: '推荐药物', recommends_procedure: '推荐手术',
    recommends_exam_item: '推荐检查', recommends_lab_item: '推荐检验',
    has_recommended_action: '关联可选动作', blocks_action: '阻断动作',
    has_contraindication: '有禁忌', has_alternative_action: '有替代动作',
    derived_from: '来源证据', uses_primary_guideline: '主依据指南',
    /* 鉴别与治疗安全（V3.1 新关系） */
    requires_exclusion_exam: '需排除检查', requires_exclusion_lab: '需排除检验',
    targets_differential_diagnosis: '指向鉴别诊断', blocked_by_differential: '被鉴别阻断',
    requires_pre_treatment_exam: '治疗前需检查', requires_pre_treatment_lab: '治疗前需检验',
    /* 路径 */
    has_clinical_pathway: '有临床路径', has_pathway_stage: '有路径阶段',
    has_stage_rule: '阶段含规则', next_pathway_stage: '下一阶段'
  };

  function relationLabel(relType) { return RELATION_LABELS[relType] || relType || ''; }

  /* ---- 维度 → 关系编码映射（与 server.py 查询口径一致，连线标签用） ---- */
  var DIM_REL = {
    Symptom: 'has_symptom', Sign: 'has_sign', RiskFactor: 'has_risk_factor',
    Complication: 'may_cause_complication', DifferentialDiagnosis: 'has_differential_diagnosis',
    RiskStratification: 'has_risk_stratification', Prognosis: 'has_prognosis',
    FollowUp: 'has_follow_up', TreatmentPlan: 'has_treatment_plan',
    DiagnosisCriteria: 'has_diagnostic_criteria', Etiology: 'has_etiology',
    Epidemiology: 'has_epidemiology', Pathophysiology: 'has_pathophysiology',
    Prevention: 'has_prevention', Definition: 'has_definition',
    Evidence: 'supported_by_evidence', Guideline: 'based_on_guideline',
    ExamItem: 'includes_exam_item', LabItem: 'includes_lab_item',
    Medication: 'includes_medication', Procedure: 'includes_procedure',
    ExamObservation: 'exam_item_has_observation', LabSubitem: 'lab_item_has_subitem',
    ThresholdRule: 'has_threshold_rule', StandardDiagnosis: 'maps_to_standard_diagnosis',
    Contraindication: 'has_contraindication', ClinicalRule: 'has_stage_rule'
  };

  /* ---- 关系连线样式（全站统一规范） ---- */
  var LINE_STYLES = {
    recommends_action: { color: '#51cf66', width: 3, type: 'solid', label: '推荐动作' },
    has_recommended_action: { color: '#868e96', width: 2, type: 'dashed', label: '可选动作' },
    blocks_action: { color: '#fa5252', width: 3, type: 'solid', label: '阻断动作' },
    blocked_by_differential: { color: '#fa5252', width: 3, type: 'solid', label: '被鉴别阻断' },
    has_contraindication: { color: '#fa5252', width: 2, type: 'solid', label: '有禁忌' },
    derived_from: { color: '#51cf66', width: 2, type: 'dashed', label: '来源证据' },
    based_on_guideline: { color: '#fab005', width: 2, type: 'dashed', label: '依据指南' },
    uses_primary_guideline: { color: '#fab005', width: 2, type: 'dashed', label: '主依据指南' },
    supported_by_evidence: { color: '#40c057', width: 1.5, type: 'dashed', label: '有证据支撑' },
    next_pathway_stage: { color: '#339af0', width: 3, type: 'solid', label: '下一阶段' },
    has_differential_diagnosis: { color: '#ffd43b', width: 2, type: 'solid', label: '需鉴别诊断' },
    requires_exclusion_exam: { color: '#e8590c', width: 2, type: 'dashed', label: '需排除检查' },
    requires_exclusion_lab: { color: '#e8590c', width: 2, type: 'dashed', label: '需排除检验' },
    requires_pre_treatment_exam: { color: '#fa5252', width: 2, type: 'dashed', label: '治疗前需检查' },
    requires_pre_treatment_lab: { color: '#fa5252', width: 2, type: 'dashed', label: '治疗前需检验' }
  };

  function lineStyle(relType) {
    return LINE_STYLES[relType] || { color: '#868e96', width: 1.5, type: 'solid', label: relationLabel(relType) };
  }

  /* ---- 关键字段中文名 ---- */
  var FIELD_LABELS = {
    clinical_stage: '诊疗阶段', purpose: '临床用途', service_target_name: '服务对象',
    priority_level: '优先级', evidence_text: '证据原文', source_name: '来源名称',
    source_page: '来源页码', source_section_path: '来源章节', cdss_dict_id: 'CDSS字典ID',
    clinical_review_status: '审核状态', formal_cdss_ready: 'CDSS就绪',
    recommendation_class: '推荐等级', evidence_level: '证据等级',
    indication_conditions: '适应条件', contraindication_conditions: '禁忌条件',
    applicable_population: '适用人群', primary_evidence_code: '主证据编码',
    primary_guideline_code: '主指南编码', rule_logic: '规则逻辑',
    usage_boundary: '用途边界', trigger_condition: '触发条件',
    mapping_status: '字典映射状态'
  };

  /* ---- 字典状态推导：mapping_status 入库后优先，现库从 cdss_dict_id 推导 ---- */
  function dictStatus(node) {
    if (!node) return { key: 'none', label: '—' };
    if (node.mapping_status) {
      var ms = String(node.mapping_status);
      if (ms === 'matched') return { key: 'matched', label: '已匹配' };
      if (ms === 'multi_candidate') return { key: 'multi', label: '多候选' };
      if (ms === 'knowledge_only') return { key: 'knowledge', label: '仅知识展示' };
      if (ms === 'pending') return { key: 'pending', label: '待注册' };
    }
    return node.cdss_dict_id
      ? { key: 'matched', label: '已匹配' }
      : { key: 'pending', label: '待注册' };
  }

  /* 可医嘱实体类型（能落到医嘱/申请单的动作类） */
  var ORDERABLE_TYPES = ['Medication', 'Procedure', 'TreatmentItem', 'LabItem', 'ExamItem'];

  /* ---- 医嘱状态推导：字典已匹配且类型可医嘱 → 可医嘱 ---- */
  function orderStatus(node, entityType) {
    var type = entityType || (node && node.entityType) || '';
    if (ORDERABLE_TYPES.indexOf(type) < 0) {
      return { key: 'n/a', label: '不适用' };
    }
    var ds = dictStatus(node);
    if (ds.key === 'matched') return { key: 'ok', label: '可医嘱' };
    if (ds.key === 'multi') return { key: 'pending_dict', label: '待字典确认' };
    return { key: 'pending_dict', label: '待字典确认' };
  }

  /* ---- 审核状态（clinical_review_status 全库取值，2026-08-31 实测 10 种） ---- */
  var REVIEW_STATUS = {
    not_applicable: { label: '不适用', cls: 'muted' },
    not_required: { label: '无需审核', cls: 'muted' },
    clinical_ready: { label: '临床就绪', cls: 'ok' },
    clinical_batch_signed_off: { label: '批次已签核', cls: 'ok' },
    textbook_verified: { label: '教材已验证', cls: 'ok' },
    review_ready: { label: '待复核', cls: 'warn' },
    pending_clinical_review: { label: '待临床审核', cls: 'warn' },
    pending_clinical_use_effect_review: { label: '待使用效果审核', cls: 'warn' },
    blocked: { label: '已阻断', cls: 'bad' },
    pending_review: { label: '待审核', cls: 'warn' },
    approved: { label: '已通过', cls: 'ok' },
    need_evidence: { label: '待补证据', cls: 'warn' },
    pending_dict: { label: '待字典确认', cls: 'warn' },
    knowledge_display_only: { label: '仅知识展示', cls: 'muted' },
    cleaned: { label: '已清理', cls: 'muted' },
    /* 兼容库中既有取值 */
    passed: { label: '已通过', cls: 'ok' },
    pending: { label: '待审核', cls: 'warn' }
  };

  function reviewStatus(node) {
    if (!node) return { label: '—', cls: 'muted' };
    var raw = node.clinical_review_status || node.review_status || '';
    /* 库中存在数组型取值（如 ['not_applicable','not_required']，6 节点），取首个 */
    var rs = Array.isArray(raw) ? (raw[0] || '') : raw;
    if (rs && REVIEW_STATUS[rs]) return REVIEW_STATUS[rs];
    if (rs) return { label: rs, cls: 'warn' };
    return { label: '仅知识展示', cls: 'muted' };
  }

  /* ---- 来源信息格式化：章节路径 + 页码（book_page 优先，其次 pdf_page） ---- */
  function sourceText(node) {
    if (!node) return '';
    var bits = [];
    if (node.source_section_path) bits.push(node.source_section_path);
    else if (node.source_name) bits.push(node.source_name);
    var page = '';
    if (node.book_page_start) page = 'p.' + node.book_page_start;
    else if (node.pdf_page_start) page = 'p.' + node.pdf_page_start;
    else if (node.source_page) page = 'p.' + node.source_page;
    if (page) bits.push(page);
    return bits.join(' · ');
  }

  /* ---- 缺口标签：按字段空值判定 ---- */
  function gapTags(node, entityType) {
    var gaps = [];
    if (!node) return gaps;
    if (!node.source_section_path && !node.source_name) gaps.push('缺来源');
    if (!node.book_page_start && !node.pdf_page_start && !node.source_page) gaps.push('缺页码');
    if (!(node.evidence_count > 0)) gaps.push('缺证据');
    var type = entityType || node.entityType || '';
    if (ORDERABLE_TYPES.indexOf(type) >= 0 && !node.cdss_dict_id && !node.mapping_status) gaps.push('缺字典');
    return gaps;
  }

  /* ---- 状态徽标 HTML（紧凑形态，供实体标签/列表行复用） ---- */
  function statusBadges(node, entityType) {
    if (!node) return '';
    var h = '';
    var ds = dictStatus(node);
    var isOrderable = ORDERABLE_TYPES.indexOf(entityType || node.entityType || '') >= 0;
    if (isOrderable) {
      h += '<span class="sm-badge ' + (ds.key === 'matched' ? 'ok' : 'warn') + '" title="字典状态：' + ds.label + '">' +
        (ds.key === 'matched' ? '●' : '○') + '</span>';
    }
    if (node.evidence_count > 0) {
      h += '<span class="sm-badge ev" title="证据 ' + node.evidence_count + ' 条">📄' + node.evidence_count + '</span>';
    }
    return h;
  }

  return {
    roleGroup: roleGroup, roleLabel: roleLabel, roleClass: roleClass,
    roleLongLabel: roleLongLabel, roleBadge: roleBadge,
    isBroad: isBroad, isSubtype: isSubtype, isIndependent: isIndependent, isTopDisease: isTopDisease,
    RELATION_LABELS: RELATION_LABELS, relationLabel: relationLabel, DIM_REL: DIM_REL,
    LINE_STYLES: LINE_STYLES, lineStyle: lineStyle,
    FIELD_LABELS: FIELD_LABELS,
    dictStatus: dictStatus, orderStatus: orderStatus, reviewStatus: reviewStatus,
    sourceText: sourceText, gapTags: gapTags, statusBadges: statusBadges,
    ORDERABLE_TYPES: ORDERABLE_TYPES
  };
})();
