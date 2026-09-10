/* Keep backup validation independent of the calendar and its automatic updates. */
globalThis.periodBackup = (() => {
  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + "T12:00:00Z");
    return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
  }
  function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function validate(data) {
    if (!object(data) || data.app !== "period-tracker" || data.version !== 1 ||
        !object(data.state) || !Array.isArray(data.state.periods) || !object(data.state.logs) ||
        !object(data.ui)) throw Error("這不是有效的 Period Tracker 備份。");
    for (const period of data.state.periods) {
      if (!object(period) || !date(period.start) || !date(period.end) || period.end < period.start)
        throw Error("備份內的經期日期無效，未匯入任何資料。");
    }
    for (const [day, log] of Object.entries(data.state.logs)) {
      if (!date(day) || !object(log) || typeof log.note !== "string" ||
          typeof log.flow !== "string" || typeof log.sex !== "boolean" ||
          !Array.isArray(log.symptoms) || !log.symptoms.every(item => typeof item === "string"))
        throw Error("備份內的每日記錄無效，未匯入任何資料。");
    }
    if (data.ui.pendingStart != null && !date(data.ui.pendingStart))
      throw Error("備份內的開始日期無效。");
    return data;
  }
  function merge(current, incoming) {
    const result = JSON.parse(JSON.stringify(current));
    for (const period of incoming.periods) {
      if (result.periods.some(p => p.start === period.start && p.end === period.end)) continue;
      if (result.periods.some(p => p.start <= period.end && period.start <= p.end))
        throw Error("經期日期與現有記錄重疊，未匯入任何資料。請保留備份以便核對。");
      result.periods.push(period);
    }
    for (const [day, log] of Object.entries(incoming.logs)) {
      const existing = result.logs[day];
      if (existing && (existing.flow !== log.flow || existing.note !== log.note ||
          existing.sex !== log.sex || JSON.stringify([...existing.symptoms].sort()) !== JSON.stringify([...log.symptoms].sort())))
        throw Error(`${day} 的記錄與現有資料不同，未匯入任何資料。請保留備份以便核對。`);
      result.logs[day] = log;
    }
    return result;
  }
  return { validate, merge };
})();
