/* 全局版本号 — 从 API 动态获取，版本文件为 /VERSION */
var APP_VERSION = 'v1.5.0';  // 默认值，API 加载后自动覆盖
var APP_VERSION_DATE = '2026-07-13';

/* 启动时从 API 获取版本号 */
(function(){
  fetch('/api/kg/version').then(function(r){return r.json()}).then(function(d){
    if(d && d.version){ APP_VERSION='v'+d.version.replace(/^v/,''); }
  }).catch(function(){});
})();

/* === 专科知识图谱 · 共享应用逻辑 === */
var KG_DATA = null;
var DIM_NAMES = {Symptom:'症状',Sign:'体征',ExamItem:'检查项目',LabItem:'检验项目',ExamObservation:'检查发现',LabSubitem:'检验细项',Medication:'药物',Procedure:'手术',RiskFactor:'危险因素',Complication:'并发症',DifferentialDiagnosis:'鉴别诊断',RiskStratification:'风险分层',Prognosis:'预后',FollowUp:'随访',TreatmentPlan:'治疗方案',DiagnosisCriteria:'诊断标准',Etiology:'病因',Epidemiology:'流行病学',Pathophysiology:'病理生理',Evidence:'证据',Guideline:'指南',ThresholdRule:'阈值规则',Prevention:'预防',Definition:'定义',StandardDiagnosis:'标准诊断',Contraindication:'禁忌',ClinicalRule:'临床规则',NursingCarePlan:'护理计划',NursingAssessment:'护理评估',NursingDiagnosis:'护理诊断'};
var DIM_KEYS = Object.keys(DIM_NAMES);
/* 核心临床维度（用于覆盖度计算） */
var CORE_DIM_KEYS = ['Symptom','Sign','ExamItem','LabItem','Medication','Procedure','RiskFactor','Complication','DifferentialDiagnosis','RiskStratification','Prognosis','FollowUp','TreatmentPlan','DiagnosisCriteria','Etiology','Epidemiology','Pathophysiology'];
/* 全局维度颜色（对象+数组两种形式，供各页面统一引用） */
var DIM_COLORS = {Symptom:'#51cf66',Sign:'#cc5de8',ExamItem:'#22b8cf',LabItem:'#748ffc',ExamObservation:'#845ef7',LabSubitem:'#b197fc',Medication:'#ff922b',Procedure:'#f06595',RiskFactor:'#ff6b6b',Complication:'#ffd43b',DiagnosisCriteria:'#94d82d',TreatmentPlan:'#66d9e8',Etiology:'#fcc419',DifferentialDiagnosis:'#ea7ccc',RiskStratification:'#a9e34b',Prognosis:'#63e6be',FollowUp:'#fcc419',Epidemiology:'#da77f2',Pathophysiology:'#748ffc',Evidence:'#40c057',Guideline:'#fab005',ThresholdRule:'#20c997',Prevention:'#20c997',Definition:'#748ffc',StandardDiagnosis:'#ff922b',Contraindication:'#ff6b6b',ClinicalRule:'#339af0',NursingCarePlan:'#0ca678',NursingAssessment:'#15aabf',NursingDiagnosis:'#e64980'};
var DIM_COLORS_ARR = DIM_KEYS.map(function(k){return DIM_COLORS[k]});
/* V2.0 三层架构分组 */
var THREE_LAYERS = {
  knowledge: {
    name: '疾病知识层', icon: '📖', color: '#4f8cff', borderColor: 'rgba(79,140,255,.3)',
    desc: '这个病是什么、有哪些表现、如何检查和治疗',
    dims: ['Definition','Symptom','Sign','ExamItem','ExamObservation','LabItem','LabSubitem','Medication','Procedure','TreatmentPlan','NursingCarePlan','NursingAssessment','NursingDiagnosis','Etiology','Pathophysiology','Epidemiology','RiskFactor','Complication','Prognosis','FollowUp','Prevention','DifferentialDiagnosis','RiskStratification','DiagnosisCriteria','ThresholdRule','Contraindication','ClinicalRule']
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
/* 动态注入维度数量：替换页面中所有 .dcp 占位符 */
function injectDimCount() {
  var els = document.querySelectorAll('.dcp');
  for (var i = 0; i < els.length; i++) {
    els[i].textContent = CORE_DIM_KEYS.length;
    els[i].className = '';
  }
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

/* 临床展示名清理：display_name > preferred_name > name > code，兜底去前缀 */
var _PREFIX_PATTERNS = [
  'AMI诊断明细：','STEMI诊断明细：','NSTEMI诊断明细：',
  'AMI鉴别：','STEMI鉴别：','NSTEMI鉴别：',
  'AMI诊断明细:','STEMI诊断明细:','NSTEMI诊断明细:',
  'AMI鉴别:','STEMI鉴别:','NSTEMI鉴别:',
];
/* 技术编码前缀：如果 name 以这些开头，说明是未清理的技术名 */
var _CODE_PREFIX_RE = /^(EXAM-|RULE-|DXC-|STAGE-|REC-|EVD-|SRC-DOC-|PATHWAY-|DIS-|SUB-CARD-)/;
function cleanName(entity) {
  var raw = entity.display_name || entity.preferred_name || entity.name || entity.code || '';
  // 兜底去疾病/用途前缀
  for (var i = 0; i < _PREFIX_PATTERNS.length; i++) {
    if (raw.indexOf(_PREFIX_PATTERNS[i]) === 0) {
      raw = raw.substring(_PREFIX_PATTERNS[i].length).replace(/^\s+/, '');
      break;
    }
  }
  // 如果清理后仍是技术编码，尝试用 preferred_name 或 code
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

/* Data loading - 动态API模式 */
function loadData(callback) {
  if (KG_DATA && KG_DATA._loaded) { callback(KG_DATA); return; }
  // 并行加载疾病列表 + 全局统计
  Promise.all([
    fetch('/api/kg/diseases?v=' + Date.now()).then(function(r){return r.json()}),
    fetch('/api/kg/stats?v=' + Date.now()).then(function(r){return r.json()})
  ]).then(function(results){
    var diseaseList = results[0];
    var stats = results[1];
    var diseases = {};
    diseaseList.forEach(function(d){
      // 建骨架对象，含 dim_counts 用于 getCoverage
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
    // 降级到静态JSON
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

/* 批量加载所有疾病完整数据（1次请求替代76次） */
function loadAllDiseaseData(callback) {
  /* 1. 检查内存缓存 */
  if (KG_DATA && KG_DATA._allLoaded) { callback(KG_DATA); return; }
  
  /* 2. 检查 sessionStorage 缓存 */
  try {
    var cached = sessionStorage.getItem('kg_all_diseases');
    if (cached) {
      var parsed = JSON.parse(cached);
      /* 恢复到 KG_DATA */
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
      /* 缓存到 sessionStorage */
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
  DIM_KEYS.forEach(function(k){
    var it = diseaseData.dimensions[k];
    if(it && it.length){
      diseaseData.dimensions[k] = it.filter(function(e){ return e.status !== 'deprecated'; });
    }
  });
}

function getCoverage(code) {
  if(!KG_DATA||!KG_DATA.diseases[code])return 0;
  var d=KG_DATA.diseases[code];
  // 使用17核心维度计算覆盖度
  var keys = CORE_DIM_KEYS;
  if(d._loaded && d.dimensions) {
    var f=0;
    keys.forEach(function(k){if(d.dimensions[k]&&d.dimensions[k].length>0)f++});
    return(f/keys.length)*100;
  }
  if(d.dim_counts) {
    var f=0;
    keys.forEach(function(k){if(d.dim_counts[k]&&d.dim_counts[k]>0)f++});
    return(f/keys.length)*100;
  }
  return 0;
}
function covClass(c){return c===100?'cov-full':c>=70?'cov-good':c>=40?'cov-mid':'cov-low';}

/* 获取默认疾病code：第一个疾病大类下的第一个疾病（按覆盖度排序） */
function getDefaultDiseaseCode(){
  if(!KG_DATA||!KG_DATA.diseases)return null;
  var ds=KG_DATA.diseases,groups={};
  Object.keys(ds).forEach(function(code){
    var info=ds[code].info,g=parseParentCode(info.parent).group;
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
  var pages = [
    {id:'index',label:'数据总览',icon:'📊'},
    {id:'explore',label:'图谱探索',icon:'🧭'},
    {id:'network',label:'网络探索',icon:'🕸️'},
    {id:'heatmap',label:'专病诊疗框架覆盖分析',icon:'🔬'},
    {id:'schema',label:'图谱数据审核',icon:'📐'},
    {id:'standard',label:'图谱架构规范',icon:'📘'},
    {id:'guideline',label:'指南库',icon:'📋'},
    {id:'terminology',label:'医学术语库',icon:'🧬'},
    {id:'specialty-cdss-prototype',label:'专科辅助诊疗',icon:'🩺',external:true}
  ];
  var cfg = getServerConfig();
  var h = '<a class="nav-brand" href="index.html">🏥 专科知识图谱 · 心血管内科</a><div class="nav-links">';
  pages.forEach(function(p){
    var cls = 'nav-link'+(activePage===p.id?' active':'');
    var target = p.external ? ' target="_blank"' : '';
    h += '<a class="'+cls+'" href="'+p.id+'.html"'+target+'>'+p.icon+' '+p.label+'</a>';
  });
  h += '</div><div class="nav-right">';
  h += '<a class="nav-config-btn" href="config.html" title="系统配置">⚙</a>';
  h += '</div>';
  document.querySelector('.nav').innerHTML = h;
  renderFooter();
}

/* Footer & Changelog */
function renderFooter() {
  // 如果已存在则跳过
  if (document.getElementById('app-footer')) return;
  var footer = document.createElement('div');
  footer.id = 'app-footer';
  footer.style.cssText = 'text-align:center;padding:24px;font-size:11px;color:#8b90a0;border-top:1px solid #2e3348;margin-top:32px';
  footer.innerHTML = '专科知识图谱 · 心血管内科 <a href="javascript:void(0)" onclick="showChangelog()" style="color:#4f8cff;margin-left:6px">' + APP_VERSION + '</a> <span style="margin-left:6px;color:#555">|</span> Neo4j 实时数据 <span style="margin-left:6px;color:#555">|</span> <a href="https://github.com/liushixinjun/cardiology-kg-web" target="_blank" style="color:#8b90a0;margin-left:6px">GitHub</a>';
  
  // 检查弹窗是否已存在，不存在则创建
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
    { v: 'v1.5.0', date: '2026-07-13', items: [
      '新增6个事件类型：入院登记/转科/病情变化/生命体征报警/随访就诊/再入院',
      '新增5个自动动作：转ICU/升级治疗/通知上级医师/启动急救团队/再入院流程',
      '新增pathway_stage节点类型（门急诊/住院/ICU/随访阶段标记）',
      'AMI案例升级为完整闭环路径：门急诊→住院→病情加重ICU升级→随访→恶化再入院',
      'AMI新增ICU升级路径（心源性休克转ICU/Code Blue急救/ICU高级治疗/脱机评估）',
      'AMI新增随访恶化再入院闭环（随访异常→再入院→重新住院）',
      'HTN模板升级：新增start节点/准入规则/住院阶段/血压达标ICU升级路径',
      'HF模板升级：新增完整闭环（住院容量管理+心衰加重ICU升级+随访再入院）',
      'AF模板升级：新增完整闭环（住院抗凝管理+血流动力学不稳定紧急复律+随访卒中再入院）',
      '所有模板统一新格式：rules[]/events[]/entry_rules/state/output_type/auto_actions'
    ]},
    { v: 'v1.4.2', date: '2026-07-13', items: [
      '修复P0: buildFlowData/loadFlowData 连线导出导入补全rules/rule_result，解决规则数据丢失',
      '修复P0: generateDroolsDRL 升级支持新rules[]数组、准入规则、连线规则、医嘱类别规则',
      '修复P0: runSimulation 升级为完整路径流转模拟（准入检查→规则执行→推荐来源→路径遍历）',
      '修复P1: validateFlow 新增准入规则/推荐来源/连线规则一致性校验',
      '修复P1: compilePathway 编译准入规则/连线规则/推荐来源',
      '修复P1: showPathStats 新增连线规则/准入规则/推荐来源统计',
      '清理P2: 移除废弃的addDecisionRule/removeDecisionRule函数'
    ]},
    { v: 'v1.4.1', date: '2026-07-13', items: [
      '连接线规则：移除图谱/混合选项，仅保留Drools规则引擎',
      '疾病准入规则：同步精简为仅Drools',
      '业务组件新增推荐来源配置：医嘱类别推荐（检验/检查/药物/手术介入）',
      '业务组件新增Dify智能体推荐：可配置Agent API地址和描述',
      '业务组件新增图谱推荐：可配置图谱规则编码'
    ]},
    { v: 'v1.4.0', date: '2026-07-13', items: [
      '条件分支组件：开发备注移除，判断条件改造为规则选择器（Drools/Graph/混合）',
      '疾病入口节点：疾病编码/疾病名称/入选条件移除，新增ICD-10准入规则绑定',
      '新增开始节点：AMI路径入口，流程起点',
      '所有节点：开发备注统一移除'
    ]},
    { v: 'v1.3.0', date: '2026-07-06', items: [
      '统计口径对齐Codex验收标准：疾病大类12、可视化实体1,145、关系99,269',
      '诊断模拟结果卡片新增诊疗指南依据展示，推理有据可循',
      '全局缓存管理：server.py所有静态文件统一no-cache策略，彻底解决版本缓存问题',
      '版本号全局统一管理：APP_VERSION集中定义，底部版本号自动跟随',
      '默认疾病选择改为动态取第一个疾病大类下覆盖度最高的疾病',
      'Redis缓存部署，提升API响应性能'
    ]},
    { v: 'v1.2.0', date: '2026-06-27', items: [
      '重新从 Neo4j 导出最新数据快照，修复旧静态数据导致的空壳实体问题',
      '图谱展示支持二跳展开：TreatmentPlan→includes_medication/includes_procedure，Medication→has_specific_medication',
      '自动过滤空壳实体名（鉴别诊断/诊断标准/危险分层/预后良好/预后不良等）',
      '页面底部新增数据源信息栏：导出时间、节点数、关系数、空壳实体数',
      '节点去重改为按 code 去重'
    ]},
    { v: 'v1.1.4', date: '2026-06-27', items: [
      '修复网络探索图谱空白/空数据问题，节点与关系构建改为去重后再渲染',
      '优化力导向图布局参数，默认图谱进入页面即可散开显示',
      '右侧详情默认保持图谱概览，避免鼠标移出后回到空状态'
    ]},
    { v: 'v1.1.2', date: '2026-06-26', items: [
      '优化网络探索默认首屏，进入页面自动选择高价值示例疾病并展示关联网络',
      '新增图谱引导浮层、推荐探索节点、右侧默认概览与可见节点/关系统计',
      '修复网络探索维度计数在默认疾病选中后不刷新的问题',
      '减少页面可见英文标签，实体标签和补充说明统一中文展示'
    ]},
    { v: 'v1.1.1', date: '2026-06-26', items: [
      '修复网络探索页面缺少共享导航的问题',
      '调整网络探索页面布局高度，适配顶部导航栏',
      '首页和全局菜单均可进入网络探索'
    ]},
    { v: 'v1.1.0', date: '2026-06-26', items: [
      '新增网络探索页面，支持节点点击展开、三级探索、路径模式和全屏浏览',
      '左侧支持多维度筛选，右侧展示实体详情、标签颜色和关联疾病'
    ]},
    { v: 'v1.0.0', date: '2026-06-26', items: [
      '新增心血管内科专科知识图谱 Web 测试平台',
      '新增专病知识总览驾驶舱，按疾病大类展示17维度完整率',
      '新增图谱探索工作台，融合疾病视角、关系视角、实体视角',
      '新增数据覆盖分析热力图，77种专病×17维度',
      '新增临床诊断模拟，支持17维度加权匹配',
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
