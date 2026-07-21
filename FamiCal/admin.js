const GOOGLE_SYNC_TIMEOUT_MS = 15000;
const appConfig = window.FAMILY_CALENDAR_CONFIG || {};

const fetchGoogleButton = document.querySelector("#fetchGoogleButton");
const publishGitHubButton = document.querySelector("#publishGitHubButton");
const downloadEventsButton = document.querySelector("#downloadEventsButton");
const directPublishLink = document.querySelector("#directPublishLink");
const adminStatus = document.querySelector("#adminStatus");
const adminPreview = document.querySelector("#adminPreview");

let latestEvents = [];

setupDirectPublishLink();

fetchGoogleButton.addEventListener("click", () => {
  fetchGoogleEvents();
});

publishGitHubButton.addEventListener("click", () => {
  publishGitHubEvents();
});

downloadEventsButton.addEventListener("click", () => {
  downloadEventsJs(latestEvents);
});

function setupDirectPublishLink() {
  if (!directPublishLink) {
    return;
  }

  if (!appConfig.googleSyncUrl) {
    directPublishLink.removeAttribute("href");
    directPublishLink.setAttribute("aria-disabled", "true");
    directPublishLink.title = "data/config.js に Apps Script のURLを入れてください。";
    return;
  }

  const setFreshUrl = () => {
    const url = new URL(appConfig.googleSyncUrl);
    url.searchParams.set("action", "publish");
    url.searchParams.set("t", String(Date.now()));
    directPublishLink.href = url.toString();
  };

  setFreshUrl();
  directPublishLink.addEventListener("click", setFreshUrl);
}

function fetchGoogleEvents() {
  if (!appConfig.googleSyncUrl) {
    window.alert("data/config.js に Apps Script のURLを入れてください。");
    return;
  }

  const callbackName = `receiveFamilyCalendarEvents${Date.now()}`;
  const script = document.createElement("script");
  const url = new URL(appConfig.googleSyncUrl);
  url.searchParams.set("callback", callbackName);
  url.searchParams.set("t", String(Date.now()));

  fetchGoogleButton.disabled = true;
  publishGitHubButton.disabled = true;
  downloadEventsButton.disabled = true;
  adminStatus.textContent = "Google予定を取得中...";

  const timeout = window.setTimeout(() => {
    cleanup(callbackName, script);
    fetchGoogleButton.disabled = false;
    publishGitHubButton.disabled = false;
    adminStatus.textContent = "取得に失敗しました。";
  }, GOOGLE_SYNC_TIMEOUT_MS);

  window[callbackName] = (payload) => {
    window.clearTimeout(timeout);
    cleanup(callbackName, script);

    if (payload && payload.error) {
      fetchGoogleButton.disabled = false;
      publishGitHubButton.disabled = false;
      adminStatus.textContent = payload.error;
      return;
    }

    latestEvents = Array.isArray(payload && payload.events)
      ? payload.events.filter((item) => !isExcludedWorkEvent(item))
      : [];
    fetchGoogleButton.disabled = false;
    downloadEventsButton.disabled = latestEvents.length === 0;
    renderPreview(latestEvents);

    const diagnostics = payload && payload.diagnostics
      ? `仕事 ${payload.diagnostics.workCount}件 / 手入力終日 ${payload.diagnostics.manualWorkAllDayCount || 0}件 / 個人 ${payload.diagnostics.personalCount}件 / 祝日 ${payload.diagnostics.holidayCount || 0}件`
      : "";
    const source = payload && payload.diagnostics && payload.diagnostics.workCalendarId
      ? ` / 仕事元 ${payload.diagnostics.workCalendarId}`
      : "";
    const version = payload && payload.scriptVersion ? ` / ${payload.scriptVersion}` : "";
    adminStatus.textContent = `取得しました。${latestEvents.length}件 ${diagnostics}${source}${version}`;
    publishGitHubButton.disabled = false;
  };

  script.src = url.toString();
  script.onerror = () => {
    window.clearTimeout(timeout);
    cleanup(callbackName, script);
    fetchGoogleButton.disabled = false;
    publishGitHubButton.disabled = false;
    adminStatus.textContent = "取得に失敗しました。";
  };
  document.body.append(script);
}

