const storeKey = "period-tracker-v2";
const uiStoreKey = "period-tracker-ui-v1";
const legacyStoreKey = "gungu-period-tracker-v1";
let today = startOfDay(new Date());
const defaultPeriodLength = 6;
const defaultCycleLength = 33;

let viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
let pendingStart = null;
let selectedDate = null;
let selectedSymptoms = new Set();
let reminderEnabled = false;
let lastReminderKey = "";
let storageReadError = false;
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
  dateActions: document.querySelector("#dateActions"),
  logCard: document.querySelector("#logCard"),
  logDateLabel: document.querySelector("#logDateLabel"),
  noteInput: document.querySelector("#noteInput"),
  reminderBtn: document.querySelector("#reminderBtn"),
  startPeriodBtn: document.querySelector("#startPeriodBtn"),
  endPeriodBtn: document.querySelector("#endPeriodBtn"),
  sexLogBtn: document.querySelector("#sexLogBtn"),
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
    storageReadError = true;
    return empty;
  }
  return empty;
}

function normalizeState(input) {
  const validDate = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    return toKey(parseDate(value)) === value;
  };
  if (!Array.isArray(input.periods || []) || (input.periods || []).some(period =>
    !period || !validDate(period.start) || !validDate(period.end))) throw Error("Invalid stored periods");
  if (!input.logs || typeof input.logs !== "object" || Array.isArray(input.logs)) throw Error("Invalid stored logs");
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
    if (!validDate(key) || !log || typeof log !== "object") throw Error("Invalid stored log");
    logs[key] = {
      flow: log.flow || "无",
      symptoms: Array.isArray(log.symptoms) ? log.symptoms : [],
      note: log.note || "",
      sex: Boolean(log.sex)
    };
  }
  return { periods, logs };
}

function saveState() {
  preserveBeforeWrite();
  localStorage.setItem(storeKey, JSON.stringify(state));
  document.dispatchEvent(new Event("period-data-changed"));
}

function preserveBeforeWrite() {
  if (storageReadError) throw Error("原有資料無法讀取，已暫停保存以保護記錄。請先匯出備份。");
  const previous = localStorage.getItem(storeKey);
  const ui = localStorage.getItem(uiStoreKey);
  if (previous || ui) localStorage.setItem("period-tracker-last-saved", JSON.stringify({ state: previous, ui }));
}

function loadUiDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(uiStoreKey));
    const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
    return {
      pendingStart: isDate(draft?.pendingStart) ? draft.pendingStart : null,
      selectedDate: isDate(draft?.selectedDate || draft?.selectedLogDate)
        ? draft.selectedDate || draft.selectedLogDate
        : null,
      reminderEnabled: Boolean(draft?.reminderEnabled),
      lastReminderKey: typeof draft?.lastReminderKey === "string" ? draft.lastReminderKey : ""
    };
  } catch {
    storageReadError = true;
    return { pendingStart: null, selectedDate: null, reminderEnabled: false, lastReminderKey: "" };
  }
}

function saveUiDraft() {
  if (storageReadError) throw Error("原有資料無法讀取，已暫停保存。請先匯出備份。");
  localStorage.setItem(
    uiStoreKey,
    JSON.stringify({ pendingStart, selectedDate, reminderEnabled, lastReminderKey })
  );
  document.dispatchEvent(new Event("period-data-changed"));
}

function getReminderPlan() {
  if (storageReadError) throw Error("資料讀取失敗，暫停同步提醒。");
  const latest = anchorPeriod();
  if (!latest) return [];
  const { cycleLength } = cycleStats();
  const now = new Date();
  let next = addDays(parseDate(latest.start), cycleLength);
  const plan = [];
  for (let index = 0; index < 200; index += 1) {
    const reminder = new Date(next.getFullYear(), next.getMonth(), next.getDate(), 10);
    if (reminder > addDays(now, 799)) break;
    if (reminder >= startOfDay(now) && !hasRecordedThisMonth(reminder)) plan.push(+reminder);
    if (plan.length === 24) break;
    next = addDays(next, cycleLength);
  }
  return plan;
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
  if (!addPeriod(preview.start, preview.end)) return false;
  selectedDate = preview.start;
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

  let start = addDays(parseDate(latest.start), cycleLength);
  while (start < today) start = addDays(start, cycleLength);
  return start;
}

