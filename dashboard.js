/* === 专科知识图谱 · 数据总览 Dashboard === */
/* 所有数据从 KG_DATA 动态读取，无硬编码 */

/* 帮助说明切换 */
function togglePanelNote(el) {
  var note = el.closest('.panel').querySelector('.panel-note');
  if (!note) return;
  var show = !note.classList.contains('show');
  note.classList.toggle('show', show);
  el.classList.toggle('active', show);
}

/* GROUP_ORDER: 优先展示顺序，缺失的大类自动追加到末尾 */
var GROUP_ORDER_BASE = ['心力衰竭','心律失常','冠心病','心肌病','瓣膜性心脏病','心包疾病','高血压','先天性心脏病','感染性心内膜炎','心脏骤停/猝死','主动脉/外周血管','心脏神经症'];
function getGroupOrder(groups) {
  var seen = {};
  var order = GROUP_ORDER_BASE.filter(function(g) { if (groups[g]) { seen[g] = true; return true; } return false; });
  Object.keys(groups).forEach(function(g) { if (!seen[g]) order.push(g); });
  return order;
}
var _cachedGroups = null;

/* ====== 辅助函数 ====== */

function getDimCount(code) {
  if (!KG_DATA || !KG_DATA.diseases[code]) return 0;
  var d = KG_DATA.diseases[code], f = 0;
  if (d._loaded && d.dimensions) {
    DIM_KEYS.forEach(function(k) { if (d.dimensions[k] && d.dimensions[k].length > 0) f++; });
  } else if (d.dim_counts) {
    DIM_KEYS.forEach(function(k) { if (d.dim_counts[k] && d.dim_counts[k] > 0) f++; });
  }
  return f;
}

function getMedCount(code) {
  if (!KG_DATA || !KG_DATA.diseases[code]) return 0;
  var d = KG_DATA.diseases[code];
  if (d._loaded && d.dimensions && d.dimensions.Medication) return d.dimensions.Medication.length;
  if (d.dim_counts && d.dim_counts.Medication) return d.dim_counts.Medication;
  return 0;
}

function buildGroupDims(diseases) {
  var vec = [];
  DIM_KEYS.forEach(function(k) {
    var has = 0;
    diseases.forEach(function(d) {
      if (!KG_DATA || !KG_DATA.diseases[d.code]) return;
      var dd = KG_DATA.diseases[d.code];
      if (dd._loaded && dd.dimensions && dd.dimensions[k] && dd.dimensions[k].length > 0) has = 1;
      else if (dd.dim_counts && dd.dim_counts[k] && dd.dim_counts[k] > 0) has = 1;
    });
    vec.push(has);
  });
  return vec;
}

function avg(arr) {
  return arr.length ? Math.round(arr.reduce(function(a, b) { return a + b; }, 0) / arr.length) : 0;
}

/* ====== 核心构建 ====== */

function buildGroupStats() {
  var ds = KG_DATA.diseases, groups = {};
  Object.keys(ds).forEach(function(code) {
    var info = ds[code].info, p = parseParentCode(info.parent);
    if (!groups[p.group]) groups[p.group] = { name: p.group, icon: GROUP_ICONS[p.group] || '\ud83d\udcc1', count: 0, coverage: 0, dims: [], diseases: [] };
    groups[p.group].count++;
    groups[p.group].diseases.push({ name: info.name, code: code, pct: Math.round(getCoverage(code)), dimCount: getDimCount(code), medCount: getMedCount(code) });
  });
  Object.keys(groups).forEach(function(g) {
    var covs = groups[g].diseases.map(function(d) { return d.pct; });
    groups[g].coverage = covs.length ? Math.round(covs.reduce(function(a, b) { return a + b; }, 0) / covs.length) : 0;
    groups[g].dims = buildGroupDims(groups[g].diseases);
  });
  return groups;
}

/* ====== 入口函数 ====== */

function renderDashboard() {
  var s = KG_DATA.stats, groups = buildGroupStats();
  _cachedGroups = groups;
  /* 1. 立即渲染 KPI 数字 */
  renderFlowBar(s, groups);
  renderDiseaseTable(groups);
  /* 2. 延迟渲染图表，保证首屏速度 */
  setTimeout(function() { renderGraph(groups); }, 100);
  setTimeout(function() { renderRadar(); }, 150);
  setTimeout(function() { renderDimChart(); }, 200);
  setTimeout(function() { renderGaps(); }, 250);
}

/* ====== Hero KPIs ====== */