function publishGitHubEvents() {
  if (!appConfig.googleSyncUrl) {
    window.alert("data/config.js に Apps Script のURLを入れてください。");
    return;
  }

  const callbackName = `publishFamilyCalendarEvents${Date.now()}`;
  const script = document.createElement("script");
  const url = new URL(appConfig.googleSyncUrl);
  url.searchParams.set("action", "publish");
  url.searchParams.set("callback", callbackName);
  url.searchParams.set("t", String(Date.now()));

  fetchGoogleButton.disabled = true;
  publishGitHubButton.disabled = true;
  downloadEventsButton.disabled = true;
  adminStatus.textContent = "Google予定を取得してGitHubへ反映中...";

  const timeout = window.setTimeout(() => {
    cleanup(callbackName, script);
    fetchGoogleButton.disabled = false;
    publishGitHubButton.disabled = false;
    adminStatus.textContent = "GitHubへの反映に失敗しました。";
  }, 30000);

  window[callbackName] = (payload) => {
    window.clearTimeout(timeout);
    cleanup(callbackName, script);

    fetchGoogleButton.disabled = false;
    publishGitHubButton.disabled = false;

    if (payload && payload.error) {
      adminStatus.textContent = payload.error;
      return;
    }

    latestEvents = Array.isArray(payload && payload.events)
      ? payload.events.filter((item) => !isExcludedWorkEvent(item))
      : [];
    downloadEventsButton.disabled = latestEvents.length === 0;
    renderPreview(latestEvents);

    const publish = payload && payload.publish ? payload.publish : null;
    if (!publish) {
      adminStatus.textContent = "Apps ScriptがGitHub反映に未対応です。Code.gsを更新して再デプロイしてください。";
      return;
    }

    const publishText = publish.changed === false
      ? "GitHub上のevents.jsは最新でした。"
      : "GitHubへ反映しました。";
    const mergeText = publish.cutoffDate
      ? ` / ${publish.cutoffDate}以降を更新 / 過去保持 ${publish.preservedCount}件 / 公開 ${publish.publishedCount}件`
      : "";
    const diagnostics = payload && payload.diagnostics
      ? `仕事 ${payload.diagnostics.workCount}件 / 手入力終日 ${payload.diagnostics.manualWorkAllDayCount || 0}件 / 個人 ${payload.diagnostics.personalCount}件 / 祝日 ${payload.diagnostics.holidayCount || 0}件`
      : "";
    const source = payload && payload.diagnostics && payload.diagnostics.workCalendarId
      ? ` / 仕事元 ${payload.diagnostics.workCalendarId}`
      : "";
    const version = payload && payload.scriptVersion ? ` / ${payload.scriptVersion}` : "";
    adminStatus.textContent = `${publishText} ${latestEvents.length}件 ${diagnostics}${mergeText}${source}${version}`;
  };

  script.src = url.toString();
  script.onerror = () => {
    window.clearTimeout(timeout);
    cleanup(callbackName, script);
    fetchGoogleButton.disabled = false;
    publishGitHubButton.disabled = false;
    adminStatus.textContent = "GitHubへの反映に失敗しました。";
  };
  document.body.append(script);
}

function renderPreview(events) {
  adminPreview.replaceChildren();

  if (events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "予定なし";
    adminPreview.append(empty);
    return;
  }

  events.slice(0, 20).forEach((event) => {
    const card = document.createElement("article");
    card.className = `event-card ${event.source}`;

    const time = document.createElement("div");
    time.className = "event-time";
    time.textContent = `${formatShortDate(event.start)} ${event.allDay ? "終日" : `${formatTime(event.start)}-${formatTime(event.end)}`}`;

    const title = document.createElement("p");
    title.className = "event-title";
    title.textContent = event.title;

    card.append(time, title);
    adminPreview.append(card);
  });
}

function downloadEventsJs(events) {
  const body = `window.FAMILY_CALENDAR_UPDATED_AT = ${JSON.stringify(new Date().toISOString())};\nwindow.FAMILY_CALENDAR_EVENTS = ${JSON.stringify(events, null, 2)};\n`;
  const blob = new Blob([body], { type: "text/javascript;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "events.js";
  document.body.append(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function cleanup(callbackName, script) {
  delete window[callbackName];
  if (script.parentNode) {
    script.parentNode.removeChild(script);
  }
}

function isExcludedWorkEvent(event) {
  return Boolean(event && event.source === "work" && event.allDay && !event.manualAllDay);
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}
