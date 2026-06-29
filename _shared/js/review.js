/* === 临床审核页面逻辑 === */
var REVIEW_DATA = null;
var CURRENT_TAB = 'disease';
/* 审核决策状态存储：{ reviewId: { field: value } } */
var REVIEW_DECISIONS = {};

/* ========== 数据加载 ========== */
function loadReviewData() {
  fetch('./assets/clinical_review_frontend_data.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      REVIEW_DATA = data;
      renderKPI(data.summary);
      renderDiseasePanel(data.disease_reviews);
      renderScenarioPanel(data.scenario_cards);
      renderPharmacistPanel(data.pharmacist_items);
      renderDetailPanel(data.detail_items || []);
    })
    .catch(function(e) {
      console.error('加载审核数据失败:', e);
      document.getElementById('panel-disease').innerHTML = '<div style="padding:40px;text-align:center;color:var(--accent2)">加载数据失败，请检查 assets/clinical_review_frontend_data.json 是否存在</div>';
    });
}

/* ========== KPI 指标 ========== */
function renderKPI(summary) {
  var kpis = [
    { num: summary.disease_review_count, label: '待审核疾病数', color: 'var(--accent)' },
    { num: summary.scenario_card_count, label: '待审核场景数', color: 'var(--cyan)' },
    { num: summary.pharmacist_item_count, label: '药师专项数', color: 'var(--purple)' },
    { num: summary.detail_item_count, label: '边级追溯数', color: 'var(--orange)' }
  ];
  var h = '';
  kpis.forEach(function(k) {
    h += '<div class="rv-kpi"><div class="num" style="color:' + k.color + '">' + k.num + '</div><div class="label">' + k.label + '</div></div>';
  });
  document.getElementById('rv-kpi').innerHTML = h;
}