function renderFlowBar(stats, groups) {
  var ds = KG_DATA.diseases, totalNodes = 0;
  Object.keys(ds).forEach(function(code) {
    var d = ds[code];
    if (d._loaded && d.dimensions) {
      DIM_KEYS.forEach(function(k) { totalNodes += (d.dimensions[k] || []).length; });
    } else if (d.dim_counts) {
      DIM_KEYS.forEach(function(k) { totalNodes += (d.dim_counts[k] || 0); });
    }
  });
  var groupCount = Object.keys(groups).length;
  var el = function(id) { return document.getElementById(id); };
  var kg = el('k-groups'), kd = el('k-diseases'), ke = el('k-entities'), kr = el('k-relations');
  if (kg) kg.textContent = groupCount;
  if (kd) kd.textContent = stats.disease_count;
  if (ke) ke.textContent = totalNodes.toLocaleString();
  if (kr) kr.textContent = (stats.total_relationships || 0).toLocaleString();
  /* 兼容旧 flow-bar（如有） */
  var fb = el('flow-bar');
  if (fb) fb.innerHTML =
    '<div class="fb-node"><div class="fb-num">' + groupCount + '</div><div class="fb-label">疾病大类</div></div>' +
    '<div class="fb-line"><div class="fb-pulse"></div></div>' +
    '<div class="fb-node"><div class="fb-num">' + stats.disease_count + '</div><div class="fb-label">专病数量</div></div>' +
    '<div class="fb-line"><div class="fb-pulse"></div></div>' +
    '<div class="fb-node"><div class="fb-num">' + DIM_KEYS.length + '</div><div class="fb-label">知识维度</div></div>' +
    '<div class="fb-line"><div class="fb-pulse"></div></div>' +
    '<div class="fb-node"><div class="fb-num">' + totalNodes.toLocaleString() + '</div><div class="fb-label">知识实体</div></div>' +
    '<div class="fb-line"><div class="fb-pulse"></div></div>' +
    '<div class="fb-node"><div class="fb-num">' + (stats.total_relationships || 0).toLocaleString() + '</div><div class="fb-label">图谱关系</div></div>';
}

/* ====== 疾病大类表格 ====== */

