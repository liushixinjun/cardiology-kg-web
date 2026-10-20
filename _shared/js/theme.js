/* ============================================================
   theme.js · 主题切换（v1.5.12，2026-10-17）
   三套主题：light 浅色医疗风（默认）/ dark 深色科技风（大屏模式）/
             azure 青玉 · Azure 光感（浅色高级版）
   - 首选色存 localStorage('kg-theme')，默认 'light'
   - 导航右侧按钮点击循环切换：light → dark → azure → light
     （按钮样式与位置沿用既有 nav-config-btn，仅文案随当前主题变化）
   - 防闪白：本文件必须在 <head> 中同步加载（无 defer），
     <html> 渲染前立即设 data-theme，避免深色用户看到白色闪屏
   - 提供全局助手 window.cssVar(name, fallback)：
     图表 JS（ECharts 等）运行时取当前主题色，切肤后由
     window.onThemeChange 监听器重绘
   - 导航右侧注入切换按钮（app.js 渲染完 .nav 后调用 mountThemeToggle）
   ============================================================ */
(function () {
  'use strict';
  var KEY = 'kg-theme';
  /* 主题轮转顺序（点击导航按钮按此循环） */
  var ORDER = ['light', 'dark', 'azure'];
  /* 各主题在下拉框中的展示文案 */
  var LABELS = {
    light: { icon: '☀️', name: '浅色', full: '浅色医疗风', title: '配色：浅色医疗风（点击选择其他主题）' },
    dark:  { icon: '🌙', name: '深色', full: '深色科技风', title: '配色：深色科技风（点击选择其他主题）' },
    azure: { icon: '💎', name: '青玉', full: '青玉 · Azure 光感', title: '配色：青玉 · Azure 光感（点击选择其他主题）' }
  };
  /* 下拉项的三色预览点 */
  var DOTS = {
    light: ['#f5f7fa', '#1668dc', '#2f9e44'],
    dark:  ['#0f1117', '#4f8cff', '#51cf66'],
    azure: ['#e3f0f3', '#0d9488', '#0ea5e9']
  };
  function norm(t) { return ORDER.indexOf(t) === -1 ? 'light' : t; }

  function readPref() {
    try { return norm(localStorage.getItem(KEY) || 'light'); } catch (e) { return 'light'; }
  }
  function applyPref(t) {
    try { localStorage.setItem(KEY, t); } catch (e) { /* 隐私模式等，忽略 */ }
  }

  /* 立即应用（本文件在 head 同步加载，此处不会闪屏） */
  var current = readPref();
  document.documentElement.setAttribute('data-theme', current);

  window.KG_THEME = current;

  /* 全局助手：图表等运行时取当前主题色 */
  window.cssVar = function (name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    v = (v || '').trim();
    return v || fallback || '';
  };

  /* v1.4.4 全局助手：高分屏 DPR（上限2，兼顾清晰与性能）+ 防抖 */
  window.kgDpr = function () {
    try { return Math.min(window.devicePixelRatio || 1, 2); } catch (e) { return 1; }
  };
  window.kgDebounce = function (fn, ms) {
    var t = null;
    return function () {
      var a = arguments, c = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(c, a); }, ms || 150);
    };
  };

  /* 取当前主题（图表初始化用） */
  window.getTheme = function () { return document.documentElement.getAttribute('data-theme') || 'light'; };

  /* v1.5.12 是否浅底主题（light / azure 均为浅底）。
     供图表按明暗分支取色：light→true、dark→false 与原行为完全一致，
     仅让新增的 azure 走浅底分支（原代码的判断是 getTheme()==='light'）。 */
  window.isLightTheme = function () {
    var t = window.getTheme();
    return t !== 'dark';
  };

  /* 就地应用指定主题（供「颜色设置」直接选择；不轮转） */
  function setTheme(t) {
    current = norm(t);
    document.documentElement.setAttribute('data-theme', current);
    window.KG_THEME = current;
    applyPref(current);
    if (typeof window.onThemeChange === 'function') {
      /* 页面自带重绘处理器（图表就地重绘，不刷新） */
      try { window.onThemeChange(current); } catch (e) { /* 重绘失败不阻塞 */ }
    } else if (document.querySelector('canvas')) {
      /* 兜底：页面上有画布图表但页面未提供重绘处理器——
         画布颜色在加载时已固化，无法随 CSS 变量热更新，整页刷新 */
      try { window.location.reload(); } catch (e) { /* ignore */ }
    }
    var btn = document.getElementById('nav-theme-select');
    if (btn) { updateBtn(btn); }
    /* 广播：设置页主题卡等监听者同步选中态 */
    try { window.dispatchEvent(new CustomEvent('kg:theme-change', { detail: { theme: current } })); } catch (e) {}
  }
  window.setTheme = setTheme;

  /* 循环切换：light → dark → azure → light */
  window.toggleTheme = function () {
    var i = ORDER.indexOf(current);
    setTheme(ORDER[(i + 1) % ORDER.length]);
  };

  function updateBtn(el) {
    var t = document.documentElement.getAttribute('data-theme') || 'light';
    var lb = LABELS[t] || LABELS.light;
    el.value = t;
    el.title = lb.title;
    el.setAttribute('aria-label', lb.title);
    el.setAttribute('data-theme-cur', t);
  }

  /* 导航按钮注入：app.js 渲染 .nav 后调用；防重复挂载。
     v1.5.13 改为下拉框，位置仍在「⚙ 系统配置」左侧，⚙ 保持最右。 */
  window.mountThemeToggle = function () {
    var navRight = document.querySelector('.nav-right');
    if (!navRight || document.getElementById('nav-theme-select')) return;
    var sel = document.createElement('select');
    sel.id = 'nav-theme-select';
    sel.className = 'nav-config-btn nav-theme-select';
    sel.title = '切换配色主题';
    sel.setAttribute('aria-label', '切换配色主题');
    ORDER.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t;
      o.textContent = LABELS[t].icon + ' ' + LABELS[t].name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { setTheme(this.value); });
    /* 插到「⚙ 系统配置」之前，保证 ⚙ 始终在最右侧 */
    var gear = navRight.querySelector('.nav-config-btn');
    if (gear) navRight.insertBefore(sel, gear);
    else navRight.appendChild(sel);
    updateBtn(sel);
  };

  /* 兜底：app.js 未调用 mountThemeToggle 时（如 disease-review 自渲染导航），DOMContentLoaded 后尝试注入 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (!document.getElementById('nav-theme-select') && document.querySelector('.nav-right')) window.mountThemeToggle();
    });
  } else if (document.querySelector('.nav-right') && !document.getElementById('nav-theme-select')) {
    window.mountThemeToggle();
  }
})();
