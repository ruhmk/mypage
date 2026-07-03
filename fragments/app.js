(() => {
  "use strict";

  const DB_NAME = "today-fragments-db";
  const DB_VERSION = 1;
  const STATE_KEY = "today-fragments-state-v1";
  const GITHUB_DEFAULT_PATH = "daily-fragments-sync/data.enc.json";
  const DRIVE_FOLDER = "Today Fragments";
  const DRIVE_FILE = "today-fragments.json";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const GROUP_COLORS = ["#67e8f9", "#ff7aa8", "#ffd166", "#8ff0c4", "#a78bfa"];
  const APP_VERSION = "12";
  const NOTE_CARD_WIDTH = 210;
  const NOTE_CARD_HEIGHT = 62;
  const GROUP_FIT_PADDING = 52;

  const els = {};
  const loadedScripts = new Map();
  const app = {
    data: null,
    settings: null,
    dirty: { notes: {}, groups: {} },
    selected: null,
    view: { x: 0, y: 0, zoom: 1 },
    gl: null,
    drive: { accessToken: "", saving: false, pending: false, connected: false },
    saveTimer: 0,
    driveTimer: 0,
    inspectorTimer: 0,
    pointers: new Map(),
    panStart: null,
    pinchStart: null,
    qrParts: new Map(),
    scanSession: 0,
    dragHoverGroupId: ""
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const nowIso = () => new Date().toISOString();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    collectEls();
    await loadState();
    registerServiceWorker();
    bindWorkspaceEvents();
    if (app.settings.role) {
      startWorkspace();
    } else {
      renderSetup();
    }
  }

  function collectEls() {
    els.setup = $("#setup");
    els.workspace = $("#workspace");
    els.canvas = $("#gl-canvas");
    els.world = $("#world");
    els.groupLayer = $("#group-layer");
    els.cardLayer = $("#card-layer");
    els.roleLabel = $("#role-label");
    els.syncStatus = $("#sync-status");
    els.toolbar = $(".toolbar");
    els.composer = $("#composer");
    els.quickNote = $("#quick-note");
    els.inspector = $("#inspector");
    els.modalRoot = $("#modal-root");
    els.addGroup = $("#add-group");
    els.exportAi = $("#export-ai");
    els.githubSync = $("#github-sync");
    els.pcQr = $("#pc-qr");
    els.phoneImport = $("#phone-import");
    els.trashOpen = $("#trash-open");
    els.settingsOpen = $("#settings-open");
  }

  async function loadState() {
    const stored = await idbGet(STATE_KEY).catch(() => null);
    app.settings = mergeSettings(stored?.settings || {});
    app.data = normalizeData(stored?.data || createEmptyData());
    app.dirty = stored?.dirty || { notes: {}, groups: {} };
    if (!app.settings.deviceId) app.settings.deviceId = uid("device");
    if (!app.data.deviceId) app.data.deviceId = app.settings.deviceId;
  }

  function createEmptyData() {
    const timestamp = nowIso();
    return {
      schemaVersion: 1,
      app: "Today Fragments",
      createdAt: timestamp,
      updatedAt: timestamp,
      deviceId: "",
      notes: [],
      groups: []
    };
  }

  function normalizeData(data) {
    const base = createEmptyData();
    const merged = { ...base, ...data };
    merged.notes = Array.isArray(data.notes) ? data.notes : [];
    merged.groups = Array.isArray(data.groups) ? data.groups : [];
    merged.notes.forEach((note) => {
      note.groupIds = Array.isArray(note.groupIds) ? note.groupIds : [];
      note.x = Number.isFinite(note.x) ? note.x : 0;
      note.y = Number.isFinite(note.y) ? note.y : 0;
      note.createdAt ||= nowIso();
      note.updatedAt ||= note.createdAt;
      note.localDate ||= localDate(note.createdAt);
    });
    merged.groups.forEach((group) => {
      group.x = Number.isFinite(group.x) ? group.x : 0;
      group.y = Number.isFinite(group.y) ? group.y : 0;
      group.w = Number.isFinite(group.w) ? group.w : 320;
      group.h = Number.isFinite(group.h) ? group.h : 220;
      group.createdAt ||= nowIso();
      group.updatedAt ||= group.createdAt;
      group.color ||= GROUP_COLORS[0];
    });
    return merged;
  }

  function mergeSettings(settings) {
    return {
      role: "",
      deviceId: "",
      savePassword: true,
      syncPassword: "",
      drive: {
        clientId: "",
        folderName: DRIVE_FOLDER,
        fileName: DRIVE_FILE,
        folderId: "",
        fileId: "",
        ...(settings.drive || {})
      },
      github: {
        owner: "",
        repo: "",
        branch: "main",
        path: GITHUB_DEFAULT_PATH,
        token: "",
        ...(settings.github || {})
      },
      ...settings
    };
  }

  function renderSetup() {
    document.documentElement.classList.add("setup-mode");
    document.documentElement.classList.remove("workspace-mode");
    document.body.classList.remove("role-phone", "role-pc");
    els.workspace.classList.add("hidden");
    els.setup.classList.remove("hidden");
    els.setup.innerHTML = `
      <div class="setup-wrap">
        <div class="setup-title">
          <h1>Today Fragments</h1>
          <p>今日あったことを雑に置いて、あとから眺めて、必要な時だけAIに渡せる形で残します。</p>
        </div>
        <div class="mode-grid">
          <button class="mode-card" data-mode="phone">
            <strong>スマホで始める</strong>
            <span>Driveを本体にして、GitHub同期とPC取り込みを扱います。</span>
          </button>
          <button class="mode-card" data-mode="pc">
            <strong>PCで使う</strong>
            <span>GitHubの暗号化データを読み、編集差分はQRでスマホへ渡します。</span>
          </button>
        </div>
        <div id="setup-detail"></div>
      </div>
    `;
    $$(".mode-card", els.setup).forEach((button) => {
      button.addEventListener("click", () => renderSetupDetail(button.dataset.mode));
    });
  }

  function renderSetupDetail(mode) {
    const detail = $("#setup-detail", els.setup);
    const g = app.settings.github;
    const d = app.settings.drive;
    if (mode === "phone") {
      detail.innerHTML = `
        <section class="setup-card">
          <h2>スマホ設定</h2>
          <div class="form-grid">
            <div class="form-row">
              <label>Google OAuthクライアントID</label>
              <input id="setup-drive-client" value="${escapeAttr(d.clientId)}" placeholder="xxxxx.apps.googleusercontent.com" />
            </div>
            <div class="form-row">
              <label>同期パスワード</label>
              <input id="setup-password" type="password" value="${escapeAttr(app.settings.syncPassword)}" autocomplete="current-password" />
            </div>
            <div class="field-split">
              <div class="form-row">
                <label>GitHubユーザー/組織</label>
                <input id="setup-gh-owner" value="${escapeAttr(g.owner)}" placeholder="owner" />
              </div>
              <div class="form-row">
                <label>リポジトリ</label>
                <input id="setup-gh-repo" value="${escapeAttr(g.repo)}" placeholder="repo" />
              </div>
            </div>
            <div class="field-split">
              <div class="form-row">
                <label>ブランチ</label>
                <input id="setup-gh-branch" value="${escapeAttr(g.branch)}" placeholder="main" />
              </div>
              <div class="form-row">
                <label>同期ファイル</label>
                <input id="setup-gh-path" value="${escapeAttr(g.path)}" />
              </div>
            </div>
            <div class="form-row">
              <label>GitHubトークン</label>
              <input id="setup-gh-token" type="password" value="${escapeAttr(g.token)}" autocomplete="off" />
            </div>
            <div class="button-row">
              <button id="setup-phone-start" class="primary-button" type="button">開始</button>
              <button id="setup-drive-connect" class="soft-button" type="button">Drive接続</button>
            </div>
            <p id="setup-status" class="status-line"></p>
          </div>
        </section>
      `;
      $("#setup-phone-start").addEventListener("click", async () => {
        readSetupFields("phone");
        app.settings.role = "phone";
        await persistState();
        startWorkspace();
      });
      $("#setup-drive-connect").addEventListener("click", async () => {
        readSetupFields("phone");
        await persistState();
        await connectGoogleDrive($("#setup-status"));
      });
      return;
    }

    detail.innerHTML = `
      <section class="setup-card">
        <h2>PC設定</h2>
        <div class="form-grid">
          <div class="field-split">
            <div class="form-row">
              <label>GitHubユーザー/組織</label>
              <input id="setup-gh-owner" value="${escapeAttr(g.owner)}" placeholder="owner" />
            </div>
            <div class="form-row">
              <label>リポジトリ</label>
              <input id="setup-gh-repo" value="${escapeAttr(g.repo)}" placeholder="repo" />
            </div>
          </div>
          <div class="field-split">
            <div class="form-row">
              <label>ブランチ</label>
              <input id="setup-gh-branch" value="${escapeAttr(g.branch)}" placeholder="main" />
            </div>
            <div class="form-row">
              <label>同期ファイル</label>
              <input id="setup-gh-path" value="${escapeAttr(g.path)}" />
            </div>
          </div>
          <div class="form-row">
            <label>同期パスワード</label>
            <input id="setup-password" type="password" value="${escapeAttr(app.settings.syncPassword)}" autocomplete="current-password" />
          </div>
          <label class="pill"><input id="setup-save-password" type="checkbox" ${app.settings.savePassword ? "checked" : ""} /> パスワードを保存</label>
          <div class="button-row">
            <button id="setup-pc-start" class="primary-button" type="button">読み込んで開始</button>
          </div>
          <p id="setup-status" class="status-line"></p>
        </div>
      </section>
    `;
    $("#setup-pc-start").addEventListener("click", async () => {
      readSetupFields("pc");
      const status = $("#setup-status");
      try {
        status.textContent = "GitHubから読み込み中";
        await loadGithubSnapshot();
        app.settings.role = "pc";
        if (!app.settings.savePassword) app.settings.syncPassword = "";
        await persistState();
        startWorkspace();
      } catch (error) {
        status.textContent = error.message || "読み込みに失敗しました";
      }
    });
  }

  function readSetupFields(role) {
    const github = app.settings.github;
    github.owner = $("#setup-gh-owner")?.value.trim() || "";
    github.repo = $("#setup-gh-repo")?.value.trim() || "";
    github.branch = $("#setup-gh-branch")?.value.trim() || "main";
    github.path = $("#setup-gh-path")?.value.trim() || GITHUB_DEFAULT_PATH;
    if (role === "phone") {
      github.token = $("#setup-gh-token")?.value.trim() || "";
      app.settings.drive.clientId = $("#setup-drive-client")?.value.trim() || "";
    }
    app.settings.savePassword = $("#setup-save-password")?.checked ?? true;
    app.settings.syncPassword = $("#setup-password")?.value || "";
  }

  function startWorkspace() {
    document.documentElement.classList.remove("setup-mode");
    document.documentElement.classList.add("workspace-mode");
    els.setup.classList.add("hidden");
    els.workspace.classList.remove("hidden");
    document.body.classList.toggle("role-phone", app.settings.role === "phone");
    document.body.classList.toggle("role-pc", app.settings.role === "pc");
    els.roleLabel.textContent = app.settings.role === "phone" ? "スマホ本体" : "PCローカル";
    if (!app.view.x && !app.view.y) {
      app.view.x = Math.round(window.innerWidth / 2);
      app.view.y = Math.round(window.innerHeight / 2);
    }
    initWebGl();
    updateWorldTransform();
    renderAll();
    updateStatus();
  }

  function bindWorkspaceEvents() {
    els.composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const body = els.quickNote.value.trim();
      if (!body) return;
      createNote(body);
      els.quickNote.value = "";
      autosizeComposer();
    });
    els.quickNote.addEventListener("input", autosizeComposer);
    els.addGroup.addEventListener("click", createGroup);
    els.exportAi.addEventListener("click", openExportModal);
    els.githubSync.addEventListener("click", syncGithubFromPhone);
    els.pcQr.addEventListener("click", openQrModal);
    els.phoneImport.addEventListener("click", openImportModal);
    els.trashOpen.addEventListener("click", openTrashModal);
    els.settingsOpen.addEventListener("click", openSettingsModal);
    els.workspace.addEventListener("wheel", onWheel, { passive: false });
    els.workspace.addEventListener("pointerdown", onWorkspacePointerDown);
    els.workspace.addEventListener("pointermove", onWorkspacePointerMove);
    els.workspace.addEventListener("pointerup", onWorkspacePointerUp);
    els.workspace.addEventListener("pointercancel", onWorkspacePointerUp);
    window.addEventListener("resize", () => {
      resizeGlCanvas();
      renderAll();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        persistState();
        if (app.settings.role === "phone") saveDriveNow();
      }
    });
  }

  function autosizeComposer() {
    els.quickNote.style.height = "auto";
    els.quickNote.style.height = `${Math.min(160, els.quickNote.scrollHeight)}px`;
  }

  function renderAll() {
    renderGroups();
    renderCards();
    renderInspector();
    updateStatus();
  }

  function renderGroups() {
    const groups = app.data.groups.filter((group) => isVisibleEntity(group));
    els.groupLayer.innerHTML = groups
      .map((group) => {
        const selected = app.selected?.type === "group" && app.selected.id === group.id;
        const cardCount = getGroupNotes(group.id).length;
        const radius = groupRadius(group, cardCount);
        return `
          <article class="group-node ${selected ? "selected" : ""} ${cardCount ? "has-cards" : ""}" data-id="${group.id}" style="left:${group.x}px;top:${group.y}px;width:${group.w}px;height:${group.h}px;--group-color:${group.color};--group-radius:${radius}">
            <span class="group-label">${escapeHtml(group.title || "グループ")}</span>
            <span class="resize-handle" data-resize="${group.id}"></span>
          </article>
        `;
      })
      .join("");
    $$(".group-node", els.groupLayer).forEach((node) => {
      const id = node.dataset.id;
      node.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectEntity("group", id, { render: false });
        const isResize = event.target.closest(".resize-handle");
        beginEntityDrag(event, isResize ? "resize-group" : "group", id);
      });
    });
  }

  function renderCards() {
    const notes = app.data.notes.filter((note) => isVisibleEntity(note));
    els.cardLayer.innerHTML = notes
      .map((note) => {
        const selected = app.selected?.type === "note" && app.selected.id === note.id;
        const title = note.title || deriveTitle(note.body);
        const primaryGroup = getNotePrimaryGroup(note);
        return `
          <article class="note-card ${selected ? "selected" : ""} ${primaryGroup ? "grouped" : ""}" data-id="${note.id}" style="left:${note.x}px;top:${note.y}px;--card-color:${primaryGroup?.color || "#67e8f9"}">
            <h2 class="note-title">${escapeHtml(title || "無題")}</h2>
          </article>
        `;
      })
      .join("");
    $$(".note-card", els.cardLayer).forEach((node) => {
      const id = node.dataset.id;
      node.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectEntity("note", id, { render: false });
        beginEntityDrag(event, "note", id);
      });
    });
  }

  function renderInspector() {
    const selected = getSelectedEntity();
    if (!selected) {
      els.inspector.classList.add("empty");
      els.inspector.innerHTML = "";
      return;
    }
    els.inspector.classList.remove("empty");
    if (app.selected.type === "note") {
      renderNoteInspector(selected);
    } else {
      renderGroupInspector(selected);
    }
  }

  function renderNoteInspector(note) {
    const groupNames = (note.groupIds || [])
      .map((id) => findGroup(id))
      .filter((group) => group && isVisibleEntity(group))
      .map((group) => group.title || "グループ");
    els.inspector.innerHTML = `
      <div class="inspector-head">
        <h2>カード</h2>
        <button class="inspector-close" data-close-inspector type="button" aria-label="閉じる">×</button>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label>タイトル</label>
          <input id="inspect-note-title" value="${escapeAttr(note.title || "")}" placeholder="${escapeAttr(deriveTitle(note.body))}" />
        </div>
        <div class="form-row">
          <label>本文</label>
          <textarea id="inspect-note-body">${escapeHtml(note.body || "")}</textarea>
        </div>
        <div class="pill">${groupNames.length ? escapeHtml(groupNames.join(" / ")) : "未分類"}</div>
        <div class="button-row">
          <button id="inspect-note-trash" class="danger-button" type="button">ゴミ箱へ</button>
        </div>
      </div>
    `;
    $("#inspect-note-title").addEventListener("input", (event) => {
      note.title = event.target.value;
      touchEntity("note", note.id);
      renderCards();
    });
    $("#inspect-note-body").addEventListener("input", (event) => {
      note.body = event.target.value;
      note.localDate = localDate(note.createdAt);
      touchEntity("note", note.id);
      renderCards();
    });
    $("[data-close-inspector]").addEventListener("click", clearSelection);
    $("#inspect-note-trash").addEventListener("click", () => moveToTrash("note", note.id));
  }

  function renderGroupInspector(group) {
    els.inspector.innerHTML = `
      <div class="inspector-head">
        <h2>グループ</h2>
        <button class="inspector-close" data-close-inspector type="button" aria-label="閉じる">×</button>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label>名前</label>
          <input id="inspect-group-title" value="${escapeAttr(group.title || "")}" />
        </div>
        <div class="form-row">
          <label>色</label>
          <select id="inspect-group-color">
            ${GROUP_COLORS.map((color) => `<option value="${color}" ${group.color === color ? "selected" : ""}>${color}</option>`).join("")}
          </select>
        </div>
        <div class="button-row">
          <button id="inspect-group-trash" class="danger-button" type="button">ゴミ箱へ</button>
        </div>
      </div>
    `;
    $("#inspect-group-title").addEventListener("input", (event) => {
      group.title = event.target.value;
      touchEntity("group", group.id);
      renderGroups();
    });
    $("#inspect-group-color").addEventListener("change", (event) => {
      group.color = event.target.value;
      touchEntity("group", group.id);
      renderGroups();
      renderCards();
    });
    $("[data-close-inspector]").addEventListener("click", clearSelection);
    $("#inspect-group-trash").addEventListener("click", () => moveToTrash("group", group.id));
  }

  function createNote(body) {
    const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const timestamp = nowIso();
    const note = {
      id: uid("note"),
      title: "",
      body,
      createdAt: timestamp,
      updatedAt: timestamp,
      localDate: localDate(timestamp),
      x: Math.round(center.x - 115 + Math.random() * 36 - 18),
      y: Math.round(center.y - 58 + Math.random() * 36 - 18),
      groupIds: [],
      trashedAt: "",
      deletedAt: ""
    };
    app.data.notes.push(note);
    selectEntity("note", note.id);
    touchEntity("note", note.id, { alreadyUpdated: true });
    renderAll();
    toast("追加しました");
  }

  function createGroup() {
    const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const timestamp = nowIso();
    const group = {
      id: uid("group"),
      title: "新しいグループ",
      createdAt: timestamp,
      updatedAt: timestamp,
      x: Math.round(center.x - 170),
      y: Math.round(center.y - 120),
      w: 340,
      h: 240,
      color: GROUP_COLORS[app.data.groups.length % GROUP_COLORS.length],
      trashedAt: "",
      deletedAt: ""
    };
    app.data.groups.push(group);
    updateAllNoteGroups(true);
    selectEntity("group", group.id);
    touchEntity("group", group.id, { alreadyUpdated: true });
    renderAll();
  }

  function selectEntity(type, id, options = {}) {
    app.selected = { type, id };
    if (options.render === false) {
      updateSelectionClasses();
      renderInspector();
      return;
    }
    renderAll();
  }

  function clearSelection() {
    app.selected = null;
    renderAll();
  }

  function updateSelectionClasses() {
    $$(".note-card", els.cardLayer).forEach((node) => {
      node.classList.toggle("selected", app.selected?.type === "note" && app.selected.id === node.dataset.id);
    });
    $$(".group-node", els.groupLayer).forEach((node) => {
      node.classList.toggle("selected", app.selected?.type === "group" && app.selected.id === node.dataset.id);
    });
  }

  function getSelectedEntity() {
    if (!app.selected) return null;
    return app.selected.type === "note" ? findNote(app.selected.id) : findGroup(app.selected.id);
  }

  function getGroupNotes(groupId) {
    return app.data.notes.filter((note) => isVisibleEntity(note) && note.groupIds?.includes(groupId));
  }

  function getNotePrimaryGroup(note) {
    return (note.groupIds || []).map((id) => findGroup(id)).find((group) => group && isVisibleEntity(group)) || null;
  }

  function noteBounds(note) {
    return {
      x: note.x,
      y: note.y,
      w: NOTE_CARD_WIDTH,
      h: NOTE_CARD_HEIGHT
    };
  }

  function noteCenter(note) {
    const bounds = noteBounds(note);
    return {
      x: bounds.x + bounds.w / 2,
      y: bounds.y + bounds.h / 2
    };
  }

  function getContainingGroups(note) {
    const center = noteCenter(note);
    return app.data.groups
      .filter((group) => isVisibleEntity(group))
      .filter((group) => center.x >= group.x && center.x <= group.x + group.w && center.y >= group.y && center.y <= group.y + group.h)
      .sort((a, b) => a.w * a.h - b.w * b.h);
  }

  function groupRadius(group, cardCount) {
    const seed = hashNumber(`${group.id}:${cardCount}:${Math.round(group.w)}:${Math.round(group.h)}`);
    const horizontal = group.w >= group.h ? 1 : -1;
    const a = clamp(34 + (seed % 10) + cardCount * 2 + horizontal * 4, 28, 56);
    const b = clamp(30 + ((seed >> 3) % 12) - horizontal * 2, 24, 52);
    const c = clamp(38 + ((seed >> 5) % 10) + horizontal * 2, 28, 58);
    const d = clamp(28 + ((seed >> 7) % 14) + cardCount, 24, 54);
    const e = clamp(28 + ((seed >> 2) % 12), 24, 52);
    const f = clamp(40 + ((seed >> 4) % 12) + horizontal * 2, 28, 58);
    const g = clamp(30 + ((seed >> 6) % 10) + cardCount, 24, 54);
    const h = clamp(38 + ((seed >> 8) % 12) - horizontal * 2, 28, 58);
    return `${a}% ${b}% ${c}% ${d}% / ${e}% ${f}% ${g}% ${h}%`;
  }

  function hashNumber(value) {
    return String(value)
      .split("")
      .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  }

  function beginEntityDrag(event, type, id) {
    const note = type === "note" ? findNote(id) : null;
    const group = type === "group" || type === "resize-group" ? findGroup(id) : null;
    const target = note || group;
    if (!target) return;
    const node = event.currentTarget;
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      // Some mobile browsers are picky about pointer capture; window listeners still keep drag alive.
    }
    node.classList.add("dragging");
    const start = {
      pointerId: event.pointerId,
      type,
      id,
      sx: event.clientX,
      sy: event.clientY,
      x: target.x,
      y: target.y,
      w: target.w,
      h: target.h,
      groupIds: note ? [...(note.groupIds || [])] : [],
      moved: false
    };
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      moveEvent.preventDefault();
      const dx = (moveEvent.clientX - start.sx) / app.view.zoom;
      const dy = (moveEvent.clientY - start.sy) / app.view.zoom;
      start.moved = Math.abs(dx) + Math.abs(dy) > 1;
      if (type === "resize-group") {
        group.w = Math.round(clamp(start.w + dx, 180, 1200));
        group.h = Math.round(clamp(start.h + dy, 140, 900));
        node.style.width = `${group.w}px`;
        node.style.height = `${group.h}px`;
      } else {
        target.x = Math.round(start.x + dx);
        target.y = Math.round(start.y + dy);
        node.style.left = `${target.x}px`;
        node.style.top = `${target.y}px`;
        if (type === "note") updateDropHighlight(note);
      }
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== start.pointerId) return;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      node.classList.remove("dragging");
      clearDropHighlights();
      if (start.moved) {
        if (type === "note") {
          updateNoteGroups(note);
          fitGroupsToCards([...start.groupIds, ...(note.groupIds || [])], { markTouched: true });
          touchEntity("note", id);
        } else {
          touchEntity("group", id);
          updateAllNoteGroups(true);
        }
      }
      renderAll();
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }

  function updateAllNoteGroups(markTouched = false) {
    app.data.notes.filter((note) => isVisibleEntity(note)).forEach((note) => {
      const changed = updateNoteGroups(note);
      if (changed && markTouched) touchEntity("note", note.id);
    });
  }

  function updateNoteGroups(note) {
    const groupIds = getContainingGroups(note).map((group) => group.id);
    const before = (note.groupIds || []).join("|");
    const after = groupIds.join("|");
    note.groupIds = groupIds;
    return before !== after;
  }

  function fitGroupsToCards(groupIds, options = {}) {
    const ids = Array.from(new Set(groupIds.filter(Boolean)));
    ids.forEach((id) => {
      const group = findGroup(id);
      if (!group || !isVisibleEntity(group)) return;
      const notes = getGroupNotes(id);
      if (!notes.length) return;
      const bounds = notes.map(noteBounds);
      const minX = Math.min(...bounds.map((bound) => bound.x));
      const minY = Math.min(...bounds.map((bound) => bound.y));
      const maxX = Math.max(...bounds.map((bound) => bound.x + bound.w));
      const maxY = Math.max(...bounds.map((bound) => bound.y + bound.h));
      const next = {
        x: Math.round(minX - GROUP_FIT_PADDING),
        y: Math.round(minY - GROUP_FIT_PADDING),
        w: Math.round(clamp(maxX - minX + GROUP_FIT_PADDING * 2, 240, 1600)),
        h: Math.round(clamp(maxY - minY + GROUP_FIT_PADDING * 2, 160, 1200))
      };
      const changed = group.x !== next.x || group.y !== next.y || group.w !== next.w || group.h !== next.h;
      if (!changed) return;
      Object.assign(group, next);
      if (options.markTouched) touchEntity("group", id);
    });
  }

  function updateDropHighlight(note) {
    const hoverGroup = getContainingGroups(note)[0] || null;
    const nextId = hoverGroup?.id || "";
    if (app.dragHoverGroupId === nextId) return;
    app.dragHoverGroupId = nextId;
    $$(".group-node", els.groupLayer).forEach((node) => {
      node.classList.toggle("drop-target", node.dataset.id === nextId);
    });
  }

  function clearDropHighlights() {
    app.dragHoverGroupId = "";
    $$(".group-node", els.groupLayer).forEach((node) => node.classList.remove("drop-target"));
  }

  function onWheel(event) {
    if (event.ctrlKey || event.metaKey || event.deltaY) {
      event.preventDefault();
      const before = screenToWorld(event.clientX, event.clientY);
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      app.view.zoom = clamp(app.view.zoom * factor, 0.35, 2.4);
      app.view.x = event.clientX - before.x * app.view.zoom;
      app.view.y = event.clientY - before.y * app.view.zoom;
      updateWorldTransform();
    }
  }

  function onWorkspacePointerDown(event) {
    if (app.selected && isInspectorDismissTarget(event.target)) clearSelection();
    if (!isBackgroundTarget(event.target)) return;
    els.workspace.setPointerCapture(event.pointerId);
    app.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (app.pointers.size === 1) {
      app.panStart = { x: event.clientX, y: event.clientY, vx: app.view.x, vy: app.view.y };
    }
    if (app.pointers.size === 2) {
      app.pinchStart = makePinchState();
    }
  }

  function onWorkspacePointerMove(event) {
    if (!app.pointers.has(event.pointerId)) return;
    app.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (app.pointers.size === 2 && app.pinchStart) {
      const current = makePinchState();
      const worldMid = app.pinchStart.worldMid;
      app.view.zoom = clamp(app.pinchStart.zoom * (current.distance / app.pinchStart.distance), 0.35, 2.4);
      app.view.x = current.mid.x - worldMid.x * app.view.zoom;
      app.view.y = current.mid.y - worldMid.y * app.view.zoom;
      updateWorldTransform();
      return;
    }
    if (app.pointers.size === 1 && app.panStart) {
      app.view.x = app.panStart.vx + event.clientX - app.panStart.x;
      app.view.y = app.panStart.vy + event.clientY - app.panStart.y;
      updateWorldTransform();
    }
  }

  function onWorkspacePointerUp(event) {
    app.pointers.delete(event.pointerId);
    if (app.pointers.size < 2) app.pinchStart = null;
    if (app.pointers.size === 0) app.panStart = null;
  }

  function makePinchState() {
    const points = Array.from(app.pointers.values());
    const a = points[0];
    const b = points[1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return {
      mid,
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: app.view.zoom,
      worldMid: screenToWorld(mid.x, mid.y)
    };
  }

  function isBackgroundTarget(target) {
    return target === els.workspace || target === els.canvas || target === els.world || target.classList.contains("layer");
  }

  function isInspectorDismissTarget(target) {
    if (!target) return false;
    if (target.closest?.(".inspector, .composer, .toolbar, .topbar, .modal-root")) return false;
    if (target.closest?.(".note-card")) return false;
    if (target.closest?.(".group-node")) return isSmallViewport() && app.selected?.type === "note";
    return isBackgroundTarget(target) || Boolean(target.closest?.(".world"));
  }

  function isSmallViewport() {
    return window.matchMedia?.("(max-width: 760px)").matches || window.innerWidth <= 760;
  }

  function updateWorldTransform() {
    els.world.style.transform = `translate(${app.view.x}px, ${app.view.y}px) scale(${app.view.zoom})`;
  }

  function screenToWorld(x, y) {
    return {
      x: (x - app.view.x) / app.view.zoom,
      y: (y - app.view.y) / app.view.zoom
    };
  }

  function touchEntity(type, id, options = {}) {
    const entity = type === "note" ? findNote(id) : findGroup(id);
    if (!entity) return;
    if (!options.alreadyUpdated) entity.updatedAt = nowIso();
    app.data.updatedAt = nowIso();
    if (app.settings.role === "pc") {
      app.dirty[type === "note" ? "notes" : "groups"][id] = entity.updatedAt;
    }
    schedulePersist();
    if (app.settings.role === "phone") scheduleDriveSave();
    updateStatus();
  }

  function moveToTrash(type, id) {
    const entity = type === "note" ? findNote(id) : findGroup(id);
    if (!entity) return;
    entity.trashedAt = nowIso();
    entity.updatedAt = entity.trashedAt;
    if (type === "group") {
      app.data.notes.forEach((note) => {
        if (note.groupIds?.includes(id)) {
          note.groupIds = note.groupIds.filter((groupId) => groupId !== id);
          touchEntity("note", note.id);
        }
      });
    }
    touchEntity(type, id, { alreadyUpdated: true });
    app.selected = null;
    renderAll();
  }

  function restoreEntity(type, id) {
    const entity = type === "note" ? findNote(id) : findGroup(id);
    if (!entity) return;
    entity.trashedAt = "";
    entity.updatedAt = nowIso();
    touchEntity(type, id, { alreadyUpdated: true });
    renderAll();
    openTrashModal();
  }

  function deleteForever(type, id) {
    const entity = type === "note" ? findNote(id) : findGroup(id);
    if (!entity) return;
    entity.deletedAt = nowIso();
    entity.trashedAt = entity.trashedAt || entity.deletedAt;
    entity.updatedAt = entity.deletedAt;
    if (type === "note") {
      entity.title = "";
      entity.body = "";
      entity.groupIds = [];
    } else {
      entity.title = "";
      app.data.notes.forEach((note) => {
        if (note.groupIds?.includes(id)) {
          note.groupIds = note.groupIds.filter((groupId) => groupId !== id);
          touchEntity("note", note.id);
        }
      });
    }
    touchEntity(type, id, { alreadyUpdated: true });
    renderAll();
    openTrashModal();
  }

  function openExportModal() {
    const today = localDate();
    openModal(`
      <div class="modal-head">
        <h2>AI用に書き出し</h2>
        <button class="close-button" data-close type="button">×</button>
      </div>
      <div class="form-grid">
        <div class="field-split">
          <div class="form-row">
            <label>範囲</label>
            <select id="export-range">
              <option value="today">今日だけ</option>
              <option value="period">期間指定</option>
              <option value="all">全部</option>
            </select>
          </div>
          <div class="form-row">
            <label>日付</label>
            <input id="export-start" type="date" value="${today}" />
          </div>
        </div>
        <div class="form-row hidden" id="export-end-wrap">
          <label>終了日</label>
          <input id="export-end" type="date" value="${today}" />
        </div>
        <textarea id="export-output" class="output-box" readonly></textarea>
        <div class="button-row">
          <button id="copy-export" class="primary-button" type="button">コピー</button>
        </div>
      </div>
    `);
    const range = $("#export-range");
    const start = $("#export-start");
    const end = $("#export-end");
    const endWrap = $("#export-end-wrap");
    const output = $("#export-output");
    const refresh = () => {
      endWrap.classList.toggle("hidden", range.value !== "period");
      output.value = buildAiExport(range.value, start.value, end.value);
    };
    [range, start, end].forEach((input) => input.addEventListener("input", refresh));
    $("#copy-export").addEventListener("click", async () => {
      await navigator.clipboard.writeText(output.value);
      toast("コピーしました");
    });
    refresh();
  }

  function buildAiExport(range, start, end) {
    const notes = app.data.notes
      .filter((note) => isVisibleEntity(note))
      .filter((note) => {
        if (range === "all") return true;
        const date = note.localDate || localDate(note.createdAt);
        if (range === "today") return date === localDate();
        return date >= start && date <= end;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const groups = app.data.groups.filter((group) => isVisibleEntity(group));
    const groupById = Object.fromEntries(groups.map((group) => [group.id, group]));
    const md = notes
      .map((note) => {
        const names = (note.groupIds || []).map((id) => groupById[id]?.title).filter(Boolean);
        return [
          `### ${note.title || deriveTitle(note.body) || "無題"}`,
          `- 日時: ${formatDateTime(note.createdAt)}`,
          `- グループ: ${names.length ? names.join(", ") : "未分類"}`,
          "",
          note.body || ""
        ].join("\n");
      })
      .join("\n\n");
    const json = JSON.stringify(
      {
        exportedAt: nowIso(),
        range,
        notes,
        groups
      },
      null,
      2
    );
    return [
      "以下は、私の今日/日々の断片メモです。",
      "セカンドブレインとして扱い、カテゴリ分け、関係性、繰り返し出ているテーマ、次に考えるとよさそうな問いを整理してください。",
      "事実と推測を分け、元メモのニュアンスを壊さないでください。",
      "",
      "# Markdown素材",
      md || "対象メモなし",
      "",
      "# JSON",
      "```json",
      json,
      "```"
    ].join("\n");
  }

  function openSettingsModal() {
    const g = app.settings.github;
    const d = app.settings.drive;
    const phoneFields =
      app.settings.role === "phone"
        ? `
          <div class="form-row">
            <label>Google OAuthクライアントID</label>
            <input id="settings-drive-client" value="${escapeAttr(d.clientId)}" />
          </div>
          <div class="form-row">
            <label>GitHubトークン</label>
            <input id="settings-gh-token" type="password" value="${escapeAttr(g.token)}" />
          </div>
        `
        : "";
    openModal(`
      <div class="modal-head">
        <h2>設定</h2>
        <button class="close-button" data-close type="button">×</button>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label>同期パスワード</label>
          <input id="settings-password" type="password" value="${escapeAttr(app.settings.syncPassword)}" />
        </div>
        <div class="field-split">
          <div class="form-row">
            <label>GitHubユーザー/組織</label>
            <input id="settings-gh-owner" value="${escapeAttr(g.owner)}" />
          </div>
          <div class="form-row">
            <label>リポジトリ</label>
            <input id="settings-gh-repo" value="${escapeAttr(g.repo)}" />
          </div>
        </div>
        <div class="field-split">
          <div class="form-row">
            <label>ブランチ</label>
            <input id="settings-gh-branch" value="${escapeAttr(g.branch)}" />
          </div>
          <div class="form-row">
            <label>同期ファイル</label>
            <input id="settings-gh-path" value="${escapeAttr(g.path)}" />
          </div>
        </div>
        ${phoneFields}
        <div class="button-row">
          <button id="settings-save" class="primary-button" type="button">保存</button>
          ${
            app.settings.role === "phone"
              ? '<button id="settings-drive-connect" class="soft-button" type="button">Drive接続</button><button id="settings-github-test" class="soft-button" type="button">GitHub確認</button>'
              : '<button id="settings-github-load" class="soft-button" type="button">GitHubから再読込</button>'
          }
        </div>
        <p id="settings-status" class="status-line"></p>
      </div>
    `);
    $("#settings-save").addEventListener("click", async () => {
      readSettingsModal();
      await persistState();
      toast("保存しました");
    });
    $("#settings-drive-connect")?.addEventListener("click", async () => {
      readSettingsModal();
      await persistState();
      await connectGoogleDrive($("#settings-status"));
    });
    $("#settings-github-test")?.addEventListener("click", async () => {
      readSettingsModal();
      const status = $("#settings-status");
      try {
        status.textContent = "GitHub確認中";
        status.textContent = await testGithubConnection();
        await persistState();
      } catch (error) {
        status.textContent = error.message || "GitHub確認に失敗しました";
      }
    });
    $("#settings-github-load")?.addEventListener("click", async () => {
      readSettingsModal();
      const status = $("#settings-status");
      try {
        status.textContent = "読み込み中";
        await loadGithubSnapshot();
        await persistState();
        renderAll();
        status.textContent = "読み込みました";
      } catch (error) {
        status.textContent = error.message || "読み込みに失敗しました";
      }
    });
  }

  function readSettingsModal() {
    app.settings.syncPassword = $("#settings-password")?.value || "";
    app.settings.github.owner = $("#settings-gh-owner")?.value.trim() || "";
    app.settings.github.repo = $("#settings-gh-repo")?.value.trim() || "";
    app.settings.github.branch = $("#settings-gh-branch")?.value.trim() || "main";
    app.settings.github.path = $("#settings-gh-path")?.value.trim() || GITHUB_DEFAULT_PATH;
    if (app.settings.role === "phone") {
      app.settings.drive.clientId = $("#settings-drive-client")?.value.trim() || "";
      app.settings.github.token = $("#settings-gh-token")?.value.trim() || "";
    }
  }

  function openTrashModal() {
    const notes = app.data.notes.filter((note) => note.trashedAt && !note.deletedAt);
    const groups = app.data.groups.filter((group) => group.trashedAt && !group.deletedAt);
    const items = [
      ...notes.map((note) => ({ type: "note", id: note.id, title: note.title || deriveTitle(note.body), body: compactBody(note.body, 90) })),
      ...groups.map((group) => ({ type: "group", id: group.id, title: group.title || "グループ", body: "グループ" }))
    ];
    openModal(`
      <div class="modal-head">
        <h2>ゴミ箱</h2>
        <button class="close-button" data-close type="button">×</button>
      </div>
      <div class="list-stack">
        ${
          items.length
            ? items
                .map(
                  (item) => `
                    <div class="list-item">
                      <strong>${escapeHtml(item.title || "無題")}</strong>
                      <p class="status-line">${escapeHtml(item.body || "")}</p>
                      <div class="button-row">
                        <button class="soft-button" data-restore="${item.type}:${item.id}" type="button">戻す</button>
                        <button class="danger-button" data-delete="${item.type}:${item.id}" type="button">完全削除</button>
                      </div>
                    </div>
                  `
                )
                .join("")
            : '<p class="status-line">空です</p>'
        }
      </div>
    `);
    $$("[data-restore]").forEach((button) => {
      button.addEventListener("click", () => {
        const [type, id] = button.dataset.restore.split(":");
        restoreEntity(type, id);
      });
    });
    $$("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const [type, id] = button.dataset.delete.split(":");
        deleteForever(type, id);
      });
    });
  }

  async function connectGoogleDrive(statusEl) {
    if (!app.settings.drive.clientId) {
      statusEl.textContent = "Google OAuthクライアントIDを入れてください";
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      statusEl.textContent = "Googleの認可画面を読み込めませんでした";
      return;
    }
    statusEl.textContent = "Drive接続中";
    await new Promise((resolve, reject) => {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: app.settings.drive.clientId,
        scope: DRIVE_SCOPE,
        callback: async (response) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          app.drive.accessToken = response.access_token;
          app.drive.connected = true;
          try {
            await ensureDriveFile();
            await persistState();
            statusEl.textContent = "Driveに接続しました";
            renderAll();
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      });
      tokenClient.requestAccessToken({ prompt: "consent" });
    }).catch((error) => {
      statusEl.textContent = error.message || "Drive接続に失敗しました";
    });
  }

  async function ensureDriveFile() {
    const drive = app.settings.drive;
    const folder = await findOrCreateDriveFolder(drive.folderName || DRIVE_FOLDER);
    drive.folderId = folder.id;
    const file = await findDriveFile(drive.fileName || DRIVE_FILE, folder.id);
    if (file) {
      drive.fileId = file.id;
      const remote = await driveFetchJson(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
      const result = mergeData(remote, { markDirty: false });
      if (result.changed) {
        toast(`Driveから${result.changed}件取り込みました`);
      }
      await saveDriveNow();
      return;
    }
    drive.fileId = await createDriveJsonFile(drive.fileName || DRIVE_FILE, folder.id, sanitizeData(app.data));
  }

  async function findOrCreateDriveFolder(name) {
    const query = encodeURIComponent(`name = '${escapeDriveQuery(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const result = await driveFetchJson(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`);
    if (result.files?.[0]) return result.files[0];
    const created = await driveFetchJson("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" })
    });
    return created;
  }

  async function findDriveFile(name, folderId) {
    const query = encodeURIComponent(`name = '${escapeDriveQuery(name)}' and '${folderId}' in parents and trashed = false`);
    const result = await driveFetchJson(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime)`);
    return result.files?.[0] || null;
  }

  async function createDriveJsonFile(name, folderId, data) {
    const boundary = `tf_${Date.now()}`;
    const metadata = { name, parents: [folderId], mimeType: "application/json" };
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(data, null, 2),
      `--${boundary}--`
    ].join("\r\n");
    const created = await driveFetchJson("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    });
    return created.id;
  }

  function scheduleDriveSave() {
    if (app.settings.role !== "phone") return;
    app.drive.pending = true;
    updateStatus();
    clearTimeout(app.driveTimer);
    app.driveTimer = window.setTimeout(saveDriveNow, 900);
  }

  async function saveDriveNow() {
    if (app.settings.role !== "phone") return;
    if (!app.drive.accessToken || !app.settings.drive.fileId) {
      app.drive.pending = true;
      updateStatus();
      return;
    }
    app.drive.saving = true;
    updateStatus();
    try {
      await driveFetchJson(`https://www.googleapis.com/upload/drive/v3/files/${app.settings.drive.fileId}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(sanitizeData(app.data), null, 2)
      });
      app.drive.pending = false;
    } catch (error) {
      app.drive.pending = true;
      console.warn(error);
    } finally {
      app.drive.saving = false;
      updateStatus();
    }
  }

  async function driveFetchJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${app.drive.accessToken}`,
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`Drive ${response.status}`);
    return response.json();
  }

  async function syncGithubFromPhone() {
    if (app.settings.role !== "phone") return;
    try {
      requireGithubSettings(true);
      requirePassword();
      els.syncStatus.textContent = "GitHub同期中";
      const envelope = await encryptObject(sanitizeData(app.data), app.settings.syncPassword);
      const content = bytesToBase64(utf8(JSON.stringify(envelope, null, 2)));
      const sha = await getGithubFileSha().catch(() => "");
      const body = {
        message: `Update Today Fragments sync ${new Date().toISOString()}`,
        content,
        branch: app.settings.github.branch || "main"
      };
      if (sha) body.sha = sha;
      const response = await fetch(githubApiUrl(), {
        method: "PUT",
        headers: githubHeaders(true),
        body: JSON.stringify(body)
      });
      if (!response.ok) throw await makeGithubError(response);
      toast("GitHub同期しました");
    } catch (error) {
      toast(error.message || "GitHub同期に失敗しました");
    } finally {
      updateStatus();
    }
  }

  async function loadGithubSnapshot() {
    requireGithubSettings(false);
    requirePassword();
    const g = app.settings.github;
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/${encodeURIComponent(g.branch || "main")}/${g.path}?t=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("先にスマホでGitHub同期してください");
    const envelope = await response.json();
    const remoteData = await decryptObject(envelope, app.settings.syncPassword);
    mergeData(remoteData, { markDirty: false });
  }

  async function getGithubFileSha() {
    const response = await fetch(`${githubApiUrl()}?ref=${encodeURIComponent(app.settings.github.branch || "main")}`, {
      headers: githubHeaders(true)
    });
    if (!response.ok) return "";
    const json = await response.json();
    return json.sha || "";
  }

  async function testGithubConnection() {
    requireGithubSettings(true);
    const g = app.settings.github;
    const branch = g.branch || "main";
    const checked = `${g.owner}/${g.repo} / ${branch} / ${g.path}`;

    const repoResponse = await fetch(githubRepoApiUrl(), {
      headers: githubHeaders(true)
    });
    if (!repoResponse.ok) throw await makeGithubError(repoResponse);

    const branchResponse = await fetch(`${githubRepoApiUrl()}/branches/${encodeURIComponent(branch)}`, {
      headers: githubHeaders(true)
    });
    if (!branchResponse.ok) {
      if (branchResponse.status === 404) {
        throw new Error(`GitHubリポジトリは見えますが、ブランチ「${branch}」が見つかりません。\n確認した設定: ${checked}`);
      }
      throw await makeGithubError(branchResponse);
    }

    const fileResponse = await fetch(`${githubApiUrl()}?ref=${encodeURIComponent(branch)}`, {
      headers: githubHeaders(true)
    });
    if (fileResponse.ok) return `GitHub確認OK\n確認した設定: ${checked}\n同期ファイルも見つかりました`;
    if (fileResponse.status === 404) {
      return `GitHub確認OK\n確認した設定: ${checked}\n同期ファイルはまだありません。次のGitHub同期で作成できます`;
    }
    throw await makeGithubError(fileResponse);
  }

  async function makeGithubError(response) {
    let detail = "";
    try {
      const json = await response.json();
      detail = json.message || "";
    } catch {
      detail = "";
    }
    if (response.status === 404) {
      return new Error(
        [
          "GitHub 404: リポジトリが見つからないか、トークンに権限がありません。",
          "GitHubユーザー/組織はメールアドレスではなく、リポジトリURLの名前を入れてください。",
          "例: https://github.com/example/today-fragments なら example / today-fragments です。",
          "ブランチ名と、トークンの Contents: Read and write も確認してください。"
        ].join("\n")
      );
    }
    if (response.status === 401 || response.status === 403) {
      return new Error(
        [
          "GitHub認証に失敗しました。",
          detail ? `GitHubからの理由: ${detail}` : "",
          "スマホの設定に入っているトークン文字列、対象リポジトリ、ブランチを確認してください。",
          "Fine-grained tokenは、対象リポジトリと Contents: Read and write 権限が必要です。",
          "会社/組織リポジトリの場合は、組織承認が必要なことがあります。"
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
    return new Error(`GitHub ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  function githubApiUrl() {
    const g = app.settings.github;
    return `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/contents/${g.path.split("/").map(encodeURIComponent).join("/")}`;
  }

  function githubRepoApiUrl() {
    const g = app.settings.github;
    return `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}`;
  }

  function githubHeaders(needsToken) {
    const headers = {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    };
    if (needsToken) headers.Authorization = `Bearer ${app.settings.github.token}`;
    return headers;
  }

  function requireGithubSettings(needsToken) {
    const g = app.settings.github;
    if (!g.owner || !g.repo || !g.path) throw new Error("GitHub設定が足りません");
    if (needsToken && !g.token) throw new Error("GitHubトークンが必要です");
  }

  function requirePassword() {
    if (!app.settings.syncPassword) throw new Error("同期パスワードが必要です");
  }

  async function openQrModal() {
    if (app.settings.role !== "pc") return;
    try {
      requirePassword();
      const delta = buildDirtyDelta();
      if (!delta.notes.length && !delta.groups.length) {
        toast("未同期の変更はありません");
        return;
      }
      const envelope = await encryptObject(delta, app.settings.syncPassword);
      const payload = bytesToBase64Url(utf8(JSON.stringify(envelope)));
      const sessionId = uid("qr").replace(/_/g, "");
      const chunks = chunkString(payload, 300);
      let index = 0;
      openModal(`
        <div class="modal-head">
          <h2>QRでスマホへ</h2>
          <button class="close-button" data-close type="button">×</button>
        </div>
        <div class="qr-wrap"><canvas id="qr-canvas"></canvas><textarea id="qr-fallback" class="output-box hidden" readonly></textarea></div>
        <p id="qr-count" class="status-line"></p>
        <div class="button-row">
          <button id="qr-prev" class="soft-button" type="button">前へ</button>
          <button id="qr-next" class="primary-button" type="button">次へ</button>
          <button id="qr-clear" class="soft-button" type="button">送信済みにする</button>
        </div>
      `);
      const render = async () => {
        const frame = `TFQR1.${sessionId}.${index + 1}.${chunks.length}.${chunks[index]}`;
        $("#qr-count").textContent = `${index + 1} / ${chunks.length}`;
        $("#qr-prev").disabled = index === 0;
        $("#qr-next").disabled = index === chunks.length - 1;
        const canvas = $("#qr-canvas");
        const fallback = $("#qr-fallback");
        if (window.QRCode?.toCanvas) {
          fallback.classList.add("hidden");
          canvas.classList.remove("hidden");
          await window.QRCode.toCanvas(canvas, frame, { width: 360, margin: 2, errorCorrectionLevel: "M" });
        } else if (window.qrcode) {
          fallback.classList.add("hidden");
          canvas.classList.remove("hidden");
          drawQrToCanvas(canvas, frame);
        } else {
          canvas.classList.add("hidden");
          fallback.classList.remove("hidden");
          fallback.value = frame;
        }
      };
      $("#qr-prev").addEventListener("click", () => {
        index = Math.max(0, index - 1);
        render();
      });
      $("#qr-next").addEventListener("click", () => {
        index = Math.min(chunks.length - 1, index + 1);
        render();
      });
      $("#qr-clear").addEventListener("click", async () => {
        app.dirty = { notes: {}, groups: {} };
        await persistState();
        closeModal();
        updateStatus();
        toast("未同期を消しました");
      });
      await render();
    } catch (error) {
      toast(error.message || "QRを作れませんでした");
    }
  }

  function drawQrToCanvas(canvas, text) {
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 4;
    const cssSize = 360;
    const scale = Math.max(2, Math.floor(cssSize / (count + margin * 2)));
    const size = (count + margin * 2) * scale;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#05070c";
    for (let y = 0; y < count; y += 1) {
      for (let x = 0; x < count; x += 1) {
        if (qr.isDark(y, x)) {
          context.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
        }
      }
    }
  }

  function buildDirtyDelta() {
    const noteIds = new Set(Object.keys(app.dirty.notes || {}));
    const groupIds = new Set(Object.keys(app.dirty.groups || {}));
    return {
      type: "today-fragments-delta",
      schemaVersion: 1,
      createdAt: nowIso(),
      fromDeviceId: app.settings.deviceId,
      notes: app.data.notes.filter((note) => noteIds.has(note.id)),
      groups: app.data.groups.filter((group) => groupIds.has(group.id))
    };
  }

  function openImportModal() {
    if (app.settings.role !== "phone") return;
    openModal(`
      <div class="modal-head">
        <h2>PCから取り込み</h2>
        <button class="close-button" data-close type="button">×</button>
      </div>
      <video id="scan-video" class="scan-video" autoplay playsinline webkit-playsinline muted></video>
      <p id="scan-status" class="status-line">iOSでは「カメラ開始」を押して起動してください</p>
      <div class="form-row">
        <label>貼り付け取り込み</label>
        <textarea id="scan-paste" placeholder="QRの文字列"></textarea>
      </div>
      <div class="button-row">
        <button id="scan-start" class="primary-button" type="button">カメラ開始</button>
        <button id="scan-apply-paste" class="soft-button" type="button">貼り付けを読む</button>
      </div>
    `);
    $("#scan-start").addEventListener("click", startQrScan);
    $("#scan-apply-paste").addEventListener("click", () => handleQrText($("#scan-paste").value.trim(), { manual: true }));
  }

  async function startQrScan() {
    const status = $("#scan-status");
    const video = $("#scan-video");
    app.scanSession += 1;
    const session = app.scanSession;
    stopScanStream();
    if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      status.textContent = "カメラはHTTPSで開いた時だけ使えます。GitHub Pagesのhttps URLで開いてください";
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = "このブラウザではカメラを開けません。貼り付け取り込みを使ってください";
      return;
    }
    try {
      status.textContent = "カメラ確認中";
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      const stream = await openCameraStream();
      if (session !== app.scanSession) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      status.textContent = "QR読取準備中";
      const hasReader = await ensureQrReader();
      if (session !== app.scanSession) return;
      status.textContent = "読み取り中";
      if (window.jsQR) {
        scanWithJsQr(video, status, session);
      } else if ("BarcodeDetector" in window) {
        scanWithBarcodeDetector(video, status, session);
      } else {
        status.textContent = hasReader
          ? "QR読取を開始できませんでした。貼り付け取り込みを使ってください"
          : "QR読取ライブラリを読み込めませんでした。vendor/jsQR.jsがGitHub Pagesに上がっているか確認してください";
      }
    } catch (error) {
      status.textContent = cameraErrorMessage(error);
    }
  }

  async function ensureQrReader() {
    if (window.jsQR) return true;
    const sources = [
      `vendor/jsQR.js?v=${APP_VERSION}`,
      "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"
    ];
    for (const source of sources) {
      try {
        await loadScriptOnce(source);
        if (window.jsQR) return true;
      } catch (error) {
        console.warn(`QR reader load failed: ${source}`, error);
      }
    }
    return Boolean(window.jsQR);
  }

  function loadScriptOnce(source) {
    if (loadedScripts.has(source)) return loadedScripts.get(source);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      script.async = true;
      script.src = source;
      script.onload = () => finish(resolve);
      script.onerror = () => finish(reject, new Error(`script load failed: ${source}`));
      document.head.appendChild(script);
      window.setTimeout(() => finish(reject, new Error(`script load timed out: ${source}`)), 8000);
    });
    loadedScripts.set(source, promise);
    return promise;
  }

  async function openCameraStream() {
    const attempts = [
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      { video: true, audio: false }
    ];
    let lastError = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("camera unavailable");
  }

  function cameraErrorMessage(error) {
    const name = error?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "カメラ権限が許可されませんでした。Safari/ブラウザのサイト設定でカメラを許可してください";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "利用できるカメラが見つかりませんでした";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "カメラを起動できませんでした。別アプリでカメラを使っていないか確認してください";
    }
    if (name === "SecurityError") {
      return "カメラはHTTPSで開いた時だけ使えます。GitHub Pagesのhttps URLで開いてください";
    }
    return `カメラを開けませんでした${name ? `: ${name}` : ""}。貼り付け取り込みを使ってください`;
  }

  function scanWithBarcodeDetector(video, status, session) {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    let lastValue = "";
    const tick = async () => {
      if (!video.srcObject || session !== app.scanSession) return;
      try {
        const codes = await detector.detect(video);
        const value = codes[0]?.rawValue || "";
        if (value && value !== lastValue) {
          lastValue = value;
          await handleQrText(value);
        }
      } catch (error) {
        status.textContent = "読み取り中に失敗しました。もう一度QRを画面に入れてください";
      }
      requestAnimationFrame(tick);
    };
    tick();
  }

  function scanWithJsQr(video, status, session) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let lastValue = "";
    const tick = async () => {
      if (!video.srcObject || session !== app.scanSession) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if (code?.data && code.data !== lastValue) {
          lastValue = code.data;
          await handleQrText(code.data);
        }
      }
      requestAnimationFrame(tick);
    };
    status.textContent = "読み取り中";
    tick();
  }

  async function handleQrText(text, options = {}) {
    const status = $("#scan-status");
    const normalized = extractQrFrame(text);
    if (!normalized) {
      if (status) status.textContent = options.manual ? "QRの文字列ではありません。PC側のQR表示に出ている文字列を貼ってください" : "QRを読み取れませんでした";
      return;
    }
    text = normalized;
    try {
      requirePassword();
      const parts = text.split(".");
      const [, sessionId, indexText, totalText, ...chunkParts] = parts;
      const chunk = chunkParts.join(".");
      const index = Number(indexText);
      const total = Number(totalText);
      if (!sessionId || !index || !total || !chunk) throw new Error("QR形式が違います");
      if (index < 1 || index > total) throw new Error("QRの番号が正しくありません");
      if (!app.qrParts.has(sessionId)) app.qrParts.set(sessionId, { total, chunks: new Map() });
      const session = app.qrParts.get(sessionId);
      if (session.total !== total) throw new Error("別のQRセットが混ざっています");
      session.chunks.set(index, chunk);
      status.textContent = `${session.chunks.size} / ${session.total} 読み取り済み`;
      toast(`${session.chunks.size} / ${session.total} 読み取り済み`);
      if (session.chunks.size !== session.total) return;
      const missing = Array.from({ length: session.total }, (_, i) => i + 1).filter((part) => !session.chunks.has(part));
      if (missing.length) {
        status.textContent = `未読: ${missing.join(", ")}`;
        return;
      }
      const payload = Array.from({ length: session.total }, (_, i) => session.chunks.get(i + 1)).join("");
      const envelope = JSON.parse(decodeUtf8(base64UrlToBytes(payload)));
      const delta = await decryptObject(envelope, app.settings.syncPassword);
      if (delta.type !== "today-fragments-delta") throw new Error("取り込みデータが違います");
      const result = mergeData(delta, { markDirty: false });
      await persistState();
      scheduleDriveSave();
      app.qrParts.delete(sessionId);
      status.textContent = `取り込みました: ${result.created}件追加 / ${result.updated}件更新`;
      toast("PC差分を取り込みました");
      renderAll();
    } catch (error) {
      status.textContent = error.message || "取り込みに失敗しました";
    }
  }

  function extractQrFrame(text = "") {
    const compact = String(text).trim();
    if (!compact) return "";
    const match = compact.match(/TFQR1\.[A-Za-z0-9]+(?:_[A-Za-z0-9]+)?\.\d+\.\d+\.[A-Za-z0-9_-]+/);
    return match ? match[0] : "";
  }

  function mergeData(incoming, options = {}) {
    const result = { changed: 0, created: 0, updated: 0 };
    const incomingNotes = Array.isArray(incoming.notes) ? incoming.notes : [];
    const incomingGroups = Array.isArray(incoming.groups) ? incoming.groups : [];
    incomingNotes.forEach((note) => {
      const existing = findNote(note.id);
      if (!existing) {
        app.data.notes.push(normalizeData({ notes: [note], groups: [] }).notes[0]);
        result.changed += 1;
        result.created += 1;
        return;
      }
      if ((note.updatedAt || "") > (existing.updatedAt || "")) {
        Object.assign(existing, note);
        result.changed += 1;
        result.updated += 1;
      }
    });
    incomingGroups.forEach((group) => {
      const existing = findGroup(group.id);
      if (!existing) {
        app.data.groups.push(normalizeData({ notes: [], groups: [group] }).groups[0]);
        result.changed += 1;
        result.created += 1;
        return;
      }
      if ((group.updatedAt || "") > (existing.updatedAt || "")) {
        Object.assign(existing, group);
        result.changed += 1;
        result.updated += 1;
      }
    });
    if (result.changed) {
      app.data.updatedAt = nowIso();
      updateAllNoteGroups();
    }
    if (options.markDirty && app.settings.role === "pc") {
      incomingNotes.forEach((note) => (app.dirty.notes[note.id] = note.updatedAt || nowIso()));
      incomingGroups.forEach((group) => (app.dirty.groups[group.id] = group.updatedAt || nowIso()));
    }
    return result;
  }

  function sanitizeData(data) {
    return normalizeData(JSON.parse(JSON.stringify(data)));
  }

  async function encryptObject(object, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = utf8(JSON.stringify(object));
    const compressed = await compressBytes(plain);
    const key = await deriveKey(password, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed.bytes));
    return {
      app: "Today Fragments",
      version: 1,
      createdAt: nowIso(),
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 250000,
        salt: bytesToBase64Url(salt)
      },
      cipher: {
        name: "AES-GCM",
        iv: bytesToBase64Url(iv),
        data: bytesToBase64Url(cipher)
      },
      compression: compressed.compression
    };
  }

  async function decryptObject(envelope, password) {
    const salt = base64UrlToBytes(envelope.kdf.salt);
    const iv = base64UrlToBytes(envelope.cipher.iv);
    const data = base64UrlToBytes(envelope.cipher.data);
    const key = await deriveKey(password, salt, envelope.kdf.iterations);
    const plainCompressed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data));
    const plain = await decompressBytes(plainCompressed, envelope.compression);
    return JSON.parse(decodeUtf8(plain));
  }

  async function deriveKey(password, salt, iterations = 250000) {
    const material = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function compressBytes(bytes) {
    if (!("CompressionStream" in window)) return { bytes, compression: "none" };
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    return { bytes: new Uint8Array(buffer), compression: "gzip" };
  }

  async function decompressBytes(bytes, compression) {
    if (compression !== "gzip") return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  function initWebGl() {
    if (app.gl) return;
    const gl = els.canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return;
    const vertex = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;
    const fragment = `
      precision mediump float;
      uniform vec2 u_resolution;
      uniform vec2 u_view;
      uniform float u_zoom;
      uniform float u_time;

      float gridLine(vec2 p, float size, float width) {
        vec2 g = abs(fract(p / size - 0.5) - 0.5) / fwidth(p / size);
        float line = min(g.x, g.y);
        return 1.0 - smoothstep(width, width + 1.0, line);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        vec2 world = (gl_FragCoord.xy - u_view) / max(u_zoom, 0.001);
        float gridA = gridLine(world + vec2(sin(u_time * 0.25) * 10.0, 0.0), 72.0, 0.46);
        float gridB = gridLine(world, 288.0, 0.62);
        float vignette = distance(uv, vec2(0.5));
        vec3 base = mix(vec3(0.025, 0.035, 0.06), vec3(0.055, 0.065, 0.09), uv.y);
        vec3 cyan = vec3(0.14, 0.52, 0.58) * (0.22 + 0.14 * sin(u_time * 0.33 + uv.x * 6.0));
        vec3 rose = vec3(0.52, 0.12, 0.25) * (0.16 + 0.1 * cos(u_time * 0.22 + uv.y * 5.0));
        vec3 color = base + cyan * smoothstep(0.85, 0.05, distance(uv, vec2(0.12, 0.18)));
        color += rose * smoothstep(0.9, 0.08, distance(uv, vec2(0.86, 0.18)));
        color += vec3(0.24, 0.44, 0.36) * smoothstep(0.82, 0.08, distance(uv, vec2(0.52, 0.95))) * 0.24;
        color += vec3(0.12, 0.19, 0.28) * gridA;
        color += vec3(0.24, 0.37, 0.44) * gridB;
        color *= smoothstep(0.86, 0.22, vignette);
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const program = makeProgram(gl, vertex, fragment);
    if (!program) return;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    app.gl = {
      gl,
      program,
      pos: gl.getAttribLocation(program, "a_position"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      view: gl.getUniformLocation(program, "u_view"),
      zoom: gl.getUniformLocation(program, "u_zoom"),
      time: gl.getUniformLocation(program, "u_time")
    };
    resizeGlCanvas();
    requestAnimationFrame(drawWebGl);
  }

  function drawWebGl(time) {
    if (!app.gl) return;
    const { gl, program, pos, resolution, view, zoom } = app.gl;
    resizeGlCanvas();
    gl.useProgram(program);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(resolution, els.canvas.width, els.canvas.height);
    gl.uniform2f(view, app.view.x * devicePixelRatio, (window.innerHeight - app.view.y) * devicePixelRatio);
    gl.uniform1f(zoom, app.view.zoom * devicePixelRatio);
    gl.uniform1f(app.gl.time, time * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(drawWebGl);
  }

  function resizeGlCanvas() {
    const width = Math.max(1, Math.floor(window.innerWidth * devicePixelRatio));
    const height = Math.max(1, Math.floor(window.innerHeight * devicePixelRatio));
    if (els.canvas.width !== width || els.canvas.height !== height) {
      els.canvas.width = width;
      els.canvas.height = height;
      app.gl?.gl.viewport(0, 0, width, height);
    }
  }

  function makeProgram(gl, vertexSource, fragmentSource) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  function openModal(html) {
    stopScanStream();
    els.modalRoot.classList.add("active");
    els.modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal-panel">${html}</section></div>`;
    $$("[data-close]", els.modalRoot).forEach((button) => button.addEventListener("click", closeModal));
    $(".modal-backdrop", els.modalRoot).addEventListener("click", (event) => {
      if (event.target.classList.contains("modal-backdrop")) closeModal();
    });
  }

  function closeModal() {
    stopScanStream();
    els.modalRoot.classList.remove("active");
    els.modalRoot.innerHTML = "";
  }

  function stopScanStream() {
    const video = $("#scan-video");
    const stream = video?.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
  }

  function updateStatus() {
    const pendingCount = Object.keys(app.dirty.notes || {}).length + Object.keys(app.dirty.groups || {}).length;
    if (app.settings.role === "pc") {
      els.syncStatus.textContent = pendingCount ? `未同期 ${pendingCount}件` : "PCローカル保存";
      return;
    }
    if (app.drive.saving) {
      els.syncStatus.textContent = "Drive保存中";
    } else if (app.drive.pending) {
      els.syncStatus.textContent = "Drive未保存";
    } else if (app.drive.connected) {
      els.syncStatus.textContent = "Drive保存済み";
    } else {
      els.syncStatus.textContent = "ローカル保存";
    }
  }

  function schedulePersist() {
    clearTimeout(app.saveTimer);
    app.saveTimer = window.setTimeout(persistState, 120);
  }

  async function persistState() {
    app.data.updatedAt = app.data.updatedAt || nowIso();
    await idbSet(STATE_KEY, {
      settings: app.settings,
      data: app.data,
      dirty: app.dirty
    });
  }

  function findNote(id) {
    return app.data.notes.find((note) => note.id === id);
  }

  function findGroup(id) {
    return app.data.groups.find((group) => group.id === id);
  }

  function isVisibleEntity(entity) {
    return entity && !entity.trashedAt && !entity.deletedAt;
  }

  function deriveTitle(body = "") {
    return body.split(/\r?\n/).find(Boolean)?.slice(0, 32) || "";
  }

  function compactBody(body = "", limit = 120) {
    const compact = body.replace(/\s+/g, " ").trim();
    return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
  }

  function localDate(iso = nowIso()) {
    const date = new Date(iso);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatTime(iso) {
    return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  }

  function formatDateTime(iso) {
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(iso));
  }

  function uid(prefix) {
    const raw = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}_${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  }

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value = "") {
    return escapeHtml(value);
  }

  function escapeDriveQuery(value) {
    return String(value).replaceAll("'", "\\'");
  }

  function utf8(value) {
    return new TextEncoder().encode(value);
  }

  function decodeUtf8(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToBase64Url(bytes) {
    return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  function base64UrlToBytes(value) {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return base64ToBytes(padded);
  }

  function chunkString(value, size) {
    const chunks = [];
    for (let i = 0; i < value.length; i += size) chunks.push(value.slice(i, i + size));
    return chunks;
  }

  function toast(message) {
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 2600);
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("./service-worker.js")
        .then((registration) => {
          registration.update?.();
          if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
        })
        .catch(() => {});
    }
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("kv");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const request = tx.objectStore("kv").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
})();
