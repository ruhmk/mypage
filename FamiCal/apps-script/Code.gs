const CONFIG = {
  TIME_ZONE: "Asia/Tokyo",
  DAYS_BACK: 7,
  DAYS_FORWARD: 120,

  // NASCAを同期したGoogleカレンダーです。
  // NASCAがサブカレンダーに入っている場合は、そのカレンダーIDに変更してください。
  WORK_SOURCE_CALENDAR_ID: "kitagawa_manabu@qua-vision.com",

  // 個人予定の同期元です。
  PERSONAL_SOURCE_CALENDAR_ID: "respectinspire0805@gmail.com",

  // "title": 個人予定のタイトルを出す / "busy": すべて「予定あり」にする
  PERSONAL_MODE: "title"
};

function doGet(event) {
  const callback = sanitizeCallback_(event.parameter.callback);
  let payload;

  try {
    payload = {
      ok: true,
      updatedAt: new Date().toISOString(),
      events: listDisplayEvents_()
    };
  } catch (error) {
    console.error(error);
    payload = {
      ok: false,
      error: `Google予定を取得できませんでした。${getErrorMessage_(error)}`,
      events: []
    };
  }

  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(payload)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function listDisplayEvents_() {
  const syncWindow = getSyncWindow_();
  return [
    ...readWorkBusyEvents_(syncWindow.start, syncWindow.end),
    ...readPersonalEvents_(syncWindow.start, syncWindow.end)
  ].sort((left, right) => new Date(left.start) - new Date(right.start));
}

function readWorkBusyEvents_(timeMin, timeMax) {
  const response = Calendar.Freebusy.query({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    timeZone: CONFIG.TIME_ZONE,
    items: [{ id: CONFIG.WORK_SOURCE_CALENDAR_ID }]
  });
  const calendar = response.calendars && response.calendars[CONFIG.WORK_SOURCE_CALENDAR_ID];
  if (calendar && calendar.errors && calendar.errors.length > 0) {
    throw new Error(`仕事用カレンダーを読めません: ${JSON.stringify(calendar.errors)}`);
  }
  const busy = calendar && calendar.busy ? calendar.busy : [];

  return busy.map((item) => ({
    id: `work-${hash_(`${CONFIG.WORK_SOURCE_CALENDAR_ID}|${item.start}|${item.end}`)}`,
    title: "仕事",
    start: new Date(item.start).toISOString(),
    end: new Date(item.end).toISOString(),
    source: "work",
    note: "",
    allDay: false
  }));
}

function readPersonalEvents_(timeMin, timeMax) {
  return listCalendarEvents_(CONFIG.PERSONAL_SOURCE_CALENDAR_ID, timeMin, timeMax)
    .filter((event) => event.status !== "cancelled")
    .filter((event) => event.transparency !== "transparent")
    .map((event) => {
      const range = getEventRange_(event);
      if (!range) {
        return null;
      }

      const hideTitle = CONFIG.PERSONAL_MODE === "busy" || event.visibility === "private";
      return {
        id: `personal-${hash_(`${CONFIG.PERSONAL_SOURCE_CALENDAR_ID}|${event.id}`)}`,
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

function listCalendarEvents_(calendarId, timeMin, timeMax) {
  let pageToken;
  const items = [];

  do {
    const response = Calendar.Events.list(calendarId, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
      pageToken
    });
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
  const fallback = "receiveFamilyCalendarEvents";
  return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback || "") ? callback : fallback;
}

function hash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "").slice(0, 18);
}

function getErrorMessage_(error) {
  const message = error && error.message ? error.message : String(error);
  return message || "詳細不明のエラーです。";
}

function testCalendarAccess() {
  const syncWindow = getSyncWindow_();
  const result = {
    workCalendarId: CONFIG.WORK_SOURCE_CALENDAR_ID,
    personalCalendarId: CONFIG.PERSONAL_SOURCE_CALENDAR_ID,
    workBusyCount: readWorkBusyEvents_(syncWindow.start, syncWindow.end).length,
    personalEventCount: readPersonalEvents_(syncWindow.start, syncWindow.end).length
  };
  console.log(JSON.stringify(result, null, 2));
}
