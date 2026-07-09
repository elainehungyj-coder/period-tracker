const storeKey = "period-tracker-v2";
const legacyStoreKey = "gungu-period-tracker-v1";
const today = startOfDay(new Date());
const defaultPeriodLength = 6;
const defaultCycleLength = 33;

let viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
let pendingStart = null;
let state = loadState();

const els = {
  nextSummary: document.querySelector("#nextSummary"),
  periodMetric: document.querySelector("#periodMetric"),
  cycleMetric: document.querySelector("#cycleMetric"),
  nextMetric: document.querySelector("#nextMetric"),
  calendar: document.querySelector("#calendar"),
  monthTitle: document.querySelector("#monthTitle"),
  periodList: document.querySelector("#periodList"),
  selectionLabel: document.querySelector("#selectionLabel"),
  selectionCard: document.querySelector("#selectionCard")
};

function loadState() {
  const empty = { periods: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey));
    if (saved?.periods) return normalizeState(saved);

    const legacy = JSON.parse(localStorage.getItem(legacyStoreKey));
    if (legacy?.lastStart) {
      return normalizeState({
        periods: [
          {
            start: legacy.lastStart,
            end: toKey(addDays(parseDate(legacy.lastStart), (legacy.periodLength || defaultPeriodLength) - 1))
          }
        ]
      });
    }
  } catch {
    return empty;
  }
  return empty;
}

function normalizeState(input) {
  const periods = (input.periods || [])
    .filter((period) => period.start && period.end)
    .map((period) => {
      const start = parseDate(period.start);
      const end = parseDate(period.end);
      const first = start <= end ? start : end;
      const last = start <= end ? end : start;
      return { start: toKey(first), end: toKey(last) };
    })
    .sort((a, b) => parseDate(a.start) - parseDate(b.start));
  return { periods };
}

