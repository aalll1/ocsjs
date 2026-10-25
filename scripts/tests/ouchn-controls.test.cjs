const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const ts = require('typescript');
const project = path.join(__dirname, '../..');
const ouchn = fs.readFileSync(path.join(project, 'packages/scripts/src/projects/ouchn.ts'), 'utf8');
const ast = ts.createSourceFile('ouchn.ts', ouchn, ts.ScriptTarget.Latest, true);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function loadUtility(name, names, context = {}) {
  const text = fs.readFileSync(path.join(project, 'packages/scripts/src/utils/' + name + '.ts'), 'utf8');
  return vm.runInNewContext(stripTypeScriptTypes(text.replace(/^export /gm, '')) + '\n({' + names.join(',') + '})', {
    setTimeout, clearTimeout, Date, ...context
  });
}
function realFunction(name, context) {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn, name);
  return vm.runInNewContext(stripTypeScriptTypes(fn.getText(ast)) + '\n' + name, context);
}
function control(initial = false) {
  return loadUtility('automation-control', ['createAutomationControl']).createAutomationControl(initial);
}
function clockControl() {
  let now = 0, id = 0;
  const timers = new Map();
  const clock = {
    Date: { now: () => now },
    setTimeout(fn, ms) { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  return {
    automation: loadUtility('automation-control', ['createAutomationControl'], clock).createAutomationControl(),
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = end;
    }
  };
}
test('pause gate blocks until explicitly resumed', async () => {
  const c = control(true); let ran = false;
  const pending = c.waitUntilRunning().then(() => { ran = true; });
  await flush(); assert.equal(ran, false);
  c.setPaused(false); await pending; assert.equal(ran, true);
});
test('navigation countdown freezes and resumes with remaining active time', async () => {
  const { automation: c, advance } = clockControl(); let finished = false;
  const pending = c.delay(3000).then(() => { finished = true; });
  advance(500); c.setPaused(true); advance(100000); await flush();
  assert.equal(finished, false);
  c.setPaused(false); advance(2499); await flush(); assert.equal(finished, false);
  advance(1); await pending; assert.equal(finished, true);
});
test('paused playback neither clicks the player nor calls play', async () => {
  const c = control(true); let clicks = 0, plays = 0;
  const video = { paused: true, ended: false, play() { plays++; this.paused = false; } };
  const start = realFunction('startPlayback', {
    automation: { ...c, delay: async () => c.waitUntilRunning() },
    document: { querySelector: () => ({ click() { clicks++; video.paused = false; } }) },
    playMedia: async fn => fn()
  });
  const pending = start(video); await flush();
  assert.equal(clicks + plays, 0);
  c.setPaused(false); await pending; assert.equal(clicks, 1);
});
test('already playing video is not toggled into pause', async () => {
  let clicks = 0;
  const start = realFunction('startPlayback', {
    automation: control(), document: { querySelector: () => ({ click() { clicks++; } }) }
  });
  await start({ paused: false, ended: false }); assert.equal(clicks, 0);
});
test('paused next-task navigation cannot click the next button', async () => {
  const c = control(true); let clicks = 0;
  const first = { id: 'one', textContent: 'One', getAttribute() { return null; } };
  const second = { ...first, id: 'two', textContent: 'Two' };
  const next = realFunction('goNext', {
    automation: { ...c, delay: async () => c.waitUntilRunning() },
    location: { hash: '#/one' },
    document: { querySelector(s) {
      if (s === '.next-btn') return { disabled: false, click() { clicks++; } };
      if (s.includes('sidebar-menu-item.active')) return clicks ? second : first;
      return null;
    } },
    $msg: { info() {}, success() {}, error() {} }, browserNotify: async () => {}
  });
  const pending = next(); await flush(); assert.equal(clicks, 0);
  c.setPaused(false); assert.equal(await pending, true); assert.equal(clicks, 1);
});
function workerFixture(c) {
  class Worker {
    constructor(opts) { this.opts = opts; this.events = []; this.isClose = false; }
    doWork() { return new Promise(() => {}); }
    emit(e) { this.events.push(e); }
  }
  let requests = 0;
  const makeWorker = realFunction('ouchnExamWork', {
    automation: { ...c, delay: async () => c.waitUntilRunning() },
    state: {}, OCSWorker: Worker,
    $message: { info() {}, error() {} },
    CommonProject: { scripts: {
      workResults: { methods: { init() {} } },
      apps: { methods: { searchAnswerInCaches: (title, fn) => fn() } }
    } },
    BackgroundProject: { scripts: { dev: { cfg: {} } } },
    defaultAnswerWrapperHandler: async () => { requests++; return []; }
  });
  const worker = makeWorker({ answererWrappers: [], period: 0, answerSeparators: ',', answerMatchMode: 'similar' });
  return { worker, requests: () => requests };
}
test('in-flight answer handler cannot click options while paused', async () => {
  const c = control(true), { worker } = workerFixture(c); let clicks = 0;
  const option = { querySelector(s) { return s === 'input' ? { checked: false } : { click() { clicks++; } }; } };
  const pending = worker.opts.work.handler('single', 'A', option);
  await flush(); assert.equal(clicks, 0); assert.ok(worker.events.includes('stop'));
  c.setPaused(false); await pending; assert.equal(clicks, 1);
});
test('paused worker cannot send a new answer request', async () => {
  const c = control(true), fixture = workerFixture(c);
  const pending = fixture.worker.opts.answerer({ title: [{ innerText: 'Question' }] }, { type: 'single', elements: { options: [] } });
  await flush(); assert.equal(fixture.requests(), 0);
  c.setPaused(false); await pending; assert.equal(fixture.requests(), 1);
});
function domFixture() {
  const w = require('browser-env')([]);
  const { enablePanelDrag, installPanelDragging } = loadUtility('panel-drag', ['enablePanelDrag', 'installPanelDragging'], {
    MutationObserver: w.MutationObserver
  });
  function pointer(element, type, x, y, id = 1) {
    const e = new w.MouseEvent(type, { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, 'pointerId', { value: id });
    element.dispatchEvent(e);
  }
  return { w, enablePanelDrag, installPanelDragging, pointer };
}
test('drag works despite page pointer handlers and saves final position', () => {
  const { w, enablePanelDrag, pointer } = domFixture();
  try {
    const target = w.document.createElement('div'), header = w.document.createElement('div');
    target.append(header); w.document.body.append(target);
    target.getBoundingClientRect = () => ({ left: 100, top: 80, width: 300, height: 300 });
    header.getBoundingClientRect = () => ({ height: 40 });
    w.document.addEventListener('pointermove', e => e.stopImmediatePropagation());
    let saved;
    enablePanelDrag(target, header, (x,y) => { saved = [x,y]; });
    pointer(header, 'pointerdown', 10, 10); pointer(w.document, 'pointermove', 60, 50); pointer(w.document, 'pointerup', 60, 50);
    assert.deepEqual(saved, [150,120]);
    pointer(w.document, 'pointermove', 600, 500); assert.equal(target.style.left, '150px');
  } finally { w.close(); }
});
test('drag leaves buttons clickable and constrains header to viewport', () => {
  const { w, enablePanelDrag, pointer } = domFixture();
  try {
    const target=w.document.createElement('div'), header=w.document.createElement('div'), button=w.document.createElement('button');
    header.append(button); target.append(header); w.document.body.append(target);
    target.getBoundingClientRect=()=>({left:100,top:80,width:300,height:400});
    header.getBoundingClientRect=()=>({height:40}); let saves=0,clicks=0;
    button.onclick=()=>clicks++;
    enablePanelDrag(target,header,()=>saves++);
    pointer(button,'pointerdown',10,10);pointer(w.document,'pointermove',100,100);button.click();
    assert.equal(saves,0);assert.equal(clicks,1);assert.equal(target.style.left,'');
    pointer(header,'pointerdown',0,0);pointer(w.document,'pointermove',99999,99999);pointer(w.document,'pointercancel',99999,99999);
    assert.equal(target.style.left,(w.innerWidth-300)+'px');assert.equal(target.style.top,(w.innerHeight-40)+'px');assert.equal(saves,1);
  } finally { w.close(); }
});
test('drag grip returns after header rendering without duplicate bindings', async () => {
  const { w, installPanelDragging } = domFixture();
  try {
    const host=w.document.createElement('div');w.document.body.append(host);
    const root=host.attachShadow({mode:'open'}),target=w.document.createElement('container-element'),header=w.document.createElement('header-element');
    target.append(header);root.append(target);
    installPanelDragging(root,()=>{});assert.equal(header.querySelectorAll('.ocs-drag-handle').length,1);
    header.textContent='';await flush();assert.equal(header.querySelectorAll('.ocs-drag-handle').length,1);
  } finally { w.close(); }
});
test('integrated pause button persists state and returns after header rendering', async () => {
  const { w } = domFixture();
  try {
    const { installAutomationPanel } = loadUtility('panel-controls', ['installAutomationPanel'], { MutationObserver: w.MutationObserver });
    const host=w.document.createElement('div');w.document.body.append(host);
    const root=host.attachShadow({mode:'open'}),container=w.document.createElement('container-element'),header=w.document.createElement('header-element');
    header.innerHTML='<div><span class="profile">OCS</span><span class="switch">-</span></div>';
    container.append(header);root.append(container);
    const store=new Map([['ouchn.automation.paused',true]]), c=control();
    const context={
      automation:c,controlInitialized:false,pauseKey:'ouchn.automation.paused',
      $store:{get:(k,d)=>store.has(k)?store.get(k):d,set:(k,v)=>store.set(k,v),addChangeListener(){}},
      state:{study:{}},document:w.document,HTMLMediaElement:w.HTMLMediaElement
    };
    realFunction('initializeAutomationControl',context)();
    installAutomationPanel(root,c);installAutomationPanel(root,c);
    const button=root.querySelector('.ocs-automation-control');
    assert.equal(root.querySelectorAll('.ocs-automation-control').length,1);
    assert.equal(w.document.querySelector('#ocs-ouchn-control'),null);
    assert.equal(button.nextElementSibling.className,'switch');
    assert.equal(button.textContent,'▶ 继续');
    button.click();assert.equal(c.isPaused(),false);assert.equal(store.get('ouchn.automation.paused'),false);
    header.innerHTML='<div><span class="profile">Other panel</span><span class="switch">-</span></div>';
    await flush();assert.equal(root.querySelector('.ocs-automation-control'),button);
    assert.equal(root.querySelectorAll('.ocs-automation-control').length,1);
    container.classList.add('minimize');button.click();
    assert.equal(c.isPaused(),true);assert.equal(store.get('ouchn.automation.paused'),true);
    assert.equal(button.getAttribute('aria-pressed'),'true');
    const next=control();realFunction('initializeAutomationControl',{...context,automation:next,controlInitialized:false})();
    assert.equal(next.isPaused(),true);
  } finally { w.close(); }
});

test('paused video loading cannot expire or skip the current video', async () => {
  const { automation: c, advance } = clockControl(); let video = null, done = false;
  const wait = realFunction('waitForStudyVideo', { automation: c, document: { querySelector: () => video } });
  const pending = wait().then(v => { done = true; return v; });
  await flush(); c.setPaused(true); advance(100000); await flush(); assert.equal(done, false);
  video = { readyState: 4 }; c.setPaused(false); advance(200);
  assert.equal(await pending, video);
});

test('pause stops video and worker even when saving settings fails', () => {
  const c=control();let pauses=0;const events=[];
  const video={paused:false,ended:false,pause(){pauses++;this.paused=true;}};
  realFunction('initializeAutomationControl',{
    automation:c,controlInitialized:false,pauseKey:'ouchn.automation.paused',
    $store:{get:()=>false,set(){throw Error('storage unavailable');},addChangeListener(){}},
    document:{querySelector:()=>video,addEventListener(){}},
    state:{study:{},worker:{emit:e=>events.push(e)}}
  })();
  c.setPaused(true);assert.equal(pauses,1);assert.deepEqual(events,['stop']);
});
