/* Interactive treatment design: shared selections and events, local draft only. */
window.TreatmentWorkspace = (() => {
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let catalog=[], active='', tab='orders', baseline='', rx={}, notes={}, phaseDrafts={}, documentDraft='', builtFrom='', opener=null, timer, lastWrite=null;
  const data=()=>ClinicalUI.treatmentState();
  const key=(p,name)=>p.id+'|'+name;
  const selected=k=>data().picks.includes(k);
  const valid=()=>baseline===patientFactSignature()&&hasUsableDemoReports();
  const el=()=>document.getElementById('treatmentWorkspace');
  const btn=(attrs,text)=>`<button type="button" ${attrs}>${text}</button>`;
  const details={
    pci:{goal:'围绕再灌注治疗，核对介入方案与操作准备',why:'依据当前诊断、心电图及心肌损伤相关报告讨论；并非自动确认手术适应证。',assessment:'手术风险评估',care:['活动与康复安排','知情沟通与健康教育'],watch:['症状与生命体征变化','穿刺部位及出血观察','操作后相关检查与复评']},
    lysis:{goal:'比较再灌注备选方案，明确适用条件及安全限制',why:'与介入方案进行临床比较，不默认同时采用两种再灌注策略。',assessment:'GRACE评分',care:['治疗沟通与观察安排'],watch:['治疗后的症状变化','出血及其他异常情况','再灌注效果的临床复评']},
    platelet:{goal:'结合当前治疗安排选择抗血小板方案',why:'结合当前诊断、拟行治疗、既往用药与安全资料选择；下方药物不默认全部联用。',assessment:'GRACE评分',care:['用药沟通与依从性指导','活动与康复计划'],watch:['出血相关表现','用药耐受与不良反应','复查与后续治疗安排']},
    coagulation:{goal:'结合治疗情境选择抗凝方案并跟踪安全性',why:'核对既往抗凝、拟行操作及当前相关报告，候选药物按需选择。',assessment:'GRACE评分',care:['用药与风险沟通'],watch:['出血及其他异常表现','相关报告与用药变化','是否需要重新评估方案']},
    lipid:{goal:'制定调脂治疗与后续复查安排',why:'结合现有血脂报告、既往用药及耐受情况制定个体化计划。',assessment:null,care:['生活方式与用药指导'],watch:['药物耐受情况','相关复查结果','后续方案调整']},
    cm:{goal:'先明确心肌病分型与当前症状，再组织治疗',why:'不同分型不套用同一处方；结合现有资料和患者感受进行方案讨论。',assessment:'KCCQ问卷',care:['日常活动与症状管理','患者教育与沟通'],watch:['症状与活动能力变化','药物耐受情况','相关检查与分型复核']},
    icd:{goal:'围绕植入方案讨论，核对专科风险和患者意愿',why:'家族史仅为一项线索，需结合完整专科评估；讨论不等于决定植入。',assessment:'手术风险评估',care:['知情沟通与术后生活指导'],watch:['操作部位与术后观察','相关装置检查记录','症状变化及专科复评']}
  };
  function reset(){clearTimeout(timer);catalog=[];active='';tab='orders';baseline='';rx={};notes={};phaseDrafts={};documentDraft='';builtFrom='';lastWrite=null;close();}
  function card(p){
    return p.items.map(name=>{const k=key(p,name),order=OrderBridge.accepted(k);return `<div class="ordinary-item" data-ordinary-item><div>${p.knowledgeOnly?'<span class="ordinary-status" title="院内品种及规格尚未匹配">暂不可开立</span>':order?`<span class="ordinary-status">${order.executed?'已执行':'已开立'}</span>`:`<button class="screening-add" data-care-add="${h(k)}" aria-label="选择${h(name)}" aria-pressed="${selected(k)}">${selected(k)?'−':'+'}</button>`}<strong>${h(name)}</strong><button class="knowledge-info" data-static-knowledge="${h(name)}" aria-label="查看${h(name)}知识详情">i</button><button class="btn link ordinary-detail" data-ordinary-detail="${h(k)}" aria-label="查看${h(name)}推荐依据" title="推荐依据">›</button></div></div>`;}).join("");
  }
  function guide(p){const text={coagulation:'ACS抗凝药物选择需结合再灌注策略、肾功能及合并抗栓用药，核对出血风险。',lysis:'STEMI不能及时接受直接PCI时需评估溶栓策略，结合发病时间、转运条件及禁忌证决定。',platelet:'ACS抗血小板治疗通常包含阿司匹林与一种口服P2Y12抑制剂，具体选择需结合出血风险和治疗策略。',lipid:'ACS患者推荐强化他汀治疗，结合耐受性和血脂结果制定方案。',pci:'ACS血运重建方式需结合冠脉病变复杂程度、合并症和临床情况决定。'}[p.id];return activeSimulationDisease==='ami'&&text?`<p class="tw-guide" data-treatment-guide><b>指南依据：</b>${h(text)} <a href="https://www.jacc.org/doi/10.1016/j.jacc.2024.11.009" target="_blank" rel="noopener noreferrer">2025 ACS指南 ↗</a></p>`:'<p class="tw-guide">指南依据：该项目的知识摘要待补充。</p>';}
  function ordinaryDetail(k){
    const p=data().plans.find(p=>p.items.some(n=>key(p,n)===k));
    if(!p){showToast('患者资料已变化，请重新查看推荐');return;}
    const name=k.slice(k.indexOf('|')+1),d=details[p.id]||{},order=OrderBridge.accepted(k);
    document.getElementById('clinicalActionTitle').textContent='推荐依据｜'+name;
    document.getElementById('clinicalActionSubTitle').textContent='';
    document.getElementById('clinicalActionBody').innerHTML=`<section data-ordinary-basis><h4>患者依据</h4><p>${h(fieldValue('mainDiagnosis','诊断待确认'))}</p><p>${h(fieldValue('assistantExam','尚无检查检验结果'))}</p>${guide(p)}<h4>注意事项</h4><p>${h(d.why||'需结合当前患者资料核对适用性。')}</p><p>过敏史：${h(fieldValue('allergyHistory','未提供'))}</p>${order?'<p>'+h(order.executed?'已执行':'已开立 · 待执行')+'</p><button class="btn link" data-order-history>查看医嘱记录</button>':'<p>选择项目后统一进行开立核对。</p>'}</section>`;
    document.getElementById('clinicalActionModal').classList.add('open');
  }
  function mount(){if(el())return;document.body.insertAdjacentHTML('beforeend','<div id="treatmentWorkspace" class="tw-overlay" hidden><section class="tw-dialog" role="dialog" aria-modal="true" aria-labelledby="twTitle" tabindex="-1"></section></div>');}
  function open(id){
    if(!data().plans.length){showToast('请先核对当前患者资料');return;}
    mount();opener=document.activeElement;catalog=window.PathwayTasks?.availablePlans()||data().plans;if(!catalog.length){showToast('当前阶段暂无可操作的治疗方案');return;}active=catalog.some(p=>p.id===id)?id:catalog[0].id;
    if(!baseline)baseline=data().selectionSignature||patientFactSignature();tab='orders';el().hidden=false;render();el().querySelector('[data-tw-close]').focus();
  }
  function close(){if(el())el().hidden=true;opener?.isConnected&&opener.focus();opener=null;}
  function sectionBody(p,d,tab='orders'){
    const blocked=!valid();
    if(tab==='orders'&&p.knowledgeOnly)return `<h3>溶栓药物候选</h3><p>以下为指南列举的药物，需先核对患者适用性；院内品种及规格尚未匹配。</p><div class="drug-candidate-list">${p.items.map(name=>`<article><strong>${h(name)}</strong><span>规格待院内字典匹配</span><button class="knowledge-info" data-static-knowledge="${h(name)}" aria-label="查看${h(name)}知识">i</button></article>`).join('')}</div><p class="tw-muted">未匹配院内药品前不生成医嘱，不预填剂量与用法。</p>`;
    if(tab==='orders')return `<h3>${p.operation?'手术 / 操作项目':'药物与治疗项目'}</h3>${p.items.map(name=>{
      const k=key(p,name),isSelected=selected(k),r=rx[k]||{},order=OrderBridge.accepted(k);
      return `<article class="tw-order ${isSelected?'chosen':''}"><div class="tw-order-title"><input type="checkbox" data-tw-pick="${h(k)}" aria-label="选择${h(name)}" ${isSelected?'checked':''} ${blocked||order?'disabled':''}><strong>${h(name)}</strong>${btn(`class="knowledge-info" data-static-knowledge="${h(name)}" title="查看知识"`,'i')}<span>${order?(order.executed?'已执行':'已开立 · 待执行'):p.operation?'操作申请':'用药选择'}</span></div>${order?`<p class="tw-order-receipt">${h(order.product)} · ${h(order.executed?order.executionTime:order.time)} <button class="tw-text" data-order-history>医嘱记录 ›</button></p>`:''}${isSelected&&!order?`<div class="tw-rx">${(p.operation?[['product','院内操作项目'],['note','申请说明']]:[['product','院内药品 / 规格'],['dose','单次用量'],['route','给药途径'],['frequency','频次'],['duration','疗程 / 时点'],['note','补充说明']]).map(([f,label])=>`<label>${label}<input data-rx-key="${h(k)}" data-rx-field="${f}" value="${h(r[f]||'')}" placeholder="${f==='product'?'选择或填写院内项目':'由医生填写'}" ${blocked?'disabled':''}></label>`).join('')}</div>`:''}</article>`;
    }).join('')}<div class="tw-muted">${p.operation?'申请与实际操作记录分开。':'同类候选不默认联用；本页不预设剂量。'}</div>`;
    if(tab==='care'||tab==='monitor'){
      const items=tab==='care'?d.care:d.watch;
      return `<h3>${tab==='care'?'非药物措施与护理协同':'观察与复评安排'}</h3><p class="tw-help">${tab==='care'?'医生记录诊疗安排；护理观察和执行沿用原记录，不重复填报。':'围绕当前治疗记录观察重点、异常处理和复评安排。'}</p><ul class="tw-checkpoints">${items.map(s=>`<li>${h(s)}</li>`).join('')}</ul><label class="tw-note-label">本次安排<textarea data-tw-note="${tab}" ${blocked?'disabled':''} placeholder="记录具体措施、责任岗位或复评安排">${h(notes[p.id+'|'+tab]||'')}</textarea></label>${d.assessment?btn(`class="tw-text" data-assessment-open="${h(d.assessment)}"`,'打开相关评估 · '+h(d.assessment)):''}`;
    }
    if(tab==='procedure')return `<h3>围术期过程</h3>${data().procedure?ClinicalUI.treatmentProcedure()+phaseForm(blocked)+(data().procedure.phase==='cancel'?btn(`class="tw-primary" data-procedure-plan="${p.id}" ${blocked?'disabled':''}`,'重新选择本次操作'):''):`<p class="tw-help">尚无本次操作事件。选择操作后再按实际记录推进阶段。</p>${btn(`class="tw-primary" data-procedure-plan="${p.id}" ${blocked?'disabled':''}`,'演示选择本次操作')}`}<p class="tw-help">术前、术中、术后依据不同记录推进；不因完成评估自动跳到术后。</p>`;
    const picks=data().picks;
    return `<h3>本次选择与病历草稿</h3><p class="tw-help">${picks.length}项本次新选项目；可跨方案核对。已有医嘱不在此撤销。</p>${picks.map(k=>`<div class="tw-review-item"><strong>${h(k.split('|')[1])}</strong><p>${h(Object.entries(rx[k]||{}).filter(([,v])=>v).map(([f,v])=>({product:'院内项目',dose:'用量',route:'途径',frequency:'频次',duration:'疗程',note:'说明'}[f])+ '：'+v).join('；')||'尚未补充开单内容')}</p>${btn(`class="tw-text" data-tw-remove="${h(k)}" ${blocked?'disabled':''}`,'移除本次选择')}</div>`).join('')||'<div class="tw-empty">暂无新选项目，可返回治疗项目添加。</div>'}<div class="tw-document-head"><strong>诊疗计划草稿</strong>${btn(`class="tw-text" data-tw-build-note ${blocked?'disabled':''}`,'从当前选择生成草稿')}</div>${builtFrom&&builtFrom!==draftSignature()?'<p class="tw-draft-warning">选择或安排已变化，当前草稿未自动覆盖；请重新生成或人工修改。</p>':''}<textarea data-tw-document placeholder="可从选择生成后再编辑；不会自动开立医嘱。" ${blocked?'disabled':''}>${h(documentDraft)}</textarea>${btn(`class="tw-primary" data-tw-save-note ${blocked||!documentDraft.trim()?'disabled':''}`,'保存至病历区 · 诊疗计划')}<small class="tw-save-hint" role="status"></small>`;
  }
  function render(){
    if(!el()||el().hidden)return;
    const p=catalog.find(p=>p.id===active);if(!p)return;const d=details[p.id],blocked=!valid();
    const sections=[['orders','治疗项目'],['care','护理与非药物'],['monitor','观察与复评'],...(p.operation?[['procedure','围术期']]:[]),['review','本次选择']];
    if(!sections.some(([id])=>id===tab))tab='orders';
    const scroll=el().querySelector('.tw-content')?.scrollTop||0;
    const folds=Object.fromEntries([...el().querySelectorAll('[data-tw-block]')].map(n=>[n.dataset.twBlock,n.open]));
    const related=data().assessments.filter(r=>r.name===d.assessment), latest=related.at(-1);
    const alerts=patientCareView().alerts;
    el().querySelector('.tw-dialog').innerHTML=`<header class="tw-header"><div><h2 id="twTitle">治疗详情｜${h(p.name)}</h2><p>${h(fieldValue('patientName','当前患者'))} · ${h(fieldValue('dept','科室未提供'))} · ${h(fieldValue('mainDiagnosis','诊断待确认'))}</p></div>${btn('class="tw-close" data-tw-close aria-label="关闭治疗方案"','关闭')}</header>${blocked?'<div class="tw-stale" role="alert">患者资料已变化：保留原方案和草稿供核对，暂停新增选择与保存。请先核对本次资料。</div>':''}<div class="tw-layout"><nav class="tw-nav" aria-label="治疗方案选择"><span class="tw-nav-label">当前讨论方案</span>${catalog.map(x=>btn(`data-tw-plan="${x.id}" aria-current="${x.id===active?'true':'false'}"`,h(x.name)+`<small>${h(x.kind)}</small>`)).join('')}</nav><main class="tw-main"><div class="tw-goal"><span>治疗目标</span><h3>${h(d.goal)}</h3><p data-treatment-evidence>患者依据：${h(fieldValue('mainDiagnosis','诊断未提供'))}；${h((fieldValue('assistantExam').split(/[；;\n]/).filter(x=>p.id==='lipid'?/LDL|血脂/.test(x):/心电图|肌钙蛋白/.test(x)).slice(0,2).join('；'))||fieldValue('chiefComplaint','尚无相关记录'))}</p>${guide(p)}</div><div class="tw-content cx-continuous">${sections.map(([id,label])=>`<details class="tw-block" data-tw-block="${id}" ${folds[id]===false?'':'open'}><summary>${label}</summary><div>${sectionBody(p,d,id)}</div></details>`).join('')}</div></main><aside class="tw-context"><section><h4>安全提醒</h4><p>过敏史：${h(fieldValue('allergyHistory','未提供'))}</p>${alerts.length?alerts.map(a=>`<div class="tw-alert"><strong>${h(a.title)}</strong><p>${h(a.reason)}</p></div>`).join(''):'<p>结合本次病历、报告与用药核对相关风险。</p>'}<p>${h(ClinicalUI.treatmentSafety(p))}</p></section><section><h4>相关评估</h4>${d.assessment?`<strong>${h(d.assessment)}</strong><p>${latest?h(latest.note)+(latest.signature!==patientFactSignature()?' · 资料变化，待复评':''):'尚无本次评估记录'}</p>${btn(`class="tw-text" data-assessment-open="${h(d.assessment)}"`,'打开评估')}`:'<p>按病情选择适用评估，不强制为每个治疗建立量表。</p>'}<small>已有评估记录共用，无需重复填写。</small></section><section><h4>相关质控</h4><p>复用既有单病种质控任务及评估记录。</p>${btn('class="tw-text" data-tw-quality','查看单病种质控')}</section></aside></div><footer class="tw-footer"><span data-tw-count>本次选择 ${data().picks.length} 项 · 开单前由医生核对</span>${btn('class="tw-text" data-tw-section="review"','核对选择与病历草稿 →')}${btn('class="tw-primary" data-order-review','开立核对')}</footer>`;
    el().querySelector('.tw-content').scrollTop=scroll;
    if(typeof bindClinicalTaskActions==='function')bindClinicalTaskActions(el());
  }
  function draftSignature(){return JSON.stringify([data().picks,rx,notes]);}
  function phaseKey(){const p=data().procedure;return p?'围术期｜'+p.name+'｜'+p.id+'｜'+p.phase:'';}
  function phaseForm(blocked){
    const proc=data().procedure;if(!proc||proc.phase==='cancel')return '';
    const k=phaseKey(),labels={pre:['评估与报告核对','知情沟通与操作准备','待补事项与安排'],intra:['操作过程与关键发现','生命体征及异常情况','已采取措施与交接'],post:['术后症状与体征','操作部位及护理观察','异常处置与复评安排']}[proc.phase];
    const fields=phaseDrafts[k]||clinicalTaskRecords[k]?.fields||{};
    return `<div class="tw-phase-form"><h3>${{pre:'术前准备记录',intra:'术中事件记录',post:'术后观察与复评'}[proc.phase]}</h3><p class="tw-help">演示接收或补记医疗事件；保存记录不会自动判定质控达标。</p>${labels.map(label=>`<label>${h(label)}<textarea data-tw-phase-field="${h(label)}" ${blocked?'disabled':''} placeholder="填写本次记录，不填不推定为正常">${h(fields[label]||'')}</textarea></label>`).join('')}${btn(`class="tw-primary" data-tw-phase-save ${blocked?'disabled':''}`,'保存本阶段记录')}</div><details class="tw-phase-history"><summary>查看已保存的围术期记录</summary>${Object.values(clinicalTaskRecords).filter(r=>r.title?.startsWith('围术期｜'+proc.name+'｜')).map(r=>`<article><strong>${h(r.stageLabel)}</strong><p>${h(r.note)}</p><small>${h(new Date(r.time).toLocaleString('zh-CN'))}</small></article>`).join('')||'<p>暂无已保存记录</p>'}</details>`;
  }
  function buildNote(){
    const parts=['诊疗计划（待医生核对）'];
    for(const p of catalog){const ks=data().picks.filter(k=>k.startsWith(p.id+'|')),care=notes[p.id+'|care'],monitor=notes[p.id+'|monitor'];if(!ks.length&&!care&&!monitor)continue;
      parts.push(p.name+'：'+details[p.id].goal);
      ks.forEach(k=>parts.push('拟选项目：'+k.split('|')[1]+'；'+Object.entries(rx[k]||{}).filter(([,v])=>v).map(([f,v])=>({product:'院内项目',dose:'用量',route:'途径',frequency:'频次',duration:'疗程',note:'说明'}[f])+ '：'+v).join('；')));
      if(care)parts.push('措施与护理协同：'+care);if(monitor)parts.push('观察复评：'+monitor);
    }
    documentDraft=parts.join('\n');builtFrom=draftSignature();render();
  }
  document.addEventListener('change',e=>{if(e.target.matches('input[data-tw-pick]')){if(valid())ClinicalUI.toggleTreatment(e.target.dataset.twPick);render();}});
  document.addEventListener('input',e=>{
    const t=e.target;if(t.matches('[data-rx-field]')){rx[t.dataset.rxKey]||={};rx[t.dataset.rxKey][t.dataset.rxField]=t.value;}
    else if(t.matches('[data-tw-note]'))notes[active+'|'+t.dataset.twNote]=t.value;
    else if(t.matches('[data-tw-phase-field]')){phaseDrafts[phaseKey()]||={};phaseDrafts[phaseKey()][t.dataset.twPhaseField]=t.value;}
    else if(t.matches('[data-tw-document]')){documentDraft=t.value;el().querySelector('[data-tw-save-note]').disabled=!valid()||!documentDraft.trim();}
    else if(!t.closest('#treatmentWorkspace')&&!t.closest('#clinicalActionModal')){clearTimeout(timer);timer=setTimeout(render,250);}
  });
  document.addEventListener('click',e=>{
    const t=e.target.closest('button');if(!t)return;
    if(t.hasAttribute('data-ordinary-detail'))ordinaryDetail(t.dataset.ordinaryDetail);
    if(t.hasAttribute('data-treatment-open'))open(t.dataset.treatmentOpen);
    if(t.hasAttribute('data-tw-close'))close();
    if(t.hasAttribute('data-tw-plan')){active=t.dataset.twPlan;tab='orders';render();}
    if(t.hasAttribute('data-tw-section')){const block=el().querySelector('[data-tw-block="'+t.dataset.twSection+'"]');if(block){block.open=true;block.scrollIntoView({block:'start',behavior:'smooth'});}}
    if(t.hasAttribute('data-tw-pick')||t.hasAttribute('data-tw-remove')){if(!valid())return;ClinicalUI.toggleTreatment(t.dataset.twPick||t.dataset.twRemove);render();}
    if(t.hasAttribute('data-tw-build-note')&&valid())buildNote();
    if(t.hasAttribute('data-tw-save-note')&&valid()&&documentDraft.trim()){
      recordClinicalAction('note','诊疗计划',{note:documentDraft,status:'病历草稿'});const field=document.getElementById('treatmentText');
      if(field){
        const before=field.value;
        // Replace only the exact span written by this workspace, and only when the
        // surrounding document is unchanged. Otherwise append without editing prose.
        let start;
        if(lastWrite&&before===lastWrite.full){start=lastWrite.start;field.value=before.slice(0,start)+documentDraft+before.slice(lastWrite.end);}
        else{const prefix=before.trim()?before+'\n\n':'';start=prefix.length;field.value=prefix+documentDraft;}
        lastWrite={full:field.value,start,end:start+documentDraft.length};field.classList.add('changed-field','output-change');
      }
      ClinicalUI.refreshTreatment();const hint=el().querySelector('.tw-save-hint');if(hint)hint.textContent='已保存诊疗计划草稿，未开立医嘱';showToast('诊疗计划草稿已保存');
    }
    if(t.hasAttribute('data-tw-basis'))openClinicalActionModal('patientBasis',catalog.find(p=>p.id===active)?.name||'诊疗方案');
    if(t.hasAttribute('data-tw-quality')){close();if(document.getElementById('pathwayEngineModal').classList.contains('open'))openPatientWorkbench('quality');else setRecommendationTab('quality');}
    if(t.hasAttribute('data-tw-phase-save')&&valid()){
      const k=phaseKey(),fields=phaseDrafts[k]||{},note=Object.entries(fields).filter(([,v])=>v.trim()).map(([label,v])=>label+'：'+v).join('\n');
      if(!note){showToast('请填写本阶段记录');return;}
      const stageLabel={pre:'术前记录',intra:'术中记录',post:'术后记录'}[data().procedure.phase];
      recordClinicalAction('procedure',k,{fields:{...fields},note,stageLabel,procedureId:data().procedure.id,status:'已记录'});ClinicalUI.recordTreatmentEvent(stageLabel+'已保存');render();showToast('已保存本阶段记录');
    }
  });
  document.addEventListener('keydown',e=>{
    if(!el()||el().hidden||document.getElementById('clinicalActionModal').classList.contains('open'))return;
    if(e.key==='Escape'){close();e.preventDefault();}
    if(e.key==='Tab'){const all=[...el().querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),summary')].filter(n=>n.getClientRects().length),first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}
  });
  return {card,open,close,sync:render,reset,orderDrafts:()=>JSON.parse(JSON.stringify(rx))};
})();
