/* === 专科知识图谱 · 数据总览 Dashboard === */
/* 所有数据从 KG_DATA 动态读取，无硬编码 */

/* 帮助说明切换 */
function togglePanelNote(el) {
  var note = el.nextElementSibling;
  if (!note || !note.classList.contains('panel-note')) {
    var panel = el.closest('.panel') || el.closest('.section');
    if (panel) note = panel.querySelector('.panel-note');
  }
  if (!note) return;
  var show = !note.classList.contains('show');
  note.classList.toggle('show', show);
  el.classList.toggle('active', show);
}

/* GROUP_ORDER: 已解析PDF的大类优先展示，其余按默认顺序 */
var GROUP_ORDER_BASE = ['冠心病','心肌病','心力衰竭','心律失常','瓣膜性心脏病','心包疾病','高血压','先天性心脏病','感染性心内膜炎','心脏骤停/猝死','主动脉/外周血管','心脏神经症'];
function getGroupOrder(groups) {
  var seen = {};
  var order = GROUP_ORDER_BASE.filter(function(g) { if (groups[g]) { seen[g] = true; return true; } return false; });
  Object.keys(groups).forEach(function(g) { if (!seen[g]) order.push(g); });
  return order;
}
var _cachedGroups = null;

/* ====== 辅助函数 ====== */

/* 维度有无数据：兼容 完整数据dimensions / 列表骨架dim_counts / 旧键名静态快照 三种形态 */
function dimHasData(d, k) {
  if (!d) return false;
  if (d.dimensions) {
    var v = d.dimensions[k];
    if ((!v || !v.length) && CORE_DIM_ALIAS[k]) v = d.dimensions[CORE_DIM_ALIAS[k]];
    if (v && v.length > 0) return true;
  }
  if (d.dim_counts) {
    var c = d.dim_counts[k];
    if (!c && CORE_DIM_ALIAS[k]) c = d.dim_counts[CORE_DIM_ALIAS[k]];
    if (c && c > 0) return true;
  }
  return false;
}

/* 维度实体数量：完整数据取数组长度，骨架取 dim_counts，旧键别名兜底 */
function dimCountValue(d, k) {
  if (!d) return 0;
  if (d.dimensions) {
    var v = d.dimensions[k];
    if ((!v || !v.length) && CORE_DIM_ALIAS[k]) v = d.dimensions[CORE_DIM_ALIAS[k]];
    if (v && v.length > 0) return v.length;
  }
  if (d.dim_counts) {
    var c = d.dim_counts[k];
    if (!c && CORE_DIM_ALIAS[k]) c = d.dim_counts[CORE_DIM_ALIAS[k]];
    if (c && c > 0) return c;
  }
  return 0;
}

function getDimCount(code) {
  if (!KG_DATA || !KG_DATA.diseases[code]) return 0;
  var d = KG_DATA.diseases[code], f = 0;
  CORE_DIM_KEYS.forEach(function(k) { if (dimHasData(d, k)) f++; });
  return f;
}

function getMedCount(code) {
  if (!KG_DATA || !KG_DATA.diseases[code]) return 0;
  var d = KG_DATA.diseases[code];
  if (d.dimensions) {
    if (d.dimensions.Drug && d.dimensions.Drug.length) return d.dimensions.Drug.length;
    if (d.dimensions.Medication && d.dimensions.Medication.length) return d.dimensions.Medication.length;
  }
  if (d.dim_counts) {
    if (d.dim_counts.Drug) return d.dim_counts.Drug;
    if (d.dim_counts.Medication) return d.dim_counts.Medication;
  }
  return 0;
}

