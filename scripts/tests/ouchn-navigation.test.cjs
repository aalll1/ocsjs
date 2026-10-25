const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '../../packages/scripts/src/projects/ouchn.ts'), 'utf8');
const start = source.indexOf('async function goNext()');
const end = source.indexOf('/**', start);
const code = stripTypeScriptTypes(source.slice(start, end));
async function run(change, disabled = false) {
  const active = { id: 'activity-1', textContent: 'First', getAttribute() { return null; } };
  const video = { readyState: 4, currentSrc: 'first.mp4', getAttribute() { return 'first.mp4'; } };
  const page = { active, video, hash: '#/1', ticks: 0, clicks: 0 };
  const button = { disabled, click() { page.clicks++; } };
  const context = {
    document: { querySelector(selector) {
      if (selector === '.next-btn') return button;
      if (selector.includes('sidebar-menu-item.active')) return page.active;
      if (selector === 'video.vjs-tech') return page.video;
      throw new Error('Unexpected selector: ' + selector);
    } },
    location: { get hash() { return page.hash; } },
    automation: { async waitUntilRunning() {}, async delay() { page.ticks++; if (change) change(page); } },
    $msg: { info() {}, success() {}, error() {} },
    browserNotify: async () => {}
  };
  const result = await vm.runInNewContext(code + '\ngoNext()', context);
  return { result, page };
}
test('loaded old video does not prove navigation', async () => {
  const { result, page } = await run();
  assert.equal(result, false);
  assert.equal(page.ticks, 20);
});
test('re-rendering the same activity does not prove navigation', async () => {
  const { result } = await run(p => { p.active = { ...p.active }; });
  assert.equal(result, false);
});
test('activity changes even when the sidebar node is reused', async () => {
  const { result } = await run(p => { p.active.id = 'activity-2'; p.active.textContent = 'Second'; });
  assert.equal(result, true);
});
test('new route and ready new media prove navigation without sidebar', async () => {
  const { result } = await run(p => { p.hash = '#/2'; p.active = null; p.video = { readyState: 4, currentSrc: 'second.mp4' }; });
  assert.equal(result, true);
});
test('disabled next button stops without clicking', async () => {
  const { result, page } = await run(null, true);
  assert.equal(result, false);
  assert.equal(page.clicks, 0);
});
test('route changes while old video remains loaded do not prove navigation', async () => {
  const { result } = await run(p => { p.hash = '#/2'; });
  assert.equal(result, false);
});
test('changed source in a reused video element proves navigation on a new route', async () => {
  const { result } = await run(p => { p.hash = '#/2'; p.active = null; p.video.currentSrc = 'second.mp4'; });
  assert.equal(result, true);
});
test('new player on the same route does not prove navigation', async () => {
  const { result } = await run(p => { p.active = null; p.video = { readyState: 4, currentSrc: 'first.mp4' }; });
  assert.equal(result, false);
});