/* ========== 疾病级审核 ========== */
function renderDiseasePanel(items) {
  var panel = document.getElementById('panel-disease');
  /* 提取批次列表 */
  var batches = {};
  items.forEach(function(r) { batches[r.batch_id] = 1; });

  var h = '<div class="rv-filters">';
  h += '<select id="disease-batch-filter" onchange="filterDiseases()"><option value="">全部批次</option>';
  Object.keys(batches).forEach(function(b) { h += '<option value="' + b + '">' + b + '</option>'; });
  h += '</select>';
  h += '<input id="disease-search" placeholder="搜索疾病名称或编码..." oninput="filterDiseases()">';
  h += '<span style="font-size:11px;color:var(--muted);margin-left:auto" id="disease-count"></span>';
  h += '</div>';

  h += '<div class="rv-table-wrap"><table class="rv-table"><thead><tr>';
  h += '<th>批次</th><th>疾病编码</th><th>疾病名称</th><th>待审核数</th><th>场景卡</th>';
  h += '<th>临床使用决策</th><th>风险等级</th><th>审核人</th><th>角色</th><th>审核时间</th><th>专家意见</th>';
  h += '</tr></thead><tbody id="disease-tbody">';

  items.forEach(function(r) {
    var rid = r.review_id;
    h += '<tr data-batch="' + r.batch_id + '" data-name="' + r.disease_name + '" data-code="' + r.disease_code + '">';
    h += '<td style="white-space:nowrap">' + r.batch_id + '</td>';
    h += '<td style="font-family:monospace;font-size:11px">' + r.disease_code + '</td>';
    h += '<td><b>' + r.disease_name + '</b></td>';
    h += '<td style="text-align:center">' + r.pending_recommendation_count + '</td>';
    h += '<td style="text-align:center">' + r.scenario_card_count + '</td>';
    h += '<td><select class="rv-decision" onchange="setDecision(\'' + rid + '\',\'clinical_use_decision\',this.value)">';
    h += '<option value="">请选择</option>';
    h += '<option value="可试用">可试用</option><option value="仅参考">仅参考</option>';
    h += '<option value="需修改">需修改</option><option value="禁用">禁用</option>';
    h += '</select></td>';
    h += '<td><select class="rv-decision" onchange="setDecision(\'' + rid + '\',\'overall_risk_level\',this.value)">';
    h += '<option value="">请选择</option>';
    h += '<option value="高">高</option><option value="中">中</option><option value="低">低</option>';
    h += '</select></td>';
    h += '<td><input style="width:90px" placeholder="姓名" onchange="setDecision(\'' + rid + '\',\'reviewer_name\',this.value)"></td>';
    h += '<td><select class="rv-decision" onchange="setDecision(\'' + rid + '\',\'reviewer_role\',this.value)">';
    h += '<option value="">请选择</option>';
    h += '<option value="临床专家">临床专家</option><option value="药学专家">药学专家</option><option value="信息专家">信息专家</option>';
    h += '</select></td>';
    h += '<td><input type="datetime-local" style="width:140px" onchange="setDecision(\'' + rid + '\',\'reviewed_at\',this.value)"></td>';
    h += '<td><textarea class="rv-comment" style="min-height:36px;width:180px" placeholder="专家意见（需修改/禁用时必填）" onchange="setDecision(\'' + rid + '\',\'expert_comment\',this.value)"></textarea></td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  panel.innerHTML = h;
  updateDiseaseCount();
}

function filterDiseases() {
  var batch = document.getElementById('disease-batch-filter').value;
  var q = document.getElementById('disease-search').value.toLowerCase();
  var rows = document.querySelectorAll('#disease-tbody tr');
  var shown = 0;
  rows.forEach(function(r) {
    var show = (!batch || r.dataset.batch === batch) && (!q || r.dataset.name.toLowerCase().indexOf(q) !== -1 || r.dataset.code.toLowerCase().indexOf(q) !== -1);
    r.style.display = show ? '' : 'none';
    if (show) shown++;
  });
  updateDiseaseCount(shown);
}
function updateDiseaseCount(n) {
  var el = document.getElementById('disease-count');
  if (el) el.textContent = '显示 ' + (n !== undefined ? n : document.querySelectorAll('#disease-tbody tr').length) + ' / ' + (REVIEW_DATA ? REVIEW_DATA.disease_reviews.length : 0);
}

/* ========== 场景级推荐审核 ========== */
function renderScenarioPanel(items) {
  var panel = document.getElementById('panel-scenario');
  var diseases = {}, types = {}, targetTypes = {};
  items.forEach(function(c) { diseases[c.disease_name] = 1; types[c.scenario_type] = 1; targetTypes[c.target_type] = 1; });

  var h = '<div class="rv-filters">';
  h += '<select id="sc-disease" onchange="filterScenarios()"><option value="">全部疾病</option>';
  Object.keys(diseases).sort().forEach(function(d) { h += '<option>' + d + '</option>'; });
  h += '</select>';
  h += '<select id="sc-type" onchange="filterScenarios()"><option value="">全部场景类型</option>';
  Object.keys(types).sort().forEach(function(t) { h += '<option>' + t + '</option>'; });
  h += '</select>';
  h += '<select id="sc-target" onchange="filterScenarios()"><option value="">全部目标类型</option>';
  Object.keys(targetTypes).sort().forEach(function(t) { h += '<option>' + t + '</option>'; });
  h += '</select>';
  h += '<input id="sc-search" placeholder="搜索样本目标..." oninput="filterScenarios()">';
  h += '<span style="font-size:11px;color:var(--muted);margin-left:auto" id="sc-count"></span>';
  h += '</div>';

  h += '<div id="sc-cards">';
  items.forEach(function(c) {
    var rid = c.review_id;
    h += '<div class="rv-card" data-disease="' + c.disease_name + '" data-type="' + c.scenario_type + '" data-target="' + c.target_type + '" data-search="' + (c.sample_targets || '') + ' ' + c.disease_name + ' ' + c.relation_type + '">';
    h += '<div class="rv-card-head"><div class="rv-card-title">' + c.disease_name + ' — ' + c.scenario_type + '</div>';
    h += '<div class="rv-badge pending">' + c.pending_item_count + ' 项待审</div></div>';
    h += '<div class="rv-card-meta">批次: ' + c.batch_id + ' | 关系: ' + c.relation_type + ' | 目标类型: ' + c.target_type + '</div>';
    h += '<div class="rv-card-fields"><b>示例目标:</b> ' + (c.sample_targets || '-') + '</div>';
    h += '<div class="rv-card-fields"><b>缺失字段:</b> ' + (c.missing_field_summary || '-') + '</div>';
    h += '<div class="rv-card-fields"><b>审核重点:</b> ' + (c.review_focus || '-') + '</div>';
    h += '<div class="rv-card-actions">';
    h += '<select class="rv-decision" onchange="setDecision(\'' + rid + '\',\'clinical_use_decision\',this.value)">';
    h += '<option value="">请选择决策</option>';
    h += '<option value="可试用">可试用</option><option value="仅参考">仅参考</option>';
    h += '<option value="需修改">需修改</option><option value="禁用">禁用</option>';
    h += '</select>';
    h += '<textarea class="rv-comment" style="min-height:36px" placeholder="专家意见" onchange="setDecision(\'' + rid + '\',\'expert_comment\',this.value)"></textarea>';
    h += '<button class="btn btn-outline" style="font-size:11px;padding:4px 10px" onclick="showScenarioDetails(\'' + rid + '\',\'' + c.parent_review_id + '\')">📋 查看边级证据</button>';
    h += '</div>';
    h += '<div class="rv-expand" id="expand-' + rid + '" style="display:none"></div>';
    h += '</div>';
  });
  h += '</div>';
  panel.innerHTML = h;
  updateScCount();
}

function filterScenarios() {
  var d = document.getElementById('sc-disease').value;
  var t = document.getElementById('sc-type').value;
  var tgt = document.getElementById('sc-target').value;
  var q = document.getElementById('sc-search').value.toLowerCase();
  var cards = document.querySelectorAll('#sc-cards .rv-card');
  var shown = 0;
  cards.forEach(function(c) {
    var show = (!d || c.dataset.disease === d) && (!t || c.dataset.type === t) && (!tgt || c.dataset.target === tgt) && (!q || c.dataset.search.toLowerCase().indexOf(q) !== -1);
    c.style.display = show ? '' : 'none';
    if (show) shown++;
  });
  updateScCount(shown);
}
function updateScCount(n) {
  var el = document.getElementById('sc-count');
  if (el) el.textContent = '显示 ' + (n !== undefined ? n : document.querySelectorAll('#sc-cards .rv-card').length) + ' / ' + (REVIEW_DATA ? REVIEW_DATA.scenario_cards.length : 0);
}

/* 展开场景卡的边级证据 */
function showScenarioDetails(scenarioReviewId, parentDiseaseReviewId) {
  var el = document.getElementById('expand-' + scenarioReviewId);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  /* 从 pharmacist_items 中筛选属于该场景的条目 */
  if (!REVIEW_DATA || !REVIEW_DATA.pharmacist_items) return;
  var related = REVIEW_DATA.pharmacist_items.filter(function(p) { return p.parent_review_id === scenarioReviewId; });
  if (!related.length) { el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px 0">该场景暂无边级证据数据</div>'; el.style.display = 'block'; return; }
  var h = '<table class="rv-table" style="font-size:11px"><thead><tr><th>药物名称</th><th>编码</th><th>关系类型</th><th>缺失字段</th><th>审核重点</th></tr></thead><tbody>';
  related.forEach(function(p) {
    h += '<tr><td>' + p.target_name + '</td><td style="font-family:monospace">' + p.target_code + '</td><td>' + p.relation_type + '</td>';
    h += '<td style="max-width:250px;font-size:10px">' + (p.missing_fields || '-') + '</td><td>' + (p.review_focus || '-') + '</td></tr>';
  });
  h += '</tbody></table>';
  el.innerHTML = h;
  el.style.display = 'block';
}

/* ========== 药师专项审核 ========== */
function renderPharmacistPanel(items) {
  var panel = document.getElementById('panel-pharmacist');
  var diseases = {};
  items.forEach(function(i) { diseases[i.disease_name] = 1; });

  var h = '<div class="rv-filters">';
  h += '<select id="ph-disease" onchange="filterPharmacist()"><option value="">全部疾病</option>';
  Object.keys(diseases).sort().forEach(function(d) { h += '<option>' + d + '</option>'; });
  h += '</select>';
  h += '<input id="ph-search" placeholder="搜索药物名称或编码..." oninput="filterPharmacist()">';
  h += '<span style="font-size:11px;color:var(--muted);margin-left:auto" id="ph-count"></span>';
  h += '</div>';

  h += '<div class="rv-table-wrap"><table class="rv-table"><thead><tr>';
  h += '<th>疾病</th><th>药物名称</th><th>药物编码</th><th>关系类型</th><th>缺失字段</th><th>审核重点</th><th>药师决策</th><th>专家意见</th>';
  h += '</tr></thead><tbody id="ph-tbody">';

  items.forEach(function(i) {
    var rid = i.review_id;
    h += '<tr data-disease="' + i.disease_name + '" data-med="' + i.target_name + '" data-code="' + (i.target_code || '') + '">';
    h += '<td>' + i.disease_name + '</td>';
    h += '<td><b>' + i.target_name + '</b></td>';
    h += '<td style="font-family:monospace;font-size:11px">' + (i.target_code || '-') + '</td>';
    h += '<td>' + i.relation_type + '</td>';
    h += '<td style="max-width:250px;font-size:10px">' + (i.missing_fields || '-') + '</td>';
    h += '<td style="font-size:10px">' + (i.review_focus || '-') + '</td>';
    h += '<td><select class="rv-decision" onchange="setDecision(\'' + rid + '\',\'pharmacist_decision\',this.value)">';
    h += '<option value="">请选择</option>';
    h += '<option value="通过">通过</option><option value="需修改">需修改</option><option value="禁用">禁用</option>';
    h += '</select></td>';
    h += '<td><textarea class="rv-comment" style="min-height:36px;width:180px" placeholder="药师意见（需修改/禁用时必填）" onchange="setDecision(\'' + rid + '\',\'pharmacist_comment\',this.value)"></textarea></td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  panel.innerHTML = h;
  updatePhCount();
}

function filterPharmacist() {
  var d = document.getElementById('ph-disease').value;
  var q = document.getElementById('ph-search').value.toLowerCase();
  var rows = document.querySelectorAll('#ph-tbody tr');
  var shown = 0;
  rows.forEach(function(r) {
    var show = (!d || r.dataset.disease === d) && (!q || r.dataset.med.toLowerCase().indexOf(q) !== -1 || r.dataset.code.toLowerCase().indexOf(q) !== -1);
    r.style.display = show ? '' : 'none';
    if (show) shown++;
  });
  updatePhCount(shown);
}
function updatePhCount(n) {
  var el = document.getElementById('ph-count');
  if (el) el.textContent = '显示 ' + (n !== undefined ? n : document.querySelectorAll('#ph-tbody tr').length) + ' / ' + (REVIEW_DATA ? REVIEW_DATA.pharmacist_items.length : 0);
}

/* ========== 边级证据追溯 ========== */
function renderDetailPanel(items) {
  var panel = document.getElementById('panel-detail');
  if (!items.length) { panel.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)">暂无边级证据数据</div>'; return; }
  var diseases = {}, batches = {};
  items.forEach(function(i) { diseases[i.disease_name] = 1; batches[i.batch_id] = 1; });

  var h = '<div class="rv-filters">';
  h += '<select id="dt-disease" onchange="filterDetail()"><option value="">全部疾病</option>';
  Object.keys(diseases).sort().forEach(function(d) { h += '<option>' + d + '</option>'; });
  h += '</select>';
  h += '<select id="dt-batch" onchange="filterDetail()"><option value="">全部批次</option>';
  Object.keys(batches).sort().forEach(function(b) { h += '<option>' + b + '</option>'; });
  h += '</select>';
  h += '<input id="dt-search" placeholder="搜索实体名称或编码..." oninput="filterDetail()">';
  h += '<span style="font-size:11px;color:var(--muted);margin-left:auto" id="dt-count"></span>';
  h += '</div>';

  h += '<div class="rv-table-wrap"><table class="rv-table"><thead><tr>';
  h += '<th>批次</th><th>疾病</th><th>目标类型</th><th>目标名称</th><th>目标编码</th><th>关系类型</th><th>缺失字段</th><th>审核重点</th><th>追溯决策</th><th>专家意见</th>';
  h += '</tr></thead><tbody id="dt-tbody">';

  items.forEach(function(i) {
    var rid = i.review_id;
    h += '<tr data-disease="' + i.disease_name + '" data-batch="' + i.batch_id + '" data-search="' + (i.target_name || '') + ' ' + (i.target_code || '') + '">';
    h += '<td style="white-space:nowrap">' + i.batch_id + '</td>';
    h += '<td>' + i.disease_name + '</td>';
    h += '<td>' + i.target_type + '</td>';
    h += '<td><b>' + i.target_name + '</b></td>';
    h += '<td style="font-family:monospace;font-size:11px">' + (i.target_code || '-') + '</td>';
    h += '<td>' + i.relation_type + '</td>';
    h += '<td style="max-width:200px;font-size:10px">' + (i.missing_fields || '-') + '</td>';
    h += '<td style="font-size:10px">' + (i.review_focus || '-') + '</td>';
    h += '<td><select class="rv-decision" onchange="setDecision(\'' + rid + '\',\'detail_decision\',this.value)">';
    h += '<option value="">请选择</option>';
    h += '<option value="approve">通过</option><option value="revise">需修改</option><option value="reject">拒绝</option>';
    h += '</select></td>';
    h += '<td><textarea class="rv-comment" style="min-height:36px;width:160px" placeholder="意见" onchange="setDecision(\'' + rid + '\',\'detail_comment\',this.value)"></textarea></td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  panel.innerHTML = h;
  updateDtCount();
}

function filterDetail() {
  var d = document.getElementById('dt-disease').value;
  var b = document.getElementById('dt-batch').value;
  var q = document.getElementById('dt-search').value.toLowerCase();
  var rows = document.querySelectorAll('#dt-tbody tr');
  var shown = 0;
  rows.forEach(function(r) {
    var show = (!d || r.dataset.disease === d) && (!b || r.dataset.batch === b) && (!q || r.dataset.search.toLowerCase().indexOf(q) !== -1);
    r.style.display = show ? '' : 'none';
    if (show) shown++;
  });
  updateDtCount(shown);
}
function updateDtCount(n) {
  var el = document.getElementById('dt-count');
  if (el) el.textContent = '显示 ' + (n !== undefined ? n : document.querySelectorAll('#dt-tbody tr').length) + ' / ' + (REVIEW_DATA ? (REVIEW_DATA.detail_items || []).length : 0);
}

/* ========== 标签页切换 ========== */
function switchTab(tab) {
  CURRENT_TAB = tab;
  document.querySelectorAll('.rv-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tab); });
  document.querySelectorAll('.rv-panel').forEach(function(p) { p.classList.toggle('active', p.id === 'panel-' + tab); });
}

/* ========== 决策状态管理 ========== */
function setDecision(reviewId, field, value) {
  if (!REVIEW_DECISIONS[reviewId]) REVIEW_DECISIONS[reviewId] = {};
  REVIEW_DECISIONS[reviewId][field] = value;
  REVIEW_DECISIONS[reviewId]._review_id = reviewId;
}

/* ========== 强制备注校验 ========== */
function validateDecisions() {
  var errors = [];
  Object.keys(REVIEW_DECISIONS).forEach(function(rid) {
    var d = REVIEW_DECISIONS[rid];
    /* 疾病级：需修改/禁用时 expert_comment 必填 */
    if (d.clinical_use_decision === '需修改' || d.clinical_use_decision === '禁用') {
      if (!d.expert_comment || !d.expert_comment.trim()) errors.push('疾病 ' + rid + ': 选择"' + d.clinical_use_decision + '"时专家意见必填');
    }
    /* 药师级：需修改/禁用时 pharmacist_comment 必填 */
    if (d.pharmacist_decision === '需修改' || d.pharmacist_decision === '禁用') {
      if (!d.pharmacist_comment || !d.pharmacist_comment.trim()) errors.push('药师 ' + rid + ': 选择"' + d.pharmacist_decision + '"时药师意见必填');
    }
  });
  return errors;
}

/* ========== 导出审核结果 ========== */
function exportDecisions() {
  if (!REVIEW_DATA) { alert('数据未加载'); return; }
  /* 校验强制备注 */
  var errors = validateDecisions();
  if (errors.length) {
    alert('导出校验失败:\n' + errors.join('\n'));
    return;
  }
  var now = new Date();
  var ts = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  /* 收集导出行 */
  var rows = [];
  /* 疾病级 */
  REVIEW_DATA.disease_reviews.forEach(function(r) {
    var d = REVIEW_DECISIONS[r.review_id] || {};
    if (d.clinical_use_decision) {
      rows.push({
        review_level: 'disease', review_id: r.review_id, batch_id: r.batch_id,
        disease_code: r.disease_code, disease_name: r.disease_name,
        scenario_type: '', relation_type: '', target_type: '', relation_id: '', target_code: '', target_name: '',
        review_decision: d.clinical_use_decision || '', overall_risk_level: d.overall_risk_level || '',
        reviewer_name: d.reviewer_name || '', reviewer_role: d.reviewer_role || '',
        reviewed_at: d.reviewed_at || '', expert_comment: d.expert_comment || ''
      });
    }
  });
  /* 场景级 */
  REVIEW_DATA.scenario_cards.forEach(function(c) {
    var d = REVIEW_DECISIONS[c.review_id] || {};
    if (d.clinical_use_decision) {
      rows.push({
        review_level: 'scenario', review_id: c.review_id, batch_id: c.batch_id,
        disease_code: c.disease_code, disease_name: c.disease_name,
        scenario_type: c.scenario_type, relation_type: c.relation_type, target_type: c.target_type,
        relation_id: '', target_code: '', target_name: '',
        review_decision: d.clinical_use_decision || '', overall_risk_level: '',
        reviewer_name: '', reviewer_role: '', reviewed_at: '', expert_comment: d.expert_comment || ''
      });
    }
  });
  /* 药师级 */
  REVIEW_DATA.pharmacist_items.forEach(function(p) {
    var d = REVIEW_DECISIONS[p.review_id] || {};
    if (d.pharmacist_decision) {
      rows.push({
        review_level: 'pharmacist', review_id: p.review_id, batch_id: p.batch_id,
        disease_code: p.disease_code, disease_name: p.disease_name,
        scenario_type: '', relation_type: p.relation_type, target_type: 'Medication',
        relation_id: p.relation_id || '', target_code: p.target_code, target_name: p.target_name,
        review_decision: d.pharmacist_decision || '', overall_risk_level: '',
        reviewer_name: '', reviewer_role: '', reviewed_at: '', expert_comment: d.pharmacist_comment || ''
      });
    }
  });
  /* 边级 */
  (REVIEW_DATA.detail_items || []).forEach(function(i) {
    var d = REVIEW_DECISIONS[i.review_id] || {};
    if (d.detail_decision) {
      rows.push({
        review_level: 'detail', review_id: i.review_id, batch_id: i.batch_id,
        disease_code: i.disease_code, disease_name: i.disease_name,
        scenario_type: '', relation_type: i.relation_type, target_type: i.target_type,
        relation_id: i.relation_id || '', target_code: i.target_code, target_name: i.target_name,
        review_decision: d.detail_decision || '', overall_risk_level: '',
        reviewer_name: '', reviewer_role: '', reviewed_at: '', expert_comment: d.detail_comment || ''
      });
    }
  });

  if (!rows.length) { alert('暂无已填写的审核决策，请先完成审核再导出'); return; }

  /* 导出 JSON */
  var jsonExport = {
    schema_version: 'clinical-review-decision-export-v1',
    exported_at: now.toLocaleString('zh-CN'),
    exported_by: 'Trae前端审核',
    total_items: rows.length,
    items: rows
  };
  downloadFile(JSON.stringify(jsonExport, null, 2), 'clinical_review_decisions_export_' + ts + '.json', 'application/json');

  /* 导出 CSV */
  var csvHeaders = ['review_level','review_id','batch_id','disease_code','disease_name','scenario_type','relation_type','target_type','relation_id','target_code','target_name','review_decision','overall_risk_level','reviewer_name','reviewer_role','reviewed_at','expert_comment'];
  var csvLines = [csvHeaders.join(',')];
  rows.forEach(function(r) {
    csvLines.push(csvHeaders.map(function(h) { return '"' + (r[h] || '').replace(/"/g, '""') + '"'; }).join(','));
  });
  downloadFile('\uFEFF' + csvLines.join('\n'), 'clinical_review_decisions_export_' + ts + '.csv', 'text/csv;charset=utf-8');

  alert('已导出 ' + rows.length + ' 条审核决策\nJSON + CSV 文件已下载');
}

function downloadFile(content, filename, type) {
  var blob = new Blob([content], { type: type });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }

/* ========== 初始化 ========== */
document.addEventListener('DOMContentLoaded', function() {
  renderNav('review');
  loadReviewData();
});