function activePredictedPeriod() {
  if (actualPeriodFor(today)) return null;
  const { periodLength, cycleLength } = cycleStats();
  const latest = latestPeriod();
  if (!latest) return null;
  let start = addDays(parseDate(latest.start), cycleLength);
  while (addDays(start, cycleLength) <= today) start = addDays(start, cycleLength);
  const end = addDays(start, periodLength - 1);
  if (today < start || today > end) return null;
  return { start: toKey(start), end: toKey(end) };
}

function predictedStartForToday() {
  const { cycleLength } = cycleStats();
  const latest = latestPeriod();
  if (!latest) return null;

  let start = addDays(parseDate(latest.start), cycleLength);
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

async function showPeriodReminder(date) {
  const title = "Period Tracker";
  const body = "今天是预计经期开始日，记得记录一下。";
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) {
        await registration.showNotification(title, { body, tag: reminderKey(date), icon: "./assets/icon-192.png" });
        return;
      }
    } catch { /* Fall back to an in-app reminder if notifications are unavailable. */ }
  }
  alert(body);
}

let reminderInFlight = false;
async function checkPeriodReminder() {
  if (globalThis.periodPush?.enabled) return;
  if (reminderInFlight) return;
  if (!reminderEnabled) return;
  const predicted = predictedStartForToday();
  if (!predicted || pendingStart || hasRecordedThisMonth(predicted)) return;
  const now = new Date();
  if (now.getHours() < 10) return;
  const key = reminderKey(predicted);
  if (lastReminderKey === key) return;
  reminderInFlight = true;
  try {
    await showPeriodReminder(predicted);
    lastReminderKey = key;
    saveUiDraft();
  } finally { reminderInFlight = false; }
}

function scheduleReminderChecks() {
  const refresh = () => {
    const current = startOfDay(new Date());
    const changed = toKey(current) !== toKey(today);
    today = current;
    const completed = !storageReadError && autoCompletePendingPeriod();
    if (changed || completed) render();
    if (!storageReadError) checkPeriodReminder();
  };
  window.setInterval(refresh, 60000);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
}

function predictionAnchors() {
  const { cycleLength } = cycleStats();
  const latest = anchorPeriod();
  if (!latest) return [];

  const anchors = [];
  let start = parseDate(latest.start);
  const firstVisible = new Date(viewDate.getFullYear(), viewDate.getMonth(), -6);
  const lastVisible = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 14);
  // Navigation must not change the prediction model: find the first start
  // shown in this view whether it is before or after the newest record.
  while (start > firstVisible) start = addDays(start, -cycleLength);
  while (start < firstVisible) start = addDays(start, cycleLength);
  while (start < lastVisible) {
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

  const overlaps = state.periods.filter((existing) => {
    const existingStart = parseDate(existing.start).getTime();
    const existingEnd = parseDate(existing.end).getTime();
    return existingEnd >= firstTime && existingStart <= lastTime;
  });
  if (overlaps.some(existing => existing.start !== period.start || existing.end !== period.end)) {
    document.querySelector("#appStatus").textContent = "日期與已有經期重疊，原記錄已保留。請先核對開始和結束日期。";
    return false;
  }
  if (overlaps.length) return true;
  state.periods.push(period);
  state = normalizeState(state);
  saveState();
  return true;
}

function deletePeriod(startKey) {
  if (!confirm(`刪除 ${startKey} 的經期記錄？`)) return;
  state.periods = state.periods.filter((period) => period.start !== startKey);
  saveState();
  render();
}

function hasLog(key) {
  const log = state.logs[key];
  return Boolean(log && (log.flow !== "无" || log.symptoms.length || log.note || log.sex));
}

function handleDayClick(key) {
  requestStoragePersistence();
  selectedDate = key;
  saveUiDraft();
  render();
}

