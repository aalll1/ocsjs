const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const ts=require('typescript');
const project=path.join(__dirname,'../..');
function load(relative,names,context={}) {
 const text=fs.readFileSync(path.join(project,relative),'utf8');
 const code=stripTypeScriptTypes(text).replace(/^export /gm,'');
 return vm.runInNewContext(code+'\n({'+names.join(',')+'})',{URL,setTimeout,clearTimeout,...context});
}
const modulePath='packages/core/src/core/answer-wrapper/deepseek.search.ts';
const {createDeepSeekSearchWrapper,answerWithDeepSeekSearch,parseSearchedAnswer}=load(modulePath,['createDeepSeekSearchWrapper','answerWithDeepSeekSearch','parseSearchedAnswer']);
const question={type:'single',title:'这道题的原始题干是什么？',options:[{id:'A',text:'选项一'},{id:'B',text:'选项二'}]};
const source={id:'S1',title:'来源',url:'https://example.org/doc',content:'选项二符合资料。'};
const searchResponse={results:[{title:source.title,url:source.url,content:source.content}]};
const modelResponse=(selected=['B'],cited=['S1'])=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({selectedOptionIds:selected,sourceIds:cited,reason:'资料说明了对应结论。'})}}]});
const wrapper=()=>createDeepSeekSearchWrapper('sk-test-key');
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('search always precedes analysis and receives text rather than an image',async()=>{
 const calls=[];
 const result=await answerWithDeepSeekSearch(question,wrapper(),{request:async(url,data,headers)=>{calls.push({url,data,headers});return calls.length===1?searchResponse:modelResponse();}});
 assert.match(calls[0].url,/tools\/search$/);assert.match(calls[1].url,/chat\/completions$/);
 const input=JSON.parse(calls[1].data.messages[1].content);
 assert.deepEqual(input.question,question);assert.equal(calls[0].data.need_content,true);
 assert.equal(calls[1].data.response_format.type,'json_object');
 assert.equal(JSON.stringify(calls.map(c=>c.data)).includes('sk-test-key'),false);
 assert.equal(result.answer,'B');assert.equal(result.extra_data.webSearch,true);assert.equal(result.extra_data.sources[0].url,source.url);
});
test('query truncation honors the API Unicode limit without changing the full model question',async()=>{
 const q={...question,title:'😀'.repeat(160)+'完整题目'};const calls=[];
 await answerWithDeepSeekSearch(q,createDeepSeekSearchWrapper('sk-test-key','deepseek-v4-pro',3),{request:async(url,data)=>{calls.push(data);return calls.length===1?searchResponse:modelResponse();}});
 assert.equal(Array.from(calls[0].query).length,128);assert.equal(calls[0].count,3);
 assert.equal(JSON.parse(calls[1].messages[1].content).question.title,q.title);
});
test('empty search results stop before model analysis',async()=>{
 let calls=0;
 await assert.rejects(answerWithDeepSeekSearch(question,wrapper(),{request:async()=>{calls++;return {results:[]};}}),/未找到可用资料/);
 assert.equal(calls,1);
});
test('failed search cannot fall back to a model-only answer',async()=>{
 let calls=0;
 await assert.rejects(answerWithDeepSeekSearch(question,wrapper(),{request:async()=>{calls++;throw Error('network');}}),/联网搜索失败/);
 assert.equal(calls,1);
});
test('search discards unsafe source URLs and accepts summary text',async()=>{
 const result=await answerWithDeepSeekSearch(question,wrapper(),{request:async(url)=>url.endsWith('/search')?{results:[
  {url:'javascript:alert(1)',content:'bad'},
  {url:'https://user:password@example.org/',content:'bad'},
  {url:source.url,title:source.title,summary:'检索摘要'}
 ]}:modelResponse()});
 assert.equal(result.extra_data.sources.length,1);assert.equal(result.extra_data.sources[0].url,source.url);
});
test('invalid JSON, fabricated citations and unknown options cannot become an answer',()=>{
 const parse=(selected,sourceIds)=>parseSearchedAnswer(JSON.stringify({selectedOptionIds:selected,sourceIds,reason:'依据'}),question,[source]);
 assert.throws(()=>parseSearchedAnswer('B',question,[source]),/JSON/);
 assert.throws(()=>parse(['B'],['invented']),/本轮检索来源/);
 assert.throws(()=>parse(['Z'],['S1']),/不存在/);
 assert.throws(()=>parse(['A','B'],['S1']),/恰好选择一个/);
 assert.throws(()=>parse(['B','B'],['S1']),/编号无效/);
 assert.throws(()=>parse([],['S1']),/编号无效/);
});
test('multiple choices are ordered by the page; judgement uses the option text',()=>{
 const multiple={...question,type:'multiple'};
 const result=parseSearchedAnswer(JSON.stringify({selectedOptionIds:['B','A'],sourceIds:['S1'],reason:'依据'}),multiple,[source]);
 assert.equal(result.answer,'A#B');
 const judgement={...question,type:'judgement',options:[{id:'A',text:'正确'},{id:'B',text:'错误'}]};
 assert.equal(parseSearchedAnswer(JSON.stringify({selectedOptionIds:['B'],sourceIds:['S1'],reason:'依据'}),judgement,[source]).answer,'错误');
});
test('pause gate is checked again between search and analysis',async()=>{
 let calls=0,gates=0,resume;
 const pending=answerWithDeepSeekSearch(question,wrapper(),{
  beforeRequest:()=>{gates++;if(gates===2)return new Promise(resolve=>{resume=resolve;});},
  request:async()=>++calls===1?searchResponse:modelResponse()
 });
 await flush();assert.equal(calls,1);assert.equal(gates,2);resume();await pending;assert.equal(calls,2);
});
test('request timeout is finite and clears its timer',async()=>{
 let expire,cleared=false;
 const {answerWithDeepSeekSearch:run}=load(modulePath,['answerWithDeepSeekSearch'],{setTimeout:fn=>{expire=fn;return 1;},clearTimeout:()=>{cleared=true;}});
 const pending=run(question,wrapper(),{request:()=>new Promise(()=>{})});
 await flush();expire();await assert.rejects(pending,/联网搜索失败或超时/);assert.equal(cleared,true);
});
function readerFixture(type='single_selection') {
 const w=require('browser-env')([]),root=w.document.createElement('li');root.className='subject '+type;
 root.innerHTML='<div class="subject-description"><p>原始题干</p><p>第二段<br>第三行</p></div><ol class="subject-options"><li class="option"><label><span class="left"><input type="radio"><span class="option-index">A</span>.</span><div class="option-content"><p>第一项 原文</p></div></label></li><li class="option"><label><span class="left"><input type="radio"><span class="option-index">B</span>.</span><div class="option-content">第二项 原文</div></label></li></ol>';
 const reader=load('packages/scripts/src/utils/choice-question.ts',['getChoiceQuestionType','readChoiceQuestion']);
 return {w,root,...reader};
}
test('DOM reader transmits raw question and option texts with no control labels',()=>{
 const f=readerFixture();try{
  const q=f.readChoiceQuestion(f.root);assert.equal(q.title,'原始题干 第二段 第三行');
  assert.equal(q.options[0].text,'第一项 原文');assert.equal(q.options[1].id,'B');
  assert.equal(q.type,'single');
 }finally{f.w.close();}
});
test('two-option single choice is not mistaken for judgement',()=>{
 const f=readerFixture();try{assert.equal(f.getChoiceQuestionType(f.root),'single');f.root.className='subject true_or_false';assert.equal(f.getChoiceQuestionType(f.root),'judgement');f.root.className='subject multiple_selection';assert.equal(f.getChoiceQuestionType(f.root),'multiple');}finally{f.w.close();}
});
test('unsupported images and missing option text stop before transmission',()=>{
 const f=readerFixture();try{
  const option=f.root.querySelector('.option-content');option.innerHTML='<img src="https://example.org/image.png">';
  assert.throws(()=>f.readChoiceQuestion(f.root),/图片/);option.textContent='';assert.throws(()=>f.readChoiceQuestion(f.root),/文本为空/);
 }finally{f.w.close();}
});
test('legacy settings preserve defaults without generating their UI controls',()=>{
 const text=fs.readFileSync(path.join(project,'packages/scripts/src/projects/common.ts'),'utf8');
 const ast=ts.createSourceFile('common.ts',text,ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='deepSeekOnlySettings');
 const hide=vm.runInNewContext(stripTypeScriptTypes(fn.getText(ast))+'\ndeepSeekOnlySettings',{ENABLE_LEGACY_QUESTION_BANK_UI:false});
 const settings={answererWrappersButton:{label:'题库配置',defaultValue:'点击配置',onload(){}},enableQuestionCaches:{label:'缓存',defaultValue:true},deepseekApiKey:{label:'DeepSeek API Key',defaultValue:''},period:{label:'间隔',defaultValue:3,showIf:'legacy'}};
 const result=hide(settings);assert.equal(result.answererWrappersButton.label,undefined);assert.equal(result.answererWrappersButton.onload,undefined);assert.equal(result.enableQuestionCaches.label,undefined);assert.equal(result.deepseekApiKey.label,'DeepSeek API Key');assert.equal(result.period.showIf,undefined);
});

