/* Doctor-facing evidence and knowledge navigation; local demonstration data only. */
window.ClinicalRecommendationView=(()=>{
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let category='综合',query='';
  const categories=['综合','收藏','疾病','药品','中药知识','检验检查','手术','临床路径','术语','治疗','麻醉','症状','输血','诊疗指南','核心制度','法律法规','政策法规','护理知识','典型病例','医患沟通','损害防范'];
  const catalog=[
    ['疾病','急性心肌梗死（AMI）'],['疾病','心肌病'],['疾病','肥厚型心肌病'],
    ['药品','阿司匹林'],['药品','氯吡格雷'],['药品','替格瑞洛'],
    ['检验检查','心电图'],['检验检查','超声心动图'],['检验检查','心肌肌钙蛋白'],['检验检查','血肌酐'],
    ['手术','经皮冠状动脉介入治疗（PCI）'],['手术','ICD植入术'],
    ['治疗','抗血小板治疗'],['治疗','调脂治疗'],['症状','胸痛'],
    ['临床路径','急性心肌梗死临床路径'],['诊疗指南','急性胸痛 / 急性冠脉综合征相关诊疗指南']
  ];
  // Deliberately bounded, local text rules: not NLP, graph triples or a clinical model.
  const evidenceFields=[['chiefComplaint','主诉'],['presentHistory','现病史'],['pastHistory','既往史'],['personalHistory','个人史'],['familyHistory','家族史'],['allergyHistory','过敏史'],['physicalExam','体格检查'],['specialExam','专科查体'],['assistantExam','检查检验原文']];
  const pendingReport=/未返回|未回报|待回报|待报|等待|待查|未查|已申请|拟查|建议|拟行|预约|未出|待完善|待结果/;
  const resultText=/结果|提示|显示|正常|阴性|阳性|升高|降低|抬高|压低|减弱|增厚|未见|\d+(?:\.\d+)?\s*(?:ng|pg|mg|mmol|μmol|umol|mmHg|%|mm\b)/i;
  let factSignature='',factVersion=0;
  function evidenceSnapshot(){
    const sources=evidenceFields.map(([id,label])=>({id,label,text:fieldValue(id)}));
    const signature=JSON.stringify(sources.map(s=>s.text));
    if(signature!==factSignature){factSignature=signature;factVersion++;}
    return {sources,version:factVersion};
  }
  function extractFacts(sources){
    const facts=[];
    for(const source of sources){
      // Strong punctuation bounds context. Commas retain a named family subject until
      // the patient is explicitly named; negation carries only over bare list items.
      for(const sentenceMatch of source.text.matchAll(/[^。；;！？\n]+/g)){
        const sentence=sentenceMatch[0];
        let subject=source.id==='familyHistory'?'家族':'本人';
        let time=source.id==='pastHistory'||source.id==='familyHistory'?'既往':source.id==='chiefComplaint'||source.id==='presentHistory'?'当前':'时间未注明';
        let polarity='肯定';
        for(const clauseMatch of sentence.matchAll(/[^，,、但而]+/g)){
          const clause=clauseMatch[0];
          if(/既往|曾经|曾有|病史|史$/.test(clause))time='既往';
          if(/现无|目前|现在|今日|此次|本次/.test(clause))time='当前';
          const subjectMatch=[...clause.matchAll(/父亲|母亲|父母|兄弟|姐妹|祖父|祖母|家属|家族|本人|患者/g)].pop();
          if(subjectMatch){
            const nextSubject=/本人|患者/.test(subjectMatch[0])?'本人':'家族';
            if(nextSubject!==subject&&!/既往|曾经|曾有|病史|史$|现无|目前|现在|今日|此次|本次/.test(clause))time=nextSubject==='家族'?'既往':source.id==='presentHistory'||source.id==='chiefComplaint'?'当前':'时间未注明';
            subject=nextSubject;
          }
          const uncertain=/不排除|不能排除|未排除|待排|疑似|可能|考虑|不详|不确定|不否认|不能否认/.test(clause);
          const negative=/否认|未见|没有|现无|无(?:胸痛|胸闷|气促|呼吸困难|心悸|晕厥|心梗|心肌梗死|心肌病|高血压|糖尿病|过敏)/.test(clause)||/无[^，。；]{0,12}过敏/.test(clause);
          if(uncertain)polarity='不确定';
          else if(negative)polarity='否定';
          else if(/伴|出现|有|诉|本人|患者|父亲|母亲|既往/.test(clause)||clauseMatch.index===0)polarity='肯定';
          const concepts=/心肌肌钙蛋白|肌钙蛋白|超声心动图|心电图|CK-MB|BNP|血肌酐|急性心肌梗死|心肌梗死|心梗|肥厚型心肌病|心肌病|大汗|出汗|恶心|呕吐|放射痛|水肿|杂音|心率|血压|胸痛|胸闷|气促|呼吸困难|心悸|晕厥|高血压|糖尿病|过敏/gi;
          for(const match of clause.matchAll(concepts)){
            const concept=match[0],start=sentenceMatch.index+clauseMatch.index+match.index;
            const pending=source.id==='assistantExam'&&pendingReport.test(sentence);
            const report=source.id==='assistantExam';
            const status=report?(pending?'未返回':resultText.test(sentence)?'已录入原文，待核对':'是否返回待核对'):'';
            const duration=(clause.match(/\d+(?:\.\d+)?\s*(?:小时|分钟|个月|天|年|月)/)||[])[0]||'';
            const date=(sentence.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?/)||[])[0]||'';
            facts.push({source,concept,start,end:start+concept.length,subject,time,polarity,status,duration,date,
              description:report?sentence.trim():clause.trim(),
              kind:report?'检查检验':['physicalExam','specialExam'].includes(source.id)?'体征':/大汗|出汗|恶心|呕吐|放射痛|胸痛|胸闷|气促|呼吸困难|心悸|晕厥/.test(concept)?'症状':'病史'});
          }
        }
      }
    }
    for(const f of facts){
      f.conflict=f.subject==='本人'&&f.time==='当前'&&facts.some(other=>other.concept===f.concept&&other.subject===f.subject&&other.time===f.time&&[f.polarity,other.polarity].includes('肯定')&&[f.polarity,other.polarity].includes('否定'));
    }
    return facts;
  }
  function factExplanation(f){
    if(f.status==='未返回')return '缺失依据：报告未返回，不作为结果；待回填后核对。';
    if(f.status==='是否返回待核对')return '只有项目名称或描述，是否已有结果待核对。';
    if(f.subject==='家族')return '家族成员的记录，不作为本人患病或当前阳性依据。';
    if(f.conflict)return '当前表述不一致：请对照原文核对，不自动选择其中一条。';
    if(f.polarity==='否定')return '不支持该线索为阳性；否定一项线索不自动排除疾病。';
    if(f.polarity==='不确定')return '原文尚不确定，不当作已确认事实，请先核对。';
    if(f.time==='既往')return '既往记录与本次情况分开核对，不直接当作当前表现。';
    return '仅提取原文表述，供医生核对；不足以确认疾病或生成治疗建议。';
  }
  function evidenceChain(snapshot){
    const facts=extractFacts(snapshot.sources);
    const rows=facts.map(f=>{
      const relation=f.kind==='症状'?'症状 → 疾病':f.kind==='检查检验'?'检查检验 → 结果核对':'病史 → 患者背景';
      const button=`data-evidence-source="${f.source.id}" data-source-start="${f.start}" data-source-end="${f.end}"`;
      return `<li data-evidence-row><div class="evidence-chain-source"><small>${h(f.source.label)}</small><button type="button" ${button}>${h(f.description)}</button></div><button type="button" class="evidence-chain-fact" data-evidence-fact data-field="${f.source.id}" data-concept="${h(f.concept)}" ${button} aria-pressed="false"><strong>${h(f.concept)}</strong><span>${h(f.polarity)} · ${h(f.subject)} · ${h(f.time)}</span><span>${h([f.duration,f.date,f.status].filter(Boolean).join(' · '))}</span><small>查看原文位置</small></button><details data-evidence-relation><summary>${h(relation)}<small>关系说明 · 待核验</small></summary><p>仅演示专科知识的关联方式。尚未接入此条事实对应的正式知识关系、原文依据及适用条件，不能据此作诊断或推荐。</p></details><div class="evidence-chain-explanation">${h(factExplanation(f))}</div></li>`;
    }).join('');
    return `<section class="evidence-chain" data-evidence-chain data-fact-version="${snapshot.version}"><header><h3>从原文看懂推荐依据</h3><p>规则提取交互样例 · 当前资料第${snapshot.version}版。不是实际NLP、知识图谱推理或风险模型。</p></header><div class="evidence-chain-head" aria-hidden="true"><span>① 病历／报告原文</span><span>② 提取事实</span><span>③ 中文专科知识关联</span><span>④ 建议解释与缺失依据</span></div>${facts.length?`<ol class="evidence-chain-list">${rows}</ol>`:'<p class="evidence-chain-empty">未匹配到样例事实；请核对下方原文，不补造结论。</p>'}<div class="evidence-source-detail" data-evidence-source-detail aria-live="polite">点击事实可查看原文及位置。资料改变后，旧解释不再沿用。</div><details class="evidence-chain-originals"><summary>查看本次全部原文</summary>${snapshot.sources.filter(s=>s.text).map(s=>`<h4>${h(s.label)}</h4><p>${h(s.text)}</p>`).join('')||'<p>尚未录入。</p>'}</details><p class="evidence-chain-boundary">只识别有限文字样例，否定范围、主体和时间均需人工核对；未匹配不等于没有相关信息。知识原文、适用条件与报告缺项待补齐，不生成临床推断或风险分数。</p></section>`;
  }
  function showFact(button){
    const root=button.closest('[data-evidence-chain]');
    if(!root)return;
    const snapshot=evidenceSnapshot();
    if(String(snapshot.version)!==root.dataset.factVersion){refreshNetwork();return;}
    const source=snapshot.sources.find(s=>s.id===button.dataset.evidenceSource);
    if(!source)return;
    const start=Number(button.dataset.sourceStart),end=Number(button.dataset.sourceEnd);
    root.querySelectorAll('[data-evidence-fact]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.evidenceSource===source.id&&b.dataset.sourceStart===String(start))));
    root.querySelector('[data-evidence-source-detail]').innerHTML=`<strong>${h(source.label)} · 当前资料第${snapshot.version}版 · 原文第${start+1}—${end}字</strong><p>${h(source.text.slice(0,start))}<mark>${h(source.text.slice(start,end))}</mark>${h(source.text.slice(end))}</p>`;
  }
  function network(title='当前推荐'){
    const isCm=activeSimulationDisease==='cardiomyopathy',supported=['ami','cardiomyopathy'].includes(activeSimulationDisease);
    const related=title==='当前推荐'||(isCm?/心肌病|ICD/.test(title):/心肌梗死|AMI|STEMI/.test(title));
    const usable=demoCaseLoaded&&!factsEdited&&evidenceBranch==='standard'&&supported&&related;
    const snapshot=evidenceSnapshot();
    const reports=fieldValue('assistantExam'),hasReports=reports.split(/[。；;\n]/).some(s=>!pendingReport.test(s)&&resultText.test(s));
    const history=[['主诉',fieldValue('chiefComplaint')],['现病史',fieldValue('presentHistory')]].filter(([,v])=>v);
    const background=[['既往史',fieldValue('pastHistory')],['个人史',fieldValue('personalHistory')],['家族史',fieldValue('familyHistory')],['过敏史',fieldValue('allergyHistory')]].filter(([,v])=>v);
    const original=rows=>rows.map(([k,v])=>k+'：'+v).join('\n');
    const direction=!usable?(related?'资料待重新核对':'暂无该候选的可用依据'):hasUsableDemoReports()?fieldValue('mainDiagnosis','诊断方向待核对'):(isCm?'心肌病方向待明确':'急性心肌梗死方向待明确');
    const nodes=[
      {id:'history',label:'主诉与现病史',text:history.map(([,v])=>v).join('；')||'尚未录入',source:'病历原文',detail:original(history)||'尚未录入主诉与现病史。'},
      {id:'reports',label:hasReports?'已有检查 / 检验结果':'检查 / 检验尚缺结果',text:reports||'等待报告回填；不把推荐项目当作已有结果。',source:'本次报告',detail:reports||'当前没有报告内容。报告返回后，此节点展示本次结果，缺失项目仍需核对。'},
      {id:'background',label:'既往病史与风险背景',text:background.map(([k,v])=>k+'：'+v).join('；')||'尚未录入',source:'病历原文',detail:original(background)||'尚未录入病史背景。'},
      {id:'direction',label:'当前诊断方向',text:direction,source:usable?'演示病例 · 医生核对':'待核对',detail:usable?'当前展示：'+direction+'。\n这是演示病例的诊断方向，不是由本图自动作出的诊断。请结合病史、报告和鉴别结果确认。':'病历已改变、资料不完整或该候选缺乏匹配依据；不沿用原样例结论。请核对当前输入后重新评估。'},
      {id:'next',label:usable?(hasReports?'核对结果与下一步':'补充诊断依据'):'先核对当前资料',text:usable?(hasReports?'查看已返回结果，核对未返回项目；有适用依据时讨论治疗。':(isCm?'查看心电图、超声及相关检验推荐。':'查看心电图、心肌损伤相关检验推荐。')):'核对新病史、报告与当前诊断方向。',source:'下一步关注',detail:usable?'已返回报告先查看结果；是否复查由本次病情和医生判断决定。无报告的项目不推定已完成。治疗方案仅在有适用内容时展示。':'当前不提供新的疾病推断或治疗结论。原始病史和报告保留，可从左侧节点逐项核对。'},
      {id:'safety',label:'鉴别与治疗安全',text:usable?(isCm?'结合分型、家族史和相关评估核对风险。':'核对胸痛鉴别及与拟选治疗有关的安全问题。'):'资料变化后，原风险判断也需复核。',source:'安全核对',detail:usable?patientCareView().alerts.map(a=>a.title+'：'+a.reason).join('\n')||'暂无已核验的风险结论，不能据此认定无风险。':'需重新核对鉴别依据、过敏史、已有用药和相关报告；不从旧样例继承安全结论。'}
    ];
    const node=n=>`<button type="button" class="evidence-node node-${n.id}" data-network-node="${n.id}" data-network-heading="${h(n.label)}" data-network-explain="${h(n.detail)}" aria-pressed="false"><small>${h(n.source)}</small><strong>${h(n.label)}</strong><span>${h(n.text)}</span></button>`;
    return ClinicalEvidenceUX.recognition(title);
  }
  function refreshNetwork(){
    document.querySelectorAll('[data-patient-network]').forEach(el=>{
      const selected=el.querySelector('[aria-pressed=true]')?.dataset.networkNode,title=el.dataset.networkTitle;
      const t=document.createElement('template');t.innerHTML=network(title);const next=t.content.firstElementChild;el.replaceWith(next);
      if(selected)showNode(next.querySelector(`[data-network-node="${selected}"]`));
    });
  }
  function showNode(button){
    if(!button)return;const root=button.closest('[data-patient-network]');
    root.querySelectorAll('[data-network-node]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    root.querySelector('[data-network-detail]').innerHTML='<strong>'+h(button.dataset.networkHeading)+'</strong><p>'+h(button.dataset.networkExplain).replace(/\n/g,'<br>')+'</p>';
  }
  function icon(name){
    const book='<path d="M5 3h12a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V6a3 3 0 0 1 2-3zM3 17h16M8 7h6M8 11h6"/>';
    const paths={
      综合:'<path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/>',收藏:'<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
      疾病:'<circle cx="12" cy="12" r="5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4 4l3 3M17 17l3 3M4 20l3-3M17 7l3-3"/>',
      药品:'<path d="m8 3-5 5a6 6 0 0 0 8 8l7-7a6 6 0 0 0-8-8zM7 7l8 8"/>',
      检验检查:'<path d="M8 2h8M10 2v8L4 20h16l-6-10V2M7 15h10"/>',
      手术:'<path d="m16 2 6 6-10 9-5-5zM7 12l-5 9M14 4l6 6"/>',
      临床路径:'<circle cx="5" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><path d="M8 5h7a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h8"/>',
      治疗:'<path d="M3 12h4l3-8 4 16 3-8h4M2 3h20v18H2z"/>',
      症状:'<path d="M12 21S2 15 2 8a5 5 0 0 1 10-2A5 5 0 0 1 22 8c0 7-10 13-10 13z"/>',
      护理知识:'<path d="M4 6h16v7a8 8 0 0 1-16 0zM9 3h6M12 8v6M9 11h6"/>',
      医患沟通:'<path d="M3 3h18v13H9l-6 5zM7 7h10M7 11h7"/>',
      损害防范:'<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||book}</svg>`;
  }
  function search(){
    const results=catalog.filter(([c,title])=>(category==='综合'||category===c)&&title.toLowerCase().includes(query.toLowerCase()));
    const browsing=category==='综合'&&!query;
    return `<section id="knowledgeBrowser" class="knowledge-browser"><form data-knowledge-form><label class="sr-only" for="knowledgeCategory">知识分类</label><select id="knowledgeCategory" data-knowledge-select>${categories.map(c=>`<option ${c===category?'selected':''}>${h(c)}</option>`).join('')}</select><input type="search" data-knowledge-query aria-label="搜索知识" value="${h(query)}" placeholder="请输入您要查询的知识"><button type="submit" data-knowledge-search aria-label="搜索知识">搜索</button></form>${browsing?`<nav class="knowledge-category-grid" aria-label="知识分类">${categories.map(c=>`<button type="button" data-knowledge-category="${h(c)}">${icon(c)}<span>${h(c)}</span></button>`).join('')}</nav>`:`<div class="knowledge-breadcrumb"><button type="button" data-knowledge-home>‹ 全部分类</button><strong>${h(category)}</strong></div><div data-knowledge-results>${results.length?results.map(([c,title])=>`<button type="button" class="knowledge-entry" data-static-knowledge="${h(title)}"><span>${h(title)}</span><small>${h(c)} · 查看知识 ›</small></button>`).join(''):`<p class="ui-note">${category==='收藏'&&!query?'暂无收藏记录。':'本地条目中未找到匹配内容。'}正式知识目录及全文沿用现有CDSS知识库。</p>`}</div>`}<p class="knowledge-footnote">分类沿用现有CDSS；本地仅展示部分条目入口，不表示已具备全部知识正文。</p></section>`;
  }
  function updateSearch(){const root=document.getElementById('knowledgeBrowser');if(root)root.outerHTML=search();}
  document.addEventListener('click',e=>{
    const node=e.target.closest('[data-network-node]');if(node)showNode(node);
    const fact=e.target.closest('[data-evidence-source]');if(fact)showFact(fact);
    const cat=e.target.closest('[data-knowledge-category]');if(cat){category=cat.dataset.knowledgeCategory;query='';updateSearch();}
    if(e.target.closest('[data-knowledge-home]')){category='综合';query='';updateSearch();}
  });
  document.addEventListener('input',e=>{if(evidenceFields.some(([id])=>id===e.target.id))refreshNetwork();});
  document.addEventListener('change',e=>{if(e.target.matches('[data-knowledge-select]')){category=e.target.value;query=document.querySelector('[data-knowledge-query]')?.value.trim()||'';updateSearch();}});
  document.addEventListener('submit',e=>{if(e.target.matches('[data-knowledge-form]')){e.preventDefault();query=e.target.querySelector('[data-knowledge-query]').value.trim();updateSearch();}});
  return {network,refreshNetwork,search,evidenceSnapshot,extractFacts};
})();
