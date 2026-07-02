const SOURCE_LABELS = {
  family: "家族",
  personal: "個人",
  work: "仕事"
};

const state = {
  viewDate: startOfMonth(new Date()),
  selectedDate: stripTime(new Date()),
  remoteEvents: [],
  updatedAt: "",
  visibleSources: new Set(["family", "personal", "work"])
};

const calendarGrid = document.querySelector("#calendarGrid");
const monthLabel = document.querySelector("#monthLabel");
const yearLabel = document.querySelector("#yearLabel");
const selectedDateLabel = document.querySelector("#selectedDateLabel");
const selectedEventList = document.querySelector("#selectedEventList");
const importStatus = document.querySelector("#importStatus");
const calendarScroll = document.querySelector("#calendarScroll");
const weekdayScroll = document.querySelector("#weekdayScroll");

if (calendarScroll && weekdayScroll) {
  calendarScroll.addEventListener("scroll", () => {
    weekdayScroll.scrollLeft = calendarScroll.scrollLeft;
  });
}

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
  state.updatedAt = window.FAMILY_CALENDAR_UPDATED_AT || "";

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
  renderDayTimeline(selectedEventList, events, state.selectedDate);
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

function renderDayTimeline(target, events, date) {
  target.replaceChildren();

  if (events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "予定なし";
    target.append(empty);
    return;
  }

  const dayStart = stripTime(date);
  const dayEnd = addDays(dayStart, 1);
  const allDayEvents = events.filter((item) => item.allDay);
  const timedEvents = events
    .filter((item) => !item.allDay)
    .map((item) => getTimelineEvent(item, dayStart, dayEnd))
    .filter(Boolean)
    .sort((left, right) => left.startMinute - right.startMinute);

  if (allDayEvents.length > 0) {
    const allDayGroup = document.createElement("div");
    allDayGroup.className = "timeline-all-day";
    const label = document.createElement("div");
    label.className = "timeline-all-day-label";
    label.textContent = "終日";
    const list = document.createElement("div");
    list.className = "timeline-all-day-list";
    allDayEvents.forEach((item) => {
      list.append(createCompactEventCard(item));
    });
    allDayGroup.append(label, list);
    target.append(allDayGroup);
  }

  if (timedEvents.length === 0) {
    return;
  }

  const baseHourHeight = 46;
  const range = getTimelineRange(timedEvents);
  const laidOutEvents = layoutTimelineEvents(timedEvents);
  let hourBands = buildTimelineHourBands(range, baseHourHeight);
  const shell = document.createElement("div");
  shell.className = "day-timeline";

  const hours = document.createElement("div");
  hours.className = "timeline-hours";

  const stage = document.createElement("div");
  stage.className = "timeline-stage";

  shell.append(hours, stage);
  target.append(shell);

  const blocks = renderTimelineLayout(hours, stage, range, hourBands, laidOutEvents);
  const measuredBands = fitTimelineBandsToContent(range, hourBands, laidOutEvents, blocks);
  if (measuredBands.changed) {
    hourBands = measuredBands.hourBands;
    renderTimelineLayout(hours, stage, range, hourBands, laidOutEvents);
  }
}

function createCompactEventCard(event) {
  const card = document.createElement("article");
  card.className = `event-card ${event.source}`;
  const title = document.createElement("p");
  title.className = "event-title";
  title.textContent = event.title;
  card.append(title);
  return card;
}

function getTimelineEvent(event, dayStart, dayEnd) {
  const rawStart = new Date(event.start);
  const rawEnd = new Date(event.end);
  if (Number.isNaN(rawStart.getTime()) || Number.isNaN(rawEnd.getTime())) {
    return null;
  }

  const start = rawStart < dayStart ? dayStart : rawStart;
  const end = rawEnd > dayEnd ? dayEnd : rawEnd;
  if (end <= start) {
    return null;
  }

  return {
    event,
    start,
    end,
    startMinute: Math.max(0, Math.round((start - dayStart) / 60000)),
    endMinute: Math.min(1440, Math.round((end - dayStart) / 60000))
  };
}

function getTimelineRange(items) {
  const firstMinute = Math.min(...items.map((item) => item.startMinute));
  const lastMinute = Math.max(...items.map((item) => item.endMinute));
  const startHour = Math.max(0, Math.min(6, Math.floor(firstMinute / 60)));
  const endHour = Math.min(24, Math.max(22, Math.ceil(lastMinute / 60)));
  return { startHour, endHour };
}

function layoutTimelineEvents(items) {
  const lanes = [];
  const laidOut = items.map((item) => {
    const laneIndex = lanes.findIndex((laneEnd) => laneEnd <= item.startMinute);
    const lane = laneIndex >= 0 ? laneIndex : lanes.length;
    lanes[lane] = item.endMinute;
    return { ...item, lane };
  });
  const laneCount = Math.max(1, lanes.length);
  return laidOut.map((item) => ({
    ...item,
    laneCount
  }));
}

