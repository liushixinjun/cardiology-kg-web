/* === 专科知识图谱 · 共享应用逻辑 === */
/* v1.3.1 4001整改 + 恢复API动态数据模式（v1.5.0共享基础设施）
   数据优先级：Neo4j实时API → 静态快照 assets/kg_full_data.json 兜底 */

var KG_DATA = null;

/* 维度中文名（V4.1实体类型键名，全站展示统一入口；旧键 Exam/LabTest/Medication 走 CORE_DIM_ALIAS 别名兜底） */
var DIM_NAMES = {
  Symptom:'症状', Sign:'体征',
  ExamItem:'检查', ExamObservation:'检查发现', LabItem:'检验', LabSubitem:'检验细项',
  Drug:'药品', Procedure:'手术',
  RiskFactor:'危险因素', Complication:'并发症', DifferentialDiagnosis:'鉴别诊断',
  RiskStratification:'风险分层', Prognosis:'预后', FollowUp:'随访',
  TreatmentPlan:'治疗方案', DiagnosisCriteria:'诊断标准',
  Etiology:'病因', Epidemiology:'流行病学', Pathophysiology:'病理生理',
  Evidence:'证据', Guideline:'指南', ThresholdRule:'阈值规则',
  Prevention:'预防', Definition:'定义', StandardDiagnosis:'标准诊断', Contraindication:'禁忌',
  ClinicalRule:'临床规则',
  NursingCarePlan:'护理计划', NursingAssessment:'护理评估', NursingDiagnosis:'护理诊断',
  /* 旧静态快照键名（别名兜底，避免旧数据显示 undefined） */
  Exam:'检查', LabTest:'检验', Medication:'药品'
};
var DIM_KEYS = Object.keys(DIM_NAMES);

/* 4001整改：20个核心临床维度 = 17基础 + 3护理（V4.0护理批次）。
   键名与 /api/kg/diseases 返回的 dim_counts 一致（V4.1 实体类型键名）。 */
var CORE_DIM_KEYS = ['Symptom','Sign','ExamItem','LabItem','Drug','Procedure','RiskFactor',
  'Complication','DifferentialDiagnosis','RiskStratification','Prognosis','FollowUp',
  'TreatmentPlan','DiagnosisCriteria','Etiology','Epidemiology','Pathophysiology',
  'NursingCarePlan','NursingAssessment','NursingDiagnosis'];
/* 静态快照 assets/kg_full_data.json 仍用旧键名，读取时按别名兜底 */
var CORE_DIM_ALIAS = { ExamItem: 'Exam', LabItem: 'LabTest', Drug: 'Medication' };
/* 核心维度中文名（含旧键，覆盖度计算与标签展示用） */
var CORE_DIM_NAMES = { Symptom: '症状', Sign: '体征', ExamItem: '检查', LabItem: '检验',
  Drug: '药品', Medication: '药品', Exam: '检查', LabTest: '检验', Procedure: '手术',
  RiskFactor: '危险因素', Complication: '并发症', DifferentialDiagnosis: '鉴别诊断',
  RiskStratification: '风险分层', Prognosis: '预后', FollowUp: '随访',
  TreatmentPlan: '治疗方案', DiagnosisCriteria: '诊断标准', Etiology: '病因',
  Epidemiology: '流行病学', Pathophysiology: '病理生理', NursingCarePlan: '护理计划',
  NursingAssessment: '护理评估', NursingDiagnosis: '护理诊断' };

/* 全局维度颜色（对象+数组两种形式，供各页面统一引用） */
/* ====== v1.4.7 维度色板：全部主题变量化（双主题动态，切肤时 refreshDimColors 重算） ====== */
function dimColorMap(){
  return {
    Symptom:cssVar('--green','#51cf66'), Sign:cssVar('--purple','#cc5de8'),
    ExamItem:cssVar('--cyan','#22b8cf'), ExamObservation:cssVar('--dim-lab','#845ef7'), LabItem:cssVar('--dim-lab','#748ffc'), LabSubitem:cssVar('--dim-lab','#b197fc'),
    Drug:cssVar('--orange','#ff922b'), Medication:cssVar('--orange','#ff922b'), Procedure:cssVar('--pink','#f06595'),
    RiskFactor:cssVar('--accent2','#ff6b6b'), Complication:cssVar('--yellow','#ffd43b'), DifferentialDiagnosis:cssVar('--pink','#ea7ccc'),
    RiskStratification:cssVar('--green','#a9e34b'), Prognosis:cssVar('--cyan','#63e6be'), FollowUp:cssVar('--yellow','#fcc419'),
    TreatmentPlan:cssVar('--cyan','#66d9e8'), DiagnosisCriteria:cssVar('--green','#94d82d'),
    Etiology:cssVar('--yellow','#fcc419'), Epidemiology:cssVar('--purple','#da77f2'), Pathophysiology:cssVar('--dim-patho','#748ffc'),
    Evidence:cssVar('--dim-evidence','#40c057'), Guideline:cssVar('--dim-guideline','#fab005'), ThresholdRule:cssVar('--dim-threshold','#20c997'),
    Prevention:cssVar('--dim-threshold','#20c997'), Definition:cssVar('--dim-patho','#748ffc'), StandardDiagnosis:cssVar('--orange','#ff922b'), Contraindication:cssVar('--accent2','#ff6b6b'),
    ClinicalRule:cssVar('--dim-clinical-rule','#339af0'),
    NursingCarePlan:cssVar('--dim-nursing','#0ca678'), NursingAssessment:cssVar('--dim-nursing','#12b886'), NursingDiagnosis:cssVar('--dim-nursing','#20c997')
  };
}
var DIM_COLORS = dimColorMap();
var DIM_COLORS_ARR = DIM_KEYS.map(function(k){ return DIM_COLORS[k] || cssVar('--accent','#4f8cff') });
/* 新维度自动配色盘（动态注册时兜底；v1.4.7 全量主题变量化） */
function dimPalette(){
  return [cssVar('--accent','#4f8cff'),cssVar('--green','#51cf66'),cssVar('--purple','#cc5de8'),cssVar('--cyan','#22b8cf'),cssVar('--dim-patho','#748ffc'),cssVar('--orange','#ff922b'),cssVar('--pink','#f06595'),cssVar('--accent2','#ff6b6b'),cssVar('--yellow','#ffd43b'),cssVar('--green','#94d82d'),cssVar('--cyan','#66d9e8'),cssVar('--yellow','#fcc419'),cssVar('--pink','#ea7ccc'),cssVar('--green','#a9e34b'),cssVar('--cyan','#63e6be'),cssVar('--purple','#da77f2'),cssVar('--dim-threshold','#20c997'),cssVar('--dim-lab','#845ef7'),cssVar('--dim-lab','#b197fc'),cssVar('--dim-clinical-rule','#339af0')];
}
var DIM_COLOR_PALETTE = dimPalette();
/* v1.4.7 主题热切换：按当前主题重算全部维度色（就地覆写 DIM_COLORS / DIM_COLORS_ARR，
   页面内已捕获的引用保持有效；各页 onThemeChange 开头调用） */
