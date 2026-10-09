/* Event-led encounter view; all events here belong to the local demonstration. */
window.PatientJourney=(()=>{
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tools=[['overview','诊疗进程'],['care','治疗与围术期'],['assessment','智能评估'],['prediction','疾病风险预测'],['quality','质控与记录']];
  const go=(id,label)=>`<button class="btn link" data-journey-go="${id}">${label} →</button>`;
  let reviewedStage=null;
  const configs={ami:{name:'急性心肌梗死',stages:['疑似识别','诊断与鉴别','再灌注决策','治疗执行','疗效与出院'],focus:'诊断依据、再灌注选择与治疗安全',next:'核对诊断与高危鉴别，结合治疗条件选择再灌注方案'},cardiomyopathy:{name:'心肌病',stages:['临床表型','分型与病因','风险分层','分型治疗','疗效与出院'],focus:'表型—病因—风险分层—分型治疗',next:'核对表型与病因线索，结合专科评估讨论治疗，不由家族史直接决定器械治疗'},'no-pathway':{name:'冠心病普通随诊',stages:['接诊核对','诊疗建议','医嘱执行','疗效复评'],focus:'普通诊疗 · 当前未配置专病路径',next:'核对既往诊断、当前用药与过敏史，选择本次适用项目'}};
  function snapshot(){
    const state=ClinicalUI.treatmentState(),orders=OrderBridge.state(),config=configs[activeSimulationDisease]||configs['no-pathway'];
    const executed=orders.filter(x=>x.executed),phase=state.procedure?.phase;
    let stage=hasUsableDemoReports()?1:0;
    if(activeSimulationDisease==='no-pathway')stage=orders.some(x=>x.status==='accepted')?2:1;
    else if(admissionConfirmed)stage=2;
    if(phase==='pre')stage=2;
    if(phase==='intra'||executed.length)stage=3;
    if(phase==='post')stage=3;
    return {state,orders,config,stage,executed,phase};
  }
  function overview(s){
    const {state,orders,config,executed,phase}=s;
    const proc=phase?({pre:'术前准备',intra:'术中监测',post:'术后观察与复评',cancel:'操作已取消'}[phase]):'未收到执行记录';
    const phaseNext={pre:'完成拟行操作的相关评估、必要报告和知情沟通核对；开始记录回传后显示术中事项。',intra:'查看当前操作记录、生命体征与异常事件；关注出血、心律及操作相关问题，记录处理并持续监测。',post:'核对术后症状、相关检查及并发症观察；记录疗效与复评安排，出院条件由医生判断。',cancel:'记录取消原因，重新核对治疗选择与后续安排；保留已发生的操作事件。'};
    const items=[['接诊病史',fieldValue('presentHistory','待补充')],['本次报告',fieldValue('assistantExam','尚无本次报告')],['下一步诊疗重点',phaseNext[phase]||(executed.length?'核对治疗反应、不良事件及复评安排。':config.next)]];
    return `<section data-journey-summary class="journey-summary"><div class="journey-kicker">本次就诊实况</div><h2>${h(config.name)} · ${h(proc)}</h2><p>${h(fieldValue('mainDiagnosis','诊断方向待确认'))}</p><div class="journey-events"><span>鉴别记录 ${window.EncounterDemo?.state().diff.length||0}</span><span>最近事件：${h(window.EncounterDemo?.state().records.at(-1)?.title||"等待诊疗记录")}</span></div><div class="journey-metrics"><span>医嘱已开立 ${orders.filter(x=>x.status==='accepted').length}<small>${executed.length?'执行记录 '+executed.length:orders.some(x=>x.status==='accepted')?'执行待回传':'尚无医嘱回执'}</small></span><span>评估记录 ${state.assessments.length}<small>${state.assessments.filter(x=>x.signature!==patientFactSignature()).length?'资料变化，需复评':'按病情选用，不限入径'}</small></span><span>风险记录 ${state.risks.length}<small>${state.risks.filter(x=>!x.reviewed).length} 项待核实</small></span></div></section>
      <section class="journey-decision"><h3>当前决策与待办</h3>${items.map(([k,v])=>`<div><strong>${k}</strong><p>${h(v)}</p></div>`).join('')}<div class="journey-actions">${go('care','查看治疗与用药')}${go('assessment','完成相关评估')}${go('prediction','查看风险因素')}</div></section>
      <section class="journey-records"><h3>诊疗事件与复评</h3>${state.procedure?`<p><b>${h(state.procedure.name)}</b> · ${h(proc)}</p>`:''}${state.events.map(e=>`<p><time>${h(e.time)}</time> ${h(e.text)}</p>`).join('')}${state.assessments.map(r=>`<p><time>${h(r.time)}</time> ${h(r.name)}：${h(r.note)} ${r.signature!==patientFactSignature()?'（历史资料，待复评）':''}</p>`).join('')}${orders.map(r=>`<p><time>${h(r.time)}</time> ${h(r.name)} · ${r.status==='accepted'?'模拟已开立':'未接收'} · ${r.executed?'已收到模拟执行反馈':'执行待回传'}</p>`).join('')}${!state.events.length&&!state.assessments.length&&!orders.length?'<p>暂无评估或治疗事件。演示翻页不代表患者已接受治疗。</p>':''}${go('quality','查看相关质控与处理')}${go('care','记录后续安排')}</section>`;
  }
  function factors(){return [['症状与病程','presentHistory'],['既往疾病','pastHistory'],['家族线索','familyHistory'],['检查检验','assistantExam'],['生命体征','physicalExam'],['过敏与安全','allergyHistory']];}
  function radar(){
    const cm=activeSimulationDisease==='cardiomyopathy';
    const name=cm?'心肌病相关心律失常风险':activeSimulationDisease==='ami'?'急性心肌梗死相关心律失常风险':'冠心病诊疗安全因素';
    const fs=factors();
    return `<section class="risk-factor-view"><div><span class="journey-kicker">专科风险监测视图</span><h3>${name}</h3><p>当前展示风险评估所需的患者资料，不把资料齐全程度当作疾病风险值。</p></div><div class="risk-factor-layout"><svg data-risk-radar viewBox="0 0 360 290" role="img" aria-label="风险因素来源雷达，六个维度可点击查看原文"><circle cx="180" cy="145" r="98" fill="#f2f8ff" stroke="#bdd5eb"/><circle cx="180" cy="145" r="52" fill="none" stroke="#d7e4ef" stroke-dasharray="4 5"/>${fs.map(([n,id],i)=>{const a=(i*60-90)*Math.PI/180,x=180+98*Math.cos(a),y=145+98*Math.sin(a);return `<line x1="180" y1="145" x2="${x}" y2="${y}" stroke="#bdd5eb"/><circle cx="${x}" cy="${y}" r="6" fill="${fieldValue(id,'')?'#148bc8':'#9dabb9'}"/><text x="${180+124*Math.cos(a)}" y="${149+120*Math.sin(a)}" text-anchor="middle" fill="#294e70" font-size="12">${n}</text>`;}).join('')}<circle cx="180" cy="145" r="33" fill="white" stroke="#2185bd"/><text x="180" y="142" text-anchor="middle" fill="#225a7b" font-size="12">患者因素</text><text x="180" y="159" text-anchor="middle" fill="#637d91" font-size="10">非风险评分</text></svg><div class="risk-factor-list">${fs.map(([n,id],i)=>`<button data-radar-factor="${i}"><strong>${n}</strong><small>${fieldValue(id,'')?'查看当前原文':'资料待补充'}</small></button>`).join('')}</div></div><div data-radar-detail class="journey-source">选择因素查看患者原文、来源及核对事项。</div><div class="risk-model-boundary"><strong>模型与智能分析</strong><p>预测模型：适用人群、版本及结果待接入。大模型：用于整理线索和解释依据，生成结果须与原文核对；此处不显示虚构概率或模型命中。</p></div></section>`;
  }
  function render(module){
    if(module==='pathway'){module='overview';reviewedStage=null;}
    const s=snapshot(),c=s.config;
    const stageIndex=reviewedStage??s.stage;
    const stageDetail=`<section class="journey-decision"><span class="journey-kicker">阶段详情 · 不改变当前诊疗状态</span><h3>${h(c.stages[stageIndex])}</h3><p>${stageIndex===s.stage?'当前关注阶段，结合下方患者实况处理。':stageIndex>s.stage?'后续阶段预览，尚无对应完成结论。':'回看该阶段资料；先前阶段不因进程推进自动认定全部完成。'}</p><p>${stageIndex<2?'核对本次病历、检查检验和诊断依据；信息冲突时保留待核验项。':stageIndex===2?c.next:'核对实际执行、异常处理及复评记录；出院记录仅包含医生确认的安排。'}</p>${go(stageIndex<2?'assessment':stageIndex===2?'care':'quality','处理相关事项')}</section>`;
    const related=stageIndex<2?EncounterDemo.differential():stageIndex===2?ClinicalUI.assessment():stageIndex===3?ClinicalUI.treatmentProcedure():ClinicalUI.qualityView();
    const stageView=PathwayTasks.render(s,stageIndex);
    const body=module==='care'?PathwayTasks.render(s,s.stage,'treatment'):module==='assessment'?ClinicalUI.assessment():module==='prediction'?ClinicalUI.riskView()+`<details class="risk-factor-fold"><summary>患者因素与原文依据</summary>${radar()}</details>`:module==='quality'?ClinicalUI.qualityView():stageView;
    return `<div class="journey-heading"><div><span class="journey-kicker">${h(fieldValue('patientName','当前患者'))} · ${activeSimulationDisease==='no-pathway'?'普通诊疗':'心血管专科'}</span><h2>${h(c.name)}诊疗进程</h2><p>${h(c.focus)}</p></div><span class="journey-path-status">${activeSimulationDisease==='no-pathway'?'未配置路径 · 通用能力可用':admissionConfirmed?'已确认入径':'尚未入径 · 评估和治疗建议可用'}</span></div><div class="journey-layout"><aside class="journey-stages" aria-label="诊疗阶段">${c.stages.map((name,i)=>`<button data-journey-stage="${i}" class="${s.stage===i?'current':''}" aria-current="${s.stage===i?'step':'false'}"><span>${i+1}</span><b>${name}</b><small>${s.stage===i?'当前关注':i>s.stage?'后续阶段':'阶段回看'}</small></button>`).join('')}<p>由报告、评估及执行事件更新；阶段回看不改变患者状态。</p></aside><main class="journey-main"><nav class="journey-tools" aria-label="就诊工具">${tools.map(([id,label])=>`<button data-workbench-module="${id}" aria-pressed="${id===module}" class="${id===module?'selected':''}">${label}</button>`).join('')}</nav>${factsEdited?'<p class="journey-warning">患者资料已修改：保留历史记录，治疗选择与相关评估需重新核对。</p>':''}${body}</main></div>`;
  }
  document.addEventListener('click',e=>{
    const goButton=e.target.closest('[data-journey-go]');if(goButton){if(goButton.dataset.journeyGo==='overview')reviewedStage=null;openPatientWorkbench(goButton.dataset.journeyGo);}
    if(e.target.closest('[data-workbench-module="overview"]')){reviewedStage=null;renderPatientWorkbench();}
    const stage=e.target.closest('[data-journey-stage]');if(stage){reviewedStage=Number(stage.dataset.journeyStage);openPatientWorkbench('overview');}
    const f=e.target.closest('[data-radar-factor]');if(f){const [name,id]=factors()[Number(f.dataset.radarFactor)],target=f.closest('.risk-factor-view').querySelector('[data-radar-detail]');target.innerHTML=`<strong>${h(name)} · 病历原文</strong><p>${h(fieldValue(id,'未提供，需补充'))}</p><small>来源：当前就诊病历对应字段。原文不等于已确认风险因素，需核对否定、时间及本人／家属。</small>`;}
  });
  return {render,radar,snapshot,reset:()=>{reviewedStage=null;window.PathwayTasks?.reset();}};
})();
