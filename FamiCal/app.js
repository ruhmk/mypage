const LOCAL_STORAGE_KEY = "family-calendar-local-events";
const GOOGLE_SYNC_TIMEOUT_MS = 15000;
const SOURCE_LABELS = {
  family: "家族",
  personal: "個人",
  work: "仕事"
};
const appConfig = window.FAMILY_CALENDAR_CONFIG || {};

const state = {
  viewDate: startOfMonth(new Date()),
  selectedDate: stripTime(new Date()),
  remoteEvents: [],
  localEvents: [],
  visibleSources: new Set(["family", "personal", "work"])
};

const calendarGrid = document.querySelector("#calendarGrid");
const monthLabel = document.querySelector("#monthLabel");
const yearLabel = document.querySelector("#yearLabel");
const selectedDateLabel = document.querySelector("#selectedDateLabel");
const selectedEventList = document.querySelector("#selectedEventList");
const upcomingEventList = document.querySelector("#upcomingEventList");
const eventDialog = document.querySelector("#eventDialog");
const eventForm = document.querySelector("#eventForm");
const eventTitle = document.querySelector("#eventTitle");
const eventDate = document.querySelector("#eventDate");
const eventStart = document.querySelector("#eventStart");
const eventEnd = document.querySelector("#eventEnd");
const eventSource = document.querySelector("#eventSource");
const eventNote = document.querySelector("#eventNote");
const refreshGoogleButton = document.querySelector("#refreshGoogleButton");
const importNascaButton = document.querySelector("#importNascaButton");
const nascaFileInput = document.querySelector("#nascaFileInput");
const importStatus = document.querySelector("#importStatus");

document.querySelector("#prevMonth").addEventListener("click", () => {
  state.viewDate = addMonths(state.viewDate, -1);
  render();
});

document.querySelector("#nextMonth").addEventListener("click", () => {
  state.viewDate = addMonths(state.viewDate, 1);
  render();
});

document.querySelector("#todayButton").addEventListener("click", () => {
  state.selectedDate = stripTime(new Date());
  state.viewDate = startOfMonth(state.selectedDate);
  render();
});

document.querySelector("#openComposer").addEventListener("click", () => {
  openComposer(state.selectedDate);
});

refreshGoogleButton.addEventListener("click", () => {
  refreshGoogleEvents({ sync: true });
});

importNascaButton.addEventListener("click", () => {
  nascaFileInput.value = "";
  nascaFileInput.click();
});

nascaFileInput.addEventListener("change", async () => {
  const file = nascaFileInput.files && nascaFileInput.files[0];
  if (!file) {
    return;
  }

  try {
    const content = await file.text();
    const imported = parseNascaSchedule(content, file.name);
    if (imported.length === 0) {
      window.alert("取り込める予定が見つかりませんでした。");
      return;
    }

    state.localEvents = state.localEvents.filter((item) => !isNascaEvent(item));
    state.localEvents.push(...imported);
    saveLocalEvents();
    state.viewDate = startOfMonth(new Date(imported[0].start));
    state.selectedDate = stripTime(new Date(imported[0].start));
    render();
    window.alert(`NASCA予定を${imported.length}件取り込みました。`);
  } catch {
    window.alert("NASCA予定を取り込めませんでした。");
  }
});

document.querySelector("#closeComposer").addEventListener("click", () => {
  eventDialog.close();
});

document.querySelectorAll(".source-toggle input").forEach((input) => {
  input.addEventListener("change", () => {
    state.visibleSources = new Set(
      Array.from(document.querySelectorAll(".source-toggle input:checked")).map((item) => item.value)
    );
    render();
  });
});

document.querySelector("#googleDraftButton").addEventListener("click", () => {
  if (!eventForm.reportValidity()) {
    return;
  }

  const draft = readFormEvent();
  window.open(buildGoogleCalendarUrl(draft), "_blank", "noopener,noreferrer");
});

eventForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!eventForm.reportValidity()) {
    return;
  }

  const draft = readFormEvent();
  const localEvent = {
    ...draft,
    id: `local-${Date.now()}`
  };

  state.localEvents.push(localEvent);
  saveLocalEvents();
  eventDialog.close();
  render();
});

bootstrap();

function bootstrap() {
  state.localEvents = loadLocalEvents();
  state.remoteEvents = Array.isArray(window.FAMILY_CALENDAR_EVENTS)
    ? window.FAMILY_CALENDAR_EVENTS
    : fallbackEvents();

  if (!appConfig.googleSyncUrl) {
    refreshGoogleButton.disabled = true;
    refreshGoogleButton.title = "Google同期URLを設定すると使えます";
  }

  render();

  if (appConfig.googleSyncUrl && appConfig.autoLoadGoogleEvents) {
    refreshGoogleEvents({ sync: false });
  }
}

function render() {
  const monthText = new Intl.DateTimeFormat("ja-JP", { month: "long" }).format(state.viewDate);
  const yearText = new Intl.DateTimeFormat("ja-JP", { year: "numeric" }).format(state.viewDate);
  monthLabel.textContent = monthText;
  yearLabel.textContent = yearText;
  selectedDateLabel.textContent = formatDateHeading(state.selectedDate);

  renderCalendarGrid();
  renderSelectedEvents();
  renderUpcomingEvents();
  renderImportStatus();
}

function renderCalendarGrid() {
  calendarGrid.replaceChildren();

  const first = startOfMonth(state.viewDate);
  const start = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));

  days.forEach((date) => {
    const cell = document.createElement("div");
    const isOutside = date.getMonth() !== state.viewDate.getMonth();
    cell.className = [
      "day-cell",
      isOutside ? "outside" : "",
      isSameDay(date, new Date()) ? "today" : "",
      isSameDay(date, state.selectedDate) ? "selected" : ""
    ].filter(Boolean).join(" ");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-button";
    button.setAttribute("aria-label", formatDateHeading(date));
    button.addEventListener("click", () => {
      state.selectedDate = stripTime(date);
      if (isOutside) {
        state.viewDate = startOfMonth(date);
      }
      render();
    });

    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = date.getDate();
    button.append(number);

    const eventsWrapper = document.createElement("div");
    eventsWrapper.className = "day-events";

    const events = getEventsForDay(date);
    events.slice(0, 3).forEach((item) => {
      const chip = document.createElement("div");
      chip.className = `day-chip ${item.source}`;
      const text = document.createElement("span");
      text.textContent = `${formatEventStart(item)} ${item.title}`;
      chip.append(text);
      eventsWrapper.append(chip);
    });

    if (events.length > 3) {
      const more = document.createElement("div");
      more.className = "more-chip";
      more.textContent = `+${events.length - 3}`;
      eventsWrapper.append(more);
    }

    cell.append(button, eventsWrapper);
    calendarGrid.append(cell);
  });
}

function renderSelectedEvents() {
  const events = getEventsForDay(state.selectedDate);
  renderEventList(selectedEventList, events, "予定なし");
}

function renderUpcomingEvents() {
  const today = stripTime(new Date());
  const events = getVisibleEvents()
    .filter((item) => new Date(item.end) >= today)
    .sort(sortByStart)
    .slice(0, 8);

  renderEventList(upcomingEventList, events, "予定なし");
}

