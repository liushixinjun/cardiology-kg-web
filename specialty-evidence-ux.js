/* Shared patient evidence views. Local text extraction is not a connected NLP/graph service. */
window.ClinicalEvidenceUX=(()=>{
 const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let feedback=[],feedbackName='';
 function modal(title,body,sub=''){document.getElementById('clinicalActionTitle').textContent=title;document.getElementById('clinicalActionSubTitle').textContent=sub;document.getElementById('clinicalActionBody').innerHTML=body;document.getElementById('clinicalActionModal').classList.add('open');}
 function report(name){const r=screeningReport(name);modal(name+'报告',`<article class="cx-report" data-report-document><header><span>检查检验报告</span><h2>${h(name)}</h2><small>模拟报告 · 当前病例资料</small></header><dl><dt>姓名</dt><dd>${h(fieldValue('patientName','未提供'))}</dd><dt>科室</dt><dd>${h(fieldValue('dept','未提供'))}</dd><dt>报告状态</dt><dd>${h(r.status)}</dd><dt>报告时间</dt><dd>未提供</dd></dl><h3>报告内容</h3><p class="cx-report-result">${h(r.result||'尚无可用报告，不展示旧病例结果。')}</p><footer>来源：本次检查检验原文。报告编号、报告医师及审核信息未提供。</footer></article>`);}
 function recognition(title="当前推荐"){return AIEvidence.render(title);}
 function admissionRows(){
  const diagnosis=fieldValue('mainDiagnosis'),history=fieldValue('chiefComplaint')+'；'+fieldValue('presentHistory');
  const ecg=screeningReport('心电图').result,troponin=screeningReport('心肌肌钙蛋白').result,echo=screeningReport('超声心动图').result;
  const row=(title,evidence,met)=>({title,evidence:evidence||'尚无对应资料',met:!!met});
  if(activeSimulationDisease==='ami')return [
   row('诊断方向：AMI／STEMI',diagnosis,/STEMI|ST\s*段抬高型心肌梗死/.test(diagnosis)),
   row('心电图报告包含ST段抬高',ecg,/ST\s*段抬高/.test(ecg)),
   row('心肌肌钙蛋白：高于参考上限或动态升高',troponin,/高于参考上限|动态升高/.test(troponin)),
   row('发病时间或胸痛开始时间可明确',history,/\d+\s*(小时|分钟)|\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(history))
  ];
  if(activeSimulationDisease==='cardiomyopathy')return [row('心肌病分型方向',diagnosis,/心肌病/.test(diagnosis)),row('超声心动图：分型相关描述',echo,!!echo),row('心电图：已有结果',ecg,!!ecg)];
  return [];
 }
 function admissionReady(){const rows=admissionRows();return rows.length>0&&rows.every(r=>r.met)&&hasUsableDemoReports()&&!factsEdited;}
 function admission(){const rows=admissionRows(),ami=activeSimulationDisease==='ami';const date=t=>(t.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?/)||[])[0]||'未提供';return `<section class="cx-admission" data-clinical-admission><h3>入组证据核对</h3><p>核对本次诊断与报告后，确认入组。</p>${rows.map((r,i)=>`<div class="cx-condition"><strong>${h(r.title)}</strong><span class="cx-check ${!r.met||factsEdited?'missing':''}" aria-label="${factsEdited?'需复核':r.met?'已匹配':'待补充'}">${factsEdited?'↻':r.met?'✓':'—'}</span><p>${h(r.evidence)}</p><small class="cx-evidence-meta">${i===0?'诊断记录 · 编码：'+h((r.evidence.match(/[A-Z]\d{2}(?:\.\d+)?/)||[])[0]||'未提供')+' · 记录时间：'+h(date(r.evidence)):i===rows.length-1&&ami?h((r.evidence.match(/入院记录|首次病程记录|日常病程记录|病程记录|门诊病历|急诊病历/)||[])[0]||'主诉／现病史 · 文书类型未提供')+' · 记录时间：'+h(date(r.evidence)):'检查检验报告 · 检查时间：'+h(date(r.evidence))}</small></div>`).join('')||'<p>暂无入组条件</p>'}${ami?'<details><summary>诊断标准参考 · 心肌梗死通用定义（2018）</summary><p>急性心肌损伤伴急性心肌缺血证据：肌钙蛋白升高或下降，至少一次超过第99百分位参考上限，并有缺血症状、新发缺血性心电图改变、病理性Q波、相应影像证据或冠脉血栓等证据之一。</p><p>单次肌钙蛋白升高不等于已满足完整诊断标准；本页入组核对与临床诊断分开。</p><a href="https://www.jacc.org/doi/10.1016/j.jacc.2018.08.1038" target="_blank" rel="noopener noreferrer">查看标准原文 ↗</a></details>':''}</section>`;}
 function differential(name,record){
  const stale=record?.signature&&record.signature!==patientFactSignature();
  const reports=fieldValue('assistantExam');
  const lookup={'主动脉夹层':'主动脉 CTA','肺栓塞':'肺动脉 CTA','急性心包炎':'心电图','继发性心肌肥厚':'超声心动图'};
  const segments=reports.split(/[；;\n]/).filter(s=>s.includes(lookup[name]||name)&&!/待查|拟查|未回|等待|建议/.test(s));
  const conclusion=stale?'需重新评估':record?record.status:'未鉴别记录';
  const status=stale?'stale':record&&/暂不支持|不支持/.test(record.status)?'unsupported':record&&/已排除/.test(record.status)?'excluded':'insufficient';
  const statusLabel=conclusion;
  const knowledge={
   '主动脉夹层':{text:'结合胸痛表现及主动脉影像鉴别；CT、经食管超声或MRI可用于评估急性主动脉综合征。胸片不能单独确诊或排除。',source:'2022 ACC/AHA 主动脉疾病指南',url:'https://www.jacc.org/doi/10.1016/j.jacc.2022.08.004'},
   '肺栓塞':{text:'结合临床验前概率、D-二聚体及肺动脉CT血管成像（CTPA）鉴别。低或中等验前概率时可先检测D-二聚体，再按结果决定影像检查。',source:'2019 ESC/ERS 急性肺栓塞指南',url:'https://academic.oup.com/eurheartj/article/41/4/543/5556136'},
   '急性心包炎':{text:'关注与呼吸或体位相关的胸痛、心包摩擦音、广泛ST段抬高或PR段压低，以及新出现的心包积液，结合心电图与超声鉴别。',source:'ESC · Diagnosis of acute pericarditis（2017）',url:'https://www.escardio.org/communities/councils/cardiology-practice/scientific-documents-and-publications/ejournal/volume-15/Diagnosis-of-acute-pericarditis/'}
  }[name];
  return `<article class="encounter-diff cx-diff" data-diff-name="${h(name)}"><details><summary><strong>${h(name)} <span class="cx-diff-state ${status}" title="${h(statusLabel)}">${h(conclusion)}</span></strong><span class="cx-diff-chevron" aria-hidden="true">⌄</span></summary><div class="cx-diff-patient">${segments.length?`<p><b>相关报告</b>：${h(segments.join('；'))}</p>`:''}${record?`<p><b>鉴别记录</b>：${h(record.reason)}<small>${h(record.source||'既有鉴别记录')}${stale?' · 已失效，不能沿用':''}</small></p>`:'<p>未鉴别记录</p>'}</div></details>${knowledge?`<div class="cx-diff-knowledge"><p><b>鉴别要点</b>：${h(knowledge.text)}</p><a data-diff-source href="${h(knowledge.url)}" target="_blank" rel="noopener noreferrer">依据：${h(knowledge.source)} ↗</a></div>`:'<p class="cx-diff-knowledge">鉴别依据待补充</p>'}<footer class="cx-diff-feedback"><button class="btn link" data-diff-feedback="${h(name)}" aria-label="反馈${h(name)}鉴别结果">反馈</button></footer></article>`;
 }
 document.addEventListener('click',e=>{const b=e.target.closest('[data-diff-feedback]');if(b){feedbackName=b.dataset.diffFeedback;modal('结果反馈｜'+feedbackName,`<label>问题说明<textarea class="textarea" id="cx-feedback" placeholder="请说明不符合患者情况的内容"></textarea></label><button class="btn primary" data-cx-feedback-save>保存本地反馈</button><p role="status" id="cx-feedback-status"></p>`);}if(e.target.closest('[data-cx-feedback-save]')){const v=document.getElementById('cx-feedback').value.trim();if(v)feedback.push({name:feedbackName,note:v,signature:patientFactSignature(),time:new Date().toISOString()});document.getElementById('cx-feedback-status').textContent=v?'已保存本次会话反馈，未提交外部系统；不改变鉴别结论。':'请填写问题说明';}});
 return {admission,admissionReady,report,recognition,differential,feedback:()=>feedback.map(x=>({...x})),reset:()=>{feedback=[];feedbackName='';}};
})();
