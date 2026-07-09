const storeKey = "period-tracker-v2";
const uiStoreKey = "period-tracker-ui-v1";
const legacyStoreKey = "gungu-period-tracker-v1";
const today = startOfDay(new Date());
const defaultPeriodLength = 6;
const defaultCycleLength = 33;

let viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
let pendingStart = null;
let selectedLogDate = null;
let selectedSymptoms = new Set();
let reminderEnabled = false;
let lastReminderKey = "";
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
  selectionCard: document.querySelector("#selectionCard"),
  logCard: document.querySelector("#logCard"),
  logDateLabel: document.querySelector("#logDateLabel"),
  noteInput: document.querySelector("#noteInput"),
  reminderBtn: document.querySelector("#reminderBtn"),
  flowButtons: [...document.querySelectorAll("[data-flow]")],
  symptomButtons: [...document.querySelectorAll("[data-symptom]")]
};

function loadState() {
  const empty = { periods: [], logs: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey));
    if (saved?.periods || saved?.logs) return normalizeState(saved);

    const legacy = JSON.parse(localStorage.getItem(legacyStoreKey));
    if (legacy?.lastStart) {
      return normalizeState({
        logs: legacy.logs || {},
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
  const logs = {};
  for (const [key, log] of Object.entries(input.logs || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    logs[key] = {
      flow: log.flow || "无",
      symptoms: Array.isArray(log.symptoms) ? log.symptoms : [],
      note: log.note || ""
    };
  }
  return { periods, logs };
}

function saveState() {
  localStorage.setItem(storeKey, JSON.stringify(state));
}

function loadUiDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(uiStoreKey));
    const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
    return {
      pendingStart: isDate(draft?.pendingStart) ? draft.pendingStart : null,
      selectedLogDate: isDate(draft?.selectedLogDate) ? draft.selectedLogDate : null,
      reminderEnabled: Boolean(draft?.reminderEnabled),
      lastReminderKey: typeof draft?.lastReminderKey === "string" ? draft.lastReminderKey : ""
    };
  } catch {
    return { pendingStart: null, selectedLogDate: null, reminderEnabled: false, lastReminderKey: "" };
  }
}

function saveUiDraft() {
  localStorage.setItem(
    uiStoreKey,
    JSON.stringify({ pendingStart, selectedLogDate, reminderEnabled, lastReminderKey })
  );
}

function requestStoragePersistence() {
  if (!navigator.storage?.persist) return;
  navigator.storage.persist().catch(() => {});
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

function autoCompletePendingPeriod() {
  const preview = pendingPreviewPeriod();
  if (!preview) return false;
  if (daysBetween(today, parseDate(preview.end)) < 0) return false;
  addPeriod(preview.start, preview.end);
  selectedLogDate = preview.start;
  pendingStart = null;
  saveUiDraft();
  return true;
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

function predictedStartForToday() {
  const { cycleLength } = cycleStats();
  const latest = latestPeriod();
  if (!latest) return null;

  let start = parseDate(latest.start);
  while (addDays(start, cycleLength) <= today) start = addDays(start, cycleLength);
  return toKey(start) === toKey(today) ? start : null;
}

function hasRecordedThisMonth(date) {
  return state.periods.some((period) => {
    const start = parseDate(period.start);
    return start.getFullYear() === date.getFullYear() && start.getMonth() === date.getMonth();
  });
}

function reminderKey(date) {
  return `${toKey(date)}-10`;
}

function showPeriodReminder(date) {
  const title = "Period Tracker";
  const body = "今天是预计经期开始日，记得记录一下。";
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, tag: reminderKey(date) });
    return;
  }
  alert(body);
}

function checkPeriodReminder() {
  if (!reminderEnabled) return;
  const predicted = predictedStartForToday();
  if (!predicted || pendingStart || hasRecordedThisMonth(predicted)) return;
  const now = new Date();
  if (now.getHours() < 10) return;
  const key = reminderKey(predicted);
  if (lastReminderKey === key) return;
  lastReminderKey = key;
  saveUiDraft();
  showPeriodReminder(predicted);
}