function renderDiseaseTable(groups) {
  var el = document.getElementById('disease-table');
  if (!el) return;
  var html = '<table><thead><tr><th>大类</th><th>专病数</th><th>平均完整率</th><th>维度覆盖</th><th>操作</th></tr></thead><tbody>';
  var groupOrder = getGroupOrder(groups);
  groupOrder.forEach(function(g, idx) {
    if (!groups[g]) return;
    var gr = groups[g], cov = gr.coverage;
    var covCls = cov >= 80 ? 'cov-full' : cov >= 60 ? 'cov-good' : cov >= 40 ? 'cov-mid' : 'cov-low';
    var dimVec = gr.dims.map(function(v, i) { return v ? '<span class="dim-dot dim-on" title="' + (DIM_NAMES[DIM_KEYS[i]] || DIM_KEYS[i]) + '"></span>' : '<span class="dim-dot dim-off" title="' + (DIM_NAMES[DIM_KEYS[i]] || DIM_KEYS[i]) + '"></span>'; }).join('');
    html += '<tr class="dt-row" onclick="openModal(' + idx + ')">';
    html += '<td><span class="dt-icon">' + gr.icon + '</span> ' + g + '</td>';
    html += '<td>' + gr.count + '</td>';
    html += '<td><span class="tag ' + covCls + '">' + cov + '%</span></td>';
    html += '<td class="dt-dims">' + dimVec + '</td>';
    html += '<td><span class="dt-btn">查看专病 \u2192</span></td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

/* ====== 弹窗 Modal ====== */

function openModal(groupIdx) {
  var groups = _cachedGroups || buildGroupStats(), gName = getGroupOrder(groups)[groupIdx];
  if (!gName || !groups[gName]) return;
  var gr = groups[gName];
  var mask = document.getElementById('modal-mask');
  var modal = document.getElementById('modal');
  if (!mask || !modal) return;
  var html = '<div class="modal-head"><span class="modal-icon">' + gr.icon + '</span> ' + gName + ' <span class="modal-count">' + gr.count + ' 种专病</span><button class="modal-close" onclick="closeDashboardModal()">&times;</button></div>';
  html += '<div class="modal-grid">';
  gr.diseases.sort(function(a, b) { return b.pct - a.pct; }).forEach(function(d) {
    var covCls = d.pct >= 80 ? 'cov-full' : d.pct >= 60 ? 'cov-good' : d.pct >= 40 ? 'cov-mid' : 'cov-low';
    html += '<a class="d-card" href="explore.html?code=' + d.code + '">';
    html += '<div class="d-card-name">' + d.name + '</div>';
    html += '<div class="d-card-meta">';
    html += '<span class="tag ' + covCls + '">' + d.pct + '%</span>';
    html += '<span class="d-card-dim">' + d.dimCount + '/' + DIM_KEYS.length + ' 维度</span>';
    if (d.medCount > 0) html += '<span class="d-card-med">' + d.medCount + ' 药物</span>';
    html += '</div></a>';
  });
  html += '</div>';
  modal.innerHTML = html;
  mask.style.display = 'block';
  modal.style.display = 'block';
}

function closeDashboardModal() {
  var mask = document.getElementById('modal-mask');
  var modal = document.getElementById('modal');
  if (mask) mask.style.display = 'none';
  if (modal) modal.style.display = 'none';
}
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeDashboardModal(); });

/* ====== ECharts 知识网络图谱（力导向图） ====== */

function renderGraph(groups) {
  var el = document.getElementById('chart-graph');
  if (!el || typeof echarts === 'undefined') return;
  var ch = echarts.init(el, null, { renderer: 'svg' });
  var nodes = [], links = [];
  var catColors = ['#dc2626','#ec4899','#8b5cf6','#f472b6','#14b8a6','#ef4444','#38bdf8','#a78bfa','#f97316','#fbbf24','#f87171','#94a3b8'];
  /* 中心节点：心血管内科 */
  nodes.push({ name: '心血管内科', symbolSize: 55, category: 2, value: Object.keys(groups).length, itemStyle: { color: '#3b82f6' } });
  var gi = 0;
  getGroupOrder(groups).forEach(function(g) {
    if (!groups[g]) return;
    var gr = groups[g];
    nodes.push({ name: g, symbolSize: 36, category: 0, value: gr.count, itemStyle: { color: catColors[gi % catColors.length] } });
    links.push({ source: '心血管内科', target: g });
    gr.diseases.slice(0, 6).forEach(function(d) {
      if (!nodes.find(function(n) { return n.name === d.name; })) {
        nodes.push({ name: d.name, symbolSize: Math.max(12, Math.round(d.pct / 5)), category: 1, value: d.pct, diseaseCode: d.code });
      }
      links.push({ source: g, target: d.name });
    });
    gi++;
  });
  ch.setOption({
    animation: true, animationDuration: 1500,
    tooltip: {
      trigger: 'item', backgroundColor: '#1f2b3d', borderColor: 'rgba(255,255,255,.1)',
      textStyle: { color: '#f0f4f8', fontSize: 12 },
      formatter: function(p) {
        if (p.dataType === 'edge') return '';
        var cat = p.data.category;
        return p.data.name + (cat === 0 ? ' (大类 ' + p.data.value + '种)' : cat === 2 ? ' (专科)' : ' (完整率 ' + p.data.value + '%)');
      }
    },
    series: [{
      type: 'graph', layout: 'force', roam: true, draggable: true,
      force: { repulsion: 350, edgeLength: [50, 120], gravity: 0.12, friction: 0.6 },
      label: {
        show: true, fontSize: 10, color: '#f0f4f8', fontWeight: 600,
        formatter: function(p) { return (p.data.category === 0 || p.data.category === 2) ? '{bold|' + p.data.name + '}' : p.data.name; },
        rich: { bold: { fontSize: 12, fontWeight: 800, color: '#f0f4f8' } }
      },
      lineStyle: { color: 'source', curveness: 0.15, width: 1.2, opacity: 0.4 },
      emphasis: { focus: 'adjacency', lineStyle: { width: 3 }, itemStyle: { borderWidth: 3, borderColor: '#fff' } },
      categories: [
        { name: '大类', itemStyle: { color: '#dc2626' } },
        { name: '专病', itemStyle: { color: '#3b82f6' } },
        { name: '专科', itemStyle: { color: '#3b82f6' } }
      ],
      data: nodes, links: links,
      click: function(p) {
        if (p.data && p.data.category === 1 && p.data.diseaseCode) {
          window.location.href = 'explore.html?code=' + p.data.diseaseCode;
        }
      }
    }]
  });
  window.addEventListener('resize', function() { ch.resize(); });
}

/* ====== ECharts 雷达图 ====== */

function renderRadar() {
  var el = document.getElementById('chart-radar');
  if (!el || typeof echarts === 'undefined') return;
  var ch = echarts.init(el, null, { renderer: 'canvas' });
  var ds = KG_DATA.diseases, total = Object.keys(ds).length;
  var indicators = [], values = [];
  DIM_KEYS.forEach(function(k) {
    var filled = 0;
    Object.keys(ds).forEach(function(code) {
      var d = ds[code];
      if (d._loaded && d.dimensions && d.dimensions[k] && d.dimensions[k].length > 0) filled++;
      else if (d.dim_counts && d.dim_counts[k] && d.dim_counts[k] > 0) filled++;
    });
    indicators.push({ name: DIM_NAMES[k] || k, max: 100 });
    values.push(total > 0 ? Math.round(filled / total * 100) : 0);
  });
  ch.setOption({
    tooltip: {},
    radar: {
      indicator: indicators,
      shape: 'polygon',
      splitNumber: 5,
      axisName: { color: '#8b90a0', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2e3348' } },
      splitArea: { areaStyle: { color: ['rgba(79,140,255,0.02)', 'rgba(79,140,255,0.05)'] } },
      axisLine: { lineStyle: { color: '#2e3348' } }
    },
    series: [{
      type: 'radar',
      data: [{ value: values, name: '维度覆盖率 (%)',
        areaStyle: { color: 'rgba(79,140,255,0.2)' },
        lineStyle: { color: '#4f8cff', width: 2 },
        itemStyle: { color: '#4f8cff' }
      }]
    }]
  });
  window.addEventListener('resize', function() { ch.resize(); });
}

/* ====== ECharts 柱状图 ====== */

function renderDimChart() {
  var el = document.getElementById('chart-dim');
  if (!el || typeof echarts === 'undefined') return;
  var ch = echarts.init(el, null, { renderer: 'canvas' });
  var ds = KG_DATA.diseases, totals = {}, filled = {};
  DIM_KEYS.forEach(function(k) { totals[k] = 0; filled[k] = 0; });
  Object.keys(ds).forEach(function(code) {
    DIM_KEYS.forEach(function(k) {
      var d = ds[code], items = [];
      if (d._loaded && d.dimensions) items = d.dimensions[k] || [];
      else if (d.dim_counts) items = new Array(d.dim_counts[k] || 0);
      totals[k] += items.length;
      if (items.length > 0) filled[k]++;
    });
  });
  var total = Object.keys(ds).length;
  ch.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: function(ps) {
        var p = ps[0], k = DIM_KEYS[p.dataIndex];
        return (DIM_NAMES[k] || k) + '<br/>有数据疾病: ' + filled[k] + '/' + total + '<br/>实体总量: ' + totals[k];
      }
    },
    grid: { top: 10, bottom: 70, left: 50, right: 18 },
    xAxis: {
      type: 'category',
      data: DIM_KEYS.map(function(k) { return DIM_NAMES[k] || k; }),
      axisLabel: { rotate: 45, fontSize: 10, color: '#8b90a0' }
    },
    yAxis: {
      type: 'value', max: total,
      axisLabel: { fontSize: 10, color: '#8b90a0' }
    },
    series: [{
      name: '有数据疾病数', type: 'bar',
      data: DIM_KEYS.map(function(k) { return filled[k]; }),
      itemStyle: {
        color: function(p) {
          var v = p.value / total;
          return v >= 0.8 ? '#51cf66' : v >= 0.6 ? '#4f8cff' : v >= 0.4 ? '#ffd43b' : '#ff6b6b';
        }
      },
      barMaxWidth: 24
    }]
  });
  window.addEventListener('resize', function() { ch.resize(); });
}