function renderTimelineLayout(hours, stage, range, hourBands, items) {
  hours.replaceChildren();
  stage.replaceChildren();
  hours.style.height = `${hourBands.totalHeight}px`;
  stage.style.height = `${hourBands.totalHeight}px`;

  hourBands.items.forEach((band) => {
    const label = document.createElement("div");
    label.className = "timeline-hour";
    label.style.top = `${band.top}px`;
    label.textContent = `${String(band.hour).padStart(2, "0")}:00`;
    hours.append(label);

    const line = document.createElement("div");
    line.className = "timeline-line";
    line.style.top = `${band.top}px`;
    stage.append(line);
  });

  const endLine = document.createElement("div");
  endLine.className = "timeline-line";
  endLine.style.top = `${hourBands.totalHeight}px`;
  stage.append(endLine);

  return items.map((item) => {
    const block = createTimelineEventBlock(item, range, hourBands);
    stage.append(block);
    return block;
  });
}

function buildTimelineHourBands(range, baseHourHeight) {
  const bands = Array.from({ length: range.endHour - range.startHour }, (_, index) => ({
    hour: range.startHour + index,
    height: baseHourHeight,
    top: 0
  }));

  return finalizeTimelineHourBands(bands);
}

function finalizeTimelineHourBands(bands) {
  let top = 0;
  bands.forEach((band) => {
    band.top = top;
    top += band.height;
  });

  return {
    items: bands,
    totalHeight: top
  };
}

function fitTimelineBandsToContent(range, hourBands, items, blocks) {
  let changed = false;
  const bands = hourBands.items.map((band) => ({
    hour: band.hour,
    height: band.height,
    top: 0
  }));

  items.forEach((item, index) => {
    const block = blocks[index];
    if (!block) {
      return;
    }

    const currentHeight = getTimelineY(item.endMinute, range, hourBands) - getTimelineY(item.startMinute, range, hourBands);
    const requiredHeight = Math.ceil(block.scrollHeight + 1);
    if (requiredHeight <= currentHeight + 1) {
      return;
    }

    const hour = Math.min(range.endHour - 1, Math.max(range.startHour, Math.floor(item.startMinute / 60)));
    const band = bands[hour - range.startHour];
    const minutesInBand = Math.max(1, Math.min(item.endMinute, (hour + 1) * 60) - Math.max(item.startMinute, hour * 60));
    const neededBandHeight = Math.ceil((requiredHeight * 60) / minutesInBand);
    if (neededBandHeight > band.height) {
      band.height = neededBandHeight;
      changed = true;
    }
  });

  return {
    changed,
    hourBands: changed ? finalizeTimelineHourBands(bands) : hourBands
  };
}

function getTimelineY(minute, range, hourBands) {
  const startMinute = range.startHour * 60;
  const endMinute = range.endHour * 60;
  const clamped = Math.min(endMinute, Math.max(startMinute, minute));
  if (clamped >= endMinute) {
    return hourBands.totalHeight;
  }

  const hour = Math.floor(clamped / 60);
  const band = hourBands.items[hour - range.startHour];
  return band.top + ((clamped - hour * 60) / 60) * band.height;
}

function createTimelineEventBlock(item, range, hourBands) {
  const event = item.event;
  const block = document.createElement("article");
  const top = getTimelineY(item.startMinute, range, hourBands);
  const height = getTimelineY(item.endMinute, range, hourBands) - top;
  const laneWidth = 100 / item.laneCount;
  block.className = `timeline-event ${event.source}`;
  block.style.top = `${top}px`;
  block.style.height = `${height}px`;
  block.style.left = `calc(8px + ${item.lane * laneWidth}%)`;
  block.style.width = `calc(${laneWidth}% - 12px)`;

  const time = document.createElement("div");
  time.className = "timeline-event-time";
  time.textContent = `${formatTime(item.start)}-${formatTime(item.end)}`;

  const title = document.createElement("div");
  title.className = "timeline-event-title";
  title.textContent = event.title;

  block.append(time, title);
  return block;
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
  const latestDateText = formatLatestEventDate(state.remoteEvents);
  const updatedText = formatUpdatedDateTime(state.updatedAt);
  if (latestDateText) {
    importStatus.textContent = `${latestDateText}までの予定を表示中${updatedText ? `\u00a0\u00a0${updatedText}更新` : ""}`;
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

function formatLatestEventDate(events) {
  const latestTime = events
    .filter((event) => !isExcludedWorkEvent(event))
    .map(getEventDisplayEndTime)
    .filter((time) => Number.isFinite(time))
    .reduce((latest, time) => Math.max(latest, time), -Infinity);

  return Number.isFinite(latestTime) ? formatDateCompact(latestTime) : "";
}

function getEventDisplayEndTime(event) {
  if (!event || !event.end) {
    return NaN;
  }

  const end = new Date(event.end);
  if (Number.isNaN(end.getTime())) {
    return NaN;
  }

  if (event.allDay || isMidnight(end)) {
    return end.getTime() - 1;
  }

  return end.getTime();
}

function isMidnight(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    hour12: false,
    timeZone: "Asia/Tokyo"
  }).format(date) === "00:00";
}

function formatUpdatedDateTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    hour12: false,
    timeZone: "Asia/Tokyo"
  }).format(date);
}

function formatDateCompact(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tokyo"
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