window.refreshDimColors = function(){
  var m = dimColorMap(), k;
  for (k in m) { if (m.hasOwnProperty(k)) DIM_COLORS[k] = m[k]; }
  for (var i = 0; i < DIM_KEYS.length; i++) DIM_COLORS_ARR[i] = DIM_COLORS[DIM_KEYS[i]] || cssVar('--accent','#4f8cff');
  var p = dimPalette();
  for (var q = 0; q < p.length; q++) DIM_COLOR_PALETTE[q] = p[q];
  /* v1.4.7a 三层架构组色与页面级模块常量一并随主题重算 */
  try {
    THREE_LAYERS.knowledge.color = cssVar('--accent','#4f8cff');
    THREE_LAYERS.masterdata.color = cssVar('--orange','#ff922b');
    THREE_LAYERS.decision.color = cssVar('--green','#51cf66');
  } catch(e){}
  try { if (typeof DISEASE_COLOR !== 'undefined') DISEASE_COLOR = cssVar('--accent','#4f8cff'); } catch(e){}
  return DIM_COLORS;
};

/* ====== 动态维度注册（单一事实源：/api/kg/dimensions） ======
   Schema 升级新增维度批次时，只改 server.py（REL_MAP/MULTI_HOP_DIMS/CORE_DIM_ORDER），
   前端启动时自动拉取本接口刷新口径；接口不可用时保留下方静态兜底值。 */
function applyDimRegistry(reg) {
  try {
    if (!reg) return;
    if (Array.isArray(reg.core_dimensions) && reg.core_dimensions.length) {
      CORE_DIM_KEYS = reg.core_dimensions.slice();
    }
    /* 注册表声明的新维度追加进 DIM_KEYS（旧键顺序不变，末尾追加），筛选器/雷达自动跟随 */
    if (Array.isArray(reg.all_dimensions)) {
      reg.all_dimensions.forEach(function(k) {
        if (DIM_KEYS.indexOf(k) === -1) DIM_KEYS.push(k);
      });
    }
    if (reg.alias) {
      for (var ak in reg.alias) CORE_DIM_ALIAS[ak] = reg.alias[ak];
    }
    if (reg.names) {
      for (var nk in reg.names) {
        if (reg.names[nk]) {
          CORE_DIM_NAMES[nk] = reg.names[nk];
          DIM_NAMES[nk] = reg.names[nk];  /* 只补中文名标签，不扩容 DIM_KEYS（避免筛选/雷达轴爆炸） */
        }
      }
    }
    /* 新维度自动配色 */
    var ci = 0;
    Object.keys(DIM_NAMES).forEach(function(k) {
      if (!DIM_COLORS[k]) { DIM_COLORS[k] = DIM_COLOR_PALETTE[ci % DIM_COLOR_PALETTE.length]; ci++; }
    });
    /* 口径刷新后回写页面上的维度数占位 */
    if (typeof injectDimCount === 'function') { try { injectDimCount(); } catch(e){} }
  } catch (e) { console.error('applyDimRegistry failed:', e); }
}