function saveState() {
  localStorage.setItem(storeKey, JSON.stringify(state));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysBetween(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}

function formatShort(key) {
  const date = parseDate(key);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function average(values, fallback) {
  if (!values.length) return fallback;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function periodLength(period) {
  return daysBetween(parseDate(period.end), parseDate(period.start)) + 1;
}

function cycleStats() {
  const sorted = [...state.periods].sort((a, b) => parseDate(a.start) - parseDate(b.start));
  const lengths = sorted.map(periodLength).filter((length) => length > 0 && length <= 14);
  const intervals = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const interval = daysBetween(parseDate(sorted[index].start), parseDate(sorted[index - 1].start));
    if (interval >= 18 && interval <= 60) intervals.push(interval);
  }

  return {
    sorted,
    periodLength: average(lengths, defaultPeriodLength),
    cycleLength: average(intervals, defaultCycleLength)
  };
}

function latestPeriod() {
  const { sorted } = cycleStats();
  return sorted[sorted.length - 1] || null;
}

function pendingPreviewPeriod() {
  if (!pendingStart) return null;
  const { periodLength } = cycleStats();
  const start = parseDate(pendingStart);
  return {
    start: pendingStart,
    end: toKey(addDays(start, periodLength - 1)),
    preview: true
  };
}

function anchorPeriod() {
  return pendingPreviewPeriod() || latestPeriod();
}

function nextPredictedStart() {
  const { cycleLength } = cycleStats();
  const latest = anchorPeriod();
  if (!latest) return null;

  let start = parseDate(latest.start);
  while (start < today) start = addDays(start, cycleLength);
  return start;
}

function predictionAnchors() {
  const { cycleLength } = cycleStats();
  const latest = anchorPeriod();
  if (!latest) return [];

  const anchors = [];
  let start = parseDate(latest.start);
  while (start > addDays(today, -370)) start = addDays(start, -cycleLength);
  while (start < addDays(today, 370)) {
    anchors.push(start);
    start = addDays(start, cycleLength);
  }
  return anchors;
}

function actualPeriodFor(date) {
  const preview = pendingPreviewPeriod();
  if (preview) {
    const start = parseDate(preview.start);
    const end = parseDate(preview.end);
    if (date >= start && date <= end) return preview;
  }

  return state.periods.find((period) => {
    const start = parseDate(period.start);
    const end = parseDate(period.end);
    return date >= start && date <= end;
  });
}

function predictedPhaseFor(date) {
  const { periodLength, cycleLength } = cycleStats();
  const anchors = predictionAnchors();

  for (const anchor of anchors) {
    const day = daysBetween(date, anchor) + 1;
    const ovulationDay = Math.max(1, cycleLength - 14);
    if (day >= 1 && day <= periodLength) return "predicted";
    if (day === ovulationDay) return "ovulation";
    if (day >= ovulationDay - 5 && day <= ovulationDay + 1) return "fertile";
  }
  return "";
}

function addPeriod(startKey, endKey) {
  const start = parseDate(startKey);
  const end = parseDate(endKey);
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const period = { start: toKey(first), end: toKey(last) };
  const firstTime = first.getTime();
  const lastTime = last.getTime();

  state.periods = state.periods.filter((existing) => {
    const existingStart = parseDate(existing.start).getTime();
    const existingEnd = parseDate(existing.end).getTime();
    return existingEnd < firstTime || existingStart > lastTime;
  });
  state.periods.push(period);
  state = normalizeState(state);
  saveState();
}

function deletePeriod(startKey) {
  state.periods = state.periods.filter((period) => period.start !== startKey);
  saveState();
  render();
}

function handleDayClick(key) {
  if (!pendingStart) {
    pendingStart = key;
    render();
    return;
  }

  addPeriod(pendingStart, key);
  pendingStart = null;
  render();
}

function renderMetrics() {
  const { periodLength, cycleLength } = cycleStats();
  const next = nextPredictedStart();
  els.periodMetric.textContent = `${periodLength}天`;
  els.cycleMetric.textContent = `${cycleLength}天`;
  els.nextMetric.textContent = next ? formatShort(toKey(next)) : "--";

  if (pendingStart) {
    els.nextSummary.textContent = "";
  } else if (!state.periods.length) {
    els.nextSummary.textContent = "选择开始日，再选择结束日";
  } else if (next) {
    const daysLeft = Math.max(0, daysBetween(next, today));
    els.nextSummary.textContent = `预计 ${formatShort(toKey(next))} 开始，约 ${daysLeft} 天后`;
  }

  els.selectionLabel.textContent = pendingStart
    ? `开始日 ${formatShort(pendingStart)}，请选择结束日`
    : "点一个日期作为开始日";
  els.selectionCard.classList.toggle("active", Boolean(pendingStart));
}

function renderCalendar() {
  els.calendar.innerHTML = "";
  els.monthTitle.textContent = `${viewDate.getFullYear()}年${viewDate.getMonth() + 1}月`;

  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = addDays(first, -offset);

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    const key = toKey(date);
    const button = document.createElement("button");
    const actual = actualPeriodFor(date);
    const predicted = predictedPhaseFor(date);

    button.type = "button";
    button.className = "day";
    button.innerHTML = `<span>${date.getDate()}</span>`;
    button.setAttribute("aria-label", key);

    if (date.getMonth() !== viewDate.getMonth()) button.classList.add("muted");
    if (key === toKey(today)) button.classList.add("today");
    if (pendingStart === key) button.classList.add("selecting");
    if (actual) button.classList.add("actual");
    else if (predicted) button.classList.add(predicted);

    if (actual?.start === key) button.dataset.edge = "start";
    if (actual?.end === key) button.dataset.edge = "end";
    if (actual?.preview) button.classList.add("preview");

    button.addEventListener("click", () => handleDayClick(key));
    els.calendar.append(button);
  }
}

function renderList() {
  els.periodList.innerHTML = "";
  const items = [...state.periods].sort((a, b) => parseDate(b.start) - parseDate(a.start)).slice(0, 8);

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "暂无记录";
    els.periodList.append(empty);
    return;
  }

  for (const period of items) {
    const item = document.createElement("li");
    item.innerHTML = `
      <div>
        <strong>${formatShort(period.start)} - ${formatShort(period.end)}</strong>
        <span>${periodLength(period)}天</span>
      </div>
      <button type="button" aria-label="删除 ${period.start}">删除</button>
    `;
    item.querySelector("button").addEventListener("click", () => deletePeriod(period.start));
    els.periodList.append(item);
  }
}

function render() {
  renderMetrics();
  renderCalendar();
  renderList();
}

document.querySelector("#prevMonth").addEventListener("click", () => {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
  renderCalendar();
});

document.querySelector("#nextMonth").addEventListener("click", () => {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
  renderCalendar();
});

document.querySelector("#cancelSelectionBtn").addEventListener("click", () => {
  pendingStart = null;
  render();
});

document.querySelector("#resetBtn").addEventListener("click", () => {
  if (!confirm("确定清空所有本地记录吗？")) return;
  state = { periods: [] };
  pendingStart = null;
  saveState();
  render();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

render();