function setPeriodStart() {
  if (!selectedDate) return;
  if (pendingStart && pendingStart !== selectedDate && !confirm("更改尚未完成的經期開始日期？")) return;
  pendingStart = selectedDate;
  saveUiDraft();
  render();
}

function setPeriodEnd() {
  if (!selectedDate || !pendingStart) return;
  if (selectedDate < pendingStart) {
    document.querySelector("#appStatus").textContent = "結束日期不能早於開始日期。";
    return;
  }
  if (!addPeriod(pendingStart, selectedDate)) return;
  pendingStart = null;
  saveUiDraft();
  render();
}

function toggleSexLog() {
  if (!selectedDate) return;
  const log = state.logs[selectedDate] || { flow: "无", symptoms: [], note: "", sex: false };
  state.logs[selectedDate] = { ...log, sex: !log.sex };
  saveState();
  render();
}

function renderMetrics() {
  const { periodLength, cycleLength } = cycleStats();
  const next = nextPredictedStart();
  const activePrediction = activePredictedPeriod();
  els.periodMetric.textContent = `${periodLength}天`;
  els.cycleMetric.textContent = `${cycleLength}天`;
  els.nextMetric.textContent = activePrediction ? "进行中" : next ? formatShort(toKey(next)) : "--";

  if (pendingStart) {
    els.nextSummary.textContent = "";
  } else if (!state.periods.length) {
    els.nextSummary.textContent = "选择开始日，再选择结束日";
  } else if (activePrediction) {
    els.nextSummary.textContent = `预计经期 ${formatShort(activePrediction.start)} - ${formatShort(activePrediction.end)}，尚未记录`;
  } else if (next) {
    const daysLeft = Math.max(0, daysBetween(next, today));
    els.nextSummary.textContent = `预计 ${formatShort(toKey(next))} 开始，约 ${daysLeft} 天后`;
  }

  if (!selectedDate) {
    els.selectionLabel.textContent = "点日期后选择记录类型";
  } else if (pendingStart) {
    els.selectionLabel.textContent = `${formatShort(selectedDate)} 已选，开始日 ${formatShort(pendingStart)}`;
  } else {
    els.selectionLabel.textContent = `${formatShort(selectedDate)} 已选`;
  }
  els.selectionCard.classList.toggle("active", Boolean(selectedDate));
  els.dateActions.hidden = !selectedDate;
  els.endPeriodBtn.disabled = !pendingStart || selectedDate < pendingStart;
  els.reminderBtn.textContent = reminderEnabled ? "開啟時提醒：開" : "開啟時提醒：關";
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
    if (selectedDate === key) button.classList.add("selected");
    if (pendingStart === key) button.classList.add("selecting");
    if (actual) button.classList.add("actual");
    else if (predicted) button.classList.add(predicted);

    if (actual?.start === key) button.dataset.edge = "start";
    if (actual?.end === key) button.dataset.edge = "end";
    if (actual?.preview) button.classList.add("preview");
    if (hasLog(key)) button.classList.add("logged");
    if (state.logs[key]?.sex) button.classList.add("sex");

    button.addEventListener("click", () => handleDayClick(key));
    els.calendar.append(button);
  }
}

function renderLogForm() {
  if (!selectedDate) {
    els.logCard.hidden = true;
    return;
  }

  const log = state.logs[selectedDate] || { flow: "无", symptoms: [], note: "", sex: false };
  selectedSymptoms = new Set(log.symptoms);
  els.logCard.hidden = false;
  els.logDateLabel.textContent = `${formatShort(selectedDate)} 状况`;
  els.noteInput.value = log.note || "";
  els.sexLogBtn.classList.toggle("active", log.sex);
  els.flowButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.flow === log.flow);
  });
  els.symptomButtons.forEach((button) => {
    button.classList.toggle("active", selectedSymptoms.has(button.dataset.symptom));
  });
}

function renderList() {
  els.periodList.innerHTML = "";
  const items = [...state.periods].sort((a, b) => parseDate(b.start) - parseDate(a.start));

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
        <strong>${period.start.replaceAll("-", "/")} - ${formatShort(period.end)}</strong>
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
  selectedDate = null;
  saveUiDraft();
  render();
});

