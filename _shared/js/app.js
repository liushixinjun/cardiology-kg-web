/* === 专科知识图谱 · 共享应用逻辑 === */
var KG_DATA = null;
var DIM_NAMES = {Symptom:'症状',Sign:'体征',Exam:'检查',LabTest:'检验',Medication:'药物',Procedure:'手术',RiskFactor:'危险因素',Complication:'并发症',DifferentialDiagnosis:'鉴别诊断',RiskStratification:'风险分层',Prognosis:'预后',FollowUp:'随访',TreatmentPlan:'治疗方案',DiagnosisCriteria:'诊断标准',Etiology:'病因',Epidemiology:'流行病学',Pathophysiology:'病理生理'};
var DIM_KEYS = Object.keys(DIM_NAMES);

/* 二级层级映射：从 parentCode 提取大类前缀 → 大类名 + 子类名 */
function parseParentCode(pc) {
  if (!pc) return { group: '其他', sub: '' };
  var parts = pc.replace('SUB-CARD-', '').split('-');
  var main = parts[0];
  var sub = parts.length > 1 ? parts.slice(1).join('-') : '';
  var groupMap = {
    'HF':'心力衰竭','ARR':'心律失常','CAD':'冠心病','CM':'心肌病',
    'VHD':'瓣膜性心脏病','PERICARD':'心包疾病','HTN':'高血压',
    'CHD':'先天性心脏病','IE':'感染性心内膜炎','SCD':'心脏骤停/猝死',
    'AORTA':'主动脉/外周血管','PAD':'外周血管','NEUROSIS':'心脏神经症'
  };
  var subMap = {
    'GENERAL':'','ACS':'急性冠脉综合征','CHRONIC':'慢性冠脉综合征',
    'PHENOTYPE':'表型分类','ARRHYTHMIC':'致心律失常型','ATRIAL':'心房型','SPECIAL':'特殊类型'
  };
  return { group: groupMap[main] || main, sub: subMap[sub] || sub };
}
var GROUP_ICONS = {'心力衰竭':'❤️','心律失常':'💓','冠心病':'🫀','心肌病':'🔬','瓣膜性心脏病':'🫀','心包疾病':'🫀','高血压':'💊','先天性心脏病':'👶','感染性心内膜炎':'🦠','心脏骤停/猝死':'🚑','主动脉/外周血管':'🩸','外周血管':'🩸','心脏神经症':'🧠'};

/* Server config */
function getServerConfig() {
  var defaults = { url: 'bolt://192.168.3.27:7687', user: 'neo4j', password: 'zysoft@2024', httpUrl: 'http://192.168.3.27:7474' };
  try { var saved = localStorage.getItem('kg_server_config'); return saved ? JSON.parse(saved) : defaults; } catch(e) { return defaults; }
}
function saveServerConfig(cfg) { localStorage.setItem('kg_server_config', JSON.stringify(cfg)); }

/* Data loading */
function loadData(callback) {
  if (KG_DATA) { callback(KG_DATA); return; }
  fetch('./assets/kg_full_data.json').then(function(r){return r.json()}).then(function(d){KG_DATA=d;callback(d)}).catch(function(e){console.error('Load failed:',e)});
}

function getCoverage(code) {
  if(!KG_DATA||!KG_DATA.diseases[code])return 0;
  var dims=KG_DATA.diseases[code].dimensions,f=0;
  DIM_KEYS.forEach(function(k){if(dims[k]&&dims[k].length>0)f++});
  return(f/DIM_KEYS.length)*100;
}
function covClass(c){return c===100?'cov-full':c>=70?'cov-good':c>=40?'cov-mid':'cov-low';}

/* Professional Nav — brand links back to index */
function renderNav(activePage) {
  var pages = [
    {id:'index',label:'数据总览',icon:'📊'},
    {id:'explore',label:'图谱探索',icon:'🧭'},
    {id:'heatmap',label:'数据覆盖分析',icon:'🗺️'},
    {id:'diagnosis',label:'临床诊断模拟',icon:'🔍'},
    {id:'schema',label:'图谱数据字典',icon:'📐'},
    {id:'standard',label:'Schema标准',icon:'📘'},
    {id:'terminology',label:'医学术语库',icon:'🧬'}
  ];
  var cfg = getServerConfig();
  var h = '<a class="nav-brand" href="index.html">🏥 专科知识图谱 · 心血管内科</a><div class="nav-links">';
  pages.forEach(function(p){
    h += '<a class="nav-link'+(activePage===p.id?' active':'')+'" href="'+p.id+'.html">'+p.icon+' '+p.label+'</a>';
  });
  h += '</div><div class="nav-right">';
  h += '<a class="nav-config-btn" href="config.html" title="系统配置">⚙</a>';
  h += '</div>';
  document.querySelector('.nav').innerHTML = h;
}

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
