const CONFIG = {
  TIME_ZONE: "Asia/Tokyo",
  DAYS_BACK: 7,
  DAYS_FORWARD: 120,

  // NASCAを同期したGoogleカレンダーです。
  // NASCAがサブカレンダーに入っている場合は、そのカレンダーIDに変更してください。
  WORK_SOURCE_CALENDAR_ID: "kitagawa_manabu@qua-vision.com",

  // 個人予定の同期元です。
  PERSONAL_SOURCE_CALENDAR_ID: "respectinspire0805@gmail.com",

  // 同期先の専用カレンダーIDです。個人カレンダー本体とは分けてください。
  FAMILY_CALENDAR_ID: "PASTE_FAMILY_CALENDAR_ID_HERE",

  // "title": 個人予定のタイトルを出す / "busy": すべて「予定あり」にする
  PERSONAL_MODE: "title"
};

function doGet(event) {
  const callback = sanitizeCallback_(event.parameter.callback);
  let payload;

  try {
    if (event.parameter.action === "sync") {
      syncFamilyCalendar_();
    }
    payload = {
      ok: true,
      updatedAt: new Date().toISOString(),
      events: listFamilyEvents_()
    };
  } catch (error) {
    console.error(error);
    payload = {
      ok: false,
      error: "Google予定を更新できませんでした。Apps Scriptの設定とカレンダー共有を確認してください。",
      events: []
    };
  }

  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(payload)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function syncFamilyCalendar_() {
  validateConfig_();

  const syncWindow = getSyncWindow_();
  const desiredEvents = [
    ...readWorkBusyEvents_(syncWindow.start, syncWindow.end),
    ...readPersonalEvents_(syncWindow.start, syncWindow.end)
  ];
  const existingEvents = listManagedFamilyEvents_(syncWindow.start, syncWindow.end);
  const existingByKey = {};
  const desiredKeys = {};

  existingEvents.forEach((event) => {
    const properties = getPrivateProperties_(event);
    if (properties.familySyncKey) {
      existingByKey[properties.familySyncKey] = event;
    }
  });

  desiredEvents.forEach((desired) => {
    desiredKeys[desired.key] = true;
    const resource = toGoogleEventResource_(desired);
    const existing = existingByKey[desired.key];

    if (existing) {
      if (needsUpdate_(existing, resource)) {
        Calendar.Events.patch(resource, CONFIG.FAMILY_CALENDAR_ID, existing.id, {
          sendUpdates: "none"
        });
      }
      return;
    }

    Calendar.Events.insert(resource, CONFIG.FAMILY_CALENDAR_ID, {
      sendUpdates: "none"
    });
  });

  existingEvents.forEach((event) => {
    const properties = getPrivateProperties_(event);
    if (properties.familySyncKey && !desiredKeys[properties.familySyncKey]) {
      Calendar.Events.remove(CONFIG.FAMILY_CALENDAR_ID, event.id, {
        sendUpdates: "none"
      });
    }
  });
}

function readWorkBusyEvents_(timeMin, timeMax) {
  const response = Calendar.Freebusy.query({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    timeZone: CONFIG.TIME_ZONE,
    items: [{ id: CONFIG.WORK_SOURCE_CALENDAR_ID }]
  });
  const calendar = response.calendars && response.calendars[CONFIG.WORK_SOURCE_CALENDAR_ID];
  const busy = calendar && calendar.busy ? calendar.busy : [];

  return busy.map((item) => {
    const start = new Date(item.start);
    const end = new Date(item.end);
    const key = `work:${hash_(`${CONFIG.WORK_SOURCE_CALENDAR_ID}|${item.start}|${item.end}`)}`;
    return {
      key,
      source: "work",
      title: "仕事",
      start,
      end,
      allDay: false
    };
  });
}

function readPersonalEvents_(timeMin, timeMax) {
  const items = listCalendarEvents_(CONFIG.PERSONAL_SOURCE_CALENDAR_ID, timeMin, timeMax);

  return items
    .filter((event) => event.status !== "cancelled")
    .filter((event) => event.transparency !== "transparent")
    .map((event) => {
      const range = getEventRange_(event);
      if (!range) {
        return null;
      }

      const hideTitle = CONFIG.PERSONAL_MODE === "busy" || event.visibility === "private";
      return {
        key: `personal:${hash_(`${CONFIG.PERSONAL_SOURCE_CALENDAR_ID}|${event.id}`)}`,
        source: "personal",
        title: hideTitle ? "予定あり" : (event.summary || "予定あり"),
        start: range.start,
        end: range.end,
        allDay: range.allDay
      };
    })
    .filter(Boolean);
}

function listFamilyEvents_() {
  validateConfig_();

  const syncWindow = getSyncWindow_();
  return listCalendarEvents_(CONFIG.FAMILY_CALENDAR_ID, syncWindow.start, syncWindow.end)
    .filter((event) => event.status !== "cancelled")
    .map((event) => {
      const range = getEventRange_(event);
      if (!range) {
        return null;
      }

      const properties = getPrivateProperties_(event);
      const source = properties.familySyncSource || "family";
      return {
        id: event.id,
        title: event.summary || "予定",
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        source,
        note: "",
        allDay: range.allDay
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(left.start) - new Date(right.start));
}

function listManagedFamilyEvents_(timeMin, timeMax) {
  return listCalendarEvents_(CONFIG.FAMILY_CALENDAR_ID, timeMin, timeMax, {
    privateExtendedProperty: "familySyncManaged=1"
  });
}

function listCalendarEvents_(calendarId, timeMin, timeMax, extraParams) {
  let pageToken;
  const items = [];

  do {
    const params = Object.assign({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
      pageToken
    }, extraParams || {});

    const response = Calendar.Events.list(calendarId, params);
    items.push(...(response.items || []));
    pageToken = response.nextPageToken;
  } while (pageToken);

  return items;
}

function toGoogleEventResource_(event) {
  return {
    summary: event.title,
    start: toGoogleDateResource_(event.start, event.allDay),
    end: toGoogleDateResource_(event.end, event.allDay),
    transparency: "opaque",
    extendedProperties: {
      private: {
        familySyncManaged: "1",
        familySyncKey: event.key,
        familySyncSource: event.source
      }
    }
  };
}

function toGoogleDateResource_(date, allDay) {
  if (allDay) {
    return {
      date: Utilities.formatDate(date, CONFIG.TIME_ZONE, "yyyy-MM-dd")
    };
  }

  return {
    dateTime: date.toISOString(),
    timeZone: CONFIG.TIME_ZONE
  };
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

function needsUpdate_(existing, resource) {
  const existingProperties = getPrivateProperties_(existing);
  const resourceProperties = resource.extendedProperties.private;

  return existing.summary !== resource.summary
    || JSON.stringify(existing.start) !== JSON.stringify(resource.start)
    || JSON.stringify(existing.end) !== JSON.stringify(resource.end)
    || existingProperties.familySyncKey !== resourceProperties.familySyncKey
    || existingProperties.familySyncSource !== resourceProperties.familySyncSource;
}

function getPrivateProperties_(event) {
  return event.extendedProperties && event.extendedProperties.private
    ? event.extendedProperties.private
    : {};
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

function validateConfig_() {
  if (!CONFIG.FAMILY_CALENDAR_ID || CONFIG.FAMILY_CALENDAR_ID === "PASTE_FAMILY_CALENDAR_ID_HERE") {
    throw new Error("FAMILY_CALENDAR_ID is not configured.");
  }
  if (CONFIG.FAMILY_CALENDAR_ID === CONFIG.WORK_SOURCE_CALENDAR_ID) {
    throw new Error("Family calendar must be different from work source calendar.");
  }
  if (CONFIG.FAMILY_CALENDAR_ID === CONFIG.PERSONAL_SOURCE_CALENDAR_ID) {
    throw new Error("Family calendar must be different from personal source calendar.");
  }
}

function sanitizeCallback_(callback) {
  const fallback = "receiveFamilyCalendarEvents";
  return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback || "") ? callback : fallback;
}

function hash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "").slice(0, 18);
}