function renderEventList(target, events, emptyText) {
  target.replaceChildren();

  if (events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    target.append(empty);
    return;
  }

  events.forEach((item) => {
    const card = document.createElement("article");
    card.className = `event-card ${item.source}`;

    const time = document.createElement("div");
    time.className = "event-time";

    const range = document.createElement("span");
    range.textContent = formatEventRange(item);

    const source = document.createElement("span");
    source.className = "source-pill";
    source.textContent = SOURCE_LABELS[item.source] || item.source;

    const title = document.createElement("p");
    title.className = "event-title";
    title.textContent = item.title;

    time.append(range, source);
    card.append(time, title);

    if (item.id && (item.id.startsWith("local-") || isNascaEvent(item))) {
      const deleteButton = document.createElement("button");
      deleteButton.className = "event-delete";
      deleteButton.type = "button";
      deleteButton.setAttribute("aria-label", `${item.title}を削除`);
      deleteButton.title = "削除";
      deleteButton.textContent = "x";
      deleteButton.addEventListener("click", () => {
        removeLocalEvent(item.id);
      });
      card.append(deleteButton);
    }

    if (item.note) {
      const note = document.createElement("p");
      note.className = "event-note";
      note.textContent = item.note;
      card.append(note);
    }

    target.append(card);
  });
}

function openComposer(date) {
  eventForm.reset();
  eventTitle.value = "";
  eventDate.value = toDateInputValue(date);
  eventStart.value = "09:00";
  eventEnd.value = "10:00";
  eventSource.value = "family";
  eventDialog.showModal();
  eventTitle.focus();
}

function readFormEvent() {
  const start = new Date(`${eventDate.value}T${eventStart.value}:00`);
  const end = new Date(`${eventDate.value}T${eventEnd.value}:00`);
  const normalizedEnd = end > start ? end : addDays(end, 1);
  const source = eventSource.value;

  return {
    title: source === "work" ? "仕事" : eventTitle.value.trim(),
    start: start.toISOString(),
    end: normalizedEnd.toISOString(),
    source,
    note: source === "work" ? "" : eventNote.value.trim()
  };
}

function getVisibleEvents() {
  return [...state.remoteEvents, ...state.localEvents]
    .filter((item) => state.visibleSources.has(item.source))
    .sort(sortByStart);
}

function getEventsForDay(date) {
  const dayStart = stripTime(date);
  const dayEnd = addDays(dayStart, 1);
  return getVisibleEvents().filter((item) => {
    const start = new Date(item.start);
    const end = new Date(item.end);
    return start < dayEnd && end > dayStart;
  });
}

function saveLocalEvents() {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state.localEvents));
}

function removeLocalEvent(id) {
  state.localEvents = state.localEvents.filter((item) => item.id !== id);
  saveLocalEvents();
  render();
}

function renderImportStatus() {
  const count = state.localEvents.filter((item) => isNascaEvent(item)).length;
  const googleCount = appConfig.googleSyncUrl ? state.remoteEvents.length : 0;
  if (googleCount > 0 && count > 0) {
    importStatus.textContent = `Google予定 ${googleCount}件 / NASCA取込 ${count}件を表示中`;
    return;
  }
  if (googleCount > 0) {
    importStatus.textContent = `Google予定 ${googleCount}件を表示中`;
    return;
  }
  importStatus.textContent = count > 0 ? `NASCA取込 ${count}件を表示中` : "Google同期は未設定";
}

function parseNascaSchedule(content, fileName) {
  const text = content.replace(/^\uFEFF/, "");
  const lowerName = fileName.toLowerCase();
  const parsed = lowerName.endsWith(".ics") || /BEGIN:VEVENT/i.test(text)
    ? parseIcsEvents(text)
    : parseCsvEvents(text);
  return dedupeEvents(parsed).map((item, index) => ({
    id: `nasca-${hashString(`${item.start}|${item.end}`)}-${index}`,
    title: "仕事",
    start: item.start,
    end: item.end,
    source: "work",
    note: ""
  }));
}

function parseIcsEvents(content) {
  const lines = content
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
  const events = [];
  let current = null;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      current = {};
      return;
    }
    if (trimmed === "END:VEVENT") {
      const event = normalizeImportedEvent(current);
      if (event) {
        events.push(event);
      }
      current = null;
      return;
    }
    if (!current) {
      return;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).toUpperCase();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key.startsWith("DTSTART")) {
      current.start = parseIcsDate(value, key.includes("VALUE=DATE"));
    }
    if (key.startsWith("DTEND")) {
      current.end = parseIcsDate(value, key.includes("VALUE=DATE"));
    }
  });

  return events;
}

