# 踩坑记录 - 心血管专科知识图谱Web

> **记录原则**：每次犯错必须记录，防止重复犯错。

---

## #001 — echarts 图谱不渲染（series=0）

**日期**：2026-06-28  
**现象**：关系视角切换后，图谱区域空白，`GRAPH.getOption().series.length === 0`  
**根因**：`renderGraphView()` 替换 `workspace.innerHTML` 后，旧 echarts 实例与新 DOM 断开，`setOption` 内部抛出 `Cannot set properties of undefined (setting 'dataIndex')`  
**修复**：用 `echarts.getInstanceByDom(el)` + `dispose()` 清理旧实例，或用 `replaceChild` 创建全新容器  
**教训**：**echarts 实例必须与 DOM 元素一一绑定，innerHTML 替换后旧实例一定失效**

---

## #002 — echarts graph 不允许重复 node name

**日期**：2026-06-28  
**现象**：`setOption` 抛出 `Cannot set properties of undefined (setting 'dataIndex')`  
**根因**：echarts 5.x 的 graph series **不允许重复的节点 name**。当疾病名称（如"主动脉夹层"）同时出现在疾病节点和某个实体中时，echarts 内部崩溃  
**修复**：用 `seen` 对象追踪已添加的节点名，跳过重复  
**教训**：**echarts graph 的 node.name 必须全局唯一，不能有重名**

---

## #003 — 图谱探索只显示5个实体

**日期**：2026-06-28  
**现象**：每个维度只展示前5个实体，其余被截断  
**根因**：代码中 `it.slice(0, 5)` 硬编码截断  
**修复**：移除 slice 限制，显示全部实体  
**教训**：**不要随意截断数据，用户需要看到完整内容**

---

## #004 — loadData() 只获取摘要数据

**日期**：2026-06-28  
**现象**：数据总览的17维度图表全空、医学术语库列表全空  
**根因**：`loadData()` 从 `/api/kg/diseases` 获取的只是摘要数据（code/name/parent/dim_counts），**不包含实际实体**。`dimensions` 是空对象 `{}`  
**修复**：在 `loadData()` 回调中批量调用 `loadDiseaseData(code)` 获取完整维度数据  
**教训**：**`/api/kg/diseases` 返回摘要，`/api/kg/disease/{code}` 返回完整数据，必须区分使用**

---

## #005 — 图谱探索-实体视角只显示"主动脉夹层"

**日期**：2026-06-28  
**现象**：实体视角表格前500行全是"主动脉夹层"的实体  
**根因**：`ALL_ENTITIES` 按疾病名称排序，"主动脉夹层"在中文排序中靠前；表格限制500行  
**修复**：添加疾病下拉筛选器，支持按疾病过滤  
**教训**：**大数据量展示必须提供筛选/排序能力**

---

## #006 — 重复修改同一个问题导致反复出错

**日期**：2026-06-28  
**现象**：关系视角图谱反复修改 echarts 清理方式（innerHTML / replaceChild / getInstanceByDom），每次改完都还有新问题  
**根因**：没有一次性分析清楚根因（重复 node name + 实例清理），而是零散地尝试各种修复  
**修复**：最终一次性解决两个问题（seen 去重 + 彻底清理实例）  
**教训**：**修复前先分析根因，不要盲目尝试。一个 bug 可能有多个并发原因，必须全部解决**

---

## #007 — 图谱探索-实体视角切换疾病不生效

**日期**：2026-06-28  
**现象**：左侧选择其他疾病，实体视角数据不变，始终显示"主动脉夹层"  
**根因**：`renderCurrent()` 中 `CURRENT_VIEW==='entity'` 时直接 return，完全忽略 `CURRENT_DISEASE`；`renderEntityView()` 疾病筛选器默认选"全部疾病"  
**修复**：  
1. `selectDisease()` 中增加逻辑：如果当前是实体视角，同步更新筛选器并过滤  
2. `renderEntityView()` 渲染时，默认选中 `CURRENT_DISEASE` 对应的 option  
**教训**：**所有视角都要响应疾病切换，不能在 renderCurrent() 中 early return**

---

## #008 — 点击节点展开功能未实现

**日期**：2026-06-28  
**现象**：关系视角中点击"治疗方案"分组节点没有反应  
**根因**：最初没有添加 `GRAPH.on('click')` 事件处理  
**修复**：添加点击事件，点击分组节点展开所有实体，点击维度节点展开该维度实体  
**教训**：**交互功能需要主动实现，不能只展示静态数据**

---

## #008 — 页面滚动条异常：左侧树和主内容区一起滚动

**日期**：2026-06-28  
**现象**：疾病视角底部内容无法下拉展示全部；滚动时左侧疾病树和主内容区一起滚动  
**根因**：`html, body` 从 shared CSS 继承了 `overflow: hidden`；`.ex-layout` 也设了 `overflow: hidden`，导致 `.ex-main` 的 `overflow: auto` 被上层覆盖  
**修复**：  
1. 显式设置 `html, body { height: 100%; overflow: hidden }` 覆盖 shared CSS  
2. `.ex-main` 改为 `overflow-y: auto; overflow-x: hidden`  
3. `.ex-left` 加 `overflow: hidden`，让 `.ex-tree` 的 `flex:1; overflow:auto` 独立滚动  
**教训**：**三栏布局必须确保每栏独立滚动，不能让 overflow 从父级泄漏**

---

## 通用教训总结

1. **先分析再修复**：遇到 bug 先用控制台验证，找到确切根因再改代码
2. **echarts 实例管理**：init → setOption → dispose，生命周期必须清晰
3. **数据加载要完整**：摘要接口和完整接口要区分，不能混用
4. **批量操作要验证**：76个疾病的批量加载需要等待全部完成再渲染
5. **记录踩坑**：每次犯错必须记录，防止重复犯错
6. **版本管理**：每次修复后及时 commit + push，不要积累大量修改
7. **早期返回要谨慎**：`renderCurrent()` 中的 early return 导致实体视角忽略疾病切换，所有视角都要响应全局状态
8. **三栏布局独立滚动**：overflow 会从父级泄漏，必须显式隔离每栏的滚动容器
