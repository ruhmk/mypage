const SOURCE_LABELS = {
  family: "家族",
  personal: "個人",
  work: "仕事"
};

const state = {
  viewDate: startOfMonth(new Date()),
  selectedDate: stripTime(new Date()),
  remoteEvents: [],
  visibleSources: new Set(["family", "personal", "work"])
};

const calendarGrid = document.querySelector("#calendarGrid");
const monthLabel = document.querySelector("#monthLabel");
const yearLabel = document.querySelector("#yearLabel");
const selectedDateLabel = document.querySelector("#selectedDateLabel");
const selectedEventList = document.querySelector("#selectedEventList");
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

document.querySelectorAll(".source-toggle input").forEach((input) => {
  input.addEventListener("change", () => {
    state.visibleSources = new Set(
      ["family", ...Array.from(document.querySelectorAll(".source-toggle input:checked")).map((item) => item.value)]
    );
    render();
  });
});

bootstrap();

function bootstrap() {
  state.remoteEvents = Array.isArray(window.FAMILY_CALENDAR_EVENTS)
    ? window.FAMILY_CALENDAR_EVENTS
    : fallbackEvents();

  render();
}

function render() {
  const monthText = new Intl.DateTimeFormat("ja-JP", { month: "long" }).format(state.viewDate);
  const yearText = new Intl.DateTimeFormat("ja-JP", { year: "numeric" }).format(state.viewDate);
  monthLabel.textContent = monthText;
  yearLabel.textContent = yearText;
  selectedDateLabel.textContent = formatDateHeading(state.selectedDate);

  renderCalendarGrid();
  renderSelectedEvents();
  renderImportStatus();
}

function renderCalendarGrid() {
  calendarGrid.replaceChildren();

  const first = startOfMonth(state.viewDate);
  const start = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));

  days.forEach((date) => {
    const cell = document.createElement("button");
    const isOutside = date.getMonth() !== state.viewDate.getMonth();
    cell.type = "button";
    cell.className = [
      "day-cell",
      isOutside ? "outside" : "",
      isSameDay(date, new Date()) ? "today" : "",
      isSameDay(date, state.selectedDate) ? "selected" : ""
    ].filter(Boolean).join(" ");
    cell.setAttribute("aria-label", formatDateHeading(date));
    cell.addEventListener("click", () => {
      state.selectedDate = stripTime(date);
      if (isOutside) {
        state.viewDate = startOfMonth(date);
      }
      render();
    });

    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = date.getDate();

    const eventsWrapper = document.createElement("div");
    eventsWrapper.className = "day-events";

    const events = getEventsForDay(date);
    const eventLimit = 4;
    events.slice(0, eventLimit).forEach((item) => {
      const chip = document.createElement("div");
      chip.className = `day-chip ${item.source}`;
      const text = document.createElement("span");
      text.textContent = `${formatEventStart(item)} ${item.title}`;
      chip.append(text);
      eventsWrapper.append(chip);
    });

    if (events.length > eventLimit) {
      const more = document.createElement("div");
      more.className = "more-chip";
      more.textContent = `+${events.length - eventLimit}`;
      eventsWrapper.append(more);
    }

    cell.append(number, eventsWrapper);
    calendarGrid.append(cell);
  });
}

function renderSelectedEvents() {
  const events = getEventsForDay(state.selectedDate);
  renderEventList(selectedEventList, events, "予定なし");
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

    if (item.note) {
      const note = document.createElement("p");
      note.className = "event-note";
      note.textContent = item.note;
      card.append(note);
    }

    target.append(card);
  });
}

function getVisibleEvents() {
  return state.remoteEvents
    .filter((item) => !isExcludedWorkEvent(item))
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

function renderImportStatus() {
  const googleCount = state.remoteEvents.length;
  if (googleCount > 0) {
    importStatus.textContent = `公開予定 ${googleCount}件を表示中`;
    return;
  }
  importStatus.textContent = "公開予定は未設定";
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

function isExcludedWorkEvent(event) {
  return Boolean(event && event.source === "work" && event.allDay);
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
