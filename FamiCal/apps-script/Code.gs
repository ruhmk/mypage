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
  PERSONAL_MODE: "title",

  // GitHub Pagesのリポジトリです。トークンはコードに書かず、スクリプトプロパティに入れます。
  GITHUB_OWNER: "ruhmk",
  GITHUB_REPO: "ruhmk.github.io",
  GITHUB_BRANCH: "main",
  GITHUB_EVENTS_PATH: "data/events.js"
};

const SCRIPT_VERSION = "direct-display-2026-05-28-1";

function doGet(event) {
  event = event || { parameter: {} };
  const action = String(event.parameter.action || "");
  const callback = sanitizeCallback_(event.parameter.callback);
  let payload;

  try {
    if (action === "calendars") {
      payload = {
        ok: true,
        scriptVersion: SCRIPT_VERSION,
        calendars: listVisibleCalendars_()
      };
    } else if (action === "publish") {
      const updatedAt = new Date().toISOString();
      const events = listDisplayEvents_();
      payload = buildDisplayPayload_(events, updatedAt);
      payload.publish = publishEventsToGitHub_(events, updatedAt);
    } else {
      const updatedAt = new Date().toISOString();
      const events = listDisplayEvents_();
      payload = buildDisplayPayload_(events, updatedAt);
    }
  } catch (error) {
    console.error(error);
    const prefix = action === "publish"
      ? "GitHubへ反映できませんでした。"
      : "Google予定を取得できませんでした。";
    payload = {
      ok: false,
      scriptVersion: SCRIPT_VERSION,
      error: `${prefix}${getErrorMessage_(error)}`,
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

function buildDisplayPayload_(events, updatedAt) {
  return {
    ok: true,
    scriptVersion: SCRIPT_VERSION,
    updatedAt,
    diagnostics: {
      workCount: events.filter((item) => item.source === "work").length,
      personalCount: events.filter((item) => item.source === "personal").length
    },
    events
  };
}

function publishEventsToGitHub_(events, updatedAt) {
  const config = getGitHubConfig_();
  const content = buildEventsJs_(events, updatedAt);
  const existing = getGitHubFile_(config);
  const currentContent = existing && existing.content
    ? Utilities.newBlob(Utilities.base64Decode(existing.content.replace(/\s/g, ""))).getDataAsString("UTF-8")
    : "";

  if (currentContent === content) {
    return {
      changed: false,
      message: "GitHub上のevents.jsは最新です。",
      path: config.path,
      branch: config.branch,
      htmlUrl: existing && existing.html_url ? existing.html_url : ""
    };
  }

  const payload = {
    message: `Update family calendar events ${Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, "yyyy-MM-dd HH:mm")}`,
    content: Utilities.base64Encode(Utilities.newBlob(content, "text/javascript", "events.js").getBytes()),
    branch: config.branch
  };

  if (existing && existing.sha) {
    payload.sha = existing.sha;
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodeGitHubPath_(config.path)}`;
  const response = fetchGitHub_(url, {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  }, config);
  const result = parseGitHubResponse_(response);

  return {
    changed: true,
    message: "GitHubへevents.jsを反映しました。",
    path: config.path,
    branch: config.branch,
    commitSha: result.commit && result.commit.sha ? result.commit.sha : "",
    htmlUrl: result.content && result.content.html_url ? result.content.html_url : ""
  };
}

function buildEventsJs_(events, updatedAt) {
  return `window.FAMILY_CALENDAR_UPDATED_AT = ${JSON.stringify(updatedAt)};\nwindow.FAMILY_CALENDAR_EVENTS = ${JSON.stringify(events, null, 2)};\n`;
}

function getGitHubConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const token = String(properties.getProperty("GITHUB_TOKEN") || "").trim();
  if (!token) {
    throw new Error("Apps Scriptのスクリプトプロパティに GITHUB_TOKEN を設定してください。");
  }

  return {
    token,
    owner: String(properties.getProperty("GITHUB_OWNER") || CONFIG.GITHUB_OWNER).trim(),
    repo: String(properties.getProperty("GITHUB_REPO") || CONFIG.GITHUB_REPO).trim(),
    branch: String(properties.getProperty("GITHUB_BRANCH") || CONFIG.GITHUB_BRANCH).trim(),
    path: String(properties.getProperty("GITHUB_EVENTS_PATH") || CONFIG.GITHUB_EVENTS_PATH).trim()
  };
}

function getGitHubFile_(config) {
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodeGitHubPath_(config.path)}?ref=${encodeURIComponent(config.branch)}`;
  const response = fetchGitHub_(url, { method: "get" }, config);
  if (response.getResponseCode() === 404) {
    return null;
  }
  return parseGitHubResponse_(response);
}

function fetchGitHub_(url, options, config) {
  const requestOptions = options || {};
  requestOptions.muteHttpExceptions = true;
  requestOptions.headers = Object.assign({}, requestOptions.headers || {}, {
    Authorization: `Bearer ${config.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "family-calendar-apps-script"
  });
  return UrlFetchApp.fetch(url, requestOptions);
}

function parseGitHubResponse_(response) {
  const status = response.getResponseCode();
  const text = response.getContentText();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (error) {
    json = {};
  }

  if (status < 200 || status >= 300) {
    throw new Error(`GitHub API ${status}: ${json.message || text || "詳細不明のエラーです。"}`);
  }

  return json;
}

function encodeGitHubPath_(path) {
  return String(path || "").split("/").map(encodeURIComponent).join("/");
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