els.startPeriodBtn.addEventListener("click", setPeriodStart);
els.endPeriodBtn.addEventListener("click", setPeriodEnd);
els.sexLogBtn.addEventListener("click", toggleSexLog);

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
  if (!selectedDate) return;
  const flow = document.querySelector("[data-flow].active")?.dataset.flow || "无";
  const existing = state.logs[selectedDate] || {};
  state.logs[selectedDate] = {
    sex: Boolean(existing.sex),
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
  selectedDate = null;
  saveState();
  localStorage.removeItem(uiStoreKey);
  render();
});

const backupStatus = document.querySelector("#backupStatus");
function createBackup() {
  return {
    app: "period-tracker", version: 1, exportedAt: new Date().toISOString(),
    state: JSON.parse(JSON.stringify(state)), ui: loadUiDraft(),
    originalStorage: Object.fromEntries([storeKey, uiStoreKey, legacyStoreKey]
      .map(key => [key, localStorage.getItem(key)]))
  };
}

document.querySelector("#exportBackupBtn").addEventListener("click", async () => {
  try {
    const backup = createBackup();
    const file = new File([JSON.stringify(backup, null, 2)], `period-tracker-backup-${toKey(new Date())}.json`, { type: "application/json" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Period Tracker 備份" });
    } else {
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    backupStatus.textContent = `已準備 ${backup.state.periods.length} 筆經期、${Object.keys(backup.state.logs).length} 天的記錄。請確認備份已存入「檔案」。`;
  } catch (error) {
    backupStatus.textContent = error.name === "AbortError" ? "已取消匯出。" : "無法匯出備份，請重試。";
  }
});

const backupFile = document.querySelector("#backupFile");
document.querySelector("#importBackupBtn").addEventListener("click", () => backupFile.click());
backupFile.addEventListener("change", async () => {
  const file = backupFile.files[0];
  if (!file) return;
  try {
    if (file.size > 10000000) throw Error("備份檔案過大，請確認選擇正確的 JSON 檔案。");
    const backup = periodBackup.validate(JSON.parse(await file.text()));
    const merged = periodBackup.merge(state, backup.state);
    if (pendingStart && backup.ui.pendingStart && pendingStart !== backup.ui.pendingStart)
      throw Error("兩份資料有不同的未完成經期，未匯入任何資料。請保留備份以便核對。");
    if (!confirm(`合併備份中的 ${backup.state.periods.length} 筆經期及 ${Object.keys(backup.state.logs).length} 天的記錄？`)) return;
    // Preserve both inputs before writing either active storage key.
    localStorage.setItem("period-tracker-before-import", JSON.stringify(createBackup()));
    localStorage.setItem("period-tracker-import-source", JSON.stringify(backup));
    preserveBeforeWrite();
    localStorage.setItem(storeKey, JSON.stringify(merged));
    state = merged;
    pendingStart = pendingStart || backup.ui.pendingStart || null;
    saveUiDraft();
    render();
    backupStatus.textContent = "已合併備份，原有記錄已保留。";
  } catch (error) {
    backupStatus.textContent = error instanceof SyntaxError ? "無法讀取這個備份檔案。" : error.message;
  } finally {
    backupFile.value = "";
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

const uiDraft = loadUiDraft();
pendingStart = uiDraft.pendingStart;
selectedDate = uiDraft.selectedDate || uiDraft.pendingStart;
reminderEnabled = uiDraft.reminderEnabled;
lastReminderKey = uiDraft.lastReminderKey;
if (!storageReadError) autoCompletePendingPeriod();
scheduleReminderChecks();
render();
if (storageReadError) document.querySelector("#appStatus").textContent = "原有資料無法讀取，已暫停保存。請先匯出備份，保留原始資料。";
window.addEventListener("error", () => {
  document.querySelector("#appStatus").textContent = "操作未能完成。請先匯出備份並重新開啟；不要清除網站資料。";
});
