const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
process.env.TZ = 'Asia/Shanghai';
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function boot(saved = {}, at = '2026-07-07T09:00:00+08:00') {
  const store = new Map(Object.entries(saved));
  const elements = new Map();
  const intervals = [];
  let clock = at;
  function element() {
    const classes = new Set();
    const children = [];
    const handlers = {};
    return { children, handlers, dataset: {}, value: '', textContent: '', hidden: false,
      classList: { add: (...names) => names.forEach(name => classes.add(name)),
        remove: name => classes.delete(name), toggle: (name, active) => active ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) },
      set innerHTML(value) { children.length = 0; },
      append: item => children.push(item), setAttribute() {},
      addEventListener: (type, handler) => { handlers[type] = handler; },
      querySelector: () => element() };
  }
  const document = { visibilityState: 'visible',
    querySelector: selector => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); },
    querySelectorAll: () => [], createElement: () => element(), addEventListener() {}, dispatchEvent() {} };
  const sandbox = vm.createContext({ document, navigator: {}, console, Event: class {},
    confirm: () => true, alert() {},
    window: { setInterval: callback => intervals.push(callback), addEventListener() {} },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return +new Date(clock); } },
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) } });
  vm.runInContext(source, sandbox);
  return { store, elements, run: code => vm.runInContext(code, sandbox),
    tick: value => { clock = value; intervals.forEach(callback => callback()); } };
}
const data = periods => ({ 'period-tracker-v2': JSON.stringify({ periods, logs: {} }) });
test('date selection does not generate a period or daily record', () => {
  const app = boot();
  app.run('handleDayClick("2026-07-07")');
  assert.equal(app.run('state.periods.length'), 0);
  assert.equal(app.run('Object.keys(state.logs).length'), 0);
});
test('explicit start fills six days and completed period survives reload', () => {
  const app = boot();
  app.run('handleDayClick("2026-07-07"); setPeriodStart()');
  assert.equal(app.run('pendingPreviewPeriod().end'), '2026-07-12');
  assert.equal(app.run('Boolean(actualPeriodFor(parseDate("2026-07-10")))'), true);
  assert.equal(app.run('predictedPhaseFor(parseDate("2026-08-09"))'), 'predicted');
  assert.equal(app.run('predictedPhaseFor(parseDate("2026-07-24"))'), 'fertile');
  assert.equal(app.run('predictedPhaseFor(parseDate("2026-07-25"))'), 'ovulation');
  app.run('handleDayClick("2026-07-12"); setPeriodEnd(); toggleSexLog()');
  const again = boot(Object.fromEntries(app.store));
  assert.equal(again.run('state.periods.length'), 1);
  assert.equal(again.run('state.logs["2026-07-12"].sex'), true);
  assert.ok(app.store.get('period-tracker-last-saved'));
});
test('overlapping period cannot remove original dates; end before start is rejected', () => {
  const app = boot(data([{ start: '2026-07-01', end: '2026-07-06' }]));
  assert.equal(app.run('addPeriod("2026-07-03", "2026-07-08")'), false);
  assert.equal(app.run('state.periods[0].start'), '2026-07-01');
  app.run('handleDayClick("2026-07-20"); setPeriodStart(); handleDayClick("2026-07-18"); setPeriodEnd()');
  assert.equal(app.run('state.periods.length'), 1);
});
test('missed end is filled at startup and when the open page crosses the date', () => {
  const saved = { ...data([]), 'period-tracker-ui-v1': JSON.stringify({ pendingStart: '2026-07-07' }) };
  const app = boot(saved, '2026-07-11T23:59:00+08:00');
  assert.equal(app.run('state.periods.length'), 0);
  app.tick('2026-07-12T10:00:00+08:00');
  assert.equal(app.run('state.periods[0].end'), '2026-07-12');
  assert.equal(app.run('toKey(today)'), '2026-07-12');
  assert.equal(boot(saved, '2026-07-13T10:00:00+08:00').run('state.periods[0].end'), '2026-07-12');
});
test('all history is visible, default cycle is 33 and averages adapt', () => {
  const periods = Array.from({ length: 10 }, (_, i) => ({ start: `2025-${String(i + 1).padStart(2, '0')}-01`, end: `2025-${String(i + 1).padStart(2, '0')}-06` }));
  const app = boot(data(periods));
  assert.equal(app.elements.get('#periodList').children.length, 10);
  assert.equal(app.run('cycleStats().periodLength'), 6);
  assert.equal(app.run('cycleStats().cycleLength'), 30);
  assert.equal(boot().run('cycleStats().cycleLength'), 33);
});
test('reminder plan is at 10 local time, excludes recorded month and contains no log contents', () => {
  const app = boot(data([{ start: '2026-07-07', end: '2026-07-12' }]));
  assert.equal(app.run('new Date(getReminderPlan()[0]).getHours()'), 10);
  assert.equal(app.run('toKey(new Date(getReminderPlan()[0]))'), '2026-08-09');
  assert.equal(app.run('getReminderPlan().every(Number.isSafeInteger)'), true);
  assert.equal(app.run('toKey(nextPredictedStart())'), '2026-08-09');
});
test('predictions use every actual start date and work in past, current and future months', () => {
  const periods = [
    { start: '2026-07-07', end: '2026-07-12' },
    { start: '2026-08-03', end: '2026-08-08' },
    { start: '2026-08-30', end: '2026-09-04' }
  ];
  const app = boot(data(periods), '2026-09-27T12:00:00+08:00');
  assert.equal(app.run('cycleStats().cycleLength'), 27);
  assert.equal(app.run('toKey(nextPredictedStart())'), '2026-10-23');
  assert.deepEqual(JSON.parse(app.run('JSON.stringify(activePredictedPeriod())')), { start: '2026-09-26', end: '2026-10-01' });
  assert.equal(app.run('predictedPhaseFor(parseDate("2026-09-26"))'), 'predicted');
  assert.equal(app.run('predictedPhaseFor(parseDate("2026-10-01"))'), 'predicted');
  assert.equal(app.run('predictedPhaseFor(parseDate("2026-10-03"))'), 'fertile');
  assert.equal(app.run('predictedPhaseFor(parseDate("2026-10-08"))'), 'ovulation');
  assert.equal(app.run('predictedPhaseFor(parseDate("2026-10-09"))'), 'fertile');
  app.run('viewDate = new Date(2026, 6, 1)');
  assert.equal(app.run('predictionAnchors().some(day => toKey(day) === "2026-07-07")'), true);
});
test('corrupt saved data is retained and subsequent writes are blocked', () => {
  const app = boot({ 'period-tracker-v2': '{broken' });
  assert.throws(() => app.run('saveState()'));
  assert.equal(app.store.get('period-tracker-v2'), '{broken');
  const invalid = data([{ start: '2026-02-30', end: '2026-03-04' }]);
  assert.throws(() => boot(invalid).run('saveState()'));
});