function resultWaitFixture() {
 const text=fs.readFileSync(path.join(project,'packages/core/src/core/worker/worker.ts'),'utf8');
 const ast=ts.createSourceFile('worker.ts',text,ts.ScriptTarget.Latest,true);let initializer;
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='waitForRequested')initializer=node.initializer;ts.forEachChild(node,visit);}visit(ast);
 let now=0,tick,cleared=false;
 const context={isStop:false,isClose:false,Date:{now:()=>now},setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{cleared=true;},AnswerWrapperHandlerConfig:{timeout_seconds:1}};
 const wait=vm.runInNewContext(stripTypeScriptTypes('const wait='+initializer.getText(ast)+';wait'),context);
 return {wait,context,tick:time=>{now=time;tick();},cleared:()=>cleared};
}
test('two-stage answer waiting does not expire or apply a returned result while paused',async()=>{
 const f=resultWaitFixture(),result={requested:false};let resolved=false;
 const pending=f.wait(result).then(()=>{resolved=true;});f.tick(200);f.context.isStop=true;f.tick(1000000);
 result.requested=true;f.tick(1000200);await flush();assert.equal(resolved,false);
 f.context.isStop=false;f.tick(1000400);await pending;assert.equal(resolved,true);assert.equal(f.cleared(),true);
});
test('unpaused answer waiting still times out',async()=>{
 const f=resultWaitFixture(),pending=f.wait({requested:false});f.tick(12000);await assert.rejects(pending,/答题超时/);assert.equal(f.cleared(),true);
});

