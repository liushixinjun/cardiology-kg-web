/* Explicit fictional encounter events for prototype walkthroughs, not clinical inference. */
window.EncounterDemo=(()=>{
 const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const steps=['载入检查检验报告','回填医生鉴别记录','回填相关评估记录','回填拟行治疗决定','回填治疗开始与监测提示','回填治疗结束与复评'];
 let cursor=0,records=[],diff=[];
 function reset(){cursor=0;records=[];diff=[];window.ClinicalEvidenceUX?.reset();}
 function sync(){const b=document.querySelector('[data-encounter-next]');if(b){b.textContent=cursor<steps.length?'模拟事件：'+steps[cursor]:'就诊事件演练完成';b.disabled=cursor>=steps.length;b.title='明确载入虚构事件；不同于仅浏览页面的下一步';}}
 function next(){
   if(!demoCaseLoaded){loadCase();sync();showToast('已载入病例，下一事件为报告回填');return;}
   if(factsEdited||evidenceBranch!=='standard'){showToast('资料已修改或存在证据分支，请核对或重新载入演示病例，不套用原事件');return;}
   if(activeSimulationDisease==='no-pathway'){showToast('普通病例可直接进行推荐、开立和评估；不套用AMI手术事件');return;}
   if(cursor>=steps.length)return;
   if(cursor===0&&!hasUsableDemoReports())fillReports();
   if(cursor===1){
     diff=activeSimulationDisease==='ami'?[{name:'主动脉夹层',status:'当前依据不支持该诊断',reason:'模拟医生鉴别记录已回填；结合病史、查体及现有资料作出本次判断。不是凭缺少CTA自动排除。'},{name:'肺栓塞',status:'需继续观察',reason:'模拟医生保留观察与再评估安排；未记录排除结论，不默认追加CTA。'},{name:'急性心包炎',status:'当前依据不支持该诊断',reason:'模拟医生已核对当前心电图及超声资料；患者情况变化时重新评估。'}]:[{name:'继发性心肌肥厚',status:'需进一步明确病因',reason:'模拟专科记录：保留表型、病因及家族信息，不能仅凭单项检查确定病因。'}];
     if(simulationState!=='periop')assistFocus='diagnosis';
     diff=diff.map(r=>({...r,signature:patientFactSignature(),source:'模拟EMR医生鉴别记录'}));
     if(activeSimulationDisease==='ami'){setField('subDiagnosis1','主动脉夹层');setField('subStatus1','当前依据不支持该诊断，病情变化时复评');setField('subDiagnosis2','肺栓塞');setField('subStatus2','继续观察与再评估');}
   }
   if(cursor>=2)ClinicalUI.applyEncounterEvent(['','','assessment','decision','start','reassessment'][cursor]);
   records.push({title:steps[cursor],source:cursor===0?'模拟检查检验回填':cursor===1?'模拟EMR医生记录':cursor===2?'模拟评估中心回填':'模拟诊疗事件回填',time:new Date().toLocaleString('zh-CN',{hour12:false})});cursor++;
   renderRecommendations();sync();showToast('已载入：'+steps[cursor-1]+'（虚构病例事件）');
 }
 function differential(){
   const names=activeSimulationDisease==='cardiomyopathy'?['继发性心肌肥厚']:['主动脉夹层','肺栓塞','急性心包炎'];
   return section('鉴别诊断',names.length,names.map(name=>ClinicalEvidenceUX.differential(name,diff.find(x=>x.name===name))).join(''));
 }
 function entry(){
   document.getElementById('clinicalActionTitle').textContent='HIS／EMR患者基本信息入口（模拟）';document.getElementById('clinicalActionSubTitle').textContent='以患者与本次就诊进入辅助诊疗；选择新病例将清空当前本地演示记录';
   document.getElementById('clinicalActionBody').innerHTML=`<div class="encounter-patients">${[['ami','刘大虾','急诊 · 胸痛病例'],['cardiomyopathy','心肌病虚构患者','专科 · 心肌病病例'],['no-pathway','普通随诊示例','门诊 · 冠心病，无专病路径']].map(([id,name,desc])=>`<article><strong>${name}</strong><p>${desc}</p><small>虚构患者 · 不连接真实HIS</small><button class="btn primary" data-encounter-patient="${id}">进入患者辅助诊疗</button></article>`).join('')}</div>`;document.getElementById('clinicalActionModal').classList.add('open');
 }
 function review(name){const r=diff.find(x=>x.name===name);document.getElementById('clinicalActionTitle').textContent='鉴别判断｜'+name;document.getElementById('clinicalActionSubTitle').textContent='医生记录与依据保留；不因未做检查自动判定风险';document.getElementById('clinicalActionBody').innerHTML=`<p>当前病历：${h(fieldValue('presentHistory','未提供'))}</p><p>报告：${h(fieldValue('assistantExam','未提供'))}</p><label>本次判断<select class="input" id="diff-status"><option>当前依据不支持该诊断</option><option>需继续观察</option><option>发现可疑线索，需进一步评估</option></select></label><label>判断依据与后续安排<textarea class="textarea" id="diff-reason">${h(r?.reason||'')}</textarea></label><button class="btn primary" data-diff-save="${h(name)}">保存本次判断</button>`;const select=document.getElementById('diff-status');if(r){if(![...select.options].some(o=>o.value===r.status))select.add(new Option(r.status,r.status));select.value=r.status;}document.getElementById('clinicalActionModal').classList.add('open');}
 document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
   if(b.hasAttribute('data-encounter-next'))next();
   if(b.hasAttribute('data-external-patient'))entry();
   if(b.hasAttribute('data-encounter-patient')){activeSimulationDisease=b.dataset.encounterPatient;document.getElementById('simulationDiseaseSelect').value=activeSimulationDisease;closeClinicalActionModal();resetSimulation(false);loadCase();}
   if(b.hasAttribute('data-open-workbench')){PatientJourney.reset();openPatientWorkbench();}
   if(b.hasAttribute('data-patient-tool'))openPatientWorkbench(b.dataset.patientTool);
   if(b.hasAttribute('data-patient-inline'))setRecommendationTab(b.dataset.patientInline);
   if(b.hasAttribute('data-diff-review'))review(b.dataset.diffReview);
   if(b.hasAttribute('data-diff-save')){const reason=document.getElementById('diff-reason').value.trim();if(!reason){showToast('请填写判断依据与后续安排');return;}const r={name:b.dataset.diffSave,status:document.getElementById('diff-status').value,reason,signature:patientFactSignature(),source:'医生本地鉴别记录'};diff=diff.filter(x=>x.name!==r.name).concat(r);const idx={'主动脉夹层':1,'肺栓塞':2}[r.name];if(idx){setField('subDiagnosis'+idx,r.name+'（已评估）');setField('subStatus'+idx,r.status);}closeClinicalActionModal();renderRecommendations();}
 });
 return {reset,sync,next,differential,state:()=>({cursor,nextLabel:steps[cursor]||'',records:[...records],diff:[...diff]})};
})();
