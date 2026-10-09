/* Local interaction adapter. It never sends a request to HIS or an execution system. */
window.OrderBridge=(()=>{
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let records=[],drafts={},review=null,serial=0;
  const stamp=()=>new Date().toLocaleString('zh-CN',{hour12:false});
  function reset(){records=[];drafts={};review=null;serial=0;}
  function accepted(key){return records.find(r=>r.key===key&&r.status==='accepted');}
  function selected(){const s=ClinicalUI.treatmentState();return s.picks.map(key=>({key,name:key.split('|')[1]})).filter(x=>!accepted(x.key));}
  function modal(title,body){document.getElementById('clinicalActionTitle').textContent=title;document.getElementById('clinicalActionSubTitle').textContent='本地交互演示 · 候选选择、开立回执与实际执行分开';document.getElementById('clinicalActionBody').innerHTML=body;document.getElementById('clinicalActionModal').classList.add('open');}
  function open(){
    const items=selected(),signature=patientFactSignature();
    const stale=ClinicalUI.treatmentState().selectionSignature&&ClinicalUI.treatmentState().selectionSignature!==signature;
    review={id:'DEMO-'+Date.now()+'-'+(++serial),signature,items,submitted:false};
    const source=window.TreatmentWorkspace?.orderDrafts?.()||{};
    items.forEach(x=>{if(!drafts[x.key]){const d=source[x.key]||{};drafts[x.key]={product:d.product||'',usage:[d.dose,d.route,d.frequency,d.duration,d.note].filter(Boolean).join('；')};}});
    modal('医嘱开立核对',`<div class="order-demo-notice">模拟HIS开单交互，不向真实系统发送医嘱。医生核对院内项目和处方参数后再确认。</div>${stale?'<p role="alert">患者资料已变化，原选择需重新核对；当前不能提交。</p><button class="btn" data-order-clear-stale>清除本次失效选择</button>':''}${items.length?`<div class="order-review-list">${items.map(x=>`<article class="order-review-row"><strong>${h(x.name)}</strong><label>院内项目／规格<input class="input" data-order-field="product" data-order-key="${h(x.key)}" value="${h(drafts[x.key].product)}" placeholder="选择或填写院内项目（演示）"></label><label>用法、频次与疗程／操作安排<input class="input" data-order-field="usage" data-order-key="${h(x.key)}" value="${h(drafts[x.key].usage)}" placeholder="由医生核对填写，不默认生成处方"></label></article>`).join('')}</div><p>过敏史：${h(fieldValue('allergyHistory','未提供，需核对'))}</p><p>当前资料：${h(fieldValue('assistantExam','尚无本次报告；按具体项目核对需要的资料'))}</p><label class="order-check"><input type="checkbox" data-order-confirm> 已核对本次项目、用法及相关安全信息（演示）</label><details class="order-demo-settings"><summary>回执演示设置</summary><label>模拟结果 <select data-order-outcome><option value="accepted">全部接收</option><option value="partial">部分接收</option><option value="failed">暂未接收</option></select></label></details><button class="btn primary" data-order-submit ${stale?'disabled':''}>确认并模拟回写HIS</button>`:'<p>当前没有待开立的新选项目。已有医嘱不能用本地减号撤销。</p>'}${history()}`);
  }
  function history(){return records.length?`<section class="order-history"><h4>本次就诊回执记录</h4>${records.map(r=>`<article data-order-record="${h(r.id)}"><strong>${h(r.name)} · ${r.status==='accepted'?'模拟已开立':'模拟未接收'}</strong><p>${h(r.product)} · ${h(r.usage)}</p><small>${h(r.time)} · ${h(r.id)} · ${r.status==='accepted'?(r.executed?'已模拟接收执行记录':'执行待回传'):'未开立，可核对后重试'}</small>${r.status==='failed'?`<button class="btn link" data-order-retry="${h(r.id)}">模拟重试</button>`:!r.executed?`<button class="btn link" data-order-execute="${h(r.id)}">模拟接收执行记录</button>`:''}</article>`).join('')}</section>`:'';}
  function refresh(){ClinicalUI.refreshTreatment();}
  function submit(){
    if(!review||review.submitted)return;
    if(review.signature!==patientFactSignature()){showToast('患者资料已变化，请关闭并重新核对本次选择');return;}
    if(!document.querySelector('[data-order-confirm]')?.checked){showToast('请先核对本次开单信息');return;}
    if(review.items.some(x=>!drafts[x.key]?.product.trim()||!drafts[x.key]?.usage.trim())){showToast('请填写院内项目与用法／操作安排');return;}
    const outcome=document.querySelector('[data-order-outcome]').value;
    review.submitted=true;
    review.items.forEach((x,i)=>{if(accepted(x.key))return;const status=outcome==='failed'||outcome==='partial'&&i>0?'failed':'accepted';const prior=records.find(r=>r.key===x.key&&r.status==='failed'&&r.signature===review.signature);if(prior){Object.assign(prior,drafts[x.key],{status,time:stamp(),attempts:prior.attempts+1});}else records.push({...x,...drafts[x.key],id:review.id+'-'+i,status,signature:review.signature,time:stamp(),executed:false,attempts:1});});
    ClinicalUI.clearSelections(records.filter(r=>r.status==='accepted').map(r=>r.key));
    refresh();modal('医嘱回写结果（本地模拟）',`<p>开立回执不代表已经用药或完成操作；以下仅为原型中的模拟结果。</p>${history()}`);
  }
  function state(){return records.map(r=>({...r}));}
  document.addEventListener('input',e=>{const t=e.target;if(t.matches('[data-order-field]')){drafts[t.dataset.orderKey]||={};drafts[t.dataset.orderKey][t.dataset.orderField]=t.value;}});
  document.addEventListener('click',e=>{const t=e.target.closest('button');if(!t)return;
    if(t.hasAttribute('data-order-review'))open();
    if(t.hasAttribute('data-order-clear-stale')){ClinicalUI.clearSelections(ClinicalUI.treatmentState().picks);review=null;closeClinicalActionModal();refresh();showToast('已清除本次失效选择，历史医嘱保留');}
    if(t.hasAttribute('data-order-submit'))submit();
    if(t.hasAttribute('data-order-history'))modal('医嘱回执与执行记录（本地模拟）',history()||'<p>暂无回执记录。</p>');
    if(t.hasAttribute('data-order-retry')){const r=records.find(x=>x.id===t.dataset.orderRetry);if(!r||r.status!=='failed')return;if(r.signature!==patientFactSignature()){showToast('患者资料已变化，请重新核对；不能重试旧医嘱');return;}r.status='accepted';r.attempts++;r.time=stamp();ClinicalUI.clearSelections([r.key]);refresh();modal('医嘱重试结果（本地模拟）',history());}
    if(t.hasAttribute('data-order-execute')){const r=records.find(x=>x.id===t.dataset.orderExecute);if(!r||r.status!=='accepted'||r.executed)return;r.executed=true;r.executionTime=stamp();refresh();modal('医嘱执行反馈（本地模拟）',history());}
  });
  return {reset,open,state,accepted,history};
})();