function buildGroupDims(diseases) {
  var vec = [];
  CORE_DIM_KEYS.forEach(function(k) {
    var has = 0;
    diseases.forEach(function(d) {
      if (!KG_DATA || !KG_DATA.diseases[d.code]) return;
      if (dimHasData(KG_DATA.diseases[d.code], k)) has = 1;
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
    var gName = getGroupName(info) || p.group;
    if (!groups[gName]) groups[gName] = { name: gName, icon: GROUP_ICONS[gName] || '\ud83d\udcc1', count: 0, coverage: 0, dims: [], diseases: [] };
    groups[gName].count++;
    groups[gName].diseases.push({ name: info.name, code: code, pct: Math.round(getCoverage(code)), dimCount: getDimCount(code), medCount: getMedCount(code) });
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
  var groupCount = stats.disease_category_count || Object.keys(groups).length;
  var entityCount = stats.visual_entity_count || 0;
  var el = function(id) { return document.getElementById(id); };
  var kg = el('k-groups'), kd = el('k-diseases'), ke = el('k-entities'), kr = el('k-relations');
  if (kg) kg.textContent = groupCount;
  if (kd) kd.textContent = stats.disease_count;
  if (ke) ke.textContent = entityCount.toLocaleString();
  if (kr) kr.textContent = (stats.total_relationships || 0).toLocaleString();
  /* v1.5.11p 实时状态点：数据到达后由「同步中」转绿 */
  var hl = el('hero-live');
  if (hl){ hl.innerHTML = '<span class="hero-live-dot"></span>实时数据'; }
  /* 兼容旧 flow-bar（如有） */
  var fb = el('flow-bar');
  if (fb) fb.innerHTML =
    '<div class="fb-node"><div class="fb-num">' + groupCount + '</div><div class="fb-label">疾病大类</div></div>' +
    '<div class="fb-line"><div class="fb-pulse"></div></div>' +
    '<div class="fb-node"><div class="fb-num">' + stats.disease_count + '</div><div class="fb-label">专病数量</div></div>' +
    '<div class="fb-line"><div class="fb-pulse"></div></div>' +
    '<div class="fb-node"><div class="fb-num">' + coreDimTotal() + '</div><div class="fb-label">知识维度</div></div>' +
    '<div class="fb-line"><div class="fb-pulse"></div></div>' +
    '<div class="fb-node"><div class="fb-num">' + entityCount.toLocaleString() + '</div><div class="fb-label">可视化实体</div></div>' +
    '<div class="fb-line"><div class="fb-pulse"></div></div>' +
    '<div class="fb-node"><div class="fb-num">' + (stats.total_relationships || 0).toLocaleString() + '</div><div class="fb-label">图谱关系</div></div>';
}

/* ====== 疾病大类表格 ====== */

function renderDiseaseTable(groups) {
  var el = document.getElementById('disease-table');
  if (!el) return;
  var groupOrder = getGroupOrder(groups);
  /* 按覆盖率百分比排序（高→低） */
  var sorted = groupOrder.filter(function(g){return groups[g]}).sort(function(a,b){return groups[b].coverage - groups[a].coverage});
  var DEFAULT_SHOW = 5;
  var showAll = false;

  function renderRows(order) {
    var html = '<table><thead><tr><th>大类</th><th>专病数</th><th>平均覆盖率</th><th>维度覆盖</th><th>操作</th></tr></thead><tbody>';
    order.forEach(function(g, idx) {
      var gr = groups[g], cov = gr.coverage;
      var covCls = cov >= 80 ? 'cov-full' : cov >= 60 ? 'cov-good' : cov >= 40 ? 'cov-mid' : 'cov-low';
      var dimVec = gr.dims.map(function(v, i) { return v ? '<span class="dim-dot dim-on" title="' + (CORE_DIM_NAMES[CORE_DIM_KEYS[i]] || CORE_DIM_KEYS[i]) + '"></span>' : '<span class="dim-dot dim-off" title="' + (CORE_DIM_NAMES[CORE_DIM_KEYS[i]] || CORE_DIM_KEYS[i]) + '"></span>'; }).join('');
      var realIdx = groupOrder.indexOf(g);
      html += '<tr class="dt-row" onclick="openModal(' + realIdx + ')">';
      html += '<td><span class="dt-icon">' + gr.icon + '</span> ' + g + '</td>';
      html += '<td>' + gr.count + '</td>';
      html += '<td><span class="tag ' + covCls + '">' + cov + '%</span></td>';
      html += '<td class="dt-dims">' + dimVec + '</td>';
      html += '<td><span class="dt-btn">查看专病 \u2192</span></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    if (sorted.length > DEFAULT_SHOW) {
      html += '<div class="dt-toggle" onclick="window._dtToggle()">' +
        (showAll ? '收起 ↑' : '展开全部 ' + sorted.length + ' 个大类 ↓') + '</div>';
    }
    return html;
  }

  window._dtToggle = function() {
    showAll = !showAll;
    el.innerHTML = renderRows(showAll ? sorted : sorted.slice(0, DEFAULT_SHOW));
  };

  el.innerHTML = renderRows(sorted.slice(0, DEFAULT_SHOW));
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
    html += '<span class="d-card-dim">' + d.dimCount + '/' + coreDimTotal() + ' 维度</span>';
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
  var ch = echarts.getInstanceByDom(el) || echarts.init(el, null, { renderer: 'svg' });
  el.setAttribute('role', 'img'); el.setAttribute('aria-label', '疾病知识网络力导向图');
  var nodes = [], links = [];
  var catColors = isLightTheme()
    ? ['#dc2626','#db2777','#7c3aed','#be185d','#0f766e','#ea580c','#0369a1','#6d28d9','#c2410c','#a16207','#b91c1c','#475569']
    : ['#dc2626','#ec4899','#8b5cf6','#f472b6','#14b8a6','#ef4444','#38bdf8','#a78bfa','#f97316','#fbbf24','#f87171','#94a3b8'];
  /* 预收集所有大类名，避免疾病名与大类名冲突导致 ECharts 重复节点崩溃 */
  var groupNames = {};
  getGroupOrder(groups).forEach(function(g) { if (groups[g]) groupNames[g] = true; });
  /* 中心节点：心血管内科 */
  nodes.push({ name: '心血管内科', symbolSize: 55, category: 2, value: Object.keys(groups).length, itemStyle: { color: '#3b82f6' } });
  var gi = 0;
  getGroupOrder(groups).forEach(function(g) {
    if (!groups[g]) return;
    var gr = groups[g];
    /* 大类节点去重：若同名疾病节点已存在则跳过 */
    if (!nodes.find(function(n) { return n.name === g; })) {
      nodes.push({ name: g, symbolSize: 36, category: 0, value: gr.count, itemStyle: { color: catColors[gi % catColors.length] } });
    }
    links.push({ source: '心血管内科', target: g });
    gr.diseases.slice().sort(function(a,b){return b.pct - a.pct}).slice(0, 5).forEach(function(d) {
      /* 跳过与大类名同名的疾病，避免 ECharts 重复节点名崩溃（如"心肌炎"既是疾病又是大类） */
      if (groupNames[d.name]) return;
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
      trigger: 'item', backgroundColor: cssVar('--tip-bg', '#1f2b3d'), borderColor: cssVar('--tip-line', 'rgba(255,255,255,.1)'),
      textStyle: { color: cssVar('--tip-ink', '#f0f4f8'), fontSize: 12 },
      formatter: function(p) {
        if (p.dataType === 'edge') return '';
        var cat = p.data.category;
        if (cat === 2) return p.data.name + ' (专科)';
        if (cat === 0) return p.data.name + ' (大类 ' + p.data.value + '种)';
        return p.data.name + '<br/>覆盖率: <b>' + p.data.value + '%</b><br/><span style="opacity:.65">点击进入图谱探索 →</span>';
      }
    },
    series: [{
      type: 'graph', layout: 'force', roam: true, draggable: true,
      force: { repulsion: 350, edgeLength: [50, 120], gravity: 0.12, friction: 0.6 },
      label: {
        show: true, fontSize: 10, color: cssVar('--ink','#1e293b'), fontWeight: 600,
        formatter: function(p) {
          if (p.data.category === 2) return '{bold|' + p.data.name + '}';
          if (p.data.category === 0) return '{bold|' + p.data.name + '}';
          return p.data.name + '\n{pct|' + p.data.value + '%}';
        },
        rich: {
          bold: { fontSize: 12, fontWeight: 800, color: cssVar('--ink','#1e293b') },
          pct: { fontSize: 9, color: cssVar('--accent','#1668dc'), padding: [2, 0, 0, 0] }
        }
      },
      lineStyle: { color: 'source', curveness: 0.15, width: isLightTheme() ? 1.5 : 1.2, opacity: isLightTheme() ? 0.55 : 0.4 },
      emphasis: { focus: 'adjacency', lineStyle: { width: 3 }, itemStyle: { borderWidth: 3, borderColor: cssVar('--bg2','#ffffff') } },
      categories: [
        { name: '大类', itemStyle: { color: '#dc2626' } },
        { name: '专病', itemStyle: { color: '#3b82f6' } },
        { name: '专科', itemStyle: { color: '#3b82f6' } }
      ],
      data: nodes, links: links
    }]
  });
  /* v1.4.8 修复：ECharts 点击事件必须在实例上注册（series 内的 click 属性无效，此前点击专病节点跳转从未生效） */
  ch.off('click');
  ch.on('click', function(p) {
    if (p.dataType === 'node' && p.data && p.data.category === 1 && p.data.diseaseCode) {
      window.location.href = 'explore.html?code=' + p.data.diseaseCode;
    }
  });
  window.addEventListener('resize', kgDebounce(function() { ch.resize(); }, 150));
}

/* ====== ECharts 雷达图 ====== */

function renderRadar() {
  var el = document.getElementById('chart-radar');
  if (!el || typeof echarts === 'undefined') return;
  var ch = echarts.init(el, null, { renderer: 'canvas', devicePixelRatio: kgDpr() });
  el.setAttribute('role', 'img'); el.setAttribute('aria-label', '核心维度覆盖率雷达图');
  var indicators = [], values = [];
  var dc = KG_DATA.dim_coverage;
  if (dc && dc.dimensions && dc.dimensions.length) {
    /* 后端真实统计口径：每维 filled/disease_total 直接取后端 coverage_pct */
    dc.dimensions.forEach(function(x) {
      indicators.push({ name: x.name_cn || DIM_NAMES[x.key] || x.key, max: 100 });
      values.push(Math.round(x.coverage_pct));
    });
  } else {
    /* 后端不可用时降级：前端按 dim_counts 现算，与后端同口径 */
    var ds = KG_DATA.diseases, total = Object.keys(ds).length;
    CORE_DIM_KEYS.forEach(function(k) {
      var filled = 0;
      Object.keys(ds).forEach(function(code) {
        if (dimHasData(ds[code], k)) filled++;
      });
      indicators.push({ name: DIM_NAMES[k] || k, max: 100 });
      values.push(total > 0 ? Math.round(filled / total * 100) : 0);
    });
  }
  ch.setOption({
    tooltip: {
      backgroundColor: cssVar('--tip-bg', '#ffffff'),
      borderColor: cssVar('--tip-line', 'rgba(22,104,220,.18)'),
      textStyle: { color: cssVar('--tip-ink', '#1e293b'), fontSize: 12 }
    },
    radar: {
      indicator: indicators,
      shape: 'polygon',
      splitNumber: 5,
      axisName: { color: cssVar('--muted','#8b90a0'), fontSize: 11 },
      splitLine: { lineStyle: { color: cssVar('--rule','#2e3348'), width: 1 } },
      splitArea: { areaStyle: { color: ['rgba(79,140,255,0.02)', 'rgba(79,140,255,0.05)'] } },
      axisLine: { lineStyle: { color: cssVar('--rule','#2e3348') } }
    },
    series: [{
      type: 'radar',
      data: [{ value: values, name: '维度覆盖率 (%)',
        areaStyle: { color: 'rgba(79,140,255,0.2)' },
        lineStyle: { color: cssVar('--accent','#4f8cff'), width: 2 },
        itemStyle: { color: cssVar('--accent','#4f8cff') }
      }]
    }]
  });
  window.addEventListener('resize', kgDebounce(function() { ch.resize(); }, 150));
}

/* ====== ECharts 柱状图 ====== */

function renderDimChart() {
  var el = document.getElementById('chart-dim');
  if (!el || typeof echarts === 'undefined') return;
  var ch = echarts.init(el, null, { renderer: 'canvas', devicePixelRatio: kgDpr() });
  el.setAttribute('role', 'img'); el.setAttribute('aria-label', '核心维度实体量柱状图');
  var keys = CORE_DIM_KEYS, names = {}, filled = {}, totals = {}, total;
  var dc = KG_DATA.dim_coverage;
  if (dc && dc.dimensions && dc.dimensions.length) {
    /* 后端真实统计：维度清单、有数据疾病数、实体总量全部来自 /api/kg/dimensions/coverage */
    keys = dc.dimensions.map(function(x) { return x.key; });
    total = dc.disease_total || 0;
    dc.dimensions.forEach(function(x) {
      names[x.key] = x.name_cn;
      filled[x.key] = x.filled;
      totals[x.key] = x.entity_total;
    });
  } else {
    keys = CORE_DIM_KEYS.slice();
    totals = {}; filled = {};
    keys.forEach(function(k) { totals[k] = 0; filled[k] = 0; });
    Object.keys(KG_DATA.diseases).forEach(function(code) {
      keys.forEach(function(k) {
        var n = dimCountValue(KG_DATA.diseases[code], k);
        totals[k] += n;
        if (n > 0) filled[k]++;
      });
    });
    total = Object.keys(KG_DATA.diseases).length;
  }
  ch.setOption({
    tooltip: {
      trigger: 'axis',
      backgroundColor: cssVar('--tip-bg', '#ffffff'),
      borderColor: cssVar('--tip-line', 'rgba(22,104,220,.18)'),
      textStyle: { color: cssVar('--tip-ink', '#1e293b'), fontSize: 12 },
      formatter: function(ps) {
        var p = ps[0], k = keys[p.dataIndex];
        return (names[k] || DIM_NAMES[k] || k) + '<br/>有数据疾病: ' + filled[k] + '/' + total + '<br/>实体总量: ' + totals[k];
      }
    },
    grid: { top: 10, bottom: 70, left: 50, right: 18 },
    xAxis: {
      type: 'category',
      data: keys.map(function(k) { return names[k] || DIM_NAMES[k] || k; }),
      axisLabel: { rotate: 45, fontSize: 10, color: cssVar('--muted','#8b90a0') }
    },
    yAxis: {
      type: 'value', max: total,
      axisLabel: { fontSize: 10, color: cssVar('--muted','#8b90a0') }
    },
    series: [{
      name: '有数据疾病数', type: 'bar',
      data: keys.map(function(k) { return filled[k]; }),
      itemStyle: {
        color: function(p) {
          var v = total ? p.value / total : 0;
          return v >= 0.8 ? cssVar('--green','#51cf66') : v >= 0.6 ? cssVar('--accent','#4f8cff') : v >= 0.4 ? cssVar('--yellow','#ffd43b') : cssVar('--accent2','#ff6b6b');
        }
      },
      barMaxWidth: 24
    }]
  });
  window.addEventListener('resize', kgDebounce(function() { ch.resize(); }, 150));
}

/* ====== 质量缺口列表 ====== */

/* ====== v1.4.5 主题热切换：切肤后图表就地重绘（免整页刷新，免重载1.4MB数据） ====== */
window.onThemeChange = function() {
  if (!window.KG_DATA || !KG_DATA.diseases) return;
  if (typeof refreshDimColors === 'function') refreshDimColors();
  var groups = buildGroupStats();
  _cachedGroups = groups;
  renderGraph(groups);
  renderRadar();
  renderDimChart();
  renderGaps();
};

function renderGaps() {
  var el = document.getElementById('gap-list');
  if (!el) return;
  var rows = [];
  var dc = KG_DATA.dim_coverage;
  if (dc && dc.dimensions && dc.dimensions.length) {
    /* 后端真实统计：缺口数 = 总疾病数 - 有数据疾病数，与雷达/柱状图同源 */
    var total = dc.disease_total || 0;
    rows = dc.dimensions.map(function(x) {
      return { key: x.key, name: x.name_cn, miss: Math.max(total - (x.filled || 0), 0), total: total };
    });
  } else {
    var ds = KG_DATA.diseases, n = Object.keys(ds).length;
    var missing = {};
    CORE_DIM_KEYS.forEach(function(k) { missing[k] = 0; });
    Object.keys(ds).forEach(function(code) {
      CORE_DIM_KEYS.forEach(function(k) {
        if (!dimHasData(ds[code], k)) missing[k]++;
      });
    });
    rows = CORE_DIM_KEYS.map(function(k) {
      return { key: k, name: DIM_NAMES[k] || k, miss: missing[k], total: n };
    });
  }
  rows.sort(function(a, b) { return b.miss - a.miss; });
  var html = '';
  rows.forEach(function(r) {
    var m = r.miss, total = r.total;
    var pct = total ? Math.round((total - m) / total * 100) : 0;
    var color = pct >= 80 ? cssVar('--green','#51cf66') : pct >= 60 ? cssVar('--accent','#4f8cff') : pct >= 40 ? cssVar('--yellow','#ffd43b') : cssVar('--accent2','#ff6b6b');
    html += '<div class="gap-row">';
    html += '<div class="gap-label">' + (r.name || r.key) + '</div>';
    html += '<div class="gap-track"><div class="gap-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
    html += '<div class="gap-val" style="color:' + color + '">' + pct + '%<span class="gap-miss">缺' + m + '</span></div>';
    html += '</div>';
  });
  el.innerHTML = html || '<div class="gap-empty">所有维度均已覆盖</div>';
}
