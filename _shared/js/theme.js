/* ============================================================
   theme.js · 主题切换（v1.4.1，2026-10-01）
   双主题：默认浅色医疗风；html[data-theme="dark"] 深色科技风（大屏模式）。
   - 首选色存 localStorage('kg-theme')，默认 'light'
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

  function readPref() {
    try { return localStorage.getItem(KEY) || 'light'; } catch (e) { return 'light'; }
  }
  function applyPref(t) {
    try { localStorage.setItem(KEY, t); } catch (e) { /* 隐私模式等，忽略 */ }
  }

  /* 立即应用（本文件在 head 同步加载，此处不会闪屏） */
  var current = readPref() === 'dark' ? 'dark' : 'light';
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

  /* 切换；切换后广播，图表页面挂监听器重绘 */
  window.toggleTheme = function () {
    current = current === 'dark' ? 'light' : 'dark';
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
    var btn = document.getElementById('nav-theme-btn');
    if (btn) { updateBtn(btn); }
  };

  function updateBtn(btn) {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.innerHTML = dark ? '🌙 深色' : '☀️ 浅色';
    btn.title = dark ? '当前：深色科技风（大屏模式），点击切换为浅色医疗风' : '当前：浅色医疗风，点击切换为深色科技风（大屏模式）';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }

  /* 导航按钮注入：app.js 渲染 .nav 后调用；防重复挂载 */
  window.mountThemeToggle = function () {
    var navRight = document.querySelector('.nav-right');
    if (!navRight || document.getElementById('nav-theme-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'nav-theme-btn';
    btn.type = 'button';
    btn.className = 'nav-config-btn';
    btn.style.marginLeft = '8px';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', window.toggleTheme);
    navRight.appendChild(btn);
    updateBtn(btn);
  };

  /* 兜底：app.js 未调用 mountThemeToggle 时（如 disease-review 自渲染导航），DOMContentLoaded 后尝试注入 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (!document.getElementById('nav-theme-btn') && document.querySelector('.nav-right')) window.mountThemeToggle();
    });
  } else if (document.querySelector('.nav-right') && !document.getElementById('nav-theme-btn')) {
    window.mountThemeToggle();
  }
})();
