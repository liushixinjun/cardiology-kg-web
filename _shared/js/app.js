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
var DIM_COLORS = {
  Symptom:'#51cf66', Sign:'#cc5de8',
  ExamItem:'#22b8cf', ExamObservation:'#845ef7', LabItem:'#748ffc', LabSubitem:'#b197fc',
  Drug:'#ff922b', Medication:'#ff922b', Procedure:'#f06595',
  RiskFactor:'#ff6b6b', Complication:'#ffd43b', DifferentialDiagnosis:'#ea7ccc',
  RiskStratification:'#a9e34b', Prognosis:'#63e6be', FollowUp:'#fcc419',
  TreatmentPlan:'#66d9e8', DiagnosisCriteria:'#94d82d',
  Etiology:'#fcc419', Epidemiology:'#da77f2', Pathophysiology:'#748ffc',
  Evidence:'#40c057', Guideline:'#fab005', ThresholdRule:'#20c997',
  Prevention:'#20c997', Definition:'#748ffc', StandardDiagnosis:'#ff922b', Contraindication:'#ff6b6b',
  ClinicalRule:'#339af0',
  NursingCarePlan:'#0ca678', NursingAssessment:'#12b886', NursingDiagnosis:'#20c997'
};
var DIM_COLORS_ARR = DIM_KEYS.map(function(k){ return DIM_COLORS[k] || '#4f8cff' });
/* 新维度自动配色盘（动态注册时兜底） */
var DIM_COLOR_PALETTE = ['#4f8cff','#51cf66','#cc5de8','#22b8cf','#748ffc','#ff922b','#f06595','#ff6b6b','#ffd43b','#94d82d','#66d9e8','#fcc419','#ea7ccc','#a9e34b','#63e6be','#da77f2','#20c997','#845ef7','#b197fc','#339af0'];

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
    name: '疾病知识层', icon: '📖', color: '#4f8cff', borderColor: 'rgba(79,140,255,.3)',
    desc: '这个病是什么、有哪些表现、如何检查和治疗',
    dims: ['Definition','Symptom','Sign','ExamItem','ExamObservation','LabItem','LabSubitem','Drug','Procedure','TreatmentPlan','Etiology','Pathophysiology','Epidemiology','RiskFactor','Complication','Prognosis','FollowUp','Prevention','DifferentialDiagnosis','RiskStratification','DiagnosisCriteria','ThresholdRule','Contraindication','ClinicalRule','NursingCarePlan','NursingAssessment','NursingDiagnosis']
  },
  masterdata: {
    name: 'CDSS标准主数据层', icon: '🏷️', color: '#ff922b', borderColor: 'rgba(255,146,43,.3)',
    desc: '如何对应系统标准字典和医嘱/诊断编码',
    dims: ['StandardDiagnosis']
  },
  decision: {
    name: '临床决策层', icon: '🧠', color: '#51cf66', borderColor: 'rgba(81,207,102,.3)',
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
})();
function getEntityLayer(dimKey) { return ENTITY_LAYER_MAP[dimKey] || 'knowledge'; }
function getLayerInfo(layerKey) { return THREE_LAYERS[layerKey] || THREE_LAYERS.knowledge; }