function parseCsvEvents(content) {
  const rows = parseCsvRows(content);
  if (rows.length === 0) {
    return [];
  }

  const firstRow = rows[0].map((item) => normalizeHeader(item));
  const startIndex = findColumn(firstRow, ["start", "starts at", "start date", "start datetime", "start time", "開始", "開始日時", "開始日", "開始時刻", "開始時間"]);
  const endIndex = findColumn(firstRow, ["end", "ends at", "end date", "end datetime", "end time", "終了", "終了日時", "終了日", "終了時刻", "終了時間"]);
  const dateIndex = findColumn(firstRow, ["date", "day", "日付", "予定日", "年月日"]);
  const hasHeader = startIndex !== -1 && endIndex !== -1;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows.map((row) => {
    const startValue = hasHeader ? row[startIndex] : row[0];
    const endValue = hasHeader ? row[endIndex] : row[1];
    const dateValue = hasHeader && dateIndex !== -1 ? row[dateIndex] : "";
    const start = dateValue && looksLikeTime(startValue)
      ? combineDateAndTime(dateValue, startValue)
      : parseFlexibleDate(startValue);
    const end = dateValue && looksLikeTime(endValue)
      ? combineDateAndTime(dateValue, endValue)
      : parseFlexibleDate(endValue);

    return normalizeImportedEvent({ start, end });
  }).filter(Boolean);
}

function parseCsvRows(content) {
  const delimiter = detectDelimiter(content);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      field += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      row.push(field.trim());
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }
  return rows;
}

function parseIcsDate(value, isAllDay) {
  if (isAllDay || /^\d{8}$/.test(value)) {
    return new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "00", zulu] = match;
  if (zulu) {
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }

  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function parseFlexibleDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const japaneseDate = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2}))?/);
  if (japaneseDate) {
    return new Date(
      Number(japaneseDate[1]),
      Number(japaneseDate[2]) - 1,
      Number(japaneseDate[3]),
      Number(japaneseDate[4] || 0),
      Number(japaneseDate[5] || 0)
    );
  }

  const compactDateTime = text.match(/^(\d{4})(\d{2})(\d{2})[ T]?(\d{2})(\d{2})(\d{2})?$/);
  if (compactDateTime) {
    return new Date(
      Number(compactDateTime[1]),
      Number(compactDateTime[2]) - 1,
      Number(compactDateTime[3]),
      Number(compactDateTime[4]),
      Number(compactDateTime[5]),
      Number(compactDateTime[6] || 0)
    );
  }

  const normalized = text.replace(/\//g, "-").replace(/\s+/, "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function combineDateAndTime(dateValue, timeValue) {
  const date = parseFlexibleDate(dateValue);
  const time = String(timeValue || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!date || !time) {
    return null;
  }

  date.setHours(Number(time[1]), Number(time[2]), 0, 0);
  return date;
}

function normalizeImportedEvent(event) {
  if (!event || !event.start) {
    return null;
  }

  const start = event.start instanceof Date ? event.start : new Date(event.start);
  let end = event.end instanceof Date ? event.end : new Date(event.end);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  if (Number.isNaN(end.getTime())) {
    end = new Date(start);
    end.setHours(end.getHours() + 1);
  }
  if (end <= start) {
    end = addDays(end, 1);
  }

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

function normalizeHeader(value) {
  return String(value || "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function findColumn(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

function looksLikeTime(value) {
  return /^\d{1,2}:\d{2}/.test(String(value || "").trim());
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.start}|${event.end}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isNascaEvent(event) {
  return Boolean(event.id && event.id.startsWith("nasca-"));
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function detectDelimiter(content) {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim()) || "";
  const candidates = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: firstLine.split(delimiter).length
    }))
    .sort((left, right) => right.count - left.count)[0].delimiter;
}