function scheduleReminderChecks() {
  checkPeriodReminder();
  window.setInterval(checkPeriodReminder, 60000);
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

function hasLog(key) {
  const log = state.logs[key];
  return Boolean(log && (log.flow !== "无" || log.symptoms.length || log.note));
}

function handleDayClick(key) {
  requestStoragePersistence();
  if (!pendingStart) {
    pendingStart = key;
    selectedLogDate = key;
    saveUiDraft();
    render();
    return;
  }

  addPeriod(pendingStart, key);
  selectedLogDate = pendingStart;
  pendingStart = null;
  saveUiDraft();
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
  els.reminderBtn.textContent = reminderEnabled ? "提醒开" : "提醒关";
  els.reminderBtn.classList.toggle("active", reminderEnabled);
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
    if (hasLog(key)) button.classList.add("logged");

    button.addEventListener("click", () => handleDayClick(key));
    els.calendar.append(button);
  }
}

function renderLogForm() {
  if (!selectedLogDate) {
    els.logCard.hidden = true;
    return;
  }

  const log = state.logs[selectedLogDate] || { flow: "无", symptoms: [], note: "" };
  selectedSymptoms = new Set(log.symptoms);
  els.logCard.hidden = false;
  els.logDateLabel.textContent = `${formatShort(selectedLogDate)} 状况`;
  els.noteInput.value = log.note || "";
  els.flowButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.flow === log.flow);
  });
  els.symptomButtons.forEach((button) => {
    button.classList.toggle("active", selectedSymptoms.has(button.dataset.symptom));
  });
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
  renderLogForm();
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
  saveUiDraft();
  render();
});

els.reminderBtn.addEventListener("click", async () => {
  requestStoragePersistence();
  if (!reminderEnabled && "Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  reminderEnabled = !reminderEnabled;
  saveUiDraft();
  renderMetrics();
  checkPeriodReminder();
});

function saveCurrentLog() {
  if (!selectedLogDate) return;
  const flow = document.querySelector("[data-flow].active")?.dataset.flow || "无";
  state.logs[selectedLogDate] = {
    flow,
    symptoms: [...selectedSymptoms],
    note: els.noteInput.value.trim()
  };
  saveState();
  saveUiDraft();
}

document.querySelector("#saveLogBtn").addEventListener("click", () => {
  saveCurrentLog();
  renderCalendar();
});

els.flowButtons.forEach((button) => {
  button.addEventListener("click", () => {
    requestStoragePersistence();
    els.flowButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    saveCurrentLog();
    renderCalendar();
  });
});

els.symptomButtons.forEach((button) => {
  button.addEventListener("click", () => {
    requestStoragePersistence();
    const symptom = button.dataset.symptom;
    if (selectedSymptoms.has(symptom)) selectedSymptoms.delete(symptom);
    else selectedSymptoms.add(symptom);
    button.classList.toggle("active", selectedSymptoms.has(symptom));
    saveCurrentLog();
    renderCalendar();
  });
});

els.noteInput.addEventListener("input", () => {
  requestStoragePersistence();
  saveCurrentLog();
  renderCalendar();
});

document.querySelector("#resetBtn").addEventListener("click", () => {
  if (!confirm("确定清空所有本地记录吗？")) return;
  state = { periods: [], logs: {} };
  pendingStart = null;
  selectedLogDate = null;
  saveState();
  localStorage.removeItem(uiStoreKey);
  render();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

const uiDraft = loadUiDraft();
pendingStart = uiDraft.pendingStart;
selectedLogDate = uiDraft.selectedLogDate || uiDraft.pendingStart;
reminderEnabled = uiDraft.reminderEnabled;
lastReminderKey = uiDraft.lastReminderKey;
autoCompletePendingPeriod();
scheduleReminderChecks();
render();