/* 维度数量注入：把页面中 .dcp 占位数字替换为实际核心维度数 */
function injectDimCount() {
  var els = document.querySelectorAll('.dcp');
  for (var i = 0; i < els.length; i++) els[i].textContent = CORE_DIM_KEYS.length;
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
  var defaults = { url: 'bolt://192.168.3.27:7687', user: 'neo4j', password: 'zysoft@2024', httpUrl: 'http://192.168.3.27:7474' };
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
    fetch('/api/kg/dimensions?v=' + Date.now()).then(function(r){return r.json()}).catch(function(){return null})
  ]).then(function(results){
    var diseaseList = results[0];
    var stats = results[1];
    if (results[2]) applyDimRegistry(results[2]);  /* 先应用口径，再回调渲染 */
    var diseases = {};
    diseaseList.forEach(function(d){
      diseases[d.code] = { info: d, dimensions: {}, dim_counts: d.dim_counts || {}, relations_summary: [], evidence_count: 0, _loaded: false };
    });
    KG_DATA = {
      diseases: diseases,
      stats: stats,
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
    return Math.round(f/CORE_DIM_KEYS.length*100);
  }
  if(d.dim_counts) {
    CORE_DIM_KEYS.forEach(function(k){
      var c=d.dim_counts[k];
      if(!c&&CORE_DIM_ALIAS[k]) c=d.dim_counts[CORE_DIM_ALIAS[k]];
      if(c&&c>0)f++;
    });
    return Math.round(f/CORE_DIM_KEYS.length*100);
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
  /* 10个功能菜单（数据总览/图谱探索/网络探索/数据覆盖分析/临床审核/图谱数据字典/
     Schema标准/指南库/医学术语库）+ 外部链接（专科辅助诊疗，新标签页打开）
     注：diagnosis.html(临床诊断模拟)、engine.html(路径编辑) 已作废并已从仓库移除 */
  var pages = [
    {id:'index',label:'数据总览',icon:'📊'},
    {id:'explore',label:'图谱探索',icon:'🧭'},
    {id:'network',label:'网络探索',icon:'🕸️'},
    {id:'heatmap',label:'数据覆盖分析',icon:'🗺️'},
    {id:'review',label:'临床审核',icon:'✅'},
    {id:'schema',label:'图谱数据字典',icon:'📐'},
    {id:'standard',label:'Schema标准',icon:'📘'},
    {id:'guideline',label:'指南库',icon:'📚'},
    {id:'terminology',label:'医学术语库',icon:'🧬'},
    {id:'specialty-cdss-prototype',label:'专科辅助诊疗',icon:'🩺',external:true}
  ];
  var cfg = getServerConfig();
  var h = '<a class="nav-brand" href="index.html">🏥 专科知识图谱 · 心血管内科</a><div class="nav-links">';
  pages.forEach(function(p){
    var target = p.external ? ' target="_blank"' : '';
    h += '<a class="nav-link'+(activePage===p.id?' active':'')+'" href="'+p.id+'.html"'+target+'>'+p.icon+' '+p.label+'</a>';
  });
  h += '</div><div class="nav-right">';
  h += '<a class="nav-config-btn" href="config.html" title="系统配置">⚙</a>';
  h += '</div>';
  document.querySelector('.nav').innerHTML = h;
  renderFooter();
  renderVersionBar();
}

/* 4001整改 3.1：全站版本信息条 — 显示当前实际数据版本
   Schema标准版本 / 实例版本一致性 / 解析Skill版本 / G8回读时间 / 前端+API版本 */
var KG_VERSION_INFO = null;
function renderVersionBar() {
  var bar = document.getElementById('kg-version-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'kg-version-bar';
    var nav = document.querySelector('.nav');
    if (nav && nav.parentNode) nav.parentNode.insertBefore(bar, nav.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
  }
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 18px;align-items:center;padding:6px 22px;font-size:11px;color:#9aa1b5;background:#151824;border-bottom:1px solid #262b3d;line-height:1.7';
  bar.innerHTML = '<span style="color:#6b7286">版本信息加载中…</span>';
  fetch('/api/kg/version').then(function(r){return r.json()}).then(function(v){
    KG_VERSION_INFO = v;
    var consistent = v.instance_version_consistent;
    var items = [];
    items.push('<span><span style="color:#6b7286">Schema标准</span> <b style="color:#dfe4f0">' + (v.schema_standard_version||'-') + '</b></span>');
    // 实例版本：统一/混合 两种呈现，不能只显示标准版本误导用户
    if (consistent) {
      var vs = Object.keys(v.instance_schema_versions||{});
      items.push('<span><span style="color:#6b7286">实例版本</span> <b style="color:#51cf66">统一 ' + (vs[0]||'-') + '</b></span>');
    } else {
      items.push('<span title="' + (v.version_label||'') + '"><span style="color:#6b7286">实例版本</span> <b style="color:#ffb020">混合 · 待迁移复核</b></span>');
    }
    items.push('<span><span style="color:#6b7286">解析Skill</span> <b style="color:#dfe4f0">' + (v.skill_version||'-') + '</b></span>');
    if (v.g8_readback_time) {
      items.push('<span><span style="color:#6b7286">G8回读</span> <b style="color:#dfe4f0">' + String(v.g8_readback_time).replace('T',' ').slice(0,16) + '</b></span>');
    } else if (v.data_updated_at) {
      items.push('<span title="无G8回读记录，显示数据最后更新时间"><span style="color:#6b7286">数据更新</span> <b style="color:#dfe4f0">' + String(v.data_updated_at).replace('T',' ').slice(0,16) + '</b></span>');
    }
    items.push('<span><span style="color:#6b7286">前端</span> <b style="color:#dfe4f0">v' + (v.app_version||'-') + '</b> <span style="color:#6b7286">/ API</span> <b style="color:#dfe4f0">' + (v.api_version||'-') + '</b></span>');
    if (!consistent) items.push('<span style="color:#ffb020">⚠ ' + (v.version_label||'实例版本混合，待迁移复核') + '</span>');
    bar.innerHTML = items.join('<span style="color:#39405a">|</span>');
    // 页脚版本号联动
    var fv = document.getElementById('footer-version');
    if (fv && v.app_version) fv.textContent = 'v' + v.app_version;
  }).catch(function(e){
    bar.innerHTML = '<span style="color:#ff6b6b">⚠ 版本信息获取失败（API不可达）</span>';
  });
}

/* Footer & Changelog */
function renderFooter() {
  if (document.getElementById('app-footer')) return;
  var footer = document.createElement('div');
  footer.id = 'app-footer';
  footer.style.cssText = 'text-align:center;padding:24px;font-size:11px;color:#8b90a0;border-top:1px solid #2e3348;margin-top:32px';
  footer.innerHTML = '专科知识图谱 · 心血管内科 <a href="javascript:void(0)" onclick="showChangelog()" style="color:#4f8cff;margin-left:6px" id="footer-version">v1.3.1</a> <span style="margin-left:6px;color:#555">|</span> <a href="https://github.com/liushixinjun/cardiology-kg-web" target="_blank" style="color:#8b90a0;margin-left:6px">GitHub</a>';

  if (!document.getElementById('changelog-modal')) {
    var modal = document.createElement('div');
    modal.id = 'changelog-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
    modal.innerHTML = '<div style="position:absolute;inset:0" onclick="hideChangelog()"></div><div style="position:relative;max-width:640px;margin:80px auto;background:#1a1d27;border:1px solid #2e3348;border-radius:14px;padding:28px 32px;max-height:70vh;overflow-y:auto"><button onclick="hideChangelog()" style="position:absolute;top:16px;right:18px;background:none;border:none;color:#8b90a0;font-size:20px;cursor:pointer">✕</button><h2 style="font-size:18px;font-weight:800;color:#e8eaf0;margin-bottom:6px">📋 更新记录</h2><div style="font-size:12px;color:#8b90a0;margin-bottom:20px">专科知识图谱 · 心血管内科 平台版本历史</div><div id="changelog-list"></div></div>';
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
    html += '<div style="margin-bottom:18px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:14px;font-weight:800;color:#e8eaf0">' + release.v + '</span><span style="font-size:11px;color:#555;background:#242836;padding:2px 8px;border-radius:6px">' + release.date + '</span></div><ul style="list-style:none;padding:0;margin:0">';
    release.items.forEach(function(item) {
      html += '<li style="font-size:12px;color:#8b90a0;padding:3px 0;line-height:1.6;padding-left:12px;position:relative"><span style="position:absolute;left:0;color:#51cf66">●</span>' + item + '</li>';
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
function closeModal(){document.getElementById('entity-modal').classList.remove('show');}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()});