function loadLocalEvents() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildGoogleCalendarUrl(event) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toGoogleDate(event.start)}/${toGoogleDate(event.end)}`,
    details: event.note || "",
    trp: "true"
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function refreshGoogleEvents({ sync }) {
  if (!appConfig.googleSyncUrl) {
    window.alert("Google同期の準備がまだできていません。");
    return;
  }

  const callbackName = `receiveFamilyCalendarEvents${Date.now()}`;
  const script = document.createElement("script");
  const url = new URL(appConfig.googleSyncUrl);
  url.searchParams.set("callback", callbackName);
  url.searchParams.set("t", String(Date.now()));
  if (sync) {
    url.searchParams.set("action", "sync");
  }

  refreshGoogleButton.disabled = true;
  importStatus.textContent = "Google予定を更新中...";

  const timeout = window.setTimeout(() => {
    cleanupGoogleSync(callbackName, script);
    refreshGoogleButton.disabled = false;
    importStatus.textContent = "Google予定の更新に失敗しました";
    window.alert("Google予定を更新できませんでした。");
  }, GOOGLE_SYNC_TIMEOUT_MS);

  window[callbackName] = (payload) => {
    window.clearTimeout(timeout);
    cleanupGoogleSync(callbackName, script);

    if (payload && payload.error) {
      refreshGoogleButton.disabled = false;
      importStatus.textContent = "Google予定の更新に失敗しました";
      window.alert(payload.error);
      return;
    }

    const events = Array.isArray(payload && payload.events) ? payload.events : [];
    state.remoteEvents = events;
    if (events.length > 0) {
      state.viewDate = startOfMonth(new Date(events[0].start));
      state.selectedDate = stripTime(new Date(events[0].start));
    }
    refreshGoogleButton.disabled = false;
    render();
    window.alert(`Google予定を${events.length}件読み込みました。`);
  };

  script.src = url.toString();
  script.onerror = () => {
    window.clearTimeout(timeout);
    cleanupGoogleSync(callbackName, script);
    refreshGoogleButton.disabled = false;
    importStatus.textContent = "Google予定の更新に失敗しました";
    window.alert("Google予定を更新できませんでした。");
  };
  document.body.append(script);
}

function cleanupGoogleSync(callbackName, script) {
  delete window[callbackName];
  if (script.parentNode) {
    script.parentNode.removeChild(script);
  }
}

function formatEventStart(event) {
  return event.allDay ? "終日" : formatTime(event.start);
}

function formatEventRange(event) {
  if (event.allDay) {
    return `${formatShortDate(event.start)} 終日`;
  }
  return `${formatShortDate(event.start)} ${formatTime(event.start)}-${formatTime(event.end)}`;
}

function toGoogleDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function formatDateHeading(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

function formatShortDate(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function isSameDay(left, right) {
  return stripTime(left).getTime() === stripTime(right).getTime();
}

function sortByStart(left, right) {
  return new Date(left.start) - new Date(right.start);
}

function fallbackEvents() {
  const today = stripTime(new Date());
  const makeEvent = (offset, startHour, endHour, title, source, note = "") => {
    const start = addDays(today, offset);
    start.setHours(startHour, 0, 0, 0);
    const end = addDays(today, offset);
    end.setHours(endHour, 0, 0, 0);
    return {
      id: `sample-${offset}-${startHour}`,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      source,
      note
    };
  };

  return [
    makeEvent(0, 9, 18, "仕事", "work"),
    makeEvent(1, 17, 18, "買い物", "family", "帰りに寄る"),
    makeEvent(2, 19, 21, "夕食", "family"),
    makeEvent(4, 10, 11, "歯医者", "personal")
  ];
}
