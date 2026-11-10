const GOOGLE_SYNC_TIMEOUT_MS = 15000;
const TOKEN_WARNING_DAYS = 14;
const appConfig = window.FAMILY_CALENDAR_CONFIG || {};

const MISSING_URL_MESSAGE = "Apps ScriptのURLが見つかりません。Code.gs の ADMIN_URL を確認し、「直接更新を開く」か毎朝の更新で反映してください。";

const fetchGoogleButton = document.querySelector("#fetchGoogleButton");
const publishGitHubButton = document.querySelector("#publishGitHubButton");
const directPublishLink = document.querySelector("#directPublishLink");
const adminStatus = document.querySelector("#adminStatus");
const adminTokenStatus = document.querySelector("#adminTokenStatus");
const adminPreview = document.querySelector("#adminPreview");

let latestEvents = [];
// Apps ScriptのURLは公開ファイルに書かず、暗号化した予定データの中から取り出す。
// 暗号化前の古いデータのときだけ、data/config.js のURLを使う。
let syncUrl = "";

fetchGoogleButton.addEventListener("click", () => {
  fetchGoogleEvents();
});

publishGitHubButton.addEventListener("click", () => {
  publishGitHubEvents();
});

initSyncUrl();

async function initSyncUrl() {
  fetchGoogleButton.disabled = true;
  publishGitHubButton.disabled = true;

  const encrypted = window.FAMILY_CALENDAR_ENCRYPTED;
  if (encrypted && window.FamiCalCrypto) {
    try {
      const payload = await window.FamiCalCrypto.open(encrypted, { kicker: "Calendar Admin" });
      syncUrl = String(payload.adminUrl || "");
    } catch (error) {
      adminStatus.textContent = error && error.message ? error.message : "予定データを開けませんでした。";
    }
  }
  if (!syncUrl && appConfig.googleSyncUrl) {
    syncUrl = appConfig.googleSyncUrl;
  }

  setupDirectPublishLink();
  if (!syncUrl) {
    adminStatus.textContent = MISSING_URL_MESSAGE;
    return;
  }
  fetchGoogleButton.disabled = false;
  publishGitHubButton.disabled = false;
}

function setupDirectPublishLink() {
  if (!directPublishLink) {
    return;
  }

  if (!syncUrl) {
    directPublishLink.removeAttribute("href");
    directPublishLink.setAttribute("aria-disabled", "true");
    directPublishLink.title = MISSING_URL_MESSAGE;
    return;
  }

  const setFreshUrl = () => {
    const url = new URL(syncUrl);
    url.searchParams.set("action", "publish");
    url.searchParams.set("t", String(Date.now()));
    directPublishLink.href = url.toString();
  };

  directPublishLink.removeAttribute("aria-disabled");
  directPublishLink.removeAttribute("title");
  setFreshUrl();
  directPublishLink.addEventListener("click", setFreshUrl);
}

function fetchGoogleEvents() {
  if (!syncUrl) {
    window.alert(MISSING_URL_MESSAGE);
    return;
  }

  const callbackName = `receiveFamilyCalendarEvents${Date.now()}`;
  const script = document.createElement("script");
  const url = new URL(syncUrl);
  url.searchParams.set("callback", callbackName);
  url.searchParams.set("t", String(Date.now()));

  fetchGoogleButton.disabled = true;
  publishGitHubButton.disabled = true;
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
    renderPreview(latestEvents);

    const diagnostics = payload && payload.diagnostics
      ? `仕事 ${payload.diagnostics.workCount}件 / 手入力終日 ${payload.diagnostics.manualWorkAllDayCount || 0}件 / 個人 ${payload.diagnostics.personalCount}件 / 祝日 ${payload.diagnostics.holidayCount || 0}件`
      : "";
    const source = payload && payload.diagnostics && payload.diagnostics.workCalendarId
      ? ` / 仕事元 ${payload.diagnostics.workCalendarId}`
      : "";
    const version = payload && payload.scriptVersion ? ` / ${payload.scriptVersion}` : "";
    adminStatus.textContent = `取得しました。${latestEvents.length}件 ${diagnostics}${source}${version}`;
    renderTokenStatus(payload && payload.githubToken);
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
  if (!syncUrl) {
    window.alert(MISSING_URL_MESSAGE);
    return;
  }

  const callbackName = `publishFamilyCalendarEvents${Date.now()}`;
  const script = document.createElement("script");
  const url = new URL(syncUrl);
  url.searchParams.set("action", "publish");
  url.searchParams.set("callback", callbackName);
  url.searchParams.set("t", String(Date.now()));

  fetchGoogleButton.disabled = true;
  publishGitHubButton.disabled = true;
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
    renderPreview(latestEvents);

    const publish = payload && payload.publish ? payload.publish : null;
    if (!publish) {
      adminStatus.textContent = "Apps ScriptがGitHub反映に未対応です。Code.gsを更新して再デプロイしてください。";
      return;
    }

    const publishText = publish.changed === false
      ? "GitHub上のevents.jsは最新でした。"
      : publish.encrypted
        ? "GitHubへ暗号化して反映しました。"
        : "GitHubへ反映しました。";
    const pastNote = publish.pastNote ? ` / ${publish.pastNote}` : "";
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
    adminStatus.textContent = `${publishText} ${latestEvents.length}件 ${diagnostics}${mergeText}${pastNote}${source}${version}`;
    renderTokenStatus(payload && payload.githubToken);
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

function renderTokenStatus(status) {
  if (!adminTokenStatus) {
    return;
  }

  adminTokenStatus.hidden = !status;
  adminTokenStatus.classList.remove("warning");
  if (!status) {
    return;
  }

  if (!status.checked) {
    adminTokenStatus.textContent = `GitHubトークンの期限を確認できませんでした。${status.error || ""}`;
    adminTokenStatus.classList.add("warning");
    return;
  }

  if (!status.expiresAt) {
    adminTokenStatus.textContent = "GitHubトークンの期限: なし";
    return;
  }

  const dateText = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tokyo"
  }).format(new Date(status.expiresAt));
  const renewText = "新しいトークンを作り、Apps Scriptのスクリプトプロパティ GITHUB_TOKEN を入れ替えてください。";
  if (status.daysLeft < 0) {
    adminTokenStatus.textContent = `GitHubトークンの期限が切れています（${dateText}）。${renewText}`;
    adminTokenStatus.classList.add("warning");
  } else if (status.daysLeft <= TOKEN_WARNING_DAYS) {
    adminTokenStatus.textContent = `GitHubトークンの期限が近づいています: ${dateText}（あと${status.daysLeft}日）。${renewText}`;
    adminTokenStatus.classList.add("warning");
  } else {
    adminTokenStatus.textContent = `GitHubトークンの期限: ${dateText}（あと${status.daysLeft}日）`;
  }
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
