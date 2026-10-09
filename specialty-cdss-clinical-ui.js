/* Doctor-facing local prototype. No scoring engine, model inference or HIS writes. */
window.ClinicalUI = (() => {
  let risks=[], assessments=[], picks=new Set(), selectionSignature='', procedure=null, events=[], serial=0, qualityNotes={}, qualityEnrolled=false;
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const now=()=>new Date().toLocaleString('zh-CN',{hour12:false});
  const button=(attr,label)=>`<button type="button" class="btn link" ${attr}>${label}</button>`;
  const info=name=>`<button class="knowledge-info" data-static-knowledge="${h(name)}" title="查看静态知识" aria-label="查看${h(name)}静态知识">i</button>`;
  const current=()=>typeof demoCaseLoaded!=='undefined'&&demoCaseLoaded;
  const signature=()=>patientFactSignature();
  const stale=r=>r.signature!==signature();
  const notice='<div class="ui-note">原型演示 · 用于评审功能、内容与交互。</div>';
  function reset(){risks=[];assessments=[];picks=new Set();selectionSignature='';procedure=null;events=[];serial=0;qualityNotes={};qualityEnrolled=false;const coverage=document.getElementById('demoTreatmentCoverage');if(coverage)coverage.value='plan';window.TreatmentWorkspace?.reset();window.OrderBridge?.reset();window.PatientJourney?.reset();window.EncounterDemo?.reset();}
  function modal(title,body,sub='查看患者依据，完成核对与下一步处理'){
    document.getElementById('clinicalActionTitle').textContent=title;
    document.getElementById('clinicalActionSubTitle').textContent=sub;
    document.getElementById('clinicalActionBody').innerHTML=body;
    document.getElementById('clinicalActionModal').classList.add('open');
  }
  function refresh(){
    const panel=document.getElementById('recommendPanel'),scroll=panel?.scrollTop;
    renderRecommendations();if(panel)panel.scrollTop=scroll||0;
    window.TreatmentWorkspace?.sync();
    if(document.getElementById('pathwayEngineModal')?.classList.contains('open')) {
      renderPatientWorkbench();
    }
  }
  function planCandidates(){
    if(!hasUsableDemoReports())return [];
    if(activeSimulationDisease==='ami')return [
      {id:'pci',name:'经皮冠状动脉介入治疗（PCI）',kind:'手术 / 操作',items:['经皮冠状动脉介入治疗（PCI）'],assessment:'PCI介入治疗术前评估表',content:'治疗目标：评估再灌注方案。结合发病经过、诊断依据、既往治疗与当前风险，核对操作准备，并安排术后观察。',operation:true},
      {id:'lysis',name:'静脉溶栓治疗',kind:'备选方案',items:['溶栓药物（选择具体品种）'],assessment:'再灌注治疗评估表',content:'备选再灌注方案。先比较当前治疗条件与禁忌，再由医生决定是否采用；与PCI方案不默认同时选择。'},
      {id:'platelet',name:'抗血小板治疗',kind:'药物治疗',items:['阿司匹林','氯吡格雷','替格瑞洛'],assessment:'抗血小板治疗评估',content:'药名沿用原型已有候选；不是默认联用清单。具体药品、联合方式和处方参数需医生及院内方案确认。'},
      {id:'coagulation',name:'抗凝治疗',kind:'药物治疗',items:['普通肝素','低分子肝素'],assessment:'抗凝治疗评估',content:'结合拟行治疗、既往抗凝、出血风险及肝肾功能选择药物；候选药物不是默认联用。'},
      {id:'lipid',name:'调脂治疗',kind:'药物治疗',items:['调脂药物（选择具体品种）'],assessment:'调脂治疗评估',content:'结合血脂资料、既往治疗及耐受情况制定方案；后续观察用药反应及复查结果。'}
    ];
    if(activeSimulationDisease==='cardiomyopathy')return [
      {id:'cm',name:'心肌病分型诊疗方案',kind:'专科治疗',items:['症状控制用药（按分型选择）'],assessment:'心肌病临床评估',content:'先查看分型及血流动力学资料，再组织药物、活动指导及复评。分型变化后重新核对，不将所有心肌病套用同一治疗。'},
      {id:'icd',name:'ICD植入方案讨论',kind:'手术 / 操作',items:['ICD植入术'],assessment:'ICD 植入适应证评估提示',content:'结合完整专科风险评估进行方案讨论。家族史是一项线索，不单独作为植入依据。',operation:true}
    ];return [];
  }
  const coverage=()=>document.getElementById('demoTreatmentCoverage')?.value||'plan';
  function planOperation(p){
    procedure={id:'op-'+(++serial),planId:p.id,name:p.name,phase:'pre',signature:signature(),basis:{diagnosis:fieldValue('mainDiagnosis','待明确'),report:fieldValue('assistantExam','未提供'),assessment:assessments.at(-1)?.note||'相关评估尚未回填'},source:'医生选择拟行治疗（本地演示）'};
    events.push({time:now(),operationId:procedure.id,text:'拟行治疗决定：'+p.name+'；记录患者依据，未视为已执行'});
  }
  function applyEncounterEvent(kind){
    if(!current()||factsEdited)return;
    if(kind==='assessment'&&!assessments.some(x=>x.demoEvent==='assessment'))assessments.push({id:++serial,name:activeSimulationDisease==='ami'?'再灌注治疗评估':'心肌病专科评估',note:activeSimulationDisease==='ami'?'已记录再灌注治疗讨论及下一步安排；具体术前安全项目继续核对。':'已记录分型与风险评估意见；拟行治疗须结合完整专科评估。',fields:[],time:now(),signature:signature(),source:'模拟评估中心回填',demoEvent:'assessment',facts:[['报告',fieldValue('assistantExam')]]});
    if(kind==='decision'&&!procedure){const p=planCandidates().find(x=>x.operation);if(p)planOperation(p);}
    if(kind==='start'&&procedure?.phase==='pre'){procedure.phase='intra';events.push({time:now(),operationId:procedure.id,text:'模拟操作系统回填：治疗开始'});}
    if(kind==='reassessment'&&procedure?.phase==='intra'){procedure.phase='post';events.push({time:now(),operationId:procedure.id,text:'模拟操作系统回填：治疗结束，进入术后观察'});}
    if(['start','monitor','reassessment','review-monitor'].includes(kind)){
      let r=risks.find(x=>x.key==='monitor');
      if(!r){r={id:'risk-'+(++serial),key:'monitor',type:'疾病风险预测',title:'室性心律失常风险（监测演练）',signature:signature(),facts:[['关联疾病',fieldValue('mainDiagnosis','待明确')]],reviewed:false,handling:'',updates:[]};risks.push(r);}
      const reviewed=['reassessment','review-monitor'].includes(kind);
      r.time=now();r.monitorStatus=reviewed?'已复评，继续监测':'新提示，待核实';r.reviewed=reviewed?now():false;r.handling=reviewed?'模拟医生复评：继续观察，未自动解除风险。':'';
      r.updates.push({time:r.time,status:r.monitorStatus,source:reviewed?'模拟医生复评记录':'模拟监护事件回填',signal:reviewed?'已回填复评意见与后续观察安排':'新监护异常片段待判读，提醒医生核实',factSignature:signature()});
    }
    refresh();
  }
  function riskMonitor(){
    const r=risks.find(x=>x.key==='monitor');
    return `<section class="risk-monitor" data-risk-monitor aria-live="polite"><div class="monitor-title"><div><small>当前患者 · 动态监测</small><h3>${h(r?.title||'室性心律失常风险监测')}</h3></div><span class="monitor-state ${r&&!r.reviewed?'new':''}">${r?h(stale(r)?'资料变化，待复核':r.monitorStatus):'等待监测事件'}</span></div><p>${r?'新增信息、提醒及医生处理沿同一条风险记录更新。':'尚未接收监测或模型结果；没有提示不代表没有风险。'}</p><div class="monitor-timeline">${(r?.updates||[]).map((u,i)=>`<article data-risk-event><span>${i+1}</span><div><strong>${h(u.status)}</strong><small>${h(u.time)} · ${h(u.source)}</small><p>${h(u.signal)}</p></div></article>`).join('')||'<p>时间轴将在收到新事件后更新。</p>'}</div><p class="monitor-origin">演练使用虚构监护与医生复评事件；不是模型计算的风险概率，不因单一监护片段直接确诊。</p><div class="care-tools">${button('data-monitor-step="monitor"','模拟新增监测提示')}${r?button('data-monitor-step="review-monitor"','模拟复评回填'):''}${r?button(`data-risk-open="${r.id}"`,'查看依据与处理'):''}</div></section>`;
  }
  function plans(){return coverage()==='plan'?planCandidates():[];}
  function medications(){
    if(activeSimulationDisease==='no-pathway'&&current()&&!factsEdited&&coverage()!=='none')return ['阿司匹林','氯吡格雷'].map(name=>({name,key:'ordinary|'+name,group:'冠心病普通推荐样例'}));
    if(coverage()!=='drug-only'||activeSimulationDisease!=='ami')return [];
    return planCandidates().filter(p=>['platelet','coagulation'].includes(p.id)).flatMap(p=>p.items.map(name=>({name,key:p.id+'|'+name,group:p.name})));
  }
  function medicationList(){
    const drugs=medications();if(!drugs.length)return '';
    return section('推荐用药',drugs.length,'<p class="ui-note">疾病相关候选演示，不是处方；不默认联用。无需配置路径，开立前核对患者适用性。</p>'+drugs.map(d=>`<div class="ui-item" data-medication-recommendation>${window.OrderBridge?.accepted(d.key)?button('data-order-history title="查看已开立医嘱"','✓'):`<button type="button" class="screening-add" data-care-add="${h(d.key)}" aria-label="添加或移除${h(d.name)}" aria-pressed="${picks.has(d.key)}">${picks.has(d.key)?'−':'+'}</button>`}<span><strong>${h(d.name)}</strong> ${info(d.name)}</span>${button(`data-drug-basis="${h(d.key)}"`,'依据')}</div>`).join('')+`<div class="ui-shortcuts">${button('data-drug-review','查看本次选择')}${button('data-order-review','开立核对')}${button('data-order-history','医嘱记录')}</div>`);
  }
  function care(){
    const list=plans();
    const empty=current()?'根据当前问题补充资料、制定诊疗计划；有无专病路径均可使用评估、预警及知识检索。':'请先载入患者资料。';
    return (list.length?'<div data-inline-treatment>'+(admissionConfirmed&&window.PathwayTasks?section('治疗方案',list.length,PathwayTasks.treatments()):section('推荐用药',list.filter(p=>!p.operation).reduce((n,p)=>n+p.items.length,0),list.filter(p=>!p.operation).map(p=>TreatmentWorkspace.card(p)).join(''))+section('推荐手术',list.filter(p=>p.operation).reduce((n,p)=>n+p.items.length,0),list.filter(p=>p.operation).map(p=>TreatmentWorkspace.card(p)).join('')||'<p>暂无适用手术推荐。</p>'))+'</div>':medications().length?medicationList()+section('推荐手术',0,'<p>暂无适用手术推荐。</p>'):`<p class="ui-note">暂无适用治疗方案或药品推荐。${empty}${button('data-ui-tab="search"','查询知识')}</p>`)+
      `<div class="ui-shortcuts">${button('data-care-note="plan"','记录诊疗计划')}${button('data-care-note="discharge"','出院注意事项')}</div>`+(procedure?procedurePanel():'')+(qualityEnrolled?quality():'')+
      ['诊疗计划','出院注意事项'].filter(k=>clinicalTaskRecords[k]).map(k=>`<div class="action-detail-card"><strong>${k}</strong><p>${h(clinicalTaskRecords[k].note)}</p></div>`).join('');
  }
  function planSafety(p){
    if(['lysis','coagulation','platelet'].includes(p.id))return '相关提醒：核对出血、过敏及未解决的高危鉴别。缺少资料与明确禁忌分开判断。';
    if(p.operation)return '相关提醒：核对手术风险、知情沟通、必要报告及操作准备；保存评估不代表已经完成操作。';
    return '相关提醒：结合本次报告、既往用药及耐受情况调整；不要重复开立已有治疗。';
  }
  function assessmentSummary(p){const name=p.operation?'手术风险评估':activeSimulationDisease==='cardiomyopathy'?'KCCQ问卷':'GRACE评分';const r=assessments.filter(x=>x.name===name).at(-1);return r?`<small class="ui-note" data-care-assessment>${h(name)}：${h(r.note)}${stale(r)?'（资料变化，待复评）':''}</small>`:'';}
  function assessmentCatalog(){return [
    ['GRACE评分','心血管专科','急性冠脉综合征相关风险评估'],
    ['KCCQ问卷','患者报告','仅在适用人群使用，不由AI代答'],
    ['SOFA评分','重症评估','查看器官功能资料及连续评估记录'],
    ['MEWS评分','病情评估','需关联本次有效生命体征'],
    ['APACHE II评分','重症评估','查看病情严重程度及变化'],
    ['手术风险评估','操作相关','按拟行术式调用相应模板']
  ];}
  function assessment(){
    const relevant=activeSimulationDisease==='ami'?['GRACE评分','MEWS评分']:activeSimulationDisease==='cardiomyopathy'?['KCCQ问卷','MEWS评分']:['MEWS评分'];
    const rows=assessmentCatalog().map(([name,kind,hint])=>{const latest=assessments.filter(x=>x.name===name).at(-1);return `<div class="ui-item ui-scale" data-scale-name="${h(name+kind)}"><div><strong>${h(name)}</strong><small>${h(kind)} · ${latest?(stale(latest)?'资料变化，需复评':h(latest.note)):h(hint)}</small></div>${button(`data-assessment-open="${h(name)}"`,latest?'复评':'打开')}</div>`;});
    const recordRows=assessments.map(r=>`<article class="action-detail-card"><strong>${h(r.name)}</strong><small>${h(r.time)} · ${h(r.source||'人工记录')}${stale(r)?' · 资料变化，待复核':''}</small><p>${h(r.note)}</p>${button(`data-assessment-history="${r.id}"`,'依据与记录')}${button(`data-assessment-open="${h(r.name)}"`,'新增复评')}</article>`).join('');
    return `<div class="ui-page-heading"><strong>智能评估</strong><small>本次患者的评估结果优先展示；量表检索不是未完成任务清单</small></div>${section('本次评估记录',assessments.length,recordRows||'<p class="action-detail-card">尚未接收评估记录。可人工评估，或通过“模拟事件”回填评估中心记录；无需进入专病路径。</p>')}<h3>本次相关评估</h3>${rows.filter((_,i)=>relevant.includes(assessmentCatalog()[i][0])).join('')}<details class="assessment-library"><summary>其他量表与评估工具</summary><label class="ui-search">查找量表 <input class="input" data-scale-search placeholder="名称 / 专科 / 病情评估"></label>${rows.filter((_,i)=>!relevant.includes(assessmentCatalog()[i][0])).join('')}</details>`;
  }
  function openAssessment(name){
    const defs=/KCCQ/.test(name)?[['患者感受与日常活动','由患者本人填写，不由系统代答'],['症状变化','结合患者本次回答'],['生活影响','由患者本人描述']]:/SOFA|APACHE/.test(name)?[['当前生命体征',fieldValue('physicalExam','待补充')],['器官功能相关报告',fieldValue('assistantExam','待补充')],['取值时间与既往变化','选择对应评估时点']]:/手术/.test(name)?[['拟行操作',procedure?.name||'从诊疗方案选择'],['过敏史',fieldValue('allergyHistory','待补充')],['术前报告',fieldValue('assistantExam','待补充')],['知情沟通与操作准备','待核对']]:[['本次症状与病情',fieldValue('presentHistory','待补充')],['生命体征',fieldValue('physicalExam','待补充')],['相关检查检验',fieldValue('assistantExam','待补充')]];
    modal('智能评估中心｜'+name,`${notice}<div class="ui-compare"><article><strong>系统提取</strong><p>病历与报告预填</p><small>逐项查看来源，缺失项保留空缺</small></article><article><strong>医生确认</strong><p>核对、补充或修正</p><small>${/KCCQ/.test(name)?'问卷需由患者作答':'确认后保存为本次评估记录'}</small></article></div><table class="ui-table"><thead><tr><th>资料项目</th><th>系统读取 / 来源</th><th>人工核对</th></tr></thead><tbody>${defs.map(([k,v])=>`<tr><td>${h(k)}</td><td>${h(v)}</td><td><input class="input" data-evaluation-field="${h(k)}" placeholder="确认或补充"></td></tr>`).join('')}</tbody></table><p class="ui-note">此处演示资料核对与结果复用；正式量表题项沿用评估中心。不同量表不套用同一组题目。</p><label>本次评估结论与处理<textarea class="textarea" id="assessment-note" placeholder="例如：尚缺哪些资料、是否需要复评、已沟通的下一步安排"></textarea></label><div class="action-confirm-bar">${button(`data-assessment-save="${h(name)}"`,'保存本次评估')}</div>`,'资料预填 → 医护核对 → 结果复用 → 历史复评');
  }
  function riskView(){
    return riskMonitor()+`<div class="ui-page-heading"><strong>疾病风险预测</strong><small>风险预测＋疾病预警发现 · 普通就诊与专病管理共用</small></div><div class="ui-compare"><article><strong>${risks.length}</strong><small>预警发现记录</small></article><article><strong>${risks.filter(r=>!r.reviewed).length}</strong><small>待核实</small></article></div><p class="ui-note">关注可能遗漏的疾病与未来风险。患者标签、顶部预警、此处详情关联同一记录；筛查不等于确诊。</p><details class="ui-demo" open><summary>演示场景：切换预警发现示例</summary><p>独立情境样例，用于查看内容结构；不表示当前心血管病例已命中这些疾病。</p>${button('data-risk-demo="specialty"','专病风险')}${button('data-risk-demo="rare"','罕见病线索')}${button('data-risk-demo="infection"','院感线索')}${button('data-risk-demo="communicable"','传染病线索')}</details>`+
      `<div>${risks.length?risks.map(r=>`<article class="ui-record" data-risk-record="${r.id}"><span class="ui-kind">${h(r.type)}</span><h4>${h(r.title)}</h4><p>${stale(r)?'患者资料已变化，请复核原线索':r.reviewed?'已记录处理，继续观察':'核对依据，补充必要资料'}</p><small>${h(r.time)} · 情境演示</small>${button(`data-risk-open="${r.id}"`,'原因与处理')}</article>`).join(''):'<p class="action-detail-card">当前暂无预警发现记录。可选择上方情境演示。</p>'}</div><p class="ui-note">范围：专病风险、罕见病、院感及传染病线索发现。上报在既有系统办理，本模块不制作报卡、不管理上报流程。</p>`;
  }
  function addRisk(type){
    if(!current()){showToast('请先载入患者资料');return;}
    if(risks.some(r=>r.key===type&&r.signature===signature())){showToast('当前资料已有同类演示记录');return;}
    const labels={specialty:['专病风险',activeSimulationDisease==='cardiomyopathy'?'心肌病相关心律失常风险待评估':'心血管疾病相关心律失常风险待评估'],rare:['罕见病','法布雷病线索待核实（独立情境）'],infection:['院感线索','医院获得性肺炎线索待核实（独立情境）'],communicable:['传染病线索','肺结核线索待核实（独立情境）']};
    const l=labels[type];if(!l)return;
    risks.push({id:'risk-'+(++serial),key:type,type:l[0],title:l[1],time:now(),signature:signature(),facts:[['主诉',fieldValue('chiefComplaint')],['家族史',fieldValue('familyHistory')],['报告',fieldValue('assistantExam','未取得')]],reviewed:false,handling:''});refresh();
  }
  function openRisk(id){
    const r=risks.find(x=>x.id===id);if(!r)return;
    const focus={monitor:'新增监护片段提示需核实。查看本次监测事件与医生判读，不等同于模型确诊或风险概率。',rare:'查看既往诊断是否能解释现有表现、跨系统线索及家族史；必要时进一步专科评估。',infection:'核对发病时间、入院时情况、相关操作及病原学资料；线索提示不能直接认定为院内感染。',communicable:'核对症状、接触史及相关报告，必要时进一步排查；不在此处办理上报。',specialty:'结合当前病情、既往史与报告开展适用的专科风险评估。'}[r.key];
    modal('疾病风险预测｜'+r.title,`${notice}<div class="ui-note">${h(r.time)}<br>${stale(r)?'患者资料已变化，须重新核验':r.reviewed?'已记录查看；风险未自动解除':'待核实'}</div>${detailGrid([['发现类型',h(r.type)],['为什么关注',focus],['本次样例说明','情境展示，不据此认定已命中临床条件；下列为演示患者原始资料'],...r.facts.map(([k,v])=>[k,h(v||'未提供')])])}<h4>下一步</h4><p>核对线索 → 补充检查或评估 → 记录临床判断。处理记录不替代诊断。</p><label>处理说明<textarea id="risk-handling" class="textarea" placeholder="记录核对结果、暂不采纳原因或后续安排">${h(r.handling)}</textarea></label><p>${r.reviewed?'查看记录：'+h(r.reviewed):'暂无处理记录'}</p>${button(`data-risk-review="${r.id}"`,'保存处理记录')}${button('data-ui-tab="assessment"','相关评估')}${button('data-ui-tab="prediction"','因素监测与风险记录')}<small>记录编号 ${r.id} · 三处入口共用</small>`);
  }
  function tags(){return risks.map(r=>`<button class="patient-tag" data-prediction-tag="${r.id}">${h(r.type)} · ${stale(r)?'待核验':r.monitorStatus||'演示线索'}</button>`).join('');}
  function alerts(){return !risks.length?'':`<section class="rec-section" data-prediction-alert><div class="rec-head"><strong>风险预警</strong>${button('data-patient-tool="prediction"','查看全部')}</div>${[['prediction','疾病风险预测',risks.filter(r=>['monitor','specialty'].includes(r.key))],['screening','疾病筛查线索',risks.filter(r=>!['monitor','specialty'].includes(r.key))]].map(([id,label,list])=>list.length?`<div data-risk-group="${id}"><h4>${label} · ${list.length}</h4>${list.map(r=>`<div class="ui-item"><div><strong>${h(r.title)}</strong><small>${h(r.time)} · ${stale(r)?'资料变化，待核验':r.reviewed?'已记录处理，未自动解除':'待核实'}${id==='screening'?' · 筛查不等于确诊':''}</small></div>${button(`data-risk-workbench="${r.id}"`,'查看详情')}</div>`).join('')}</div>`:'').join('')}</section>`;}
  function procedurePanel(){
    if(!procedure)return '<div class="ui-note">围术期：尚未选择操作演示，普通诊疗不显示术中/术后任务。</div>';
    const phases={pre:'术前',intra:'术中',post:'术后',cancel:'已取消'};
    const text={pre:'核对相关评估、报告、知情沟通和操作准备。',intra:'接收手术/操作记录，关注实际事件与异常；不能推断术前核对均已完成。',post:'关联操作结束记录、术后观察及复评，不能自动推断疗效或无并发症。',cancel:'停止新阶段提醒，保留取消原因和历史。'};
    const currentEvents=events.filter(e=>e.operationId===procedure.id),priorEvents=events.filter(e=>e.operationId!==procedure.id);
    const eventRows=items=>items.map(e=>`<p>${h(e.time)} · ${h(e.text)}</p>`).join('');
    return section('围术期管理',currentEvents.length,`<div class="action-detail-card" data-procedure-current><strong>${h(procedure.name)} · ${phases[procedure.phase]}</strong><p>${text[procedure.phase]}</p><details class="procedure-basis" open><summary>患者依据与治疗决定</summary><p>关联方案：${h(procedure.name)}</p><p>来源：${h(procedure.source||"本地治疗决定")}</p><p>当时诊断：${h(procedure.basis?.diagnosis||"待核对")}</p><p>当时报告：${h(procedure.basis?.report||"待核对")}</p><p>评估：${h(procedure.basis?.assessment||"尚未回填")}</p>${procedure.signature!==signature()?"<p>患者资料已变化，拟行方案及依据需重新核对。</p>":""}<small>上述为选择方案时的资料，不代表系统已确认手术适应证。</small></details><div class="care-tools">${procedure.phase==='pre'?button('data-procedure-next="start"','模拟接收开始记录'):procedure.phase==='intra'?button('data-procedure-next="end"','模拟接收结束记录'):''}${['pre','intra'].includes(procedure.phase)?button('data-procedure-next="cancel"','记录取消'):''}${button(`data-task-action="form" data-task-title="${procedure.phase==='post'?'术后观察核对':'介入治疗术前评估表'}"`,'相关核对')}</div></div><details class="ui-demo" data-current-operation-events><summary>本次事件记录</summary>${eventRows(currentEvents)}</details>${priorEvents.length?`<details class="ui-demo"><summary>既往操作事件</summary>${eventRows(priorEvents)}</details>`:''}`);
  }
  function quality(){
    return section('相关质控', {label:'按事件关联'},`<div class="ui-item"><div><strong>诊疗安全与病历记录</strong><small>查看相关问题及处理记录</small></div>${button('data-quality-open="通用质控"','查看')}</div><div class="ui-item"><div><strong>单病种质控</strong><small>沿用既有任务，避免重复填写</small></div>${button('data-ui-tab="quality"','进入原模块')}</div>`,false);
  }
  function qualityTasks(){return [
    {id:'diagnosis',name:'诊断依据与报告核对',detail:fieldValue('assistantExam','尚未回填报告'),action:'basis'},
    {id:'assessment',name:'相关风险评估',detail:assessments.length?'已有评估记录，可复用':'选择适用评估，核对本次资料',action:'assessment'},
    {id:'operation',name:'治疗与操作记录',detail:procedure?procedure.name+' · '+({pre:'术前',intra:'术中',post:'术后',cancel:'已取消'}[procedure.phase]):'尚未选择操作，不产生术中或术后完成结论',action:'care'}
  ];}
  function qualityView(){
    const disease=activeSimulationDisease==='ami'?'急性心肌梗死':activeSimulationDisease==='cardiomyopathy'?'心肌病':'当前病种';
    return `<div class="ui-page-heading"><strong>单病种质控</strong><small>整合既有模块 · 任务清单 / 质控提醒 / 推荐量表 / 历史记录</small></div><div class="ui-item"><div><strong>${disease}</strong><small>${qualityEnrolled?'已纳入质控演示':'核对适用指标及纳排条件后查看任务'}</small></div>${button('data-quality-enroll',qualityEnrolled?'查看纳排 / 出组':'纳排核对')}</div><p class="ui-note">单病种质控与专病路径分别纳入；共用患者报告、评估和医疗事件，不重复建任务。</p>`+(qualityEnrolled?
      section('任务清单',3,qualityTasks().map(q=>`<article class="ui-record" data-quality-task="${q.id}"><strong>${q.name}</strong><p>${h(q.detail)}</p>${button(`data-quality-task-open="${q.id}"`,'依据与处理')}${qualityNotes[q.id]?`<small>处理记录：${h(qualityNotes[q.id].text)}</small>`:''}</article>`).join(''))+
      section('质控提醒',Object.keys(qualityNotes).length,`<p class="ui-note">问题与任务使用同一记录；登记处理不直接判定指标达标。</p>${Object.entries(qualityNotes).map(([id,n])=>`<div class="ui-record">${h(n.text)}<small>${h(n.time)}</small>${button(`data-quality-task-open="${id}"`,'定位任务')}</div>`).join('')||'<p class="ui-note">暂无人工处理记录</p>'}`)+
      section('推荐量表与评估记录',assessments.length,`${button('data-ui-tab="assessment"','进入智能评估')}${assessments.map(r=>`<div class="ui-item"><div><strong>${h(r.name)}</strong><small>${h(r.note)}${stale(r)?' · 资料变化待复评':''}</small></div>${button(`data-assessment-history="${r.id}"`,'历史记录')}</div>`).join('')}`):'<p class="ui-note">本页保留独立入口；演示纳入质控后展示任务，不影响普通诊疗功能。</p>');
  }
  function openQualityTask(id){const q=qualityTasks().find(x=>x.id===id);if(!q)return;modal('单病种质控｜'+q.name,`${detailGrid([['当前依据',h(q.detail)],['关联记录','与诊疗方案、评估、路径使用同一份患者资料']])}<label>处理记录<textarea class="textarea" id="quality-note">${h(qualityNotes[id]?.text||'')}</textarea></label>${button(`data-quality-task-save="${id}"`,'保存处理')}${button(`data-ui-tab="${q.action==='basis'?'assist':q.action}"`,'查看相关内容')}`);}
  function knowledge(title){
    const troponin=/肌钙蛋白/.test(title);
    modal('静态知识｜'+title,`<div data-knowledge-content><div class="ui-note">静态条目与当前患者报告分开；不据此生成患者结论。</div><div class="ui-shortcuts">概述　适用范围　注意事项　来源</div><h4>概述</h4><p>${troponin?'肌钙蛋白由TnT、TnI和TnC三个亚基构成。此段为用户提供的现有CDSS知识截图摘录，正式知识全文未接入。':'该项目的正式知识正文尚未接入本地原型。保留条目身份与知识入口，不补造医学说明。'}</p><h4>适用范围与注意事项</h4><p>以正式知识条目、院内项目说明及当前版本为准；此处不展示未经核验的阈值和操作要求。</p><h4>来源</h4><p>${troponin?'用户提供的现有CDSS“血清肌钙蛋白I和肌钙蛋白T”截图；全文版本与授权待对接。':'知识条目及版本待接入，不能以患者报告或演示规则替代。'}</p></div>`,'知识查看交互已提供；全文内容和来源随现有知识库接入');
  }
  function network(title){
    return ClinicalRecommendationView.network(title);
  }
  function note(kind){
    const name=kind==='discharge'?'出院注意事项':'诊疗计划';
    modal(name,`<p>由医生核对并记录；不自动生成处方，不建立随访任务。</p><label>${name}<textarea id="care-note" class="textarea" placeholder="记录本次安排；出院内容可包含复查与随访注意事项">${h(clinicalTaskRecords[name]?.note||'')}</textarea></label>${button(`data-care-note-save="${h(name)}"`,'保存记录')}`);
  }
  document.addEventListener('input',e=>{if(e.target.matches('[data-scale-search]'))document.querySelectorAll('[data-scale-name]').forEach(el=>el.hidden=!el.dataset.scaleName.toLowerCase().includes(e.target.value.toLowerCase()));});
  document.addEventListener('change',e=>{if(e.target.id==='demoTreatmentCoverage')refresh();});
  document.addEventListener('click',e=>{
    const t=e.target.closest('button');if(!t)return;
    if(t.hasAttribute('data-ui-tab')){closeClinicalActionModal();const tab=t.dataset.uiTab;if(document.getElementById('pathwayEngineModal').classList.contains('open')&&tab!=='search'){openPatientWorkbench(tab==='assist'?'overview':tab);}else{closePathwayWorkbench();setRecommendationTab(tab);}}
    if(t.hasAttribute('data-static-knowledge'))knowledge(t.dataset.staticKnowledge);
    if(t.hasAttribute('data-assessment-open'))openAssessment(t.dataset.assessmentOpen);
    if(t.hasAttribute('data-assessment-save')){
      const note=document.getElementById('assessment-note').value.trim();if(!note){showToast('请填写人工核对说明');return;}
      if(!current()){showToast('请先载入患者资料');return;}
      const fields=[...document.querySelectorAll('[data-evaluation-field]')].map(el=>[el.dataset.evaluationField,el.value]);
      assessments.push({id:++serial,name:t.dataset.assessmentSave,note,fields,time:now(),signature:signature(),facts:[['主诉',fieldValue('chiefComplaint')],['报告',fieldValue('assistantExam')]]});closeClinicalActionModal();refresh();
    }
    if(t.hasAttribute('data-assessment-history')){const r=assessments.find(r=>r.id===Number(t.dataset.assessmentHistory));if(r)modal('评估记录｜'+r.name,detailGrid([['时间',h(r.time)],['人工记录',h(r.note)],['资料版本',stale(r)?'资料已变化，历史记录保留':'与当前一致'],...(r.fields||[]).map(([k,v])=>[h(k),h(v||'未填写')]),...(r.facts||[]).map(([k,v])=>['当时'+k,h(v||'未提供')])])+button(`data-assessment-open="${h(r.name)}"`,'新增复评'));}
    if(t.hasAttribute('data-risk-demo'))addRisk(t.dataset.riskDemo);
    if(t.hasAttribute('data-monitor-step'))applyEncounterEvent(t.dataset.monitorStep);
    if(t.hasAttribute('data-risk-workbench')){openPatientWorkbench('prediction');const row=document.querySelector('[data-risk-record="'+t.dataset.riskWorkbench+'"]');if(row){row.scrollIntoView({block:'center'});row.setAttribute('tabindex','-1');row.focus();}}
    if(t.hasAttribute('data-risk-open')||t.hasAttribute('data-prediction-tag'))openRisk(t.dataset.riskOpen||t.dataset.predictionTag);
    if(t.hasAttribute('data-risk-review')){const r=risks.find(r=>r.id===t.dataset.riskReview);if(r){const handling=document.getElementById('risk-handling')?.value.trim();if(!handling){showToast('请填写核对结果或后续安排');return;}r.reviewed=now();r.handling=handling;if(r.updates){r.monitorStatus='已记录处理，继续监测';r.updates.push({time:now(),status:r.monitorStatus,source:'医生处理记录（本地）',signal:r.handling,factSignature:signature()});}}closeClinicalActionModal();refresh();}
    if(t.hasAttribute('data-care-add')){toggleTreatment(t.dataset.careAdd);}
    if(t.hasAttribute('data-drug-basis')){
      const d=medications().find(d=>d.key===t.dataset.drugBasis);if(!d)return;
      modal('推荐用药依据｜'+d.name,detailGrid([['当前诊断',h(fieldValue('mainDiagnosis','未提供'))],['推荐层级','疾病—药品关联候选；未组成完整治疗方案'],['患者核对','需结合过敏史、当前用药、相关报告和拟行治疗核对，不凭疾病名称直接开药'],['过敏史原文',h(fieldValue('allergyHistory','未提供'))],['报告原文',h(fieldValue('assistantExam','未提供'))],['知识来源','沿用本地原型已有药品候选进行交互演示；正式适用条件及来源尚待接入']]),'药品知识关联与本次患者适用性分开核对');
    }
    if(t.hasAttribute('data-drug-review')){
      const names=medications().filter(d=>picks.has(d.key)).map(d=>d.name);
      modal('本次药品选择',`<p>${names.length?names.map(h).join('、'):'尚未选择药品'}</p><p>仅为本次新选候选；具体品种、用法用量在开单时核对，不代表医嘱已开立。</p>`);
    }
    if(t.hasAttribute('data-care-preview')){const names=[...picks].filter(k=>k.startsWith(t.dataset.carePreview+'|')).map(k=>k.split('|')[1]);modal('本次医嘱选择',`${notice}<p>${names.length?names.map(h).join('、'):'尚未选择项目'}</p><p>在开单页面确认具体品种、用法与安全条件。演示中的选择不会改动已有医嘱。</p>${button('data-care-note="plan"','写入诊疗计划草稿')}`);}
    if(t.hasAttribute('data-quality-enroll'))modal('单病种质控｜纳排核对',`${notice}<p>查看患者诊断、对应指标范围及纳排条件。此操作不改变专病路径。</p>${detailGrid([['当前诊断',h(fieldValue('mainDiagnosis','待确认'))],['当前报告',h(fieldValue('assistantExam','未提供'))]])}${button('data-quality-confirm',qualityEnrolled?'查看任务清单':'演示确认纳入')}${qualityEnrolled?button('data-quality-exit','记录出组'):''}`);
    if(t.hasAttribute('data-quality-confirm')){if(!current()){showToast('请先载入患者');return;}qualityEnrolled=true;closeClinicalActionModal();refresh();}
    if(t.hasAttribute('data-quality-exit')){modal('单病种质控｜出组原因',`<textarea id="quality-exit-reason" class="textarea" placeholder="填写出组原因"></textarea>${button('data-quality-exit-save','确认出组')}`);}
    if(t.hasAttribute('data-quality-exit-save')){const reason=document.getElementById('quality-exit-reason').value.trim();if(!reason){showToast('请填写出组原因');return;}qualityEnrolled=false;qualityNotes.exit={text:'出组：'+reason,time:now()};closeClinicalActionModal();refresh();}
    if(t.hasAttribute('data-quality-task-open'))openQualityTask(t.dataset.qualityTaskOpen);
    if(t.hasAttribute('data-quality-task-save')){const val=document.getElementById('quality-note').value.trim();if(!val){showToast('请填写处理记录');return;}qualityNotes[t.dataset.qualityTaskSave]={text:val,time:now()};closeClinicalActionModal();refresh();}
    if(t.hasAttribute('data-procedure-plan')){const p=plans().find(p=>p.id===t.dataset.procedurePlan);if(!p)return;if(procedure&&procedure.phase!=='cancel'){showToast('已有操作演示，请先完成或取消');return;}planOperation(p);refresh();}
    if(t.hasAttribute('data-procedure-next')&&procedure){const action=t.dataset.procedureNext;if(action==='start'&&procedure.phase==='pre')procedure.phase='intra';else if(action==='end'&&procedure.phase==='intra')procedure.phase='post';else if(action==='cancel')procedure.phase='cancel';else return;events.push({time:now(),operationId:procedure.id,text:action==='start'?'模拟收到开始记录':action==='end'?'模拟收到结束记录':'演示者取消操作'});refresh();}
    if(t.hasAttribute('data-quality-open'))modal(t.dataset.qualityOpen,`${detailGrid([['当前患者资料',factsEdited?'资料已改变，需复核':'本地样例'],['报告',h(fieldValue('assistantExam','未提供'))],['规则判定','未接入质控规则服务，不标通过或不通过']])}<label>处理与待核对事项<textarea id="care-note" class="textarea"></textarea></label>${button(`data-care-note-save="${h(t.dataset.qualityOpen)}"`,'记录处理，不自动结案')}`);
    if(t.hasAttribute('data-care-note'))note(t.dataset.careNote);
    if(t.hasAttribute('data-care-note-save')){const val=document.getElementById('care-note').value.trim();if(!val){showToast('请填写内容');return;}recordClinicalAction('note',t.dataset.careNoteSave,{note:val,status:'已记录，待医生核对'});closeClinicalActionModal();refresh();}
  });
  function toggleTreatment(key){
    if(!current()||factsEdited||(activeSimulationDisease!=='no-pathway'&&!hasUsableDemoReports()&&!window.PathwayTasks?.accepts(key)))return;
    if(window.OrderBridge?.accepted(key)){showToast('已有开立记录，请在医嘱记录查看');return;}
    if(selectionSignature&&selectionSignature!==signature()){showToast('患者资料已变化，请先核对原选择或重载病例');window.TreatmentWorkspace?.sync();return;}
    if(!plans().some(p=>p.items.some(name=>p.id+'|'+name===key))&&!medications().some(d=>d.key===key)&&!window.PathwayTasks?.accepts(key))return;
    if(!selectionSignature)selectionSignature=signature();
    if(picks.has(key))picks.delete(key);else picks.add(key);
    document.querySelectorAll('[data-care-add]').forEach(b=>{if(b.dataset.careAdd===key){b.textContent=picks.has(key)?'−':'+';b.setAttribute('aria-pressed',String(picks.has(key)));}});
    window.TreatmentWorkspace?.sync();
    showToast(picks.has(key)?'已加入本次选择':'已移除本次新选项目');
    if(document.getElementById('pathwayEngineModal')?.classList.contains('open'))renderPatientWorkbench();
  }
  return {reset,care,assessment,riskView,qualityView,tags,alerts,knowledge,network,
    applyEncounterEvent,riskMonitor,
    clearSelections:keys=>{keys.forEach(k=>picks.delete(k));if(!picks.size)selectionSignature='';},
    toggleTreatment,refreshTreatment:refresh,treatmentSafety:planSafety,treatmentAssessment:assessmentSummary,treatmentProcedure:procedurePanel,
    recordTreatmentEvent:text=>{events.push({time:now(),operationId:procedure?.id,text});refresh();},
    treatmentState:()=>({plans:plans(),picks:[...picks],selectionSignature,assessments:[...assessments],procedure,events:[...events],risks:[...risks],qualityNotes:{...qualityNotes}})};
})();
