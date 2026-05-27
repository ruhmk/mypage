const CONFIG = {
  TIME_ZONE: "Asia/Tokyo",
  DAYS_BACK: 7,
  DAYS_FORWARD: 120,
  EXCLUDE_WORK_ALL_DAY: true,

  // NASCAを同期したGoogleカレンダーです。
  // カレンダーIDだけでも、Googleカレンダーの埋め込みURLでも使えます。
  WORK_SOURCE_CALENDAR_ID: "kitagawa_manabu@qua-vision.com",

  // 個人予定の同期元です。
  PERSONAL_SOURCE_CALENDAR_ID: "respectinspire0805@gmail.com",

  // "title": 個人予定のタイトルを出す / "busy": すべて「予定あり」にする
  PERSONAL_MODE: "title"
};

const SCRIPT_VERSION = "direct-display-2026-05-27-11";

function doGet(event) {
  event = event || { parameter: {} };
  const callback = sanitizeCallback_(event.parameter.callback);
  let payload;

  try {
    if (event.parameter.action === "calendars") {
      payload = {
        ok: true,
        scriptVersion: SCRIPT_VERSION,
        calendars: listVisibleCalendars_()
      };
    } else {
      const events = listDisplayEvents_();
      payload = {
        ok: true,
        scriptVersion: SCRIPT_VERSION,
        updatedAt: new Date().toISOString(),
        diagnostics: {
          workCount: events.filter((item) => item.source === "work").length,
          personalCount: events.filter((item) => item.source === "personal").length
        },
        events
      };
    }
  } catch (error) {
    console.error(error);
    payload = {
      ok: false,
      scriptVersion: SCRIPT_VERSION,
      error: `Google予定を取得できませんでした。${getErrorMessage_(error)}`,
      events: []
    };
  }

  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(payload)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

function listDisplayEvents_() {
  const syncWindow = getSyncWindow_();
  return [
    ...readWorkEvents_(syncWindow.start, syncWindow.end),
    ...readPersonalEvents_(syncWindow.start, syncWindow.end)
  ].sort((left, right) => new Date(left.start) - new Date(right.start));
}

function readWorkEvents_(timeMin, timeMax) {
  const calendarId = normalizeCalendarId_(CONFIG.WORK_SOURCE_CALENDAR_ID);

  return listCalendarEvents_(calendarId, timeMin, timeMax, "仕事用カレンダー", "items(id,status,transparency,start,end),nextPageToken")
    .filter((event) => event.status !== "cancelled")
    .filter((event) => event.transparency !== "transparent")
    .map((event) => {
      const range = getEventRange_(event);
      if (!range || (CONFIG.EXCLUDE_WORK_ALL_DAY && range.allDay)) {
        return null;
      }

      return {
        id: `work-${hash_(`${calendarId}|${event.id}|${range.start.toISOString()}|${range.end.toISOString()}`)}`,
        title: "仕事",
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        source: "work",
        note: "",
        allDay: false
      };
    })
    .filter(Boolean);
}

function readPersonalEvents_(timeMin, timeMax) {
  const calendarId = normalizeCalendarId_(CONFIG.PERSONAL_SOURCE_CALENDAR_ID);
  return listCalendarEvents_(calendarId, timeMin, timeMax, "個人カレンダー")
    .filter((event) => event.status !== "cancelled")
    .filter((event) => event.transparency !== "transparent")
    .map((event) => {
      const range = getEventRange_(event);
      if (!range) {
        return null;
      }

      const hideTitle = CONFIG.PERSONAL_MODE === "busy" || event.visibility === "private";
      return {
        id: `personal-${hash_(`${calendarId}|${event.id}`)}`,
        title: hideTitle ? "予定あり" : (event.summary || "予定あり"),
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        source: "personal",
        note: "",
        allDay: range.allDay
      };
    })
    .filter(Boolean);
}

function listCalendarEvents_(calendarId, timeMin, timeMax, label, fields) {
  let pageToken;
  const items = [];

  do {
    let response;
    try {
      const params = {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
        pageToken
      };
      if (fields) {
        params.fields = fields;
      }
      response = Calendar.Events.list(calendarId, params);
    } catch (error) {
      throw new Error(`${label || "カレンダー"}を読めません。calendarId=${calendarId} / ${getErrorMessage_(error)}`);
    }
    items.push(...(response.items || []));
    pageToken = response.nextPageToken;
  } while (pageToken);

  return items;
}

function getEventRange_(event) {
  if (!event.start || !event.end) {
    return null;
  }

  const allDay = Boolean(event.start.date);
  const start = toDate_(event.start);
  let end = toDate_(event.end);
  if (!start || !end) {
    return null;
  }
  if (end <= start) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  return { start, end, allDay };
}

function toDate_(value) {
  if (value.dateTime) {
    return new Date(value.dateTime);
  }
  if (value.date) {
    const parts = value.date.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return null;
}

function getSyncWindow_() {
  const start = new Date();
  start.setDate(start.getDate() - CONFIG.DAYS_BACK);
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setDate(end.getDate() + CONFIG.DAYS_FORWARD);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function sanitizeCallback_(callback) {
  return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback || "") ? callback : "";
}

function hash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "").slice(0, 18);
}

function normalizeCalendarId_(value) {
  const text = String(value || "").trim();
  const srcMatch = text.match(/[?&]src=([^&]+)/);
  if (srcMatch) {
    return decodeURIComponent(srcMatch[1]);
  }
  return text;
}

function getErrorMessage_(error) {
  const message = error && error.message ? error.message : String(error);
  return message || "詳細不明のエラーです。";
}

function testCalendarAccess() {
  const syncWindow = getSyncWindow_();
  const result = {
    workCalendarId: normalizeCalendarId_(CONFIG.WORK_SOURCE_CALENDAR_ID),
    personalCalendarId: normalizeCalendarId_(CONFIG.PERSONAL_SOURCE_CALENDAR_ID),
    workEventCount: readWorkEvents_(syncWindow.start, syncWindow.end).length,
    personalEventCount: readPersonalEvents_(syncWindow.start, syncWindow.end).length
  };
  console.log(JSON.stringify(result, null, 2));
}

function listVisibleCalendars_() {
  const calendars = [];
  let pageToken;

  do {
    const response = Calendar.CalendarList.list({
      minAccessRole: "reader",
      pageToken
    });
    calendars.push(...(response.items || []).map((item) => ({
      id: item.id,
      summary: item.summary,
      primary: Boolean(item.primary),
      accessRole: item.accessRole,
      selected: Boolean(item.selected)
    })));
    pageToken = response.nextPageToken;
  } while (pageToken);

  return calendars.sort((left, right) => String(left.summary).localeCompare(String(right.summary), "ja"));
}

function testVisibleCalendars() {
  console.log(JSON.stringify(listVisibleCalendars_(), null, 2));
}
