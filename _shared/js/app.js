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

/* Data loading - 动态API模式 */
function loadData(callback) {
  if (KG_DATA && KG_DATA._loaded) { callback(KG_DATA); return; }
  // 并行加载疾病列表 + 全局统计
  Promise.all([
    fetch('/api/kg/diseases').then(function(r){return r.json()}),
    fetch('/api/kg/stats').then(function(r){return r.json()})
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
  fetch('/api/kg/disease/' + encodeURIComponent(code)).then(function(r){return r.json()}).then(function(d){
    d._loaded = true;
    KG_DATA.diseases[code] = d;
    callback(d);
  }).catch(function(e){
    console.error('Load disease failed:', code, e);
    callback(null);
  });
}

function getCoverage(code) {
  if(!KG_DATA||!KG_DATA.diseases[code])return 0;
  var d=KG_DATA.diseases[code];
  // 优先用已加载的 dimensions
  if(d._loaded && d.dimensions) {
    var f=0;
    DIM_KEYS.forEach(function(k){if(d.dimensions[k]&&d.dimensions[k].length>0)f++});
    return(f/DIM_KEYS.length)*100;
  }
  // 降级用 dim_counts（骨架对象）
  if(d.dim_counts) {
    var f=0;
    DIM_KEYS.forEach(function(k){if(d.dim_counts[k]&&d.dim_counts[k]>0)f++});
    return(f/DIM_KEYS.length)*100;
  }
  return 0;
}
function covClass(c){return c===100?'cov-full':c>=70?'cov-good':c>=40?'cov-mid':'cov-low';}

/* Professional Nav — brand links back to index */
function renderNav(activePage) {
  var pages = [
    {id:'index',label:'数据总览',icon:'📊'},
    {id:'explore',label:'图谱探索',icon:'🧭'},
    {id:'network',label:'网络探索',icon:'🕸️'},
    {id:'heatmap',label:'数据覆盖分析',icon:'🗺️'},
    {id:'diagnosis',label:'临床诊断模拟',icon:'🔍'},
    {id:'review',label:'临床审核',icon:'✅'},
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
  renderFooter();
}

/* Footer & Changelog */
function renderFooter() {
  // 如果已存在则跳过
  if (document.getElementById('app-footer')) return;
  var footer = document.createElement('div');
  footer.id = 'app-footer';
  footer.style.cssText = 'text-align:center;padding:24px;font-size:11px;color:#8b90a0;border-top:1px solid #2e3348;margin-top:32px';
  footer.innerHTML = '专科知识图谱 · 心血管内科 <a href="javascript:void(0)" onclick="showChangelog()" style="color:#4f8cff;margin-left:6px">v1.2.0</a> <span style="margin-left:6px;color:#555">|</span> <a href="https://github.com/liushixinjun/cardiology-kg-web" target="_blank" style="color:#8b90a0;margin-left:6px">GitHub</a>';
  
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