/* ====== 质量缺口列表 ====== */

function renderGaps() {
  var el = document.getElementById('gap-list');
  if (!el) return;
  var ds = KG_DATA.diseases, total = Object.keys(ds).length;
  var missing = {};
  DIM_KEYS.forEach(function(k) { missing[k] = 0; });
  Object.keys(ds).forEach(function(code) {
    DIM_KEYS.forEach(function(k) {
      var d = ds[code], has = false;
      if (d._loaded && d.dimensions && d.dimensions[k] && d.dimensions[k].length > 0) has = true;
      if (!has && d.dim_counts && d.dim_counts[k] && d.dim_counts[k] > 0) has = true;
      if (!has) missing[k]++;
    });
  });
  var sorted = DIM_KEYS.slice().sort(function(a, b) { return missing[b] - missing[a]; });
  var html = '';
  sorted.forEach(function(k) {
    var m = missing[k];
    var pct = Math.round((total - m) / total * 100);
    var color = pct >= 80 ? '#51cf66' : pct >= 60 ? '#4f8cff' : pct >= 40 ? '#ffd43b' : '#ff6b6b';
    html += '<div class="gap-row">';
    html += '<div class="gap-label">' + (DIM_NAMES[k] || k) + '</div>';
    html += '<div class="gap-track"><div class="gap-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
    html += '<div class="gap-val" style="color:' + color + '">' + pct + '%<span class="gap-miss">缺' + m + '</span></div>';
    html += '</div>';
  });
  el.innerHTML = html || '<div class="gap-empty">所有维度均已覆盖</div>';
}