function extractFunction(relative,name,context) {
 const text=fs.readFileSync(path.join(project,relative),'utf8'),ast=ts.createSourceFile('target.ts',text,ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 return vm.runInNewContext(stripTypeScriptTypes(fn.getText(ast)).replace(/^export /,'')+'\n'+name,context);
}
test('existing answer engine dispatches the provider and preserves both pause gates',async()=>{
 let requests=0,gates=0;
 const handler=extractFunction('packages/core/src/core/answer-wrapper/answer.wrapper.handler.ts','defaultAnswerWrapperHandler',{
  URL,console:{error(){}},answerWithDeepSeekSearch,
  request:async()=>++requests===1?searchResponse:modelResponse()
 });
 const infos=await handler([wrapper()],{question,beforeRequest:async()=>{gates++;}});
 assert.equal(requests,2);assert.equal(gates,2);assert.equal(infos[0].results[0].answer,'B');
 assert.equal(JSON.stringify(infos).includes('sk-test-key'),false);
});
test('web mode bypasses old cache and does not cache an ungraded AI answer',async()=>{
 const f=readerFixture();try{
  let cacheReads=0,cacheWrites=0,received;
  class Worker{constructor(opts){this.opts=opts;}doWork(){return new Promise(()=>{});}emit(){}}
  const make=extractFunction('packages/scripts/src/projects/ouchn.ts','ouchnExamWork',{
   automation:{isPaused:()=>false,waitUntilRunning:async()=>{},delay:async()=>{}},state:{},OCSWorker:Worker,
   getChoiceQuestionType:f.getChoiceQuestionType,readChoiceQuestion:f.readChoiceQuestion,
   $message:{info(){},error(){}},BackgroundProject:{scripts:{dev:{cfg:{}}}},
   CommonProject:{scripts:{
    workResults:{methods:{init(){},setResults(){},updateWorkStateByResults(){}}},
    apps:{methods:{searchAnswerInCaches(){cacheReads++;throw Error('legacy cache');},addQuestionCacheFromWorkResult(){cacheWrites++;}}}
   }},simplifyWorkResult:()=>[],defaultAnswerWrapperHandler:async(wrappers,env)=>{received=env;return [];}
  });
  const w=make({answererWrappers:[wrapper()],period:0,answerSeparators:'#'});
  await w.opts.answerer({title:[{innerText:'old title'}]},{root:f.root});
  w.opts.onResultsUpdate({result:{finish:true}},0,[]);
  assert.equal(cacheReads,0);assert.equal(cacheWrites,0);assert.equal(received.question.title,'原始题干 第二段 第三行');
  assert.equal(typeof received.beforeRequest,'function');assert.equal(w.opts.work.type({root:f.root}),'single');
 }finally{f.w.close();}
});
test('DeepSeek-only settings cannot revive a stored legacy question bank',()=>{
 const text=fs.readFileSync(path.join(project,'packages/scripts/src/projects/common.ts'),'utf8'),ast=ts.createSourceFile('common.ts',text,ts.ScriptTarget.Latest,true);
 const arrows={};function visit(n){if(ts.isPropertyAssignment(n)&&['getDeepSeekWrappers','getWorkOptions'].includes(n.name.getText(ast)))arrows[n.name.getText(ast)]=n.initializer.getText(ast);ts.forEachChild(n,visit);}visit(ast);
 const context=vm.createContext({cfg:{deepseekApiKey:'',deepseekModel:'deepseek-flash',deepseekSearchCount:'3',answererWrappers:[{name:'legacy'}],enableQuestionCaches:true},methods:{},createDeepSeekSearchWrapper});
 context.methods.getDeepSeekWrappers=vm.runInContext(stripTypeScriptTypes('const get='+arrows.getDeepSeekWrappers+';get'),context);
 const getOptions=vm.runInContext(stripTypeScriptTypes('const options='+arrows.getWorkOptions+';options'),context);
 let options=getOptions();assert.equal(options.answererWrappers.length,0);assert.equal(options.enableQuestionCaches,false);
 context.cfg.deepseekApiKey='sk-test-key';options=getOptions();assert.equal(options.answererWrappers.length,1);assert.equal(options.answererWrappers[0].provider,'deepseek-search');assert.equal(options.answererWrappers[0].data.searchCount,3);
});