/* V2.0 三层架构分组 */
var THREE_LAYERS = {
  knowledge: {
    name: '疾病知识层', icon: '📖', color: cssVar('--accent','#4f8cff'), borderColor: 'rgba(79,140,255,.3)',
    desc: '这个病是什么、有哪些表现、如何检查和治疗',
    dims: ['Definition','Symptom','Sign','ExamItem','ExamObservation','LabItem','LabSubitem','Drug','Procedure','TreatmentPlan','Etiology','Pathophysiology','Epidemiology','RiskFactor','Complication','Prognosis','FollowUp','Prevention','DifferentialDiagnosis','RiskStratification','DiagnosisCriteria','ThresholdRule','Contraindication','ClinicalRule','NursingCarePlan','NursingAssessment','NursingDiagnosis']
  },
  masterdata: {
    name: 'CDSS标准主数据层', icon: '🏷️', color: cssVar('--orange','#ff922b'), borderColor: 'rgba(255,146,43,.3)',
    desc: '如何对应系统标准字典和医嘱/诊断编码',
    dims: ['StandardDiagnosis']
  },
  decision: {
    name: '临床决策层', icon: '🧠', color: cssVar('--green','#51cf66'), borderColor: 'rgba(81,207,102,.3)',
    desc: '当前患者何时触发、推荐什么、为什么',
    dims: ['ClinicalPathway','Evidence','Guideline']
  }
};
/* 实体类型→所属层级映射 */
var ENTITY_LAYER_MAP = {};
(function(){
  THREE_LAYERS.knowledge.dims.forEach(function(d){ENTITY_LAYER_MAP[d]='knowledge'});
  THREE_LAYERS.masterdata.dims.forEach(function(d){ENTITY_LAYER_MAP[d]='masterdata'});
  THREE_LAYERS.decision.dims.forEach(function(d){ENTITY_LAYER_MAP[d]='decision'});

/* v1.4.7a 首屏竞态自愈：冷加载时样式表可能晚于脚本就绪，cssVar 取空会导致
   色板退回深色兜底值（浅色主题下刺眼）。样式就绪后重算一次；
   各页渲染均发生在数据加载完成之后，必然晚于本重算。 */
(function(){
  function heal(attempt){
    if (cssVar('--accent','')) { try { refreshDimColors(); } catch(e){} return; }
    if (attempt > 120) return; /* ~2s 上限，放弃则保持兜底值 */
    var raf = window.requestAnimationFrame || function(f){ setTimeout(f, 16); };
    raf(function(){ heal(attempt + 1); });
  }
  window.__kgDimHeal = heal; /* 暴露以便诊断 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ heal(0); });
  } else {
    heal(0);
  }
})();
})();
function getEntityLayer(dimKey) { return ENTITY_LAYER_MAP[dimKey] || 'knowledge'; }
function getLayerInfo(layerKey) { return THREE_LAYERS[layerKey] || THREE_LAYERS.knowledge; }

/* 维度数量注入：把页面中 .dcp 占位数字替换为实际核心维度数。
   口径优先级：后端 /api/kg/dimensions/coverage 的 dimension_count（真实参与统计的维度数）
   → 后端 /api/kg/dimensions 的 core_dimensions 长度 → 本地静态兜底。 */
var CORE_DIM_COUNT_FROM_API = 0;
function injectDimCount() {
  var n = coreDimTotal();
  var els = document.querySelectorAll('.dcp');
  for (var i = 0; i < els.length; i++) els[i].textContent = n;
}
/* 维度总数唯一取值入口：优先后端真实统计值，未取到时退回本地口径 */
function coreDimTotal() {
  return CORE_DIM_COUNT_FROM_API || CORE_DIM_KEYS.length;
}

/* 二级层级映射：从 parentCode 提取大类前缀 → 大类名 + 子类名 */
function parseParentCode(pc) {
  if (!pc) return { group: '其他', sub: '' };
  var cleaned = pc.replace('SUB-CARD-', '').replace('CAT-CARD-', '').replace('DIS-CARD-', '').replace('CARD-', '');
  var parts = cleaned.split('-');
  var main = parts[0];
  var sub = parts.length > 1 ? parts.slice(1).join('-') : '';
  var groupMap = {
    'HF':'心力衰竭','ARR':'心律失常','CAD':'冠心病','CM':'心肌病',
    'VHD':'瓣膜性心脏病','PERICARD':'心包疾病','HTN':'高血压',
    'CHD':'先天性心脏病','IE':'感染性心内膜炎','SCD':'心脏骤停/猝死',
    'AORTA':'主动脉/外周血管','PAD':'外周血管','NEUROSIS':'心脏神经症',
    'AVB':'心律失常','BBB':'心律失常','BRADY':'心律失常','SINUS':'心律失常','SND':'心律失常',
    'SHD':'先天性心脏病',
    'CAT':'其他','LIPID':'血脂异常','MPIE':'心肌/心包/感染性',
    'HT':'高血压','PERIGENERAL':'心包疾病',
    'PH':'肺动脉高压','PAH':'肺动脉高压','CTEPH':'肺动脉高压',
    'AORTIC':'瓣膜性心脏病','MITRAL':'瓣膜性心脏病','TRICUSPID':'瓣膜性心脏病',
    'PULMONARY':'瓣膜性心脏病','MULTI':'瓣膜性心脏病','RHEUMATIC':'瓣膜性心脏病',
    'MYOCARDITIS':'心肌炎'
  };
  var subMap = {
    'GENERAL':'','ACS':'急性冠脉综合征','CHRONIC':'慢性冠脉综合征',
    'PHENOTYPE':'表型分类','ARRHYTHMIC':'致心律失常型','ATRIAL':'心房型','SPECIAL':'特殊类型'
  };
  return { group: groupMap[main] || main, sub: subMap[sub] || sub };
}
var GROUP_ICONS = {'心力衰竭':'❤️','心律失常':'💓','冠心病':'🫀','心肌病':'🔬','瓣膜性心脏病':'🫀','心包疾病':'🫀','高血压':'💊','先天性心脏病':'👶','感染性心内膜炎':'🦠','心脏骤停/猝死':'🚑','主动脉/外周血管':'🩸','外周血管':'🩸','心脏神经症':'🧠','血脂异常':'🧪','心肌/心包/感染性':'🫀','肺动脉高压':'🫁','心肌炎':'🦠','其他':'📁'};

/* 疾病大类名：优先用后端动态解析的 category_name（/api/kg/diseases 随图谱返回），
   降级走 parseParentCode 前缀映射（静态快照旧数据兜底）。新增疾病大类无需改前端。 */
function getGroupName(info) {
  if (info && info.category_name) return info.category_name;
  return parseParentCode(info && info.parent).group;
}

/* 临床展示名清理：display_name > preferred_name > name > code，兜底去前缀 */
var _PREFIX_PATTERNS = [
  'AMI诊断明细：','STEMI诊断明细：','NSTEMI诊断明细：',
  'AMI鉴别：','STEMI鉴别：','NSTEMI鉴别：',
  'AMI诊断明细:','STEMI诊断明细:','NSTEMI诊断明细:',
  'AMI鉴别:','STEMI鉴别:','NSTEMI鉴别:'
];
var _CODE_PREFIX_RE = /^(EXAM-|RULE-|DXC-|STAGE-|REC-|EVD-|SRC-DOC-|PATHWAY-|DIS-|SUB-CARD-)/;
function cleanName(entity) {
  var raw = entity.display_name || entity.preferred_name || entity.name || entity.code || '';
  for (var i = 0; i < _PREFIX_PATTERNS.length; i++) {
    if (raw.indexOf(_PREFIX_PATTERNS[i]) === 0) {
      raw = raw.substring(_PREFIX_PATTERNS[i].length).replace(/^\s+/, '');
      break;
    }
  }
  if (_CODE_PREFIX_RE.test(raw)) {
    var alt = entity.preferred_name || entity.name || '';
    if (alt && !_CODE_PREFIX_RE.test(alt)) return alt;
  }
  return raw;
}
/* 按 code 去重辅助函数 */
function entityKey(e) { return e.code || e.name || ''; }

/* V1.11 教材骨架槽位映射 */
var SKELETON_SLOT_NAMES = {
  'overview':'疾病概述/定义','etiology':'病因','pathogenesis':'发病机制/病理生理',
  'epidemiology':'流行病学','clinical_manifestation':'临床表现','exam_lab':'检查/检验',
  'diagnosis_differential':'诊断与鉴别诊断','classification_risk':'分型/分级/危险分层',
  'treatment':'治疗','prognosis_followup_prevention':'预后/随访/预防'
};
var KNOWLEDGE_LAYER_NAMES = {
  'textbook_core':'教材基础骨架','guideline_supplement':'指南补充知识',
  'guideline_decision':'指南决策知识','screening_context':'筛查/背景上下文',
  'cross_reference':'跨章节引用'
};
var SOURCE_TYPE_NAMES = {
  'authoritative_textbook':'权威教材','guideline':'指南','consensus':'共识',
  'expert_material':'专家材料','unclassified':'未分类'
};
function skeletonSlotName(val) { return SKELETON_SLOT_NAMES[val] || val || ''; }
function knowledgeLayerName(val) { return KNOWLEDGE_LAYER_NAMES[val] || val || ''; }
function sourceTypeName(val) { return SOURCE_TYPE_NAMES[val] || val || ''; }

/* Server config */
function getServerConfig() {
  var defaults = { url: 'bolt://192.168.3.27:7687', user: 'neo4j', password: '__NEO4J_PWD__', httpUrl: 'http://192.168.3.27:7474' };
  try { var saved = localStorage.getItem('kg_server_config'); return saved ? JSON.parse(saved) : defaults; } catch(e) { return defaults; }
}
function saveServerConfig(cfg) { localStorage.setItem('kg_server_config', JSON.stringify(cfg)); }

/* Data loading - 动态API模式：疾病列表骨架(dim_counts) + 全局统计 + 维度口径注册 */
function loadData(callback) {
  if (KG_DATA && KG_DATA._loaded) { callback(KG_DATA); return; }
  Promise.all([
    fetch('/api/kg/diseases?v=' + Date.now()).then(function(r){return r.json()}),
    fetch('/api/kg/stats?v=' + Date.now()).then(function(r){return r.json()}),
    /* 维度口径单一事实源（失败不阻断，用静态兜底） */
    fetch('/api/kg/dimensions?v=' + Date.now()).then(function(r){return r.json()}).catch(function(){return null}),
    /* 维度覆盖率：后端真实统计，前端只负责展示，不再自行遍历计算 */
    fetch('/api/kg/dimensions/coverage?v=' + Date.now()).then(function(r){return r.json()}).catch(function(){return null})
  ]).then(function(results){
    var diseaseList = results[0];
    var stats = results[1];
    if (results[2]) applyDimRegistry(results[2]);  /* 先应用口径，再回调渲染 */
    var dimCoverage = results[3];
    /* 页面上所有维度数占位一律用后端真实统计值，杜绝前后端口径漂移 */
    if (dimCoverage && dimCoverage.dimension_count) {
      CORE_DIM_COUNT_FROM_API = dimCoverage.dimension_count;
      try { injectDimCount(); } catch(e) {}
    }
    var diseases = {};
    diseaseList.forEach(function(d){
      diseases[d.code] = { info: d, dimensions: {}, dim_counts: d.dim_counts || {}, relations_summary: [], evidence_count: 0, _loaded: false };
    });
    KG_DATA = {
      diseases: diseases,
      stats: stats,
      dim_coverage: dimCoverage || null,
      data_source: { type: 'Neo4j实时', export_time: new Date().toLocaleString('zh-CN') },
      _loaded: true
    };
    callback(KG_DATA);
  }).catch(function(e){
    console.error('API load failed:', e);
    /* 降级到静态JSON（旧键名，走 CORE_DIM_ALIAS 别名兼容） */
    fetch('./assets/kg_full_data.json').then(function(r){return r.json()}).then(function(d){KG_DATA=d;KG_DATA._loaded=true;callback(d)}).catch(function(e2){console.error('Fallback also failed:',e2)});
  });
}

/* 按需加载单个疾病完整数据 */
function loadDiseaseData(code, callback) {
  if (!KG_DATA) { callback(null); return; }
  if (KG_DATA.diseases[code] && KG_DATA.diseases[code]._loaded) { callback(KG_DATA.diseases[code]); return; }
  fetch('/api/kg/disease/' + encodeURIComponent(code) + '?v=' + Date.now()).then(function(r){return r.json()}).then(function(d){
    d._loaded = true;
    filterDeprecatedEntities(d);
    KG_DATA.diseases[code] = d;
    callback(d);
  }).catch(function(e){
    console.error('Load disease failed:', code, e);
    callback(null);
  });
}

/* 批量加载所有疾病完整数据（1次请求替代上百次） */
function loadAllDiseaseData(callback) {
  /* 1. 检查内存缓存 */
  if (KG_DATA && KG_DATA._allLoaded) { callback(KG_DATA); return; }

  /* 2. 检查 sessionStorage 缓存 */
  try {
    var cached = sessionStorage.getItem('kg_all_diseases');
    if (cached) {
      var parsed = JSON.parse(cached);
      if (!KG_DATA) KG_DATA = {diseases: {}, stats: null, _loaded: false};
      Object.keys(parsed.diseases).forEach(function(code) {
        parsed.diseases[code]._loaded = true;
        KG_DATA.diseases[code] = parsed.diseases[code];
      });
      KG_DATA.stats = parsed.stats;
      KG_DATA._loaded = true;
      KG_DATA._allLoaded = true;
      callback(KG_DATA);
      return;
    }
  } catch(e) {}

  /* 3. 发起批量请求 */
  fetch('/api/kg/diseases/all?v=' + Date.now())
    .then(function(r){return r.json()})
    .then(function(data){
      if (!KG_DATA) KG_DATA = {diseases: {}, stats: null, _loaded: false};
      Object.keys(data.diseases).forEach(function(code) {
        data.diseases[code]._loaded = true;
        filterDeprecatedEntities(data.diseases[code]);
        KG_DATA.diseases[code] = data.diseases[code];
      });
      KG_DATA.stats = data.stats;
      KG_DATA._loaded = true;
      KG_DATA._allLoaded = true;
      try { sessionStorage.setItem('kg_all_diseases', JSON.stringify(data)); } catch(e) {}
      callback(KG_DATA);
    })
    .catch(function(e){
      console.error('loadAllDiseaseData failed:', e);
      /* 降级到逐个加载 */
      loadData(function(d){
        var codes = Object.keys(d.diseases);
        var loaded = 0;
        codes.forEach(function(code) {
          loadDiseaseData(code, function() {
            loaded++;
            if (loaded === codes.length) callback(KG_DATA);
          });
        });
      });
    });
}

/* 前端兜底：过滤 status=deprecated 的节点 */
function filterDeprecatedEntities(diseaseData){
  if(!diseaseData || !diseaseData.dimensions) return;
  Object.keys(diseaseData.dimensions).forEach(function(k){
    var it = diseaseData.dimensions[k];
    if(it && it.length){
      diseaseData.dimensions[k] = it.filter(function(e){ return e.status !== 'deprecated'; });
    }
  });
}

/* 覆盖度：20核心维度（V4.1键名，旧键别名兜底），口径与图谱数据字典/热力图一致 */
function getCoverage(code) {
  if(!KG_DATA||!KG_DATA.diseases[code])return 0;
  var d=KG_DATA.diseases[code],f=0;
  if(d._loaded && d.dimensions) {
    CORE_DIM_KEYS.forEach(function(k){
      var v=d.dimensions[k];
      if((!v||!v.length)&&CORE_DIM_ALIAS[k]) v=d.dimensions[CORE_DIM_ALIAS[k]];
      if(v&&v.length>0)f++;
    });
    return Math.round(f/coreDimTotal()*100);
  }
  if(d.dim_counts) {
    CORE_DIM_KEYS.forEach(function(k){
      var c=d.dim_counts[k];
      if(!c&&CORE_DIM_ALIAS[k]) c=d.dim_counts[CORE_DIM_ALIAS[k]];
      if(c&&c>0)f++;
    });
    return Math.round(f/coreDimTotal()*100);
  }
  return 0;
}
function covClass(c){return c===100?'cov-full':c>=70?'cov-good':c>=40?'cov-mid':'cov-low';}

/* 获取默认疾病code：第一个疾病大类下的第一个疾病（按覆盖度排序） */
function getDefaultDiseaseCode(){
  if(!KG_DATA||!KG_DATA.diseases)return null;
  var ds=KG_DATA.diseases,groups={};
  Object.keys(ds).forEach(function(code){
    var info=ds[code].info,g=getGroupName(info);
    if(!groups[g])groups[g]=[];
    groups[g].push({code:code,cov:getCoverage(code)});
  });
  var parsedFirst=['冠心病','心肌病','心力衰竭'];
  var allGroups=Object.keys(groups);
  var sorted=parsedFirst.filter(function(g){return groups[g]}).concat(allGroups.filter(function(g){return parsedFirst.indexOf(g)===-1}).sort());
  for(var i=0;i<sorted.length;i++){
    var list=groups[sorted[i]];
    if(!list||!list.length)continue;
    list.sort(function(a,b){return b.cov-a.cov});
    return list[0].code;
  }
  return Object.keys(ds)[0]||null;
}

/* Professional Nav — brand links back to index */
function renderNav(activePage) {
  /* 11个功能菜单（首页/图谱探索/网络探索/数据覆盖分析/临床审核/图谱数据字典/
     Schema标准/AI图谱解析/指南库/医学术语库）+ 外部链接（专科辅助诊疗，新标签页打开）
     注：diagnosis.html(临床诊断模拟)、engine.html(路径编辑) 已作废并已从仓库移除 */
  /* v1.5.11e: heatmap(数据建设进度) 已并入 review「建设与审核」，菜单合并 */
  var pages = [
    {id:'index',label:'首页',icon:'🏠',group:'browse',home:true},
    {id:'explore',label:'图谱探索',icon:'🧭',group:'browse'},
    {id:'network',label:'网络探索',icon:'🕸️',group:'browse'},
    {id:'review',label:'建设与审核',icon:'📈',group:'gov'},
    {id:'ai-parse',label:'AI图谱解析',icon:'🤖',group:'gov'},
    {id:'schema',label:'图谱数据字典',icon:'📐',group:'std'},
    {id:'meta',label:'元模型配置',icon:'🧩',group:'std'},
    {id:'standard',label:'Schema标准',icon:'📘',group:'std'},
    {id:'guideline',label:'指南库',icon:'📚',group:'std'},
    {id:'terminology',label:'医学术语库',icon:'🧬',group:'std'},
    {id:'specialty-cdss-prototype',label:'专科辅助诊疗',icon:'🩺',external:true,group:'app'}
  ];
  var cfg = getServerConfig();
  var h = '<a class="nav-brand" href="index.html">🏥 专科知识图谱 · 心血管内科</a><div class="nav-links">';
  /* v1.4.3 菜单分组：图谱浏览(蓝)/数据治理·生产(绿)/标准与参考(紫)/临床应用(橙) */
  var GROUPS = {browse:'图谱浏览',gov:'数据治理·生产',std:'标准与参考',app:'临床应用'};
  var lastGroup = null;
  pages.forEach(function(p){
    if (lastGroup !== null && p.group !== lastGroup) h += '<span class="nav-sep"></span>';
    lastGroup = p.group;
    var target = p.external ? ' target="_blank"' : '';
    /* v1.5.11m：首页入口独立视觉（徽标底色），与其他菜单区分 */
    var cls = 'nav-link nav-g-'+(p.group||'browse')+(p.home?' nav-home':'')+(activePage===p.id?' active':'');
    h += '<a class="'+cls+'" href="'+p.id+'.html"'+target+' title="'+(p.home?'返回首页 · ':'分组：')+(GROUPS[p.group]||'')+'">'+p.icon+' '+p.label+'</a>';
  });
  h += '</div><div class="nav-right">';
  h += '<a class="nav-config-btn" href="config.html" title="系统配置" aria-label="系统配置">⚙</a>';
  h += '</div>';
  var navEl = document.querySelector('.nav');
  navEl.innerHTML = h;
  navEl.setAttribute('role', 'navigation');
  navEl.setAttribute('aria-label', '主导航');
  if (typeof mountThemeToggle === 'function') mountThemeToggle();
  renderFooter();
  renderVersionBar();
}

/* 4001整改 3.1（v1.3.8 重构）：版本信息条从每页顶部移除，改为三处呈现——
   ① 页脚一行摘要（常态）；② 导航右侧警示徽标（仅实例版本混合/API失败时出现）；
   ③ 系统设置·系统状态页「版本信息」卡（完整字段）。
   KG_VERSION_INFO 仍为全局变量，供 config.html 读取。 */
var KG_VERSION_INFO = null;
function renderVersionBar() {
  fetch('/api/kg/version').then(function(r){return r.json()}).then(function(v){
    KG_VERSION_INFO = v;
    var consistent = v.instance_version_consistent;

    /* ① 页脚版本摘要行 */
    var fv = document.getElementById('footer-version');
    if (fv && v.app_version) fv.textContent = 'v' + v.app_version;
    var fsum = document.getElementById('footer-version-summary');
    if (fsum) {
      var parts = [];
      parts.push('Schema标准 ' + (v.schema_standard_version||'-'));
      parts.push('实例版本 ' + (consistent ? '统一 ' + (Object.keys(v.instance_schema_versions||{})[0]||'-') : '混合·待迁移复核'));
      parts.push('解析Skill ' + (v.skill_version||'-'));
      if (v.g8_readback_time) parts.push('G8回读 ' + String(v.g8_readback_time).replace('T',' ').slice(0,16));
      else if (v.data_updated_at) parts.push('数据更新 ' + String(v.data_updated_at).replace('T',' ').slice(0,16));
      parts.push('API ' + (v.api_version||'-'));
      fsum.textContent = parts.join(' · ');
      fsum.style.display = '';
    }

    /* ② 异常警示徽标：仅实例版本混合时挂到导航右侧 */
    if (!consistent) {
      var nr = document.querySelector('.nav-right');
      if (nr && !document.getElementById('nav-ver-warn')) {
        var w = document.createElement('a');
        w.id = 'nav-ver-warn';
        w.href = 'config.html';
        w.title = (v.version_label||'实例版本混合，待迁移复核') + '（点击查看版本详情）';
        w.style.cssText = 'font-size:11px;padding:3px 9px;border-radius:10px;background:rgba(255,176,32,.15);color:#ffb020;border:1px solid rgba(255,176,32,.4);text-decoration:none;white-space:nowrap';
        w.innerHTML = '⚠ 版本 ' + (v.version_label ? String(v.version_label).slice(0,18) : '混合·待复核');
        nr.appendChild(w);
      }
    }
  }).catch(function(e){
    /* API 不可达：仅在页脚提示，不再占据顶部空间 */
    var fsum = document.getElementById('footer-version-summary');
    if (fsum) { fsum.textContent = '⚠ 版本信息获取失败（API不可达）'; fsum.style.display = ''; }
  });
}

/* Footer & Changelog */
function renderFooter() {
  if (document.getElementById('app-footer')) return;
  var footer = document.createElement('div');
  footer.id = 'app-footer';
  footer.style.cssText = 'text-align:center;padding:24px;font-size:11px;color:var(--muted);border-top:1px solid var(--rule);margin-top:32px';
  footer.innerHTML = '专科知识图谱 · 心血管内科 <a href="javascript:void(0)" onclick="showChangelog()" style="color:var(--accent);margin-left:6px" id="footer-version">v1.4.3</a> <span style="margin-left:6px;color:var(--rule2,var(--muted))">|</span> <a href="https://github.com/liushixinjun/cardiology-kg-web" target="_blank" style="color:var(--muted);margin-left:6px">GitHub</a>'
    + '<div id="footer-version-summary" style="display:none;margin-top:6px;color:var(--muted);font-size:11px"></div>';

  if (!document.getElementById('changelog-modal')) {
    var modal = document.createElement('div');
    modal.id = 'changelog-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
    modal.innerHTML = '<div style="position:absolute;inset:0" onclick="hideChangelog()"></div><div style="position:relative;max-width:640px;margin:80px auto;background:var(--bg2);border:1px solid var(--rule);border-radius:14px;padding:28px 32px;max-height:70vh;overflow-y:auto"><button onclick="hideChangelog()" style="position:absolute;top:16px;right:18px;background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">✕</button><h2 style="font-size:18px;font-weight:800;color:var(--ink);margin-bottom:6px">📋 更新记录</h2><div style="font-size:12px;color:var(--muted);margin-bottom:20px">专科知识图谱 · 心血管内科 平台版本历史</div><div id="changelog-list"></div></div>';
    document.body.appendChild(modal);
  }
  document.body.appendChild(footer);
  renderChangelog();
}

function showChangelog() {
  var m = document.getElementById('changelog-modal');
  if (m) m.style.display = 'block';
}

function hideChangelog() {
  var m = document.getElementById('changelog-modal');
  if (m) m.style.display = 'none';
}

function renderChangelog() {
  var list = [
    { v: 'v1.5.0 · 数据建设进度页重构', date: '2026-10-08', items: [
      '"数据覆盖分析"重构为"数据建设进度"：汇总 11 张卡压缩为"建路径→有推荐→审核通过→可正式使用"四步漏斗 + 知识维度一张卡，一句话讲懂',
      '明细表 16 列压缩为 7 列：7 个链路计数列合并为"推荐意见"1 列（悬停看明细），四层矩阵点与状态徽章合并为"建设进度"四步圆点',
      '删除全部 ? 号帮助弹窗；内部术语通俗化（实例→推荐意见、动作→具体措施、瓶颈分析→下一步补什么）；导航/首页入口/配置页同步更名'
    ]},
    { v: 'v1.4.9 · 首页顶部枢纽化', date: '2026-10-08', items: [
      '数据总览顶部 4 张 KPI 卡可点击跳转，入口收敛为两个去向：疾病大类、专病 → 图谱探索（左侧疾病树按大类组织，点开即见专病与维度详情）；可视化实体、关系 → 网络探索（实体全景网络）',
      'KPI 卡悬停显示指向箭头；维度标签保持纯展示，不链接到过程功能页',
      '修复疾病审核详情页导航突变：该页原先自带一套旧版菜单（缺 AI图谱解析/Schema标准/指南库，仍列已作废的临床诊断入口），进入后顶部样式与全站不一致；现改为复用 app.js 统一导航，高亮"临床审核"'
    ]},
    { v: 'v1.4.8 · 图谱点击跳转修复 + 首页紧凑化', date: '2026-10-08', items: [
      '修复首页知识网络图谱点击专病节点无反应的问题：点击事件此前误写在 series 选项内（ECharts 不识别），现改为实例级注册，点击专病节点即跳转图谱探索并自动定位该疾病',
      '修复指南页疾病标签跳转参数错位（disease → code），点击后可正确定位到对应疾病',
      '首页数据总览头部模块紧凑化：内边距、标题字号、卡片间距整体收紧，首屏可多露出下方图表内容',
      '首页维度口径文案同步为 20 个核心维度（17 基础 + 3 护理），与实际统计口径一致'
    ]},
    { v: 'v1.4.7 · 全站配色协调（维度色板双主题化）', date: '2026-10-08', items: [
      '维度色板全面双主题化：检验检查/机制/临床规则/证据指南/护理等 13 处硬编码霓虹色改为主题变量，浅色下不再刺眼突兀',
      '切换主题时维度筛选圆点、图谱节点、图例随主题即时重算重绘（新增色板热刷新，网络图左侧维度筛选同步更新）',
      '临床辅助（CDSS）视图徽章/状态标签/汇总卡片约 20 处硬编码色改为语义变量，浅深两套对比度均达标',
      '全部页面样式表引用补版本戳，发版即生效不再吃旧缓存',
      '修复首屏冷加载竞态：样式表晚于脚本就绪时维度色板误用深色兜底值，现样式就绪后自动重算（三层组色/疾病色一并刷新）'
    ]},
    { v: 'v1.4.6 · 图谱交互增强', date: '2026-10-07', items: [
      '图谱分组双击展开/收起子节点，实体双击直达详情面板',
      '图例支持单选/批量显隐（本组/其他组/全部）',
      '维度显隐状态跨重绘保持，切换疾病不丢失'
    ]},
    { v: 'v1.4.5 · 主题热切换 + 图表提示框统一主题化', date: '2026-10-06', items: [
      '切换主题不再整页刷新：首页/探索/网络/数据字典四页图表就地重绘，免重新加载1.4MB数据，切肤秒级完成',
      '图表提示框（tooltip）全站统一随主题：首页雷达图/柱状图、图谱探索关系图由 ECharts 默认白底改为主题气泡样式',
      '首页网络图实例防重复初始化（内存泄漏防护）'
    ]},
    { v: 'v1.4.4 · 高分屏锐化 + 窗口缩放 + 菜单组色竖条 + 无障碍 + 窄屏适配', date: '2026-10-03', items: [
      '高分屏（2K/4K）下全部 canvas 图表显式 devicePixelRatio 渲染，线条文字不再发糊',
      'resize 统一 150ms 防抖；补探索页关系图谱缺失的缩放监听；修复数据字典弹窗图监听器泄漏',
      '导航项左侧 3px 组色竖条（蓝/绿/紫/橙），分组色静态可见',
      '主导航/主题按钮/图表容器补 role 与 aria-label 无障碍标注；≤1100px/≤768px 窄屏适配'
    ]},
    { v: 'v1.4.3 · 图谱浅色可读性优化 + 菜单分组配色', date: '2026-10-02', items: [
      '首页知识网络图谱浅色适配：节点标签/覆盖率数字/连线透明度按浅色主题加深加密，不再模糊',
      '图谱探索/网络探索/数据字典页：小节点标签放大（7-8px→9-10px）并随主题取色，悬停标签浮签浅色化',
      '数据覆盖徽章与达标圆点改用语义文字色（浅色深字/深色亮字），图例文字随主题',
      '功能菜单分四组配色区分：图谱浏览(蓝)/数据治理·生产(绿)/标准与参考(紫)/临床应用(橙)，悬停与选中显示组色'
    ]},
    { v: 'v1.4.2 · 浅色模式观感修正', date: '2026-10-02', items: [
      '首页主视觉区浅色适配：原深空渐变改为淡蓝医疗渐变，徽标/标签/玻璃卡片改浅色材质',
      '图谱图表提示框（tooltip）随主题切换：浅色白底深字 / 深色原样',
      '页脚分隔线等细节色随主题统一'
    ]},
    { v: 'v1.4.1 · 双主题（浅色医疗风 / 深色大屏模式）', date: '2026-10-01', items: [
      '新增右上角主题切换按钮：默认浅色医疗风（白底深字，适合日常查阅与长时间阅读），一键切换深色科技风（大屏/投影展示）',
      '主题选择全站记忆（同一浏览器记住偏好）；画布图表页切换主题后自动重载配色',
      '全站硬编码颜色收敛为 CSS 变量双主题定义，图表色运行时读取当前主题',
      '修复历史遗留：服务器响应无缓存控制头导致发版后浏览器仍显示旧页面，现页面即发即生效'
    ]},
    { v: 'v1.4.0 · 菜单名恢复', date: '2026-09-30', items: [
      '导航与页面标题恢复「AI图谱解析」原名：上一版去AI化时把功能菜单名一并中性化属过度执行，现改回；正文解说保持去AI化不动',
      'VERSION 提升至 1.4.0；版本戳全站统一为 2026093023'
    ]},
    { v: 'v1.3.9 · 去AI化与排版治理', date: '2026-09-30', items: [
      '全站文案去AI化：面向用户的解说文案不再出现 AI 字样（数据编码如 AI-GRACE 与文件清单中的真实文件名保留）',
      '图谱架构规范页移除受众切分卡：产品面向所有读者，不再按角色区分阅读路径',
      '图谱架构规范页移除双视角切换条与对照卡：内容一页完整呈现，技术明细列不再隐藏，无需切换',
      '字体统一治理：两文档页 19 级字号收敛为 8 级阶梯（10/12/13/14/16/18/21/28），标题、正文、注释层次清晰可循',
      'VERSION 提升至 1.3.9；版本戳全站统一为 2026093022'
    ]},
    { v: 'v1.3.8 · 版本条瘦身', date: '2026-09-30', items: [
      '页面顶部版本信息条整体移除：原先每页导航下方占一行的「Schema标准/实例版本/解析Skill/G8回读/前端与API」横条不再展示，归还内容区空间',
      '版本摘要并入页脚一行小字：v1.3.8 | Schema标准 V4.1 · 实例版本统一 V4.1 · 解析Skill V2.1 · G8回读 …（API 不可达时页脚提示，不再占顶部）',
      '异常状态徽标化：仅当实例版本混合·待迁移复核时，才在导航右侧出现 ⚠ 徽标，点击直达系统设置查看详情；常态零打扰',
      '系统设置·系统状态新增「🏷️ 版本信息」卡：Schema标准/实例版本/解析Skill/G8回读/数据最后更新/前端与API版本/最近批次/生成时间 全字段展示',
      'KG_VERSION_INFO 全局变量保留，config.html 优先复用导航加载结果，未加载完成时自行请求 /api/kg/version',
      'VERSION 提升至 1.3.8；版本戳全站统一为 2026093019'
    ]},
    { v: 'v1.3.7 · 去文字墙：三分钟看懂', date: '2026-09-29', items: [
      '页面顶部新增「三分钟看懂」三张大卡：① 读资料，不瞎读 ② 抽知识，条条带户口 ③ 进库房，先过安检，每张卡配手绘图标并直接跳转对应深读章节',
      '每个默认展开区块开头加一条「说人话」白话条（图标 + 一句话），总览 / 输入产出 / 工作原理 / 三道闸门 / 规则↔程序↔文件 / 开工必填 / 从指南到三元组 / 术语对照 共 8 处',
      '九道工序全部换成动作式口语名：划范围 / 登记资料 / 搭骨架 / 抽知识 / 对名字 / 拼图谱 / 做安检 / 进库房 / 验收交接，并给每格、五步流水线每步配上专属 SVG 小图标',
      '第四步「变成实体关系」由纯文字清单改为节点连线图：规则→推荐陈述→动作 实线主链 + 前置检查/禁忌虚线，关系名以药丸标签标在连线上',
      '术语对照升级为「术语人话对照」：新增 10 张图标人话卡（实体/三元组/归一/闸门/审计/Schema/Skill/批次/candidate vs final/P0-P4），完整表格保留在后',
      'VERSION 提升至 1.3.7；版本戳全站统一为 2026092918'
    ]},
    { v: 'v1.3.6 · 版式修复', date: '2026-09-29', items: [
      '折叠章节收成一条紧凑标题条：折叠态内边距 28px→13px、外边距 22px→10px、标题 21px→16.5px，悬停整条高亮并浮出「点击展开」，一屏能看到的章节数由 5 条增至 10 条以上',
      '一张图看懂全流程的九道工序改为 3×3 等宽网格，排满不留空格，行内 → 与换行 ↓ 箭头全部对齐中缝，流向不再断裂',
      '泳道名与色块对齐修正，执行层两行标签不再把色块顶偏',
      '补上锚点跳转顶部偏移 scroll-margin-top:74px，点目录不再被顶部导航条压住标题',
      '窄屏（≤900px）适配补齐：泳道转上下排列、工序转单列并隐藏跨格箭头',
      'VERSION 提升至 1.3.6；版本戳全站统一为 2026092917'
    ]},
    { v: 'v1.3.5 · 全流程图与理论落地', date: '2026-09-29', items: [
      'AI图谱解析新增「一张图看懂全流程」全景图：四层泳道（输入层/执行层/契约层/交付层）套住 G0-G8 九道工序，一眼看清谁在干活、谁在定规则、谁接收成果',
      '九个工序方块改为「规则 / 实际」两行对照，规则行写约束、实际行写真正调用的程序与命令（如 G5 的 build_graph_instance.py / build_graph_v4.py）',
      '三道闸门（G0 范围 / G3 语义 / G6 质量）用红色徽标直接钉在对应工序上，并补出「G6 审计不过 → 退回 G5 重跑」的返工回路',
      '原「技术架构图」升级为「理论怎么落到实际：规则 ↔ 程序 ↔ 文件」对照表，逐道工序列出 遵循的规则 / 实际执行程序 / 产出文件 / 硬卡点 五列',
      '左侧目录同步改名：解析流程图 → 全流程图，技术架构图 → 规则↔程序↔文件（锚点不变）',
      'VERSION 提升至 1.3.5；版本戳全站统一为 2026092916'
    ]},
    { v: 'v1.3.4 · 指南到三元组实证', date: '2026-09-29', items: [
      'AI图谱解析新增「从一条指南到一条三元组」章节：用 2025 ACS 指南「STEMI 首次医疗接触后 120 分钟内完成直接 PCI」一条真实推荐，完整演示 原文 → 实体节点(含属性) → 实体归一 → 实体关系 → 三元组 五步全过程',
      '每一步卡片右上角标出「依据 · Gx」，点名该步受哪道工序约束，可顺着徽标跳到对应工序细读',
      '实体节点步骤给出 11 个业务语义属性在这条推荐上的真实填法，说明为什么不能只抽项目名称',
      '实体归一步骤给出归一前后对照：STEMI → I21.300x004、直接 PCI → K_OPERATION_HANDLE_DICT，以及"肌钙蛋白升高属于 ExamObservation 而非 LabSubitem"这条最易错口径',
      '三元组步骤给出真实可比的 nodes.jsonl / relations.jsonl 两行示例，四条关系与 formal_recommendation 标记全落到字段',
      '新增「同一句话，走错会变成什么」4 行对照表：不抽用途 / 疾病直连 PCI / 三名一实体 / 肌钙蛋白升高当细项',
      '15 处最长正文块改为「》》展开完整说明」点击展开，正文只留一句话提要，长段落不再堆砌',
      'VERSION 提升至 1.3.4；版本戳全站统一为 2026092915'
    ]},
    { v: 'v1.3.3 · AI图谱解析瘦身', date: '2026-09-29', items: [
      'AI图谱解析（ai-parse.html）整体大幅精简：把两张又大又细的示意图（四阶段流程图、四层技术架构图）换成一行式紧凑版，去掉重复的九宫格流水线色块，首屏信息量明显下降',
      '「工作原理」一章由"色块图＋大流程图＋重复提示条＋三张卡＋大架构图＋16 行参数表"压缩为"一行流程条＋三道闸门卡＋一行架构条"，同类信息只保留一处',
      '九道工序精简为一条横向流程条：每道工序一个方块，方块内标注名称与一句话职责，三道硬闸门直接标在对应工序上，底部保留四色阶段图例与 G6 返工说明',
      '技术架构精简为四行式列表：输入层 / 解析执行层 / 标准与契约层 / 存储与交付层，每行左侧层名、右侧一句话职责与关键文件，底部保留层间硬约束',
      '第 2–4 章深水区章节默认折叠：首屏只保留「总览」与「工作原理」两章，其余章节收起到标题；点击目录锚点会自动展开目标章节，折叠不影响跳转',
      '「16 项批次参数一览」表格默认折叠，需点击标题展开；展开状态与其他子折叠块互不干扰',
      '「总览」开篇与「它解决什么」文案压缩：五张规则卡合并为「常见问题 / 工具怎么堵」两列表格，保留全部五组口径',
      'VERSION 提升至 1.3.3；版本戳全站统一为 2026092915'
    ]},
    { v: 'v1.3.2 · AI图谱解析', date: '2026-09-29', items: [
      '新增「🤖 AI图谱解析」模块（ai-parse.html）：与「Schema标准」同级的文档型页面，把 Skill V5.1 技能文档翻译成过程需求视角的中文说明',
      '九道工序全景：G0 范围预检 → G1 资料台账 → G2 教材骨架 → G3 指南精修（含 G3.1 阶段任务链 / G3.2 关系矩阵）→ G4 字典归一 → G5 图谱生成 → G6 质量审计 → G7 受控写库 → G8 复核交接',
      '工作原理与三道硬闸门（范围闸/知识闸/落库闸），说明"只读产出在前、写库只在 G7"的设计动机',
      '关键规则：标准字典六级匹配 + 疾病结构 + 检查检验治疗边界 + 证据六级优先级 + 专病扩展 8 槽位',
      '底线与交付：G6 三十条必查项四组归并、11 条禁止事项与发布闸门、产出物清单、术语对照表',
      '图谱架构规范（standard.html）新增「速览」页首：一页看懂规模与定位、一条知识走完全程（AMI 双栏口径对照）、四个问题看懂骨架',
      '图谱架构规范新增「产品视角 / 技术视角」切换：产品视角默认折叠 63 类实体类型、122 类关系、字段标准三类查阅型章节（标题出现「技术细节·点击展开」），跳转锚点自动展开',
      '图谱架构规范切换视角时新增首屏可见反馈：切换条下方「视角差异提示条」实时改写文案并高亮闪动，同时底部弹出切换结果浮层——修复"点按钮后首屏无任何变化、误以为无法切换"的问题',
      '数据质量硬闸门 28 条改为「人话解读 + 不通过会怎样 + 技术原文」四列表格：第一列编号，第二列用非技术语言说明这条规则要求什么，第三列说明违反后的临床或业务后果，第四列保留原始技术表述；产品视角隐藏技术原文列，技术视角完整显示',
      '数据质量硬闸门新增开头解读条：以入库流水线类比说明"闸门"含义，点明任一条不合规即整批数据不得标记为正式 CDSS 可用；该解读条在技术视角自动隐藏',
      '图谱架构规范速览首屏新增「同一个规范，两种读法」对照卡：卡片随顶部视角按钮整块互换，产品视角讲覆盖范围与医生端四类提示，技术视角讲 63 种实体类型 / 122 种关系类型 / 字段约定与疾病结构约束——修复"停在页首点视角按钮时首屏无任何变化"的问题',
      'AI图谱解析新增「解析流程图」：G0–G8 九道工序按四个阶段（只读准备 / 抽取与归一 / 生成与审计 / 受控落库）横向展开，每格标注产出文件并标出三道硬闸门所在位置，底部补充 G6 不通过的返工闭环',
      'AI图谱解析新增「技术架构图」：输入层 / 解析执行层 / 标准与契约层 / 存储与交付层四层结构，每层说明职责、关键组成与固定程序入口，并附 AMI 贯通四层的实例链路与层间硬约束',
      '导航新增第 11 个入口；VERSION 提升至 1.3.2；版本戳全站统一为 2026092915'
    ]},
    { v: 'v1.3.1 · 4001整改', date: '2026-09-19', items: [
      '全站新增版本信息条：Schema标准/实例版本一致性/解析Skill/G8回读时间/前端与API版本',
      '导航补齐11个功能菜单：路径编辑、临床审核、指南库',
      '就绪状态修正：数据覆盖分析改为 结构/实例/审核/可用 四层判定，删除数量阈值误判',
      '推荐接口整改：受阻(blocked/待审核)推荐与可用推荐分离展示，不再混入推荐结果',
      '推荐闭环字段补齐：规则/阶段/路径通过关系回填，证据改读supported_by_evidence，缺失项明确标注',
      '统计口径统一：区分"图谱实例数"与"已映射CDSS标准字典数"',
      '新增图谱结构注册表API /api/kg/schema-registry（91实体类型+128关系类型）',
      '修复：恢复API动态数据模式与共享基础函数（loadDiseaseData/DIM_COLORS/cleanName等），页面数据恢复正常'
    ]},
    { v: 'v1.0.0', date: '2026-06-26', items: [
      '新增心血管内科专科知识图谱 Web 测试平台',
      '新增专病知识总览驾驶舱，按疾病大类展示维度完整率',
      '新增图谱探索工作台，融合疾病视角、关系视角、实体视角',
      '新增数据覆盖分析热力图',
      '新增临床诊断模拟，支持多维度加权匹配',
      '新增图谱数据字典，展示实体类型、关系类型、疾病分类',
      '新增 Schema 标准定义页，展示建模规范和字段约束',
      '新增医学术语知识库，按维度分类浏览所有术语',
      '新增系统配置页，支持动态配置 Neo4j 服务器地址',
      '已部署到服务器 192.168.3.27:4001'
    ]}
  ];
  var html = '';
  list.forEach(function(release) {
    html += '<div style="margin-bottom:18px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:14px;font-weight:800;color:var(--ink)">' + release.v + '</span><span style="font-size:11px;color:#555;background:var(--bg3);padding:2px 8px;border-radius:6px">' + release.date + '</span></div><ul style="list-style:none;padding:0;margin:0">';
    release.items.forEach(function(item) {
      html += '<li style="font-size:12px;color:var(--muted);padding:3px 0;line-height:1.6;padding-left:12px;position:relative"><span style="position:absolute;left:0;color:#51cf66">●</span>' + item + '</li>';
    });
    html += '</ul></div>';
  });
  var el = document.getElementById('changelog-list');
  if (el) el.innerHTML = html;
}

// 导出函数到 window 对象
window.showChangelog = showChangelog;
window.hideChangelog = hideChangelog;

/* Entity Modal */
function showEntityModal(diseaseCode,dimKey,entityCode) {
  if(!KG_DATA)return;
  var data=KG_DATA.diseases[diseaseCode],dims=data.dimensions,items=dims[dimKey]||[];
  var entity=null;
  for(var i=0;i<items.length;i++){if(items[i].code===entityCode){entity=items[i];break;}}
  if(!entity)return;
  var h='<button class="modal-close" onclick="closeModal()">&times;</button>';
  h+='<h3>'+entity.name+'</h3>';
  h+='<div class="modal-code">'+(entity.code||'N/A')+' · '+DIM_NAMES[dimKey]+' · '+data.info.name+'</div>';
  var rows=[
    ['疾病',data.info.name+' ('+data.info.code+')'],
    ['维度',DIM_NAMES[dimKey]+' ('+dimKey+')'],
    ['实体名称',entity.name],
    ['实体编码',entity.code||'无'],
    ['同维度总数',items.length+' 个'+DIM_NAMES[dimKey]],
    ['疾病证据数',(data.evidence_count||0)+' 条'],
    ['疾病总关系',(data.relations_summary?data.relations_summary.length:0)+' 条']
  ];
  rows.forEach(function(r){h+='<div class="modal-row"><div class="modal-label">'+r[0]+'</div><div class="modal-value">'+r[1]+'</div></div>';});
  if(data.relations_summary){
    var rels=data.relations_summary.filter(function(r){return r.name===entity.name;});
    if(rels.length>0){
      h+='<div class="modal-row"><div class="modal-label">关联关系</div><div class="modal-value">';
      rels.forEach(function(r){h+='<div style="margin-bottom:2px">→ '+r.rel+' → '+r.name+' ('+r.labels.join(', ')+')</div>';});
      h+='</div></div>';
    }
  }
  document.getElementById('modal-content').innerHTML=h;
  document.getElementById('entity-modal').classList.add('show');
}
function closeModal(){var m=document.getElementById('entity-modal');if(m)m.classList.remove('show');}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()});
