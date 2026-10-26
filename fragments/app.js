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
  const APP_VERSION = "39";
  const DEFAULT_PROJECT_ID = "project_main";
  const DEFAULT_PROJECT_NAME = "メイン";
  const NOTE_CARD_WIDTH = 210;
  const NOTE_CARD_HEIGHT = 62;
  const GROUP_FIT_PADDING = 52;
  const CONNECTION_STYLES = ["solid", "dotted", "dashed", "wavy"];
  const PROJECT_TEMPLATES = [
    { id: "blank", label: "空の案件", groups: [] },
    { id: "thinking", label: "思考整理", groups: ["事実", "疑問", "仮説", "次に見る"] },
    { id: "decision", label: "意思決定", groups: ["背景", "選択肢", "判断材料", "決定事項", "次アクション"] },
    { id: "retro", label: "振り返り", groups: ["よかったこと", "気になること", "学び", "次に試す"] }
  ];
  const CONNECTION_KINDS = [
    { id: "related", label: "関連", color: "#67e8f9" },
    { id: "cause", label: "原因", color: "#ffd166" }
  ];
  const NOTE_FIELDS = ["id", "title", "body", "createdAt", "updatedAt", "localDate", "x", "y", "groupIds", "locked", "trashedAt", "deletedAt"];
  const GROUP_FIELDS = ["id", "title", "createdAt", "updatedAt", "x", "y", "w", "h", "color", "locked", "trashedAt", "deletedAt"];
  const CONNECTION_FIELDS = ["id", "from", "to", "kind", "style", "createdAt", "updatedAt", "trashedAt", "deletedAt"];
  const QR_MAX_FRAMES = 500;
  const QR_MAX_SESSIONS = 3;
  const KDF_MIN_ITERATIONS = 100000;
  const KDF_MAX_ITERATIONS = 2000000;
  const INBOX_TYPE = "today-fragments-inbox";
  const INBOX_FOLDER = "inbox";
  const INBOX_BRANCH = "fragments-data";
  const POST_FIELDS = ["id", "projectId", "projectName", "groupId", "groupTitle", "body", "createdAt", "localDate", "deviceId"];
  const CAPTURE_GROUP_FIELDS = ["id", "projectId", "title", "createdAt"];
  const INBOX_SEND_DELAY = 2500;
  const INBOX_RETRY_DELAYS = [30000, 120000, 600000, 1800000];
  const SENT_POST_KEEP_DAYS = 62;
  const INBOX_RECEIVE_INTERVAL = 5 * 60 * 1000;
  const INBOX_FIRST_MONTHS = 12;
  const CATALOG_TYPE = "today-fragments-catalog";
  const BACKUP_TYPE = "today-fragments-backup";
  const BACKUP_HANDLE_KEY = "today-fragments-backup-handle-v1";
  const BACKUP_SAVE_DELAY = 20000;
  const QR_FRAME_INTERVAL = 800;

  const els = {};
  const loadedScripts = new Map();
  let idbConnection = null;
  const app = {
    data: null,
    settings: null,
    projects: null,
    projectStore: {},
    activeProjectId: "",
    dirty: { notes: {}, groups: {}, connections: {} },
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
    scanStream: null,
    storageReadError: null,
    storageWriteFailed: false,
    storageWarnedAt: 0,
    capture: null,
    inboxSend: { sending: false, again: false, timer: 0, failures: 0, branchReady: false },
    inboxLedger: null,
    inboxReceive: { running: false, timer: 0 },
    backup: { handle: null, fileName: "", permission: "", lastSavedAt: "", lastError: "", dirty: false, saving: false, timer: 0 },
    qrTimer: 0,
    dragHoverGroupId: "",
    lastEntityTap: null,
    entityTapCandidates: new Map(),
    connectionDraft: null,
    panelsCollapsed: false,
    history: { undo: [], redo: [], restoring: false },
    particles: { x: 0, y: 0, targetX: 0, targetY: 0, raf: 0, initialized: false },
    activeEntityDrag: null
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
    if (app.storageReadError) {
      renderStorageError(app.storageReadError);
      return;
    }
    bindWorkspaceEvents();
    if (app.settings.role) {
      startApp();
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
    els.lineLayer = $("#line-layer");
    els.cardLayer = $("#card-layer");
    els.roleLabel = $("#role-label");
    els.projectTitle = $("#project-title");
    els.projectSwitcher = $("#project-switcher");
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
    els.listModeToggle = $("#list-mode-toggle");
    els.panelToggle = $("#panel-toggle");
    els.mobileList = $("#mobile-list");
    els.undoAction = $("#undo-action");
    els.redoAction = $("#redo-action");
    els.resetView = $("#reset-view");
    els.movementLock = $("#movement-lock");
    els.particleLayer = $(".particle-layer");
    els.capture = $("#capture");
    if (!els.capture) {
      // A stale cached index.html can be paired with this script; add the posting screen's container so the phone still opens.
      els.capture = document.createElement("section");
      els.capture.id = "capture";
      els.capture.className = "capture-screen hidden";
      $("#app").prepend(els.capture);
    }
  }

  async function loadState() {
    let stored = null;
    try {
      stored = await idbGet(STATE_KEY);
    } catch (error) {
      // A failed read is not the same as "no data yet": block writes so the stored notes are never replaced by an empty state.
      console.warn(error);
      app.storageReadError = error || new Error("storage read failed");
    }
    app.settings = mergeSettings(stored?.settings || {});
    app.panelsCollapsed = Boolean(app.settings.panelsCollapsed);
    app.capture = normalizeCapture(stored?.capture);
    app.inboxLedger = normalizeInboxLedger(stored?.inboxLedger);
    setupProjectsFromStoredState(stored || {});
    if (!app.settings.deviceId) app.settings.deviceId = uid("device");
    if (!app.data.deviceId) app.data.deviceId = app.settings.deviceId;
  }

  function setupProjectsFromStoredState(stored) {
    const legacyData = stored.data || createEmptyData({ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME });
    const legacyProject = legacyData.project || {};
    const fallbackId = legacyProject.id || stored.activeProjectId || DEFAULT_PROJECT_ID;
    const fallbackName = legacyProject.name || DEFAULT_PROJECT_NAME;
    app.projects = normalizeProjectsIndex(stored.projects || {
      activeProjectId: fallbackId,
      items: [createProjectItem({ id: fallbackId, name: fallbackName, data: legacyData })]
    });
    app.activeProjectId = app.projects.activeProjectId || fallbackId;
    app.projectStore = normalizeProjectStore(stored.projectStore || {
      [app.activeProjectId]: {
        data: legacyData,
        dirty: stored.dirty || createEmptyDirty(),
        view: stored.view || app.view
      }
    });
    if (!app.projectStore[app.activeProjectId]) {
      const project = currentProject() || createProjectItem({ id: app.activeProjectId, name: fallbackName });
      app.projectStore[app.activeProjectId] = {
        data: createEmptyData(project),
        dirty: createEmptyDirty(),
        view: { ...app.view }
      };
    }
    activateProject(app.activeProjectId, { render: false, persist: false });
  }

  function createEmptyData(project = {}) {
    const timestamp = nowIso();
    const projectId = project.id || app.activeProjectId || DEFAULT_PROJECT_ID;
    const projectName = project.name || DEFAULT_PROJECT_NAME;
    return {
      schemaVersion: 2,
      app: "Today Fragments",
      project: {
        id: projectId,
        name: projectName,
        createdAt: project.createdAt || timestamp
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      deviceId: "",
      notes: [],
      groups: [],
      connections: []
    };
  }

  function normalizeData(data) {
    const base = createEmptyData(data?.project || currentProject() || {});
    const merged = { ...base, ...data };
    merged.schemaVersion = Math.max(2, Number(merged.schemaVersion) || 1);
    merged.project = { ...base.project, ...(data.project || {}) };
    merged.project.id = isSafeId(merged.project.id) ? merged.project.id : app.activeProjectId || DEFAULT_PROJECT_ID;
    merged.project.name = textValue(merged.project.name) || currentProject()?.name || DEFAULT_PROJECT_NAME;
    merged.createdAt = isoValue(merged.createdAt, base.createdAt);
    merged.updatedAt = isoValue(merged.updatedAt, merged.createdAt);
    merged.deviceId = textValue(merged.deviceId);
    merged.notes = (Array.isArray(data.notes) ? data.notes : []).filter(normalizeNote);
    merged.groups = (Array.isArray(data.groups) ? data.groups : []).filter(normalizeGroup);
    merged.connections = (Array.isArray(data.connections) ? data.connections : []).filter(normalizeConnection);
    return merged;
  }

  // Data can arrive from Drive, GitHub, QR or a pasted string, so every value that reaches innerHTML or a style attribute is checked here.
  // Each function fixes the entity in place and returns false when it cannot be used at all.
  function normalizeNote(note) {
    if (!isPlainObject(note) || !isSafeId(note.id)) return false;
    note.title = textValue(note.title);
    note.body = textValue(note.body);
    note.groupIds = Array.isArray(note.groupIds) ? note.groupIds.filter(isSafeId) : [];
    note.x = finiteNumber(note.x, 0);
    note.y = finiteNumber(note.y, 0);
    note.createdAt = isoValue(note.createdAt, nowIso());
    note.updatedAt = isoValue(note.updatedAt, note.createdAt);
    note.localDate = /^\d{4}-\d{2}-\d{2}$/.test(note.localDate) ? note.localDate : localDate(note.createdAt);
    note.locked = Boolean(note.locked);
    note.trashedAt = markerValue(note.trashedAt, note.updatedAt);
    note.deletedAt = markerValue(note.deletedAt, note.updatedAt);
    return true;
  }

  function normalizeGroup(group) {
    if (!isPlainObject(group) || !isSafeId(group.id)) return false;
    group.title = textValue(group.title);
    group.x = finiteNumber(group.x, 0);
    group.y = finiteNumber(group.y, 0);
    group.w = finiteNumber(group.w, 320);
    group.h = finiteNumber(group.h, 220);
    group.createdAt = isoValue(group.createdAt, nowIso());
    group.updatedAt = isoValue(group.updatedAt, group.createdAt);
    group.color = isSafeColor(group.color) ? group.color : GROUP_COLORS[0];
    group.locked = Boolean(group.locked);
    group.trashedAt = markerValue(group.trashedAt, group.updatedAt);
    group.deletedAt = markerValue(group.deletedAt, group.updatedAt);
    return true;
  }

  function normalizeConnection(connection) {
    if (!isPlainObject(connection) || !isSafeId(connection.id)) return false;
    connection.from = normalizeEndpoint(connection.from);
    connection.to = normalizeEndpoint(connection.to);
    connection.kind = CONNECTION_KINDS.some((kind) => kind.id === connection.kind) ? connection.kind : "related";
    connection.style = CONNECTION_STYLES.includes(connection.style) ? connection.style : "solid";
    connection.createdAt = isoValue(connection.createdAt, nowIso());
    connection.updatedAt = isoValue(connection.updatedAt, connection.createdAt);
    connection.trashedAt = markerValue(connection.trashedAt, connection.updatedAt);
    connection.deletedAt = markerValue(connection.deletedAt, connection.updatedAt);
    return true;
  }

  // Posts written on the phone and waiting for (or already sent to) the inbox in the data repository.
  function createEmptyCapture() {
    return { projectId: "", groupId: "", draft: "", posts: [], groups: [], lastSentAt: "", lastError: "", lastNotice: "", catalog: null };
  }

  function normalizeCapture(capture) {
    if (!isPlainObject(capture)) return createEmptyCapture();
    return {
      projectId: isSafeId(capture.projectId) ? capture.projectId : "",
      groupId: isSafeId(capture.groupId) ? capture.groupId : "",
      draft: textValue(capture.draft),
      posts: (Array.isArray(capture.posts) ? capture.posts : []).filter(normalizePost),
      groups: (Array.isArray(capture.groups) ? capture.groups : []).filter(normalizeCaptureGroup),
      lastSentAt: isoValue(capture.lastSentAt, ""),
      lastError: textValue(capture.lastError),
      lastNotice: textValue(capture.lastNotice),
      catalog: normalizeCatalog(capture.catalog)
    };
  }

  // The project and group list the PC shows to the phone by QR. Once received, it replaces the phone's own old data as the source of choices.
  function normalizeCatalog(catalog) {
    if (!isPlainObject(catalog) || !Array.isArray(catalog.projects)) return null;
    const projects = catalog.projects
      .filter((project) => isPlainObject(project) && isSafeId(project.id))
      .map((project) => ({
        id: project.id,
        name: textValue(project.name) || DEFAULT_PROJECT_NAME,
        groups: (Array.isArray(project.groups) ? project.groups : [])
          .filter((group) => isPlainObject(group) && isSafeId(group.id))
          .map((group) => ({ id: group.id, title: textValue(group.title) || "グループ", color: isSafeColor(group.color) ? group.color : "" }))
      }));
    if (!projects.length) return null;
    return { receivedAt: isoValue(catalog.receivedAt, nowIso()), projects };
  }

  // What the PC has already taken from the inbox, so a deleted card or project is never imported twice.
  function normalizeInboxLedger(ledger) {
    const source = isPlainObject(ledger) ? ledger : {};
    const pickIds = (map, valueCheck) =>
      Object.fromEntries(Object.entries(isPlainObject(map) ? map : {}).filter(([key, value]) => isSafeId(key) && valueCheck(value)));
    return {
      importedPosts: pickIds(source.importedPosts, (value) => typeof value === "string"),
      groupMap: pickIds(source.groupMap, isSafeId),
      lastCheckedAt: isoValue(source.lastCheckedAt, ""),
      lastMonth: /^\d{4}-\d{2}$/.test(source.lastMonth) ? source.lastMonth : "",
      lastError: textValue(source.lastError),
      lastReceivedCount: Number.isFinite(source.lastReceivedCount) ? source.lastReceivedCount : 0
    };
  }

  function normalizePost(post) {
    if (!isPlainObject(post) || !isSafeId(post.id) || !isSafeId(post.projectId)) return false;
    post.projectName = textValue(post.projectName) || DEFAULT_PROJECT_NAME;
    post.groupId = isSafeId(post.groupId) ? post.groupId : "";
    post.groupTitle = textValue(post.groupTitle);
    post.body = textValue(post.body);
    post.createdAt = isoValue(post.createdAt, nowIso());
    post.localDate = /^\d{4}-\d{2}-\d{2}$/.test(post.localDate) ? post.localDate : localDate(post.createdAt);
    post.deviceId = textValue(post.deviceId);
    post.sentAt = isoValue(post.sentAt, "");
    return true;
  }

  function normalizeCaptureGroup(group) {
    if (!isPlainObject(group) || !isSafeId(group.id) || !isSafeId(group.projectId)) return false;
    group.title = textValue(group.title).trim();
    if (!group.title) return false;
    group.createdAt = isoValue(group.createdAt, nowIso());
    group.sentAt = isoValue(group.sentAt, "");
    return true;
  }

  function normalizeEndpoint(endpoint) {
    return {
      type: endpoint?.type === "group" ? "group" : "note",
      id: isSafeId(endpoint?.id) ? endpoint.id : ""
    };
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isSafeId(value) {
    // Every id this app has generated is "<prefix>_<letters and digits>".
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  }

  function isSafeColor(value) {
    return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value);
  }

  function textValue(value) {
    if (typeof value === "string") return value;
    return value === null || value === undefined ? "" : String(value);
  }

  function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function isoValue(value, fallback) {
    return typeof value === "string" && value && !Number.isNaN(Date.parse(value)) ? value : fallback;
  }

  function markerValue(value, fallback) {
    // Keep anything truthy as a marker so a trashed or deleted entity never comes back to life.
    if (!value) return "";
    return isoValue(value, fallback);
  }

  function pickFields(source, fields) {
    return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(source, field)).map((field) => [field, source[field]]));
  }

  function createProjectItem(options = {}) {
    const timestamp = nowIso();
    const data = options.data || {};
    return {
      id: options.id || uid("project"),
      name: textValue(options.name || data.project?.name) || DEFAULT_PROJECT_NAME,
      createdAt: isoValue(options.createdAt || data.project?.createdAt || data.createdAt, timestamp),
      updatedAt: isoValue(options.updatedAt || data.updatedAt, timestamp),
      lastOpenedAt: isoValue(options.lastOpenedAt, timestamp),
      archivedAt: markerValue(options.archivedAt, timestamp),
      noteCount: Number.isFinite(options.noteCount) ? options.noteCount : (Array.isArray(data.notes) ? data.notes.filter(isVisibleEntity).length : 0),
      groupCount: Number.isFinite(options.groupCount) ? options.groupCount : (Array.isArray(data.groups) ? data.groups.filter(isVisibleEntity).length : 0),
      connectionCount: Number.isFinite(options.connectionCount)
        ? options.connectionCount
        : (Array.isArray(data.connections) ? data.connections.filter(isVisibleEntity).length : 0)
    };
  }

  function normalizeProjectsIndex(projects = {}) {
    const timestamp = nowIso();
    const items = Array.isArray(projects.items) ? projects.items : [];
    const normalized = items
      .filter(isPlainObject)
      .map((item) => createProjectItem(item))
      .filter((item, index, all) => isSafeId(item.id) && all.findIndex((candidate) => candidate.id === item.id) === index);
    if (!normalized.length) normalized.push(createProjectItem({ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME }));
    const activeProjectId = normalized.some((item) => item.id === projects.activeProjectId) ? projects.activeProjectId : normalized[0].id;
    return {
      type: "today-fragments-project-index",
      schemaVersion: 1,
      app: "Today Fragments",
      createdAt: projects.createdAt || timestamp,
      updatedAt: projects.updatedAt || timestamp,
      activeProjectId,
      items: normalized
    };
  }

  function normalizeProjectStore(store = {}) {
    return Object.fromEntries(
      Object.entries(store).map(([projectId, entry]) => {
        const project = app.projects?.items?.find((item) => item.id === projectId) || { id: projectId, name: DEFAULT_PROJECT_NAME };
        return [
          projectId,
          {
            data: normalizeData(entry?.data || createEmptyData(project)),
            dirty: normalizeDirty(entry?.dirty || createEmptyDirty()),
            view: normalizeView(entry?.view),
            selected: entry?.selected || null
          }
        ];
      })
    );
  }

  function createEmptyDirty() {
    return { notes: {}, groups: {}, connections: {} };
  }

  function normalizeDirty(dirty = {}) {
    return {
      notes: { ...(dirty.notes || {}) },
      groups: { ...(dirty.groups || {}) },
      connections: { ...(dirty.connections || {}) }
    };
  }

  function normalizeView(view = {}) {
    return {
      x: Number.isFinite(view.x) ? view.x : 0,
      y: Number.isFinite(view.y) ? view.y : 0,
      zoom: Number.isFinite(view.zoom) ? view.zoom : 1
    };
  }

  function mergeSettings(settings) {
    // Spread the stored settings first so the nested defaults below are filled in rather than replaced.
    return {
      role: "",
      deviceId: "",
      savePassword: true,
      syncPassword: "",
      movementLocked: false,
      panelsCollapsed: false,
      mobileListMode: false,
      phoneView: "capture",
      ...settings,
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
      inbox: {
        owner: "",
        repo: "",
        branch: "",
        token: "",
        ...(settings.inbox || {})
      }
    };
  }

  // Where the phone's cards go. Empty inbox fields fall back to the GitHub settings the phone already has,
  // so the existing repository and token are reused with a data-only branch that never touches the published site.
  function inboxConfig() {
    const inbox = app.settings.inbox;
    const github = app.settings.github;
    return {
      owner: inbox.owner || github.owner || "",
      repo: inbox.repo || github.repo || "",
      branch: inbox.branch || INBOX_BRANCH,
      token: inbox.token || github.token || "",
      custom: Boolean(inbox.owner || inbox.repo || inbox.branch || inbox.token)
    };
  }

  function currentProject() {
    return app.projects?.items?.find((project) => project.id === app.activeProjectId) || null;
  }

  function ensureProjectExists(projectId, name = DEFAULT_PROJECT_NAME) {
    let project = app.projects.items.find((item) => item.id === projectId);
    if (!project) {
      project = createProjectItem({ id: projectId, name });
      app.projects.items.unshift(project);
    }
    if (!app.projectStore[projectId]) {
      app.projectStore[projectId] = {
        data: createEmptyData(project),
        dirty: createEmptyDirty(),
        view: { x: 0, y: 0, zoom: 1 },
        selected: null
      };
    }
    return project;
  }

  function updateProjectMeta() {
    const project = currentProject();
    if (!project || !app.data) return;
    project.name = app.data.project?.name || project.name || DEFAULT_PROJECT_NAME;
    project.updatedAt = app.data.updatedAt || project.updatedAt || nowIso();
    project.noteCount = app.data.notes.filter(isVisibleEntity).length;
    project.groupCount = app.data.groups.filter(isVisibleEntity).length;
    project.connectionCount = app.data.connections.filter(isVisibleEntity).length;
    app.data.project = {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt
    };
    app.projects.activeProjectId = project.id;
    app.projects.updatedAt = nowIso();
  }

  function saveActiveProjectToStore() {
    if (!app.activeProjectId || !app.data) return;
    updateProjectMeta();
    app.projectStore[app.activeProjectId] = {
      data: sanitizeData(app.data),
      dirty: normalizeDirty(app.dirty),
      view: { ...app.view },
      selected: app.selected ? { ...app.selected } : null
    };
  }

  function activateProject(projectId, options = {}) {
    const project = app.projects.items.find((item) => item.id === projectId) || app.projects.items[0];
    app.activeProjectId = project.id;
    app.projects.activeProjectId = project.id;
    project.lastOpenedAt = nowIso();
    const stored = app.projectStore[project.id] || {
      data: createEmptyData(project),
      dirty: createEmptyDirty(),
      view: { x: 0, y: 0, zoom: 1 },
      selected: null
    };
    app.data = normalizeData(stored.data || createEmptyData(project));
    app.data.project = { id: project.id, name: project.name, createdAt: project.createdAt };
    app.dirty = normalizeDirty(stored.dirty || createEmptyDirty());
    app.view = normalizeView(stored.view || app.view);
    app.selected = validateSelection(stored.selected) || null;
    app.history = { undo: [], redo: [], restoring: false };
    updateProjectMeta();
    if (options.render !== false) {
      updateWorldTransform();
      updateUndoRedoButtons();
      renderAll();
    }
    if (options.persist !== false) schedulePersist();
  }

  function updateProjectTitle() {
    if (!els.projectTitle) return;
    els.projectTitle.textContent = currentProject()?.name || DEFAULT_PROJECT_NAME;
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
            <span>カードを書いてグループを選ぶだけ。書いたカードは自動でPCへ送ります。</span>
          </button>
          <button class="mode-card" data-mode="pc">
            <strong>PCで使う</strong>
            <span>スマホから届いたカードを受け取って、並べたり線を引いたりして整理します。</span>
          </button>
        </div>
        <div id="setup-detail"></div>
      </div>
    `;
    $$(".mode-card", els.setup).forEach((button) => {
      button.addEventListener("click", () => renderSetupDetail(button.dataset.mode));
    });
  }

  function renderStorageError(error) {
    document.documentElement.classList.add("setup-mode");
    document.documentElement.classList.remove("workspace-mode");
    els.workspace.classList.add("hidden");
    els.setup.classList.remove("hidden");
    els.setup.innerHTML = `
      <div class="setup-wrap">
        <div class="setup-title">
          <h1>Today Fragments</h1>
        </div>
        <section class="setup-card">
          <h2>端末内のデータを読み込めませんでした</h2>
          <p class="status-line">保存されているメモを守るため、この画面では何も保存しません。ページを再読み込みしてください。</p>
          <p class="status-line">何度か試しても直らない場合は、ブラウザを一度閉じてから開き直してください。</p>
          <p class="status-line">詳細: ${escapeHtml(error?.name || "")} ${escapeHtml(error?.message || "")}</p>
          <div class="button-row">
            <button id="storage-reload" class="primary-button" type="button">再読み込み</button>
          </div>
        </section>
      </div>
    `;
    $("#storage-reload").addEventListener("click", () => location.reload());
  }

  function renderSetupDetail(mode) {
    const detail = $("#setup-detail", els.setup);
    if (mode === "phone") {
      detail.innerHTML = `
        <section class="setup-card">
          <h2>スマホ設定</h2>
          <p class="status-line">送り先は、データ用に作ったGitHubの公開リポジトリです。カードは同期パスワードで暗号化して送ります。</p>
          <div class="form-grid">
            ${inboxFieldsHtml("setup")}
            <div class="button-row">
              <button id="setup-phone-start" class="primary-button" type="button">開始</button>
              <button id="setup-inbox-test" class="soft-button" type="button">接続を確認</button>
            </div>
            <p id="setup-status" class="status-line"></p>
          </div>
        </section>
      `;
      bindInboxFields("setup");
      $("#setup-phone-start").addEventListener("click", async () => {
        readInboxFields("setup");
        app.settings.role = "phone";
        app.settings.phoneView = "capture";
        await persistState();
        startApp();
      });
      $("#setup-inbox-test").addEventListener("click", () => runInboxTest("setup", $("#setup-status")));
      return;
    }

    detail.innerHTML = `
      <section class="setup-card">
        <h2>PC設定</h2>
        <p class="status-line">スマホから届くカードを受け取って、PCで並べたり線を引いたりします。受け取り先は、スマホと同じデータ用リポジトリです。</p>
        <div class="form-grid">
          ${inboxFieldsHtml("setup", { token: false, label: "受け取り先" })}
          <label class="pill"><input id="setup-save-password" type="checkbox" ${app.settings.savePassword ? "checked" : ""} /> パスワードを保存</label>
          <div class="button-row">
            <button id="setup-pc-start" class="primary-button" type="button">開始</button>
            <button id="setup-pc-restore" class="soft-button" type="button">バックアップから復元して開始</button>
          </div>
          <p id="setup-status" class="status-line"></p>
          <p class="status-line">スマホに今までのデータがある場合は、開始したあと設定の「引っ越し」から取り込めます。</p>
        </div>
      </section>
    `;
    bindInboxFields("setup");
    const readPcSetup = () => {
      readInboxFields("setup");
      // With "save password" off the password stays in memory for this session only; persistState leaves it out.
      app.settings.savePassword = $("#setup-save-password")?.checked ?? true;
    };
    $("#setup-pc-start").addEventListener("click", async () => {
      readPcSetup();
      app.settings.role = "pc";
      await persistState();
      startApp();
    });
    $("#setup-pc-restore").addEventListener("click", async () => {
      readPcSetup();
      const status = $("#setup-status");
      const file = await pickBackupFile();
      if (!file) return;
      try {
        status.textContent = "復元中";
        await restoreBackup(file);
        app.settings.role = "pc";
        await persistState();
        startApp();
        toast("バックアップから復元しました");
      } catch (error) {
        status.textContent = error.message || "復元に失敗しました";
      }
    });
  }

  function startApp() {
    if (app.settings.role === "phone" && app.settings.phoneView !== "canvas") {
      showCapture();
      return;
    }
    startWorkspace();
    if (app.settings.role === "pc") initPcServices();
  }

  async function initPcServices() {
    await loadBackupHandle();
    updateStatus();
    window.setTimeout(() => receiveInbox(), 1500);
  }

  function startWorkspace() {
    document.documentElement.classList.remove("setup-mode", "capture-mode");
    document.documentElement.classList.add("workspace-mode");
    els.setup.classList.add("hidden");
    els.capture.classList.add("hidden");
    els.workspace.classList.remove("hidden");
    document.body.classList.toggle("role-phone", app.settings.role === "phone");
    document.body.classList.toggle("role-pc", app.settings.role === "pc");
    els.roleLabel.textContent = app.settings.role === "phone" ? "スマホ本体" : "PCローカル";
    updateProjectTitle();
    if (!app.view.x && !app.view.y) {
      app.view.x = Math.round(window.innerWidth / 2);
      app.view.y = Math.round(window.innerHeight / 2);
    }
    applyPerformanceMode();
    initWebGl();
    initParticles();
    updateWorldTransform();
    applyPanelState();
    applyMobileListMode();
    applyMovementLockState();
    updateUndoRedoButtons();
    renderAll();
    updateStatus();
  }

  // Phone posting screen: pick a project and group, write, and the card is sent to the data repository automatically.
  // It deliberately avoids the canvas, WebGL and particles so it stays light on phones.
  function showCapture() {
    document.documentElement.classList.remove("setup-mode", "workspace-mode");
    document.documentElement.classList.add("capture-mode");
    els.setup.classList.add("hidden");
    els.workspace.classList.add("hidden");
    els.capture.classList.remove("hidden");
    renderCapture();
    if (hasUnsentCapture()) scheduleInboxSend(1000);
  }

  function isCaptureVisible() {
    return Boolean(els.capture && !els.capture.classList.contains("hidden"));
  }

  function renderCapture() {
    const project = captureProject();
    els.capture.innerHTML = `
      <div class="capture-wrap">
        <header class="capture-head">
          <div class="capture-brand"><span class="brand-mark"></span><strong>Today Fragments</strong></div>
          <button id="capture-settings" class="icon-button" type="button" title="送り先の設定" aria-label="送り先の設定"><span>⚙</span></button>
        </header>
        <div id="capture-status" class="capture-status" aria-live="polite"></div>
        <form id="capture-form" class="capture-form" autocomplete="off">
          <label class="capture-label" for="capture-project">案件</label>
          <select id="capture-project">${captureProjectOptions(project.id)}</select>
          <div class="capture-label-row">
            <span class="capture-label">グループ${
              app.capture.catalog ? `（PCの一覧 ${escapeHtml(formatDateTime(app.capture.catalog.receivedAt))}）` : ""
            }</span>
            <button id="capture-read-catalog" class="mini-button" type="button">PCの一覧を読み取る</button>
          </div>
          <div id="capture-groups" class="capture-chips"></div>
          <div id="capture-new-group" class="capture-new-group hidden">
            <input id="capture-new-group-name" maxlength="40" placeholder="新しいグループ名" />
            <button id="capture-new-group-add" class="soft-button" type="button">追加</button>
          </div>
          <textarea id="capture-body" rows="5" placeholder="今日あったこと"></textarea>
          <button class="primary-button capture-send" type="submit">送る</button>
        </form>
        <section class="capture-posts">
          <h2>送ったカード</h2>
          <div id="capture-posts" class="capture-post-list"></div>
        </section>
        <button id="capture-open-canvas" class="soft-button" type="button">これまでの画面を開く（引っ越しが終わるまで）</button>
      </div>
    `;
    const body = $("#capture-body");
    body.value = app.capture.draft || "";
    body.addEventListener("input", () => {
      // Keep the draft so a sleep or a killed Safari tab does not lose what was being typed.
      app.capture.draft = body.value;
      schedulePersist(600);
    });
    body.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submitCapturePost(event);
    });
    $("#capture-form").addEventListener("submit", submitCapturePost);
    $("#capture-project").addEventListener("change", (event) => {
      app.capture.projectId = event.target.value;
      app.capture.groupId = "";
      schedulePersist();
      renderCaptureGroups();
    });
    $("#capture-new-group-add").addEventListener("click", addCaptureGroup);
    $("#capture-new-group-name").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addCaptureGroup();
      }
    });
    $("#capture-settings").addEventListener("click", openCaptureSettings);
    $("#capture-read-catalog").addEventListener("click", openImportModal);
    $("#capture-open-canvas").addEventListener("click", openCanvasFromCapture);
    renderCaptureGroups();
    renderCaptureStatus();
    renderCapturePosts();
  }

  // Choices come from the PC's list once it has been read by QR; until then, from the phone's own older data.
  function captureProjects() {
    if (app.capture.catalog) return app.capture.catalog.projects.map((project) => ({ id: project.id, name: project.name }));
    return app.projects.items
      .filter((project) => !project.archivedAt)
      .sort((a, b) => (b.lastOpenedAt || "").localeCompare(a.lastOpenedAt || ""))
      .map((project) => ({ id: project.id, name: project.name || DEFAULT_PROJECT_NAME }));
  }

  function captureProject() {
    const items = captureProjects();
    const fallback = app.projects.items[0];
    const project =
      items.find((item) => item.id === app.capture.projectId) ||
      items.find((item) => item.id === app.activeProjectId) ||
      items[0] || { id: fallback.id, name: fallback.name || DEFAULT_PROJECT_NAME };
    app.capture.projectId = project.id;
    return project;
  }

  function captureProjectOptions(selectedId) {
    return captureProjects()
      .map((project) => `<option value="${escapeAttr(project.id)}" ${project.id === selectedId ? "selected" : ""}>${escapeHtml(project.name)}</option>`)
      .join("");
  }

  function captureGroupsFor(projectId) {
    let base;
    if (app.capture.catalog) {
      base = app.capture.catalog.projects.find((project) => project.id === projectId)?.groups || [];
    } else {
      const data = projectId === app.activeProjectId ? app.data : app.projectStore[projectId]?.data;
      base = (data?.groups || []).filter(isVisibleEntity).map((group) => ({ id: group.id, title: group.title || "グループ", color: group.color }));
    }
    // Groups made on the phone stay listed until the PC's list shows them (by id, or by the same name).
    const added = app.capture.groups
      .filter((group) => group.projectId === projectId && !base.some((item) => item.id === group.id || item.title === group.title))
      .map((group) => ({ id: group.id, title: group.title, color: "" }));
    return [...base, ...added];
  }

  function applyCatalog(catalog) {
    const normalized = normalizeCatalog({ ...catalog, receivedAt: nowIso() });
    if (!normalized) throw new Error("PCの一覧に案件がありません");
    app.capture.catalog = normalized;
    if (!normalized.projects.some((project) => project.id === app.capture.projectId)) {
      app.capture.projectId = normalized.projects[0].id;
      app.capture.groupId = "";
    }
    return { projects: normalized.projects.length, groups: normalized.projects.reduce((total, project) => total + project.groups.length, 0) };
  }

  function renderCaptureGroups() {
    const container = $("#capture-groups");
    if (!container) return;
    const groups = captureGroupsFor(app.capture.projectId);
    if (app.capture.groupId && !groups.some((group) => group.id === app.capture.groupId)) {
      // A phone-made group the PC now lists under its own id: keep the same choice selected.
      const own = app.capture.groups.find((group) => group.id === app.capture.groupId);
      app.capture.groupId = (own && groups.find((group) => group.title === own.title)?.id) || "";
    }
    const chip = (id, label, color = "") =>
      `<button class="capture-chip ${app.capture.groupId === id ? "selected" : ""}" type="button" data-group="${escapeAttr(id)}"${
        isSafeColor(color) ? ` style="--chip-color:${color}"` : ""
      }>${escapeHtml(label)}</button>`;
    container.innerHTML = [
      chip("", "未分類"),
      ...groups.map((group) => chip(group.id, group.title, group.color)),
      '<button class="capture-chip capture-chip-add" type="button" data-add-group>＋ 新しいグループ</button>'
    ].join("");
    $$("[data-group]", container).forEach((button) => {
      button.addEventListener("click", () => {
        app.capture.groupId = button.dataset.group;
        schedulePersist();
        renderCaptureGroups();
      });
    });
    $("[data-add-group]", container).addEventListener("click", () => {
      $("#capture-new-group").classList.remove("hidden");
      $("#capture-new-group-name").focus();
    });
  }

  function addCaptureGroup() {
    const input = $("#capture-new-group-name");
    const title = input.value.trim().slice(0, 40);
    if (!title) return;
    const projectId = app.capture.projectId;
    const existing = captureGroupsFor(projectId).find((group) => group.title === title);
    if (existing) {
      app.capture.groupId = existing.id;
    } else {
      const group = { id: uid("group"), projectId, title, createdAt: nowIso(), sentAt: "" };
      app.capture.groups.push(group);
      app.capture.groupId = group.id;
      scheduleInboxSend();
    }
    input.value = "";
    $("#capture-new-group").classList.add("hidden");
    schedulePersist();
    renderCaptureGroups();
  }

  function submitCapturePost(event) {
    event.preventDefault();
    const bodyEl = $("#capture-body");
    const body = bodyEl.value.trim();
    if (!body) return;
    const project = captureProject();
    const group = captureGroupsFor(project.id).find((item) => item.id === app.capture.groupId) || null;
    const timestamp = nowIso();
    app.capture.posts.unshift({
      id: uid("note"),
      projectId: project.id,
      projectName: project.name || DEFAULT_PROJECT_NAME,
      groupId: group?.id || "",
      groupTitle: group?.title || "",
      body,
      createdAt: timestamp,
      localDate: localDate(timestamp),
      deviceId: app.settings.deviceId,
      sentAt: ""
    });
    app.capture.draft = "";
    bodyEl.value = "";
    schedulePersist();
    renderCaptureStatus();
    renderCapturePosts();
    toast("追加しました");
    scheduleInboxSend();
  }

  function renderCaptureStatus() {
    const el = $("#capture-status");
    if (!el) return;
    const unsent = app.capture.posts.filter((post) => !post.sentAt).length;
    const problem = inboxSettingsProblem();
    let text;
    let warning = false;
    let action = "";
    if (app.inboxSend.sending) {
      text = "送信中…";
    } else if (problem) {
      text = `${problem}。設定から入力してください`;
      warning = true;
      action = '<button id="capture-status-settings" class="mini-button" type="button">設定を開く</button>';
    } else if (unsent) {
      text = `未送信 ${unsent}件${app.capture.lastError ? `（${app.capture.lastError}）` : ""}`;
      warning = Boolean(app.capture.lastError);
      action = '<button id="capture-send-now" class="mini-button" type="button">今すぐ送る</button>';
    } else if (app.capture.lastSentAt) {
      text = `すべて送信済み（最終 ${formatDateTime(app.capture.lastSentAt)}）`;
      if (app.capture.lastNotice) {
        text = `${text}。${app.capture.lastNotice}`;
        warning = true;
        action = '<button id="capture-notice-ok" class="mini-button" type="button">OK</button>';
      }
    } else {
      text = "まだ送ったカードはありません";
    }
    if (app.storageWriteFailed) {
      text = `端末内に保存できていません。${text}`;
      warning = true;
    }
    el.classList.toggle("warning", warning);
    el.innerHTML = `<span>${escapeHtml(text)}</span>${action}`;
    $("#capture-status-settings")?.addEventListener("click", openCaptureSettings);
    $("#capture-send-now")?.addEventListener("click", () => sendInbox());
    $("#capture-notice-ok")?.addEventListener("click", () => {
      app.capture.lastNotice = "";
      schedulePersist();
      renderCaptureStatus();
    });
  }

  function renderCapturePosts() {
    const el = $("#capture-posts");
    if (!el) return;
    const posts = app.capture.posts.slice(0, 30);
    el.innerHTML = posts.length
      ? posts
          .map(
            (post) => `
              <article class="capture-post">
                <p>${escapeHtml(compactBody(post.body, 160))}</p>
                <small>${escapeHtml(formatDateTime(post.createdAt))} / ${escapeHtml(post.projectName)} / ${escapeHtml(post.groupTitle || "未分類")}</small>
                <span class="capture-badge ${post.sentAt ? "" : "unsent"}">${post.sentAt ? "送信済み" : "未送信"}</span>
              </article>
            `
          )
          .join("")
      : '<p class="status-line">まだありません。</p>';
  }

  function openCaptureSettings() {
    openModal(`
      <div class="modal-head">
        <h2>送り先の設定</h2>
        <button class="close-button" data-close type="button">×</button>
      </div>
      <div class="form-grid">
        <p class="status-line">カードは同期パスワードで暗号化して、GitHubのデータ用ブランチへ送ります。サイトの公開には影響しません。</p>
        ${inboxFieldsHtml("capture-settings")}
        <div class="button-row">
          <button id="capture-settings-test" class="primary-button" type="button">接続を確認</button>
          <button id="capture-settings-save" class="soft-button" type="button">保存</button>
        </div>
        <p id="capture-settings-status" class="status-line"></p>
      </div>
    `);
    bindInboxFields("capture-settings");
    $("#capture-settings-save").addEventListener("click", async () => {
      readInboxFields("capture-settings");
      app.capture.lastError = "";
      await persistState();
      closeModal();
      renderCaptureStatus();
      toast("保存しました");
      if (hasUnsentCapture()) sendInbox();
    });
    $("#capture-settings-test").addEventListener("click", () => runInboxTest("capture-settings", $("#capture-settings-status")));
  }

  async function openCanvasFromCapture() {
    app.settings.phoneView = "canvas";
    await persistState();
    startWorkspace();
  }

  async function returnToCapture() {
    app.settings.phoneView = "capture";
    finishActiveEntityDrag();
    resetViewportInteraction();
    await persistState();
    closeModal();
    showCapture();
  }

  // Shows a one-line summary when the target can be taken from the existing GitHub settings; the fields stay behind a toggle.
  // The PC only reads the public files, so with token:false no token field is rendered.
  function inboxFieldsHtml(prefix, options = {}) {
    const config = inboxConfig();
    const withToken = options.token !== false;
    const ready = Boolean(config.owner && config.repo && (!withToken || config.token));
    const label = options.label || "送り先";
    const fields = `
      <div class="field-split">
        <div class="form-row">
          <label>GitHubユーザー/組織</label>
          <input id="${prefix}-inbox-owner" value="${escapeAttr(config.owner)}" placeholder="owner" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="form-row">
          <label>リポジトリ</label>
          <input id="${prefix}-inbox-repo" value="${escapeAttr(config.repo)}" placeholder="mypage" autocapitalize="off" spellcheck="false" />
        </div>
      </div>
      <div class="${withToken ? "field-split" : "form-row"}">
        <div class="form-row">
          <label>データ用ブランチ</label>
          <input id="${prefix}-inbox-branch" value="${escapeAttr(config.branch)}" placeholder="${INBOX_BRANCH}" autocapitalize="off" spellcheck="false" />
        </div>
        ${
          withToken
            ? `<div class="form-row">
          <label>トークン</label>
          <input id="${prefix}-inbox-token" type="password" value="${escapeAttr(config.token)}" autocomplete="off" />
        </div>`
            : ""
        }
      </div>
    `;
    return `
      <div class="form-row">
        <label>同期パスワード</label>
        <input id="${prefix}-password" type="password" value="${escapeAttr(app.settings.syncPassword)}" autocomplete="current-password" />
        <small id="${prefix}-password-code" class="password-code">確認コード: …</small>
      </div>
      ${
        ready
          ? `<div class="inbox-summary">
        <strong>${escapeHtml(label)}: ${escapeHtml(config.owner)} / ${escapeHtml(config.repo)}</strong>
        <span>データ用ブランチ「${escapeHtml(config.branch)}」。${config.custom ? "個別に設定した送り先です。" : "今までのGitHub設定をそのまま使います。"}</span>
        <button id="${prefix}-inbox-toggle" class="mini-button" type="button">別の場所にする</button>
      </div>`
          : ""
      }
      <div id="${prefix}-inbox-fields" class="form-grid ${ready ? "hidden" : ""}">${fields}</div>
    `;
  }

  function bindInboxFields(prefix) {
    $(`#${prefix}-inbox-toggle`)?.addEventListener("click", (event) => {
      $(`#${prefix}-inbox-fields`).classList.remove("hidden");
      event.currentTarget.closest(".inbox-summary")?.classList.add("hidden");
    });
    const password = $(`#${prefix}-password`);
    const code = $(`#${prefix}-password-code`);
    if (!password || !code) return;
    const refresh = async () => {
      const value = password.value;
      const text = await passwordCheckCode(value);
      if (password.value !== value || !code.isConnected) return;
      code.textContent = value ? `確認コード: ${text}（PCとスマホで同じなら、パスワードは一致しています）` : "確認コード: なし（未入力）";
    };
    password.addEventListener("input", refresh);
    refresh();
  }

  // Four characters derived from the password, so two devices can compare passwords by eye without showing them.
  async function passwordCheckCode(password) {
    if (!password) return "";
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(`today-fragments-check|${password}`)));
    return Array.from(digest.subarray(0, 2), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  function readInboxFields(prefix) {
    const inbox = app.settings.inbox;
    const github = app.settings.github;
    // Hidden fields leave the stored values alone; a value equal to the GitHub setting is stored as "inherit".
    if (!$(`#${prefix}-inbox-fields`)?.classList.contains("hidden")) {
      const read = (name) => $(`#${prefix}-inbox-${name}`)?.value.trim();
      const owner = read("owner");
      const repo = read("repo");
      const branch = read("branch");
      const token = read("token");
      if (owner !== undefined) inbox.owner = owner === github.owner ? "" : owner;
      if (repo !== undefined) inbox.repo = repo === github.repo ? "" : repo;
      if (branch !== undefined) inbox.branch = branch === INBOX_BRANCH ? "" : branch;
      if (token !== undefined) inbox.token = token === github.token ? "" : token;
    }
    app.settings.syncPassword = $(`#${prefix}-password`)?.value || "";
  }

  async function runInboxTest(prefix, statusEl) {
    readInboxFields(prefix);
    statusEl.textContent = "確認中";
    try {
      statusEl.textContent = await testInboxConnection();
      await persistState();
    } catch (error) {
      statusEl.textContent = error.message || "確認に失敗しました";
    }
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
    els.projectSwitcher?.addEventListener("click", () => openProjectsModal(false));
    els.listModeToggle?.addEventListener("click", toggleMobileListMode);
    els.panelToggle.addEventListener("click", togglePanels);
    els.syncStatus.addEventListener("click", onSyncStatusClick);
    els.undoAction.addEventListener("click", undo);
    els.redoAction.addEventListener("click", redo);
    els.resetView?.addEventListener("click", resetViewToContent);
    els.movementLock.addEventListener("click", toggleMovementLock);
    els.workspace.addEventListener("contextmenu", (event) => {
      if (event.target.closest?.(".note-card, .group-node, .connection-path, .line-layer")) event.preventDefault();
    });
    document.addEventListener("dragstart", guardNativeWorkspaceDrag, true);
    document.addEventListener("selectstart", guardWorkspaceSelection, true);
    document.addEventListener("drop", guardNativeWorkspaceDrag, true);
    document.addEventListener("dragover", guardNativeWorkspaceDrag, true);
    els.workspace.addEventListener("wheel", onWheel, { passive: false });
    els.workspace.addEventListener("pointerdown", onWorkspacePointerDown, true);
    window.addEventListener("pointermove", onWorkspacePointerMove, true);
    window.addEventListener("pointerup", onWorkspacePointerUp, true);
    window.addEventListener("pointercancel", onWorkspacePointerUp, true);
    window.addEventListener("blur", () => {
      finishActiveEntityDrag();
      resetViewportInteraction();
    });
    window.addEventListener("resize", () => {
      if (isCaptureVisible()) return;
      applyPerformanceMode();
      applyMobileListMode();
      if (!useLightweightEffects()) initWebGl();
      resizeGlCanvas();
      initParticles();
      updateParticleTarget(true);
      renderAll();
    });
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        finishActiveEntityDrag();
        resetViewportInteraction();
        persistState();
        if (app.settings.role === "phone") saveDriveNow();
        if (app.settings.role === "pc" && hasUnsavedBackup()) saveBackupNow();
      }
      // Try again when the app comes back or before it goes to sleep; failures fall back to the retry timer.
      if (app.settings.role === "phone" && hasUnsentCapture()) sendInbox();
      if (app.settings.role === "pc" && document.visibilityState === "visible") {
        const lastChecked = Date.parse(app.inboxLedger.lastCheckedAt || "") || 0;
        if (Date.now() - lastChecked > 60000) receiveInbox();
      }
    });
    window.addEventListener("online", () => {
      if (app.settings.role === "phone" && hasUnsentCapture()) sendInbox();
    });
  }

  function autosizeComposer() {
    els.quickNote.style.height = "auto";
    els.quickNote.style.height = `${Math.min(160, els.quickNote.scrollHeight)}px`;
  }

  function initParticles() {
    if (!els.particleLayer) return;
    const mobile = useLightweightEffects();
    if (mobile) {
      const key = "mobile-off";
      if (els.particleLayer.dataset.key === key) return;
      els.particleLayer.dataset.key = key;
      els.particleLayer.innerHTML = "";
      els.particleLayer.style.setProperty("--particle-image", "none");
      els.particleLayer.style.setProperty("--particle-opacity", "0");
      return;
    }
    // A small, repeating tile keeps the ambient layer inexpensive even on wide screens.
    const tileSize = 320;
    const count = 8;
    const key = `d:${tileSize}:${count}`;
    if (els.particleLayer.dataset.key === key) return;
    els.particleLayer.dataset.key = key;
    const colors = ["#e9fcff", "#78f3ff", "#ff9fca", "#ffe38a", "#a8ffd7", "#c5adff"];
    const gradients = Array.from({ length: count }, (_, index) => {
      const accent = index % 6 === 0;
      const size = randomBetween(0.42, accent ? 1.35 : 0.92);
      const fade = size * 2.05;
      const opacity = randomBetween(0.52, 0.84);
      const color = colors[Math.floor(Math.random() * colors.length)];
      const x = randomBetween(18, tileSize - 18);
      const y = randomBetween(18, tileSize - 18);
      return `radial-gradient(circle at ${x.toFixed(1)}px ${y.toFixed(1)}px, ${hexToRgba(color, opacity)} 0 ${size.toFixed(2)}px, transparent ${fade.toFixed(2)}px)`;
    });
    els.particleLayer.innerHTML = "";
    els.particleLayer.style.setProperty("--particle-tile-size", `${tileSize}px`);
    els.particleLayer.style.setProperty("--particle-image", gradients.join(","));
    els.particleLayer.style.setProperty("--particle-opacity", "0.84");
    els.particleLayer.style.setProperty("--particle-duration", "32s");
    els.particleLayer.style.setProperty("--particle-drift-x", "15px");
    els.particleLayer.style.setProperty("--particle-drift-y", "-10px");
    els.particleLayer.style.setProperty("--particle-return-x", "-8px");
    els.particleLayer.style.setProperty("--particle-return-y", "7px");
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(2)})`;
  }

  function renderAll() {
    updateProjectTitle();
    renderGroups();
    renderConnections();
    renderCards();
    renderMobileList();
    renderInspector();
    updateStatus();
  }

  function renderGroups() {
    const groups = app.data.groups
      .filter((group) => isVisibleEntity(group))
      .sort((a, b) => {
        const aSelected = app.selected?.type === "group" && app.selected.id === a.id;
        const bSelected = app.selected?.type === "group" && app.selected.id === b.id;
        if (aSelected !== bSelected) return aSelected ? 1 : -1;
        return b.w * b.h - a.w * a.h || app.data.groups.indexOf(a) - app.data.groups.indexOf(b);
      });
    els.groupLayer.innerHTML = groups
      .map((group) => {
        const selected = app.selected?.type === "group" && app.selected.id === group.id;
        const cardCount = getGroupNotes(group.id).length;
        const radius = groupRadius(group, cardCount);
        const seed = hashNumber(group.id);
        const delay = -(seed % 4200);
        const rotate = ((seed % 9) - 4) * 0.26;
        return `
          <article class="group-node ${selected ? "selected" : ""} ${cardCount ? "has-cards" : ""} ${group.locked ? "locked" : ""}" data-id="${escapeAttr(group.id)}" draggable="false" style="left:${group.x}px;top:${group.y}px;width:${group.w}px;height:${group.h}px;--group-color:${group.color};--group-radius:${radius};--float-delay:${delay}ms;--float-rotate:${rotate}deg">
            <span class="group-label" draggable="false">${escapeHtml(group.title || "グループ")}</span>
            ${group.locked ? '<span class="lock-badge">LOCK</span>' : ""}
            <span class="resize-handle" data-resize="${escapeAttr(group.id)}"></span>
          </article>
        `;
      })
      .join("");
    $$(".group-node", els.groupLayer).forEach((node) => {
      const id = node.dataset.id;
      node.addEventListener("pointerdown", (event) => {
        const targetId = pickGroupAt(event.clientX, event.clientY)?.id || id;
        if (!handleEntityPointerDown(event, "group", targetId)) return;
        const isResize = event.target.closest(".resize-handle");
        beginEntityDrag(event, isResize && targetId === id ? "resize-group" : "group", targetId);
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
        const seed = hashNumber(note.id);
        const delay = -(seed % 3600);
        const rotate = ((seed % 11) - 5) * 0.32;
        return `
          <article class="note-card ${selected ? "selected" : ""} ${primaryGroup ? "grouped" : ""} ${note.locked ? "locked" : ""}" data-id="${escapeAttr(note.id)}" draggable="false" style="left:${note.x}px;top:${note.y}px;--card-color:${primaryGroup?.color || "#67e8f9"};--float-delay:${delay}ms;--float-rotate:${rotate}deg">
            <h2 class="note-title" draggable="false">${escapeHtml(title || "無題")}</h2>
            ${note.locked ? '<span class="lock-badge">LOCK</span>' : ""}
          </article>
        `;
      })
      .join("");
    $$(".note-card", els.cardLayer).forEach((node) => {
      const id = node.dataset.id;
      node.addEventListener("pointerdown", (event) => {
        if (!handleEntityPointerDown(event, "note", id)) return;
        beginEntityDrag(event, "note", id);
      });
    });
  }

  function renderMobileList() {
    if (!els.mobileList) return;
    const groups = app.data.groups.filter((group) => isVisibleEntity(group));
    const groupById = Object.fromEntries(groups.map((group) => [group.id, group]));
    const notes = app.data.notes
      .filter((note) => isVisibleEntity(note))
      .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
    els.mobileList.innerHTML = `
      <div class="mobile-list-head">
        <strong>${escapeHtml(currentProject()?.name || DEFAULT_PROJECT_NAME)}</strong>
        <span>${notes.length}件</span>
      </div>
      <div class="mobile-list-items">
        ${
          notes.length
            ? notes
                .map((note) => {
                  const selected = app.selected?.type === "note" && app.selected.id === note.id;
                  const title = note.title || deriveTitle(note.body) || "無題";
                  const groupNames = (note.groupIds || []).map((id) => groupById[id]?.title).filter(Boolean);
                  return `
                    <button class="mobile-list-item ${selected ? "selected" : ""}" type="button" data-id="${escapeAttr(note.id)}">
                      <strong>${escapeHtml(title)}</strong>
                      <span>${escapeHtml(compactBody(note.body || "", 96))}</span>
                      <small>${formatDateTime(note.createdAt)}${groupNames.length ? ` / ${escapeHtml(groupNames.join("・"))}` : ""}</small>
                    </button>
                  `;
                })
                .join("")
            : '<p class="status-line">カードはまだありません。</p>'
        }
      </div>
    `;
    $$(".mobile-list-item", els.mobileList).forEach((button) => {
      button.addEventListener("click", () => {
        app.panelsCollapsed = false;
        app.settings.panelsCollapsed = false;
        applyPanelState();
        selectEntity("note", button.dataset.id);
      });
    });
  }

  function renderConnections() {
    const connections = app.data.connections.filter((connection) => isVisibleEntity(connection) && resolveEndpoint(connection.from) && resolveEndpoint(connection.to));
    els.lineLayer.innerHTML = `
      ${connections
        .map((connection) => {
          const kind = getConnectionKind(connection.kind);
          const selected = app.selected?.type === "connection" && app.selected.id === connection.id;
          const d = connectionPath(connection);
          const points = connectionPoints(connection);
          if (!points) return "";
          return `
            <g class="connection-node ${selected ? "selected" : ""}" data-id="${escapeAttr(connection.id)}" style="--connection-color:${kind.color}">
              <path class="connection-path connection-hit" d="${d}"></path>
              <path class="connection-path connection-main ${connection.style}" d="${d}"></path>
              <path class="connection-path connection-flow ${connection.style}" d="${d}"></path>
              <circle class="connection-point start" cx="${points.from.x}" cy="${points.from.y}" r="5"></circle>
              <circle class="connection-point end" cx="${points.to.x}" cy="${points.to.y}" r="6.5"></circle>
            </g>
          `;
        })
        .join("")}
    `;
    $$(".connection-node", els.lineLayer).forEach((node) => {
      const id = node.dataset.id;
      node.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        selectEntity("connection", id);
      });
      node.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        cycleConnectionStyle(id);
      });
    });
  }

  function handleEntityPointerDown(event, type, id) {
    if (event.button === 2) {
      beginConnectionDrag(event, type, id);
      return false;
    }
    if (app.connectionDraft) {
      event.preventDefault();
      event.stopPropagation();
      completeConnectionDraft(type, id);
      return false;
    }
    const entity = findEntity(type, id);
    const movementBlocked = isEntityMovementBlocked(entity);
    if (usesMobileEntityMode(event)) {
      if (!movementBlocked && isSelectedEntity(type, id)) {
        event.preventDefault();
        event.stopPropagation();
        selectEntity(type, id, { render: false });
        return true;
      }
      event.preventDefault();
      event.stopPropagation();
      beginViewportInteraction(event, { type, id });
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    selectEntity(type, id, { render: false });
    if (movementBlocked) {
      beginViewportInteraction(event, { type, id });
      return false;
    }
    return true;
  }

  function guardNativeWorkspaceDrag(event) {
    if (!isWorkspaceInteractionTarget(event.target)) return;
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    clearTextSelection();
  }

  function guardWorkspaceSelection(event) {
    if (!isWorkspaceInteractionTarget(event.target)) return;
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    clearTextSelection();
  }

  function isWorkspaceInteractionTarget(target) {
    return Boolean(target?.closest?.(".workspace"));
  }

  function isEditableTarget(target) {
    return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true'], .inspector, .composer, .modal-root"));
  }

  function clearTextSelection() {
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) selection.removeAllRanges();
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
    } else if (app.selected.type === "group") {
      renderGroupInspector(selected);
    } else {
      renderConnectionInspector(selected);
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
        <button id="inspect-note-lock" class="soft-button lock-control ${note.locked ? "active" : ""}" type="button">
          ${note.locked ? "位置ロック中" : "位置をロック"}
        </button>
        ${renderConnectionControls("note", note.id)}
        <div class="button-row">
          <button id="inspect-note-trash" class="danger-button" type="button">ゴミ箱へ</button>
        </div>
      </div>
    `;
    let noteEditCaptured = false;
    const captureNoteEdit = () => {
      if (noteEditCaptured) return;
      captureHistory();
      noteEditCaptured = true;
    };
    $("#inspect-note-title").addEventListener("input", (event) => {
      captureNoteEdit();
      note.title = event.target.value;
      touchEntity("note", note.id);
      renderCards();
      renderMobileList();
    });
    $("#inspect-note-body").addEventListener("input", (event) => {
      captureNoteEdit();
      note.body = event.target.value;
      note.localDate = localDate(note.createdAt);
      touchEntity("note", note.id);
      renderCards();
      renderMobileList();
    });
    bindConnectionControls("note", note.id);
    $("#inspect-note-lock").addEventListener("click", () => toggleEntityLock("note", note.id));
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
        <button id="inspect-group-lock" class="soft-button lock-control ${group.locked ? "active" : ""}" type="button">
          ${group.locked ? "位置ロック中" : "位置をロック"}
        </button>
        ${renderConnectionControls("group", group.id)}
        <div class="button-row">
          <button id="inspect-group-trash" class="danger-button" type="button">ゴミ箱へ</button>
        </div>
      </div>
    `;
    let groupEditCaptured = false;
    const captureGroupEdit = () => {
      if (groupEditCaptured) return;
      captureHistory();
      groupEditCaptured = true;
    };
    $("#inspect-group-title").addEventListener("input", (event) => {
      captureGroupEdit();
      group.title = event.target.value;
      touchEntity("group", group.id);
      renderGroups();
      renderMobileList();
    });
    $("#inspect-group-color").addEventListener("change", (event) => {
      captureHistory();
      group.color = event.target.value;
      touchEntity("group", group.id);
      renderGroups();
      renderCards();
      renderMobileList();
    });
    bindConnectionControls("group", group.id);
    $("#inspect-group-lock").addEventListener("click", () => toggleEntityLock("group", group.id));
    $("[data-close-inspector]").addEventListener("click", clearSelection);
    $("#inspect-group-trash").addEventListener("click", () => moveToTrash("group", group.id));
  }

  function renderConnectionInspector(connection) {
    const fromLabel = endpointLabel(connection.from);
    const toLabel = endpointLabel(connection.to);
    els.inspector.innerHTML = `
      <div class="inspector-head">
        <h2>線</h2>
        <button class="inspector-close" data-close-inspector type="button" aria-label="閉じる">×</button>
      </div>
      <div class="form-grid">
        <div class="pill">${escapeHtml(fromLabel)} → ${escapeHtml(toLabel)}</div>
        <div class="field-split">
          <div class="form-row">
            <label>意味</label>
            <select id="inspect-connection-kind">
              ${CONNECTION_KINDS.map((kind) => `<option value="${kind.id}" ${connection.kind === kind.id ? "selected" : ""}>${kind.label}</option>`).join("")}
            </select>
          </div>
          <div class="form-row">
            <label>線種</label>
            <select id="inspect-connection-style">
              ${CONNECTION_STYLES.map((style) => `<option value="${style}" ${connection.style === style ? "selected" : ""}>${connectionStyleLabel(style)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="button-row">
          <button id="inspect-connection-trash" class="danger-button" type="button">削除</button>
        </div>
      </div>
    `;
    $("#inspect-connection-kind").addEventListener("change", (event) => {
      captureHistory();
      connection.kind = event.target.value;
      touchEntity("connection", connection.id);
      renderConnections();
    });
    $("#inspect-connection-style").addEventListener("change", (event) => {
      captureHistory();
      connection.style = event.target.value;
      touchEntity("connection", connection.id);
      renderConnections();
    });
    $("[data-close-inspector]").addEventListener("click", clearSelection);
    $("#inspect-connection-trash").addEventListener("click", () => moveToTrash("connection", connection.id));
  }

  function renderConnectionControls(type, id) {
    return `
      <div class="field-split">
        <div class="form-row">
          <label>線の意味</label>
          <select id="connection-kind">
            ${CONNECTION_KINDS.map((kind) => `<option value="${kind.id}">${kind.label}</option>`).join("")}
          </select>
        </div>
        <div class="form-row">
          <label>接続</label>
          <button id="connection-start" class="soft-button" type="button" data-type="${escapeAttr(type)}" data-id="${escapeAttr(id)}">接続開始</button>
        </div>
      </div>
    `;
  }

  function bindConnectionControls(type, id) {
    $("#connection-start")?.addEventListener("click", () => {
      app.connectionDraft = { type, id, kind: $("#connection-kind")?.value || "related" };
      toast("接続先をタップしてください");
      els.workspace.classList.add("connecting");
    });
  }

  function createNote(body) {
    captureHistory();
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
    captureHistory();
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
    app.connectionDraft = null;
    els.workspace.classList.remove("connecting");
    renderAll();
  }

  function updateSelectionClasses() {
    $$(".note-card", els.cardLayer).forEach((node) => {
      node.classList.toggle("selected", app.selected?.type === "note" && app.selected.id === node.dataset.id);
    });
    $$(".group-node", els.groupLayer).forEach((node) => {
      node.classList.toggle("selected", app.selected?.type === "group" && app.selected.id === node.dataset.id);
    });
    $$(".connection-node", els.lineLayer).forEach((node) => {
      node.classList.toggle("selected", app.selected?.type === "connection" && app.selected.id === node.dataset.id);
    });
  }

  function getSelectedEntity() {
    if (!app.selected) return null;
    if (app.selected.type === "note") return findNote(app.selected.id);
    if (app.selected.type === "group") return findGroup(app.selected.id);
    return findConnection(app.selected.id);
  }

  function isSelectedEntity(type, id) {
    return app.selected?.type === type && app.selected.id === id;
  }

  function getGroupNotes(groupId) {
    return app.data.notes.filter((note) => isVisibleEntity(note) && note.groupIds?.includes(groupId));
  }

  function getNotePrimaryGroup(note) {
    return (note.groupIds || []).map((id) => findGroup(id)).find((group) => group && isVisibleEntity(group)) || null;
  }

  function getConnectionKind(kindId) {
    return CONNECTION_KINDS.find((kind) => kind.id === kindId) || CONNECTION_KINDS[0];
  }

  function connectionStyleLabel(style) {
    return {
      solid: "実線",
      dotted: "点線",
      dashed: "破線",
      wavy: "波線"
    }[style] || "実線";
  }

  function endpointLabel(endpoint) {
    const entity = resolveEndpoint(endpoint);
    if (!entity) return "不明";
    if (endpoint.type === "group") return entity.title || "グループ";
    return entity.title || deriveTitle(entity.body) || "無題";
  }

  function resolveEndpoint(endpoint) {
    if (!endpoint?.id) return null;
    const entity = endpoint.type === "group" ? findGroup(endpoint.id) : findNote(endpoint.id);
    return isVisibleEntity(entity) ? entity : null;
  }

  function endpointBounds(endpoint) {
    const entity = resolveEndpoint(endpoint);
    if (!entity) return null;
    if (endpoint.type === "group") {
      return { x: entity.x, y: entity.y, w: entity.w, h: entity.h };
    }
    return noteBounds(entity);
  }

  function connectionPath(connection) {
    const points = connectionPoints(connection);
    if (!points) return "";
    if (connection.style === "wavy") return wavyPath(points.from, points.to);
    const controls = curvedControls(points.from, points.to);
    return `M ${points.from.x} ${points.from.y} C ${controls.c1.x} ${controls.c1.y}, ${controls.c2.x} ${controls.c2.y}, ${points.to.x} ${points.to.y}`;
  }

  function connectionPoints(connection) {
    const fromBounds = endpointBounds(connection.from);
    const toBounds = endpointBounds(connection.to);
    if (!fromBounds || !toBounds) return null;
    const fromCenter = rectCenter(fromBounds);
    const toCenter = rectCenter(toBounds);
    const from = edgePoint(fromBounds, toCenter);
    const to = edgePoint(toBounds, fromCenter);
    return { from, to };
  }

  function rectCenter(rect) {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }

  function edgePoint(rect, toward) {
    const center = rectCenter(rect);
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    const scale = 0.5 / Math.max(Math.abs(dx) / rect.w || 0.001, Math.abs(dy) / rect.h || 0.001);
    return {
      x: Math.round(center.x + dx * scale),
      y: Math.round(center.y + dy * scale)
    };
  }

  function curvedControls(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const bend = clamp(length * 0.18, 28, 120);
    return {
      c1: {
        x: Math.round(from.x + dx * 0.32 + nx * bend),
        y: Math.round(from.y + dy * 0.32 + ny * bend)
      },
      c2: {
        x: Math.round(from.x + dx * 0.68 + nx * bend),
        y: Math.round(from.y + dy * 0.68 + ny * bend)
      }
    };
  }

  function cubicPoint(from, c1, c2, to, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * to.x,
      y: mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * to.y
    };
  }

  function cubicTangent(from, c1, c2, to, t) {
    const mt = 1 - t;
    return {
      x: 3 * mt * mt * (c1.x - from.x) + 6 * mt * t * (c2.x - c1.x) + 3 * t * t * (to.x - c2.x),
      y: 3 * mt * mt * (c1.y - from.y) + 6 * mt * t * (c2.y - c1.y) + 3 * t * t * (to.y - c2.y)
    };
  }

  function wavyPath(from, to) {
    const controls = curvedControls(from, to);
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const steps = Math.max(18, Math.ceil(length / 10));
    const cycles = Math.max(2, Math.round(length / 86));
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const base = cubicPoint(from, controls.c1, controls.c2, to, t);
      const tangent = cubicTangent(from, controls.c1, controls.c2, to, t);
      const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
      const nx = -tangent.y / tangentLength;
      const ny = tangent.x / tangentLength;
      const taper = Math.sin(Math.PI * t);
      const wave = Math.sin(t * Math.PI * 2 * cycles) * 5.8 * taper;
      points.push({
        x: base.x + nx * wave,
        y: base.y + ny * wave
      });
    }
    if (points.length < 3) return `M ${formatCoord(from.x)} ${formatCoord(from.y)} L ${formatCoord(to.x)} ${formatCoord(to.y)}`;
    const segments = [`M ${formatCoord(points[0].x)} ${formatCoord(points[0].y)}`];
    for (let i = 1; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const mid = {
        x: (current.x + next.x) / 2,
        y: (current.y + next.y) / 2
      };
      segments.push(`Q ${formatCoord(current.x)} ${formatCoord(current.y)} ${formatCoord(mid.x)} ${formatCoord(mid.y)}`);
    }
    const last = points[points.length - 1];
    segments.push(`T ${formatCoord(last.x)} ${formatCoord(last.y)}`);
    return segments.join(" ");
  }

  function formatCoord(value) {
    return Number(value.toFixed(2));
  }

  function cycleConnectionStyle(id) {
    const connection = findConnection(id);
    if (!connection) return;
    captureHistory();
    const index = CONNECTION_STYLES.indexOf(connection.style);
    connection.style = CONNECTION_STYLES[(index + 1) % CONNECTION_STYLES.length];
    touchEntity("connection", id);
    selectEntity("connection", id);
  }

  function beginConnectionDrag(event, type, id) {
    event.preventDefault();
    event.stopPropagation();
    const from = { type, id };
    const fromBounds = endpointBounds(from);
    if (!fromBounds) return;
    const fromPoint = edgePoint(fromBounds, screenToWorld(event.clientX, event.clientY));
    const draft = document.createElementNS("http://www.w3.org/2000/svg", "path");
    draft.classList.add("connection-path", "connection-draft");
    els.lineLayer.appendChild(draft);
    const draw = (clientX, clientY) => {
      const to = screenToWorld(clientX, clientY);
      const target = { x: Math.round(to.x), y: Math.round(to.y) };
      const controls = curvedControls(fromPoint, target);
      draft.setAttribute("d", `M ${fromPoint.x} ${fromPoint.y} C ${controls.c1.x} ${controls.c1.y}, ${controls.c2.x} ${controls.c2.y}, ${target.x} ${target.y}`);
    };
    draw(event.clientX, event.clientY);
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      moveEvent.preventDefault();
      draw(moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      draft.remove();
      const target = entityFromPoint(upEvent.clientX, upEvent.clientY);
      if (target) createConnection(from, target, "related");
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }

  function entityFromPoint(x, y) {
    const node = document.elementFromPoint(x, y)?.closest?.(".note-card, .group-node");
    if (!node) return null;
    return {
      type: node.classList.contains("group-node") ? "group" : "note",
      id: node.dataset.id
    };
  }

  function completeConnectionDraft(type, id) {
    const draft = app.connectionDraft;
    if (!draft) return;
    app.connectionDraft = null;
    els.workspace.classList.remove("connecting");
    createConnection({ type: draft.type, id: draft.id }, { type, id }, draft.kind || "related");
  }

  function createConnection(from, to, kind = "related") {
    if (!from.id || !to.id || (from.type === to.type && from.id === to.id)) {
      toast("同じ対象には接続できません");
      return;
    }
    const existing = app.data.connections.find(
      (connection) =>
        isVisibleEntity(connection) &&
        connection.kind === kind &&
        connection.from.type === from.type &&
        connection.from.id === from.id &&
        connection.to.type === to.type &&
        connection.to.id === to.id
    );
    if (existing) {
      selectEntity("connection", existing.id);
      toast("既に接続されています");
      return;
    }
    captureHistory();
    const timestamp = nowIso();
    const connection = {
      id: uid("connection"),
      from,
      to,
      kind,
      style: "solid",
      createdAt: timestamp,
      updatedAt: timestamp,
      trashedAt: "",
      deletedAt: ""
    };
    app.data.connections.push(connection);
    touchEntity("connection", connection.id, { alreadyUpdated: true });
    selectEntity("connection", connection.id);
    toast("接続しました");
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

  function getContainingGroups(note, groups = app.data.groups) {
    const center = noteCenter(note);
    return groups
      .filter((group) => isVisibleEntity(group))
      .filter((group) => center.x >= group.x && center.x <= group.x + group.w && center.y >= group.y && center.y <= group.y + group.h)
      .sort((a, b) => a.w * a.h - b.w * b.h);
  }

  function pickGroupAt(clientX, clientY) {
    const point = screenToWorld(clientX, clientY);
    return app.data.groups
      .filter((group) => isVisibleEntity(group))
      .filter((group) => point.x >= group.x && point.x <= group.x + group.w && point.y >= group.y && point.y <= group.y + group.h)
      .sort((a, b) => a.w * a.h - b.w * b.h || app.data.groups.indexOf(b) - app.data.groups.indexOf(a))[0];
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
    finishActiveEntityDrag();
    resetViewportInteraction();
    clearTextSelection();
    const note = type === "note" ? findNote(id) : null;
    const group = type === "group" || type === "resize-group" ? findGroup(id) : null;
    const target = note || group;
    if (!target) return;
    if (isEntityMovementBlocked(target)) return;
    const childStarts =
      type === "group"
        ? app.data.notes
            .filter((candidate) => isVisibleEntity(candidate) && candidate.groupIds?.includes(id))
            .map((candidate) => ({
              note: candidate,
              x: candidate.x,
              y: candidate.y,
              node: getEntityNode("note", candidate.id)
            }))
        : [];
    const node = getEntityNode(type, id) || event.currentTarget;
    if (!node?.classList) return;
    const historySnapshot = makeHistorySnapshot();
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      // Some mobile browsers are picky about pointer capture; window listeners still keep drag alive.
    }
    node.classList.add("dragging");
    document.body.classList.add("dragging-entity");
    const start = {
      pointerId: event.pointerId,
      type,
      id,
      sx: event.clientX,
      sy: event.clientY,
      wx: screenToWorld(event.clientX, event.clientY).x,
      wy: screenToWorld(event.clientX, event.clientY).y,
      x: target.x,
      y: target.y,
      w: target.w,
      h: target.h,
      groupIds: note ? [...(note.groupIds || [])] : [],
      moved: false
    };
    let lastClientX = event.clientX;
    let lastClientY = event.clientY;
    let autoPanFrame = 0;
    const placeTarget = (clientX, clientY) => {
      const current = screenToWorld(clientX, clientY);
      const dx = current.x - start.wx;
      const dy = current.y - start.wy;
      start.moved = start.moved || Math.abs(clientX - start.sx) + Math.abs(clientY - start.sy) > 3;
      if (type === "resize-group") {
        group.w = Math.round(clamp(start.w + dx, 180, 1200));
        group.h = Math.round(clamp(start.h + dy, 140, 900));
        node.style.width = `${group.w}px`;
        node.style.height = `${group.h}px`;
        renderConnections();
        return;
      }
      target.x = Math.round(start.x + dx);
      target.y = Math.round(start.y + dy);
      node.style.left = `${target.x}px`;
      node.style.top = `${target.y}px`;
      if (type === "group") {
        childStarts.forEach((child) => {
          child.note.x = Math.round(child.x + dx);
          child.note.y = Math.round(child.y + dy);
          if (child.node) {
            child.node.style.left = `${child.note.x}px`;
            child.node.style.top = `${child.note.y}px`;
          }
        });
      }
      if (type === "note") updateDropHighlight(note);
      renderConnections();
    };
    const autoPan = () => {
      autoPanFrame = 0;
      const pan = viewportEdgePan(lastClientX, lastClientY);
      if (!pan.x && !pan.y) return;
      start.moved = true;
      app.view.x += pan.x;
      app.view.y += pan.y;
      updateWorldTransform();
      placeTarget(lastClientX, lastClientY);
      autoPanFrame = requestAnimationFrame(autoPan);
    };
    const ensureAutoPan = () => {
      const pan = viewportEdgePan(lastClientX, lastClientY);
      if ((pan.x || pan.y) && !autoPanFrame) autoPanFrame = requestAnimationFrame(autoPan);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      if (autoPanFrame) {
        cancelAnimationFrame(autoPanFrame);
        autoPanFrame = 0;
      }
      try {
        node.releasePointerCapture(start.pointerId);
      } catch {
        // Ignore browsers that already released capture.
      }
      node.classList.remove("dragging");
      document.body.classList.remove("dragging-entity");
      clearDropHighlights();
      if (start.moved) {
        rememberHistorySnapshot(historySnapshot);
        if (type === "note") {
          updateNoteGroups(note);
          fitGroupsToCards([...start.groupIds, ...(note.groupIds || [])], { markTouched: true });
          touchEntity("note", id);
        } else {
          if (type === "group") {
            childStarts.forEach((child) => touchEntity("note", child.note.id));
          }
          touchEntity("group", id);
          updateAllNoteGroups(true);
        }
      }
      app.activeEntityDrag = null;
      renderAll();
    };
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      moveEvent.preventDefault();
      lastClientX = moveEvent.clientX;
      lastClientY = moveEvent.clientY;
      placeTarget(lastClientX, lastClientY);
      ensureAutoPan();
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== start.pointerId) return;
      upEvent.preventDefault();
      finish();
    };
    app.activeEntityDrag = { pointerId: start.pointerId, finish };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }

  function finishActiveEntityDrag() {
    const active = app.activeEntityDrag;
    if (!active) return;
    active.finish();
  }

  function getEntityNode(type, id) {
    const layer = type === "note" ? els.cardLayer : els.groupLayer;
    return Array.from(layer.querySelectorAll(type === "note" ? ".note-card" : ".group-node")).find((node) => node.dataset.id === id) || null;
  }

  function updateAllNoteGroups(markTouched = false) {
    app.data.notes.filter((note) => isVisibleEntity(note)).forEach((note) => {
      const changed = updateNoteGroups(note);
      if (changed && markTouched) touchEntity("note", note.id);
    });
  }

  function updateAllNoteGroupsIn(data) {
    data.notes.filter((note) => isVisibleEntity(note)).forEach((note) => updateNoteGroups(note, data.groups));
  }

  function updateNoteGroups(note, groups = app.data.groups) {
    const groupIds = getContainingGroups(note, groups).map((group) => group.id);
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
      if (group.locked) return;
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

  function viewportEdgePan(clientX, clientY) {
    const margin = useLightweightEffects() ? 86 : 72;
    const maxSpeed = useLightweightEffects() ? 9 : 14;
    const edgeSpeed = (distance) => {
      if (distance >= margin) return 0;
      const amount = 1 - clamp(distance / margin, 0, 1);
      return Math.round(maxSpeed * amount * amount * 100) / 100;
    };
    return {
      x: edgeSpeed(clientX) - edgeSpeed(window.innerWidth - clientX),
      y: edgeSpeed(clientY) - edgeSpeed(window.innerHeight - clientY)
    };
  }

  function onWorkspacePointerDown(event) {
    if (app.selected && isInspectorDismissTarget(event.target)) clearSelection();
    if (shouldLetTargetHandlePointer(event.target)) return;
    const group = pickGroupAt(event.clientX, event.clientY);
    if (group) {
      const resizeHandle = event.target.closest?.(".resize-handle");
      const handleGroupId = resizeHandle?.closest?.(".group-node")?.dataset?.id;
      const mode = resizeHandle && handleGroupId === group.id ? "resize-group" : "group";
      if (handleEntityPointerDown(event, "group", group.id)) {
        beginEntityDrag(event, mode, group.id);
      }
      return;
    }
    if (!isViewportPanTarget(event.target)) return;
    beginViewportInteraction(event);
  }

  function shouldLetTargetHandlePointer(target) {
    return Boolean(
      target?.closest?.(
        ".note-card, .connection-node, .connection-path, .inspector, .composer, .toolbar, .topbar, .modal-root, button, input, textarea, select, a"
      )
    );
  }

  function beginViewportInteraction(event, tapTarget = null) {
    event.preventDefault();
    const shouldResetStalePointers = event.pointerType !== "touch" || event.isPrimary;
    if (shouldResetStalePointers && app.pointers.size && !app.pointers.has(event.pointerId)) {
      resetViewportInteraction();
    }
    try {
      els.workspace.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is not always available on mobile Safari.
    }
    app.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (tapTarget) {
      app.entityTapCandidates.set(event.pointerId, {
        ...tapTarget,
        x: event.clientX,
        y: event.clientY
      });
    }
    if (app.pointers.size === 1) {
      app.panStart = { x: event.clientX, y: event.clientY, vx: app.view.x, vy: app.view.y };
    }
    if (app.pointers.size === 2) {
      app.pinchStart = makePinchState();
    }
  }

  function onWorkspacePointerMove(event) {
    if (!app.pointers.has(event.pointerId)) return;
    event.preventDefault();
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
    if (!app.pointers.has(event.pointerId)) return;
    event.preventDefault();
    const tapTarget = app.entityTapCandidates.get(event.pointerId);
    if (tapTarget && Math.hypot(event.clientX - tapTarget.x, event.clientY - tapTarget.y) < 10) {
      handleEntityTap(tapTarget.type, tapTarget.id, event);
    }
    app.entityTapCandidates.delete(event.pointerId);
    app.pointers.delete(event.pointerId);
    if (app.pointers.size < 2) app.pinchStart = null;
    if (app.pointers.size === 0) resetViewportInteraction();
  }

  function resetViewportInteraction() {
    app.pointers.clear();
    app.entityTapCandidates.clear();
    app.panStart = null;
    app.pinchStart = null;
  }

  function handleEntityTap(type, id, event) {
    const now = Date.now();
    const last = app.lastEntityTap;
    const isDoubleTap =
      last &&
      last.type === type &&
      last.id === id &&
      now - last.time < 360 &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) < 28;
    app.lastEntityTap = { type, id, time: now, x: event.clientX, y: event.clientY };
    if (!isDoubleTap) return;
    app.panelsCollapsed = false;
    app.settings.panelsCollapsed = false;
    applyPanelState();
    persistState();
    selectEntity(type, id);
  }

  function usesMobileEntityMode(event) {
    return event.pointerType === "touch" || isSmallViewport();
  }

  function togglePanels() {
    app.panelsCollapsed = !app.panelsCollapsed;
    app.settings.panelsCollapsed = app.panelsCollapsed;
    applyPanelState();
    persistState();
  }

  function toggleMobileListMode() {
    app.settings.mobileListMode = !app.settings.mobileListMode;
    applyMobileListMode();
    renderMobileList();
    persistState();
  }

  function applyMobileListMode() {
    const active = Boolean(app.settings.mobileListMode && isSmallViewport());
    els.workspace.classList.toggle("mobile-list-mode", active);
    els.listModeToggle?.classList.toggle("active", active);
    els.listModeToggle?.setAttribute("aria-pressed", active ? "true" : "false");
  }

  function applyPanelState() {
    els.workspace.classList.toggle("panels-collapsed", app.panelsCollapsed);
    els.panelToggle.textContent = app.panelsCollapsed ? "▥" : "▤";
  }

  function makeHistorySnapshot() {
    return {
      data: sanitizeData(app.data),
      selected: app.selected ? { ...app.selected } : null,
      movementLocked: Boolean(app.settings.movementLocked)
    };
  }

  function captureHistory() {
    if (app.history.restoring || !app.data) return;
    rememberHistorySnapshot(makeHistorySnapshot());
  }

  function rememberHistorySnapshot(snapshot) {
    if (app.history.restoring || !snapshot) return;
    app.history.undo.push(snapshot);
    if (app.history.undo.length > 80) app.history.undo.shift();
    app.history.redo = [];
    updateUndoRedoButtons();
  }

  function restoreHistorySnapshot(snapshot) {
    app.history.restoring = true;
    app.data = normalizeData(snapshot.data || createEmptyData());
    app.selected = validateSelection(snapshot.selected);
    app.settings.movementLocked = Boolean(snapshot.movementLocked);
    app.history.restoring = false;
    markRestoredDataDirty();
    applyMovementLockState();
    renderAll();
    persistState();
    if (app.settings.role === "phone") scheduleDriveSave();
    updateUndoRedoButtons();
  }

  function undo() {
    const snapshot = app.history.undo.pop();
    if (!snapshot) return;
    app.history.redo.push(makeHistorySnapshot());
    restoreHistorySnapshot(snapshot);
  }

  function redo() {
    const snapshot = app.history.redo.pop();
    if (!snapshot) return;
    app.history.undo.push(makeHistorySnapshot());
    restoreHistorySnapshot(snapshot);
  }

  function updateUndoRedoButtons() {
    if (!els.undoAction || !els.redoAction) return;
    els.undoAction.disabled = !app.history.undo.length;
    els.redoAction.disabled = !app.history.redo.length;
  }

  function validateSelection(selection) {
    const entity = selection ? findEntity(selection.type, selection.id) : null;
    if (!entity || !isVisibleEntity(entity)) return null;
    return { type: selection.type, id: selection.id };
  }

  function markRestoredDataDirty() {
    if (app.settings.role !== "pc") return;
    app.dirty.notes = Object.fromEntries(app.data.notes.map((note) => [note.id, note.updatedAt || nowIso()]));
    app.dirty.groups = Object.fromEntries(app.data.groups.map((group) => [group.id, group.updatedAt || nowIso()]));
    app.dirty.connections = Object.fromEntries(app.data.connections.map((connection) => [connection.id, connection.updatedAt || nowIso()]));
  }

  function onKeyDown(event) {
    if (isCaptureVisible()) return;
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    // While typing, Ctrl+Z belongs to the text field; the canvas history must not be rewound underneath it.
    if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if (key === "0") {
      event.preventDefault();
      resetViewToContent();
      return;
    }
    if (key === "z" && event.shiftKey) {
      event.preventDefault();
      redo();
      return;
    }
    if (key === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if (key === "y") {
      event.preventDefault();
      redo();
    }
  }

  function isEntityMovementBlocked(entity) {
    return Boolean(app.settings.movementLocked || entity?.locked);
  }

  function toggleMovementLock() {
    captureHistory();
    app.settings.movementLocked = !app.settings.movementLocked;
    applyMovementLockState();
    persistState();
    toast(app.settings.movementLocked ? "全体の位置をロックしました" : "全体の位置ロックを解除しました");
  }

  function applyMovementLockState() {
    els.workspace.classList.toggle("movement-locked", Boolean(app.settings.movementLocked));
    els.movementLock.classList.toggle("active", Boolean(app.settings.movementLocked));
    els.movementLock.setAttribute("aria-pressed", app.settings.movementLocked ? "true" : "false");
  }

  function toggleEntityLock(type, id) {
    const entity = findEntity(type, id);
    if (!entity) return;
    captureHistory();
    entity.locked = !entity.locked;
    touchEntity(type, id);
    renderAll();
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
    return target === els.workspace || target === els.canvas || target === els.world || Boolean(target?.classList?.contains("layer"));
  }

  function isViewportPanTarget(target) {
    if (!target?.closest || !target.closest(".workspace")) return false;
    if (
      target.closest(
        ".note-card, .group-node, .connection-node, .connection-path, .inspector, .composer, .toolbar, .topbar, .modal-root, button, input, textarea, select, a"
      )
    ) {
      return false;
    }
    return true;
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

  function useLightweightEffects() {
    const hasTouch = (navigator.maxTouchPoints || 0) > 0;
    const compactSide = Math.min(window.innerWidth, window.innerHeight) <= 760;
    return isSmallViewport() || (hasTouch && compactSide);
  }

  function applyPerformanceMode() {
    els.workspace?.classList.toggle("mobile-lite", useLightweightEffects());
    els.canvas?.classList.toggle("disabled", useLightweightEffects());
  }

  function updateWorldTransform() {
    els.world.style.transform = `translate(${app.view.x}px, ${app.view.y}px) scale(${app.view.zoom})`;
    updateParticleTarget();
  }

  function resetViewToContent() {
    const bounds = contentBounds();
    app.view.zoom = 1;
    if (!bounds) {
      app.view.x = Math.round(window.innerWidth / 2);
      app.view.y = Math.round(window.innerHeight / 2);
    } else {
      app.view.x = Math.round(window.innerWidth / 2 - (bounds.x + bounds.w / 2));
      app.view.y = Math.round(window.innerHeight / 2 - (bounds.y + bounds.h / 2));
    }
    updateWorldTransform();
    toast("視点を中央に戻しました");
  }

  function contentBounds(data = app.data) {
    const rects = [
      ...data.notes.filter((note) => isVisibleEntity(note)).map(noteBounds),
      ...data.groups.filter((group) => isVisibleEntity(group)).map((group) => ({
        x: group.x,
        y: group.y,
        w: group.w,
        h: group.h
      }))
    ];
    if (!rects.length) return null;
    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.w));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.h));
    return {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY
    };
  }

  function updateParticleTarget(force = false) {
    if (!els.particleLayer) return;
    const depth = useLightweightEffects() ? 0.12 : 0.16;
    app.particles.targetX = app.view.x * depth;
    app.particles.targetY = app.view.y * depth;
    if (force || !app.particles.initialized) {
      app.particles.initialized = true;
      app.particles.x = app.particles.targetX;
      app.particles.y = app.particles.targetY;
      applyParticlePan(app.particles.x, app.particles.y);
      return;
    }
    if (!app.particles.raf) {
      app.particles.raf = requestAnimationFrame(animateParticlePan);
    }
  }

  function animateParticlePan() {
    app.particles.raf = 0;
    const ease = useLightweightEffects() ? 0.16 : 0.12;
    app.particles.x += (app.particles.targetX - app.particles.x) * ease;
    app.particles.y += (app.particles.targetY - app.particles.y) * ease;
    if (Math.abs(app.particles.targetX - app.particles.x) < 0.08 && Math.abs(app.particles.targetY - app.particles.y) < 0.08) {
      app.particles.x = app.particles.targetX;
      app.particles.y = app.particles.targetY;
      applyParticlePan(app.particles.x, app.particles.y);
      return;
    }
    applyParticlePan(app.particles.x, app.particles.y);
    app.particles.raf = requestAnimationFrame(animateParticlePan);
  }

  function applyParticlePan(x, y) {
    const tileSize = 320;
    const wrap = (value) => ((value + tileSize / 2) % tileSize + tileSize) % tileSize - tileSize / 2;
    els.particleLayer.style.setProperty("--particle-pan-x", `${wrap(x).toFixed(2)}px`);
    els.particleLayer.style.setProperty("--particle-pan-y", `${wrap(y).toFixed(2)}px`);
  }

  function screenToWorld(x, y) {
    return {
      x: (x - app.view.x) / app.view.zoom,
      y: (y - app.view.y) / app.view.zoom
    };
  }

  function touchEntity(type, id, options = {}) {
    const entity = findEntity(type, id);
    if (!entity) return;
    if (!options.alreadyUpdated) entity.updatedAt = nowIso();
    app.data.updatedAt = nowIso();
    if (app.settings.role === "pc") {
      const bucket = type === "connection" ? "connections" : type === "note" ? "notes" : "groups";
      app.dirty[bucket][id] = entity.updatedAt;
    }
    updateProjectMeta();
    schedulePersist();
    if (app.settings.role === "phone") scheduleDriveSave();
    updateStatus();
  }

  function moveToTrash(type, id) {
    const entity = findEntity(type, id);
    if (!entity) return;
    captureHistory();
    entity.trashedAt = nowIso();
    entity.updatedAt = entity.trashedAt;
    if (type === "note" || type === "group") {
      trashConnectionsFor(type, id);
    }
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
    const entity = findEntity(type, id);
    if (!entity) return;
    captureHistory();
    entity.trashedAt = "";
    entity.updatedAt = nowIso();
    touchEntity(type, id, { alreadyUpdated: true });
    renderAll();
    openTrashModal();
  }

  function deleteForever(type, id) {
    const entity = findEntity(type, id);
    if (!entity) return;
    captureHistory();
    entity.deletedAt = nowIso();
    entity.trashedAt = entity.trashedAt || entity.deletedAt;
    entity.updatedAt = entity.deletedAt;
    if (type === "connection") {
      // Keep the deleted marker so future syncs can propagate the removal.
    } else if (type === "note") {
      entity.title = "";
      entity.body = "";
      entity.groupIds = [];
      trashConnectionsFor(type, id, true);
    } else {
      entity.title = "";
      trashConnectionsFor(type, id, true);
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
    const connections = app.data.connections.filter((connection) => isVisibleEntity(connection));
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
        project: currentProject(),
        range,
        notes,
        groups,
        connections
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

  function openProjectsModal(showArchived = false) {
    saveActiveProjectToStore();
    const items = app.projects.items
      .filter((project) => (showArchived ? Boolean(project.archivedAt) : !project.archivedAt))
      .sort((a, b) => (b.lastOpenedAt || b.updatedAt || "").localeCompare(a.lastOpenedAt || a.updatedAt || ""));
    openModal(`
      <div class="modal-head">
        <h2>${showArchived ? "アーカイブ済み" : "案件一覧"}</h2>
        <button class="close-button" data-close type="button">×</button>
      </div>
      <div class="project-create">
        <input id="project-new-name" placeholder="新しい案件名" />
        <select id="project-template">
          ${PROJECT_TEMPLATES.map((template) => `<option value="${template.id}">${escapeHtml(template.label)}</option>`).join("")}
        </select>
        <button id="project-create" class="primary-button" type="button">作成</button>
      </div>
      <div class="project-list">
        ${
          items.length
            ? items.map(renderProjectListItem).join("")
            : `<p class="status-line">${showArchived ? "アーカイブ済みの案件はありません。" : "案件はまだありません。"}</p>`
        }
      </div>
      <div class="button-row">
        <button id="project-toggle-archive" class="soft-button" type="button">${showArchived ? "通常の案件を見る" : "アーカイブを見る"}</button>
      </div>
    `);
    $("#project-create").addEventListener("click", () => createProjectFromModal($("#project-new-name").value.trim(), $("#project-template").value));
    $("#project-new-name").addEventListener("keydown", (event) => {
      if (event.key === "Enter") createProjectFromModal(event.currentTarget.value.trim(), $("#project-template").value);
    });
    $("#project-toggle-archive").addEventListener("click", () => openProjectsModal(!showArchived));
    $$(".project-open", els.modalRoot).forEach((button) => button.addEventListener("click", () => switchProject(button.dataset.id)));
    $$(".project-rename", els.modalRoot).forEach((button) => button.addEventListener("click", () => renameProject(button.dataset.id, showArchived)));
    $$(".project-archive", els.modalRoot).forEach((button) => button.addEventListener("click", () => archiveProject(button.dataset.id, showArchived)));
    $$(".project-restore", els.modalRoot).forEach((button) => button.addEventListener("click", () => restoreProject(button.dataset.id)));
    $$(".project-delete", els.modalRoot).forEach((button) => button.addEventListener("click", () => deleteProject(button.dataset.id, showArchived)));
  }

  function renderProjectListItem(project) {
    const active = project.id === app.activeProjectId;
    return `
      <article class="project-item ${active ? "active" : ""}">
        <button class="project-open project-main" type="button" data-id="${escapeAttr(project.id)}">
          <strong>${escapeHtml(project.name || DEFAULT_PROJECT_NAME)}</strong>
          <span>${projectSummary(project)}</span>
        </button>
        <div class="project-actions">
          <button class="mini-button project-rename" type="button" data-id="${escapeAttr(project.id)}">名前変更</button>
          ${
            project.archivedAt
              ? `<button class="mini-button project-restore" type="button" data-id="${escapeAttr(project.id)}">戻す</button>`
              : `<button class="mini-button project-archive" type="button" data-id="${escapeAttr(project.id)}">アーカイブ</button>`
          }
          <button class="mini-button project-delete danger-text" type="button" data-id="${escapeAttr(project.id)}">削除</button>
        </div>
      </article>
    `;
  }

  function projectSummary(project) {
    const updated = project.updatedAt ? formatDateTime(project.updatedAt) : "未更新";
    return `最終更新 ${updated} / カード ${project.noteCount || 0} / グループ ${project.groupCount || 0}`;
  }

  function applyProjectTemplate(data, templateId) {
    const template = PROJECT_TEMPLATES.find((item) => item.id === templateId) || PROJECT_TEMPLATES[0];
    if (!template.groups.length) return;
    const timestamp = nowIso();
    const columns = template.groups.length >= 5 ? 3 : 2;
    data.groups = template.groups.map((title, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      return {
        id: uid("group"),
        title,
        createdAt: timestamp,
        updatedAt: timestamp,
        x: col * 390 - Math.round((columns - 1) * 195),
        y: row * 290 - 150,
        w: 330,
        h: 220,
        color: GROUP_COLORS[index % GROUP_COLORS.length],
        trashedAt: "",
        deletedAt: ""
      };
    });
    data.updatedAt = timestamp;
  }

  async function createProjectFromModal(name, templateId = "blank") {
    const projectName = name || `案件 ${app.projects.items.length + 1}`;
    saveActiveProjectToStore();
    const project = createProjectItem({ name: projectName });
    const data = createEmptyData(project);
    applyProjectTemplate(data, templateId);
    app.projects.items.unshift(project);
    app.projectStore[project.id] = {
      data,
      dirty: createEmptyDirty(),
      view: { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2), zoom: 1 },
      selected: null
    };
    activateProject(project.id, { render: true, persist: false });
    await persistState();
    scheduleDriveSave();
    closeModal();
    toast("案件を作成しました");
  }

  async function switchProject(projectId) {
    if (!projectId || projectId === app.activeProjectId) {
      closeModal();
      return;
    }
    saveActiveProjectToStore();
    await loadProjectFromGithubIfNeeded(projectId).catch((error) => {
      console.warn(error);
      toast("ローカルにある内容で開きます");
    });
    activateProject(projectId, { render: true, persist: false });
    await persistState();
    scheduleDriveSave();
    closeModal();
  }

  async function renameProject(projectId, showArchived) {
    const project = app.projects.items.find((item) => item.id === projectId);
    if (!project) return;
    const name = prompt("案件名", project.name || DEFAULT_PROJECT_NAME);
    if (!name?.trim()) return;
    project.name = name.trim();
    project.updatedAt = nowIso();
    if (projectId === app.activeProjectId) {
      app.data.project.name = project.name;
      app.data.updatedAt = nowIso();
      updateProjectMeta();
      renderAll();
    }
    await persistState();
    scheduleDriveSave();
    openProjectsModal(showArchived);
  }

  async function archiveProject(projectId, showArchived) {
    const project = app.projects.items.find((item) => item.id === projectId);
    if (!project) return;
    project.archivedAt = nowIso();
    project.updatedAt = nowIso();
    await persistState();
    scheduleDriveSave();
    openProjectsModal(showArchived);
  }

  async function restoreProject(projectId) {
    const project = app.projects.items.find((item) => item.id === projectId);
    if (!project) return;
    project.archivedAt = "";
    project.updatedAt = nowIso();
    await persistState();
    scheduleDriveSave();
    openProjectsModal(true);
  }

  async function deleteProject(projectId, showArchived) {
    const project = app.projects.items.find((item) => item.id === projectId);
    if (!project || app.projects.items.length <= 1) {
      toast("最後の案件は削除できません");
      return;
    }
    if (!confirm(`「${project.name || DEFAULT_PROJECT_NAME}」を完全に削除しますか？`)) return;
    saveActiveProjectToStore();
    app.projects.items = app.projects.items.filter((item) => item.id !== projectId);
    delete app.projectStore[projectId];
    if (projectId === app.activeProjectId) {
      activateProject(app.projects.items[0].id, { render: true, persist: false });
    }
    await persistState();
    scheduleDriveSave();
    openProjectsModal(showArchived);
  }

  function openSettingsModal() {
    if (app.settings.role === "pc") {
      openPcSettingsModal();
      return;
    }
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
          <button id="settings-open-capture" class="soft-button" type="button">投稿画面に戻る</button>
          <button id="settings-drive-connect" class="soft-button" type="button">Drive接続</button>
          <button id="settings-github-test" class="soft-button" type="button">GitHub確認</button>
        </div>
        <p id="settings-status" class="status-line"></p>
      </div>
    `);
    $("#settings-open-capture")?.addEventListener("click", returnToCapture);
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
  }

  function openPcSettingsModal() {
    const g = app.settings.github;
    openModal(`
      <div class="modal-head">
        <h2>設定</h2>
        <button class="close-button" data-close type="button">×</button>
      </div>
      <div class="form-grid">
        <section class="settings-section">
          <h3>スマホからの受け取り</h3>
          ${inboxFieldsHtml("pc-settings", { token: false, label: "受け取り先" })}
          <label class="pill"><input id="pc-settings-save-password" type="checkbox" ${app.settings.savePassword ? "checked" : ""} /> パスワードを保存</label>
          <p class="status-line">${escapeHtml(receiveSummary())}</p>
          <div class="button-row">
            <button id="pc-settings-check" class="primary-button" type="button">接続を確認</button>
            <button id="pc-settings-receive" class="soft-button" type="button">今すぐ受け取る</button>
            <button id="pc-settings-save" class="soft-button" type="button">保存</button>
          </div>
        </section>
        <section class="settings-section">
          <h3>バックアップ</h3>
          <p class="status-line">${escapeHtml(backupSummary())}</p>
          <div class="button-row">
            ${
              backupSupported()
                ? '<button id="pc-backup-choose" class="soft-button" type="button">保存先を選ぶ</button><button id="pc-backup-now" class="soft-button" type="button">今すぐ保存</button>'
                : ""
            }
            <button id="pc-backup-export" class="soft-button" type="button">ファイルに書き出す</button>
            <button id="pc-backup-restore" class="soft-button" type="button">バックアップから復元</button>
          </div>
        </section>
        <section class="settings-section">
          <h3>引っ越し（スマホにあった今までのデータ）</h3>
          <p class="status-line">先にスマホの「これまでの画面」で ⇧（GitHub同期）を押してから実行してください。スマホにあった全部の案件を、このPCのデータと合わせて取り込みます。PCのデータは消えず、何度実行しても大丈夫です。${
            app.settings.migratedAt ? `\n前回の引っ越し: ${formatDateTime(app.settings.migratedAt)}` : ""
          }</p>
          ${
            g.owner && g.repo
              ? `<div class="inbox-summary">
            <strong>旧同期先: ${escapeHtml(g.owner)} / ${escapeHtml(g.repo)}</strong>
            <span>ブランチ「${escapeHtml(g.branch || "main")}」の ${escapeHtml(githubSyncBasePath())} フォルダ</span>
            <button id="legacy-toggle" class="mini-button" type="button">別の場所にする</button>
          </div>`
              : ""
          }
          <div id="legacy-fields" class="form-grid ${g.owner && g.repo ? "hidden" : ""}">
            <div class="field-split">
              <div class="form-row">
                <label>旧同期先のユーザー/組織</label>
                <input id="settings-gh-owner" value="${escapeAttr(g.owner)}" spellcheck="false" />
              </div>
              <div class="form-row">
                <label>旧同期先のリポジトリ</label>
                <input id="settings-gh-repo" value="${escapeAttr(g.repo)}" spellcheck="false" />
              </div>
            </div>
            <div class="field-split">
              <div class="form-row">
                <label>ブランチ</label>
                <input id="settings-gh-branch" value="${escapeAttr(g.branch)}" spellcheck="false" />
              </div>
              <div class="form-row">
                <label>同期ファイル</label>
                <input id="settings-gh-path" value="${escapeAttr(g.path)}" spellcheck="false" />
              </div>
            </div>
          </div>
          <div class="button-row">
            <button id="pc-migrate" class="soft-button" type="button">引っ越しを実行</button>
          </div>
        </section>
        <p id="settings-status" class="status-line"></p>
      </div>
    `);
    const status = $("#settings-status");
    bindInboxFields("pc-settings");
    $("#legacy-toggle")?.addEventListener("click", (event) => {
      $("#legacy-fields").classList.remove("hidden");
      event.currentTarget.closest(".inbox-summary")?.classList.add("hidden");
    });
    const readPcSettings = () => {
      readInboxFields("pc-settings");
      app.settings.savePassword = $("#pc-settings-save-password")?.checked ?? true;
      if (!$("#legacy-fields").classList.contains("hidden")) {
        app.settings.github.owner = $("#settings-gh-owner")?.value.trim() || "";
        app.settings.github.repo = $("#settings-gh-repo")?.value.trim() || "";
        app.settings.github.branch = $("#settings-gh-branch")?.value.trim() || "main";
        app.settings.github.path = $("#settings-gh-path")?.value.trim() || GITHUB_DEFAULT_PATH;
      }
    };
    const run = async (label, action) => {
      readPcSettings();
      await persistState();
      status.textContent = label;
      try {
        status.textContent = (await action()) || "";
      } catch (error) {
        status.textContent = error.message || "失敗しました";
      }
      updateStatus();
    };
    $("#pc-settings-save").addEventListener("click", () =>
      run("保存中", async () => {
        receiveInbox();
        return "保存しました";
      })
    );
    $("#pc-settings-receive").addEventListener("click", () =>
      run("受け取り中", async () => {
        await receiveInbox({ manual: true });
        return app.inboxLedger.lastError || receiveSummary();
      })
    );
    $("#pc-settings-check").addEventListener("click", () => run("確認中", checkInboxSource));
    $("#pc-backup-choose")?.addEventListener("click", async () => {
      readPcSettings();
      if (await chooseBackupFile()) status.textContent = backupSummary();
    });
    $("#pc-backup-now")?.addEventListener("click", async () => {
      readPcSettings();
      if (!app.backup.handle) {
        status.textContent = "先に「保存先を選ぶ」でファイルを選んでください";
        return;
      }
      await saveBackupNow({ userGesture: true });
      status.textContent = backupSummary();
    });
    $("#pc-backup-export").addEventListener("click", () => {
      readPcSettings();
      exportBackupFile();
    });
    $("#pc-backup-restore").addEventListener("click", async () => {
      readPcSettings();
      if (!confirm("今のPCのデータは、バックアップの内容に置き換わります。よろしいですか？")) return;
      const file = await pickBackupFile();
      if (!file) return;
      await run("復元中", async () => {
        const result = await restoreBackup(file);
        renderAll();
        await persistState();
        receiveInbox();
        return `復元しました（案件${result.projects}件）。バックアップの後にスマホから届いたカードは、このあと受け取ります`;
      });
    });
    $("#pc-migrate").addEventListener("click", () =>
      run("旧同期先から読み込み中", async () => {
        const summary = await migrateLegacyData();
        return `引っ越しが終わりました（案件${summary.projects}件・追加${summary.created}件・更新${summary.updated}件）`;
      })
    );
  }

  function receiveSummary() {
    const ledger = app.inboxLedger;
    if (ledger.lastError) return `受け取りに失敗しました: ${ledger.lastError}`;
    if (!ledger.lastCheckedAt) return "まだ受け取っていません。開いている間は5分ごとに自動で確認します";
    return `最終確認 ${formatDateTime(ledger.lastCheckedAt)}（前回 ${ledger.lastReceivedCount}件受け取り）。開いている間は5分ごとに自動で確認します`;
  }

  function backupSummary() {
    const backup = app.backup;
    if (!backupSupported()) {
      return "このブラウザはファイルへの自動保存に対応していません。時々「ファイルに書き出す」で保存してください";
    }
    if (!backup.handle) {
      return "保存先が未設定です。「保存先を選ぶ」でPC内のファイルを選ぶと、変更のたびに暗号化して自動で保存します";
    }
    const lines = [`保存先: ${backup.fileName}`, `最終保存: ${backup.lastSavedAt ? formatDateTime(backup.lastSavedAt) : "まだ"}`];
    if (backup.permission !== "granted") lines.push("ブラウザの再起動などで保存の許可が切れています。上部の表示か「今すぐ保存」を押すと再開します");
    if (backup.lastError) lines.push(`前回の失敗: ${backup.lastError}`);
    return lines.join("\n");
  }

  function pcStatus() {
    const ledger = app.inboxLedger;
    const backup = app.backup;
    const parts = [];
    const details = [];
    let warning = false;
    const problem = inboxSourceProblem();
    if (app.inboxReceive.running) {
      parts.push("受信中…");
    } else if (problem) {
      parts.push("受け取り先が未設定");
      details.push(`${problem}（クリックで設定を開きます）`);
      warning = true;
    } else if (ledger.lastError) {
      parts.push("受信エラー");
      details.push(`${ledger.lastError}（クリックで再試行します）`);
      warning = true;
    } else {
      parts.push(ledger.lastCheckedAt ? `受信 ${formatTime(ledger.lastCheckedAt)}` : "受信待ち");
      details.push("クリックで今すぐ受け取ります");
    }
    if (backupSupported()) {
      if (!backup.handle) {
        parts.push("バックアップ未設定");
        details.push("設定の「バックアップ」で保存先を選んでください");
      } else if (backup.permission !== "granted") {
        parts.push("バックアップ要許可");
        details.push("クリックするとバックアップの保存を再開します");
        warning = true;
      } else if (backup.lastError) {
        parts.push("バックアップ失敗");
        details.push(backup.lastError);
        warning = true;
      } else if (backup.lastSavedAt) {
        parts.push(`保存 ${formatTime(backup.lastSavedAt)}`);
      }
    }
    return { text: parts.join("・"), detail: details.join("\n"), warning };
  }

  function onSyncStatusClick() {
    if (app.settings.role !== "pc") return;
    if (inboxSourceProblem()) {
      openSettingsModal();
      return;
    }
    if (app.backup.handle && app.backup.permission !== "granted") {
      saveBackupNow({ userGesture: true });
      return;
    }
    receiveInbox({ manual: true });
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
                        <button class="soft-button" data-restore="${escapeAttr(`${item.type}:${item.id}`)}" type="button">戻す</button>
                        <button class="danger-button" data-delete="${escapeAttr(`${item.type}:${item.id}`)}" type="button">完全削除</button>
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
      // The Drive file holds whichever project was open last, so merge it into that project rather than the one on screen.
      const remoteProjectId = isSafeId(remote?.project?.id) ? remote.project.id : DEFAULT_PROJECT_ID;
      if (remoteProjectId !== app.activeProjectId) {
        saveActiveProjectToStore();
        const project = ensureProjectExists(remoteProjectId, textValue(remote?.project?.name) || DEFAULT_PROJECT_NAME);
        activateProject(remoteProjectId, { render: false, persist: false });
        toast(`Driveの「${project.name}」を開きました`);
      }
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
      saveActiveProjectToStore();
      await putGithubEncryptedObject(githubProjectIndexPath(), sanitizeProjectsIndex(), "Update Today Fragments project index");
      for (const project of app.projects.items) {
        const entry = app.projectStore[project.id];
        if (!entry?.data) continue;
        // The commit history of a public repository is readable by anyone, so project names stay out of the message.
        await putGithubEncryptedObject(githubProjectDataPath(project.id), sanitizeData(entry.data), "Update Today Fragments project data");
      }
      app.dirty = createEmptyDirty();
      Object.values(app.projectStore).forEach((entry) => {
        entry.dirty = createEmptyDirty();
      });
      await persistState();
      toast("GitHub同期しました");
    } catch (error) {
      toast(error.message || "GitHub同期に失敗しました");
    } finally {
      updateStatus();
    }
  }

  async function loadProjectFromGithubIfNeeded(projectId, options = {}) {
    if (!projectId) return;
    if (!options.force && app.projectStore[projectId]?.data) return;
    requireGithubSettings(false);
    requirePassword();
    const project = ensureProjectExists(projectId);
    const remoteData = await loadGithubEncryptedObject(githubProjectDataPath(projectId));
    app.projectStore[projectId] = {
      data: normalizeData({
        ...remoteData,
        project: {
          id: project.id,
          name: remoteData.project?.name || project.name,
          createdAt: remoteData.project?.createdAt || project.createdAt
        }
      }),
      dirty: createEmptyDirty(),
      view: app.projectStore[projectId]?.view || { x: 0, y: 0, zoom: 1 },
      selected: null
    };
  }

  function sanitizeProjectsIndex(projects = app.projects) {
    return normalizeProjectsIndex(JSON.parse(JSON.stringify(projects)));
  }

  async function putGithubEncryptedObject(path, object, message) {
    const envelope = await encryptObject(object, app.settings.syncPassword);
    const content = bytesToBase64(utf8(JSON.stringify(envelope, null, 2)));
    const sha = await getGithubPathSha(path).catch(() => "");
    const body = {
      message: `${message} ${new Date().toISOString()}`,
      content,
      branch: app.settings.github.branch || "main"
    };
    if (sha) body.sha = sha;
    const response = await fetch(githubContentApiUrl(path), {
      method: "PUT",
      headers: githubHeaders(true),
      body: JSON.stringify(body)
    });
    if (!response.ok) throw await makeGithubError(response);
  }

  async function loadGithubEncryptedObject(path) {
    const response = await fetch(`${githubRawUrl(path)}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      const error = new Error(response.status === 404 ? "GitHub上に同期ファイルがまだありません" : `GitHub ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const envelope = await response.json();
    return decryptObject(envelope, app.settings.syncPassword);
  }

  async function getGithubPathSha(path) {
    const response = await fetch(`${githubContentApiUrl(path)}?ref=${encodeURIComponent(app.settings.github.branch || "main")}`, {
      headers: githubHeaders(true)
    });
    if (!response.ok) return "";
    const json = await response.json();
    return json.sha || "";
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
    const checked = `${g.owner}/${g.repo} / ${branch} / ${githubProjectIndexPath()}`;

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

    const fileResponse = await fetch(`${githubContentApiUrl(githubProjectIndexPath())}?ref=${encodeURIComponent(branch)}`, {
      headers: githubHeaders(true)
    });
    if (fileResponse.ok) return `GitHub確認OK\n確認した設定: ${checked}\n同期ファイルも見つかりました`;
    if (fileResponse.status === 404) {
      return `GitHub確認OK\n確認した設定: ${checked}\n同期ファイルはまだありません。次のGitHub同期で作成できます`;
    }
    throw await makeGithubError(fileResponse);
  }

  // Inbox: the phone appends its posts to one encrypted file per month in the data repository (inbox/YYYY-MM.enc.json).
  // Each write re-reads the remote file and merges by id, so a resend or a second device never drops posts already there.
  function hasUnsentCapture() {
    return Boolean(app.capture?.posts.some((post) => !post.sentAt) || app.capture?.groups.some((group) => !group.sentAt));
  }

  function scheduleInboxSend(delay = INBOX_SEND_DELAY) {
    if (app.settings.role !== "phone") return;
    clearTimeout(app.inboxSend.timer);
    app.inboxSend.timer = window.setTimeout(sendInbox, delay);
  }

  function scheduleInboxRetry() {
    const delay = INBOX_RETRY_DELAYS[Math.min(app.inboxSend.failures, INBOX_RETRY_DELAYS.length) - 1] || INBOX_RETRY_DELAYS[0];
    scheduleInboxSend(delay);
  }

  async function sendInbox() {
    const state = app.inboxSend;
    if (app.settings.role !== "phone") return;
    clearTimeout(state.timer);
    state.timer = 0;
    if (state.sending) {
      state.again = true;
      return;
    }
    const unsentPosts = app.capture.posts.filter((post) => !post.sentAt);
    const unsentGroups = app.capture.groups.filter((group) => !group.sentAt);
    if (!unsentPosts.length && !unsentGroups.length) return;
    const problem = inboxSettingsProblem();
    if (problem) {
      renderCaptureStatus();
      return;
    }
    if (navigator.onLine === false) {
      // The "online" listener resends once the connection is back.
      app.capture.lastError = "圏外のため、電波が戻ったら自動で送ります";
      renderCaptureStatus();
      return;
    }
    state.sending = true;
    renderCaptureStatus();
    try {
      if (!state.branchReady) {
        await ensureInboxBranch();
        state.branchReady = true;
      }
      const months = new Set(unsentPosts.map((post) => inboxMonth(post.createdAt)));
      if (!months.size) months.add(inboxMonth(nowIso()));
      for (const month of months) {
        await sendInboxMonth(month);
      }
      const sentAt = nowIso();
      unsentPosts.forEach((post) => {
        post.sentAt = sentAt;
      });
      unsentGroups.forEach((group) => {
        group.sentAt = sentAt;
      });
      app.capture.lastSentAt = sentAt;
      app.capture.lastError = "";
      state.failures = 0;
      pruneSentPosts();
    } catch (error) {
      console.warn(error);
      state.failures += 1;
      // fetch rejects with a TypeError (English browser text) when the network is down.
      const reason = error instanceof TypeError ? "通信できませんでした" : error.message || "送信できませんでした";
      app.capture.lastError = `${reason}。自動で再送します`;
      scheduleInboxRetry();
    } finally {
      state.sending = false;
      await persistState();
      renderCaptureStatus();
      renderCapturePosts();
      if (state.again) {
        state.again = false;
        scheduleInboxSend(500);
      }
    }
  }

  async function sendInboxMonth(month) {
    const path = inboxPath(month);
    for (let attempt = 0; ; attempt += 1) {
      const remote = await readInboxFile(path);
      if (remote.unreadable) {
        // The file was written with a different sync password (typically after the phone was reset and the password retyped).
        // The phone still holds this month's posts, so keep the old file aside and rebuild the month from them.
        await keepUnreadableInboxFile(month, remote.text);
        app.capture.lastNotice = `送り先の${month}のファイルは別のパスワードで書かれていたため、スマホにあるカードで作り直しました`;
      }
      const result = await writeInboxFile(path, buildInboxDoc(month, remote.doc), remote.sha);
      if (result.ok) return;
      // Someone else updated the file between our read and write; read again and merge once more.
      if (!result.conflict || attempt >= 2) throw result.error;
    }
  }

  async function keepUnreadableInboxFile(month, text) {
    const stamp = nowIso().replace(/[-:]/g, "").slice(0, 15);
    const copyPath = `${INBOX_FOLDER}/${month}.unreadable-${stamp}.enc.json`;
    try {
      const response = await fetch(inboxContentUrl(copyPath), {
        method: "PUT",
        headers: inboxHeaders(),
        body: JSON.stringify({ message: "Keep unreadable Today Fragments file", content: bytesToBase64(utf8(text)), branch: inboxConfig().branch })
      });
      if (!response.ok) console.warn(`could not keep a copy of the unreadable inbox file (${response.status})`);
    } catch (error) {
      console.warn(error);
    }
  }

  function buildInboxDoc(month, remoteDoc) {
    const posts = new Map();
    const groups = new Map();
    (Array.isArray(remoteDoc?.posts) ? remoteDoc.posts : []).forEach((item) => {
      const post = isPlainObject(item) ? pickFields(item, POST_FIELDS) : null;
      if (post && normalizePost(post)) posts.set(post.id, pickFields(post, POST_FIELDS));
    });
    (Array.isArray(remoteDoc?.groups) ? remoteDoc.groups : []).forEach((item) => {
      const group = isPlainObject(item) ? pickFields(item, CAPTURE_GROUP_FIELDS) : null;
      if (group && normalizeCaptureGroup(group)) groups.set(group.id, pickFields(group, CAPTURE_GROUP_FIELDS));
    });
    app.capture.posts.filter((post) => inboxMonth(post.createdAt) === month).forEach((post) => posts.set(post.id, pickFields(post, POST_FIELDS)));
    app.capture.groups.forEach((group) => groups.set(group.id, pickFields(group, CAPTURE_GROUP_FIELDS)));
    return {
      type: INBOX_TYPE,
      schemaVersion: 1,
      app: "Today Fragments",
      month,
      updatedAt: nowIso(),
      deviceId: app.settings.deviceId,
      posts: [...posts.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      groups: [...groups.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    };
  }

  async function readInboxFile(path) {
    const branch = inboxConfig().branch;
    const response = await fetch(`${inboxContentUrl(path)}?ref=${encodeURIComponent(branch)}`, { headers: inboxHeaders(), cache: "no-store" });
    if (response.status === 404) return { sha: "", doc: null };
    if (!response.ok) throw await makeGithubError(response);
    const json = await response.json();
    let text;
    if (json.encoding === "base64" && json.content) {
      text = decodeUtf8(base64ToBytes(json.content.replace(/\s/g, "")));
    } else if (json.download_url) {
      // The contents API leaves "content" empty for larger files; fall back to the raw download.
      const raw = await fetch(json.download_url, { cache: "no-store" });
      if (!raw.ok) throw new Error(`GitHub ${raw.status}`);
      text = await raw.text();
    } else {
      throw new Error("送り先のファイルを読めませんでした");
    }
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      throw new Error("送り先に別の形式のファイルがあるため、上書きせずに止めました");
    }
    if (envelope?.app !== "Today Fragments" || !isPlainObject(envelope.cipher)) {
      throw new Error("送り先に別の形式のファイルがあるため、上書きせずに止めました");
    }
    let doc;
    try {
      doc = await decryptObject(envelope, app.settings.syncPassword);
    } catch (error) {
      if (!/パスワード/.test(error?.message || "")) throw error;
      return { sha: json.sha || "", doc: null, unreadable: true, text };
    }
    if (doc?.type !== INBOX_TYPE) throw new Error("送り先に別の形式のファイルがあるため、上書きせずに止めました");
    return { sha: json.sha || "", doc };
  }

  async function writeInboxFile(path, doc, sha) {
    const envelope = await encryptObject(doc, app.settings.syncPassword);
    const body = {
      // The repository is public, so the message carries no project names or text.
      message: "Add Today Fragments posts",
      content: bytesToBase64(utf8(JSON.stringify(envelope))),
      branch: inboxConfig().branch
    };
    if (sha) body.sha = sha;
    const response = await fetch(inboxContentUrl(path), { method: "PUT", headers: inboxHeaders(), body: JSON.stringify(body) });
    if (response.ok) return { ok: true };
    const conflict = response.status === 409 || response.status === 422;
    return { ok: false, conflict, error: await makeGithubError(response) };
  }

  function pruneSentPosts() {
    // Sent posts live on in the data repository; the phone only keeps recent ones for its list.
    const cutoff = Date.now() - SENT_POST_KEEP_DAYS * 24 * 60 * 60 * 1000;
    app.capture.posts = app.capture.posts.filter((post) => !post.sentAt || Date.parse(post.createdAt) >= cutoff);
  }

  function inboxMonth(iso) {
    return localDate(iso).slice(0, 7);
  }

  function inboxPath(month) {
    return `${INBOX_FOLDER}/${month}.enc.json`;
  }

  function inboxRepoUrl() {
    const inbox = inboxConfig();
    return `https://api.github.com/repos/${encodeURIComponent(inbox.owner)}/${encodeURIComponent(inbox.repo)}`;
  }

  function inboxContentUrl(path) {
    return `${inboxRepoUrl()}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  function inboxHeaders() {
    return {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${inboxConfig().token}`
    };
  }

  function inboxSettingsProblem() {
    const inbox = inboxConfig();
    if (!inbox.owner || !inbox.repo) return "送り先のリポジトリが未設定です";
    if (!inbox.token) return "送り先のトークンが未設定です";
    if (!app.settings.syncPassword) return "同期パスワードが未設定です";
    return "";
  }

  // Creates the data-only branch on first use. It is cut from the repository's default branch (not the published one),
  // so writing to it never triggers a site build. Needs the token's normal "Contents: write" permission.
  async function ensureInboxBranch() {
    const inbox = inboxConfig();
    const branchResponse = await fetch(`${inboxRepoUrl()}/branches/${encodeURIComponent(inbox.branch)}`, { headers: inboxHeaders(), cache: "no-store" });
    if (branchResponse.ok) return { created: false };
    if (branchResponse.status !== 404) throw await makeGithubError(branchResponse);
    const repoResponse = await fetch(inboxRepoUrl(), { headers: inboxHeaders(), cache: "no-store" });
    if (!repoResponse.ok) throw await makeGithubError(repoResponse);
    const repo = await repoResponse.json();
    const base = repo.default_branch || "main";
    const refResponse = await fetch(`${inboxRepoUrl()}/git/ref/heads/${encodeURIComponent(base)}`, { headers: inboxHeaders(), cache: "no-store" });
    if (!refResponse.ok) throw new Error(`データ用ブランチの元になるブランチ「${base}」を読めませんでした（GitHub ${refResponse.status}）`);
    const sha = (await refResponse.json())?.object?.sha;
    if (!sha) throw new Error("データ用ブランチを作る準備に失敗しました");
    const createResponse = await fetch(`${inboxRepoUrl()}/git/refs`, {
      method: "POST",
      headers: inboxHeaders(),
      body: JSON.stringify({ ref: `refs/heads/${inbox.branch}`, sha })
    });
    if (createResponse.status === 422) {
      // Someone (another send) created it a moment ago.
      const again = await fetch(`${inboxRepoUrl()}/branches/${encodeURIComponent(inbox.branch)}`, { headers: inboxHeaders(), cache: "no-store" });
      if (again.ok) return { created: false };
    }
    if (!createResponse.ok) {
      if (createResponse.status === 403 || createResponse.status === 404) {
        throw new Error("データ用のブランチを作れませんでした。トークンに Contents の Read and write 権限があるか確認してください");
      }
      throw await makeGithubError(createResponse);
    }
    return { created: true };
  }

  async function testInboxConnection() {
    const problem = inboxSettingsProblem();
    if (problem) throw new Error(problem);
    const inbox = inboxConfig();
    const repoResponse = await fetch(inboxRepoUrl(), { headers: inboxHeaders(), cache: "no-store" });
    if (!repoResponse.ok) throw await makeGithubError(repoResponse);
    const repo = await repoResponse.json();
    const branch = await ensureInboxBranch();
    app.inboxSend.branchReady = true;
    const lines = [`接続OK: ${inbox.owner}/${inbox.repo}`];
    lines.push(branch.created ? `データ用のブランチ「${inbox.branch}」を作りました` : `データ用のブランチ「${inbox.branch}」は準備済みです`);
    if (repo.private) lines.push("注意: 非公開リポジトリです。PCから読めないので、公開リポジトリにしてください");
    if (inbox.branch === (app.settings.github.branch || "")) {
      lines.push("注意: サイトを公開しているブランチと同じです。送るたびに公開処理が走るので、別のブランチ名にしてください");
    }
    return lines.join("\n");
  }

  // PC side of the inbox: read the phone's monthly files through public raw URLs (no token on the PC)
  // and place each new card inside the group chosen on the phone. The ledger keeps every id already taken.
  function scheduleInboxReceive(delay = INBOX_RECEIVE_INTERVAL) {
    if (app.settings.role !== "pc") return;
    clearTimeout(app.inboxReceive.timer);
    app.inboxReceive.timer = window.setTimeout(() => receiveInbox(), delay);
  }

  function inboxSourceProblem() {
    const inbox = inboxConfig();
    if (!inbox.owner || !inbox.repo) return "受け取り先のリポジトリが未設定です";
    if (!app.settings.syncPassword) return "同期パスワードが未設定です";
    return "";
  }

  async function receiveInbox(options = {}) {
    const state = app.inboxReceive;
    const ledger = app.inboxLedger;
    if (app.settings.role !== "pc" || state.running) return;
    clearTimeout(state.timer);
    if (inboxSourceProblem()) {
      updateStatus();
      return;
    }
    if (app.activeEntityDrag || app.pointers.size) {
      // Re-rendering in the middle of a drag would cut it off; try again shortly.
      scheduleInboxReceive(5000);
      return;
    }
    state.running = true;
    updateStatus();
    try {
      const docs = [];
      for (const month of inboxMonthsToCheck()) {
        const doc = await fetchInboxMonth(month);
        if (doc) docs.push(doc);
      }
      const result = applyInboxDocs(docs);
      ledger.lastCheckedAt = nowIso();
      ledger.lastMonth = inboxMonth(ledger.lastCheckedAt);
      ledger.lastError = "";
      ledger.lastReceivedCount = result.posts;
      await persistState();
      if (result.posts) toast(`スマホから${result.posts}件受け取りました`);
      else if (options.manual) toast("新しいカードはありません");
    } catch (error) {
      console.warn(error);
      ledger.lastError = error instanceof TypeError ? "通信できませんでした" : error.message || "受け取りに失敗しました";
      if (/パスワード/.test(ledger.lastError)) ledger.lastError = "スマホと同期パスワードが違います。両方の設定画面の「確認コード」を見比べてください";
      if (options.manual) toast(ledger.lastError);
    } finally {
      state.running = false;
      updateStatus();
      scheduleInboxReceive();
    }
  }

  function inboxMonthsToCheck() {
    const current = inboxMonth(nowIso());
    const oldest = shiftMonth(current, -INBOX_FIRST_MONTHS);
    // Look one month back from the last check, because a card written offline at the end of a month lands in that month's file.
    let start = app.inboxLedger.lastMonth ? shiftMonth(app.inboxLedger.lastMonth, -1) : shiftMonth(current, 1 - INBOX_FIRST_MONTHS);
    if (start < oldest) start = oldest;
    if (start > current) start = shiftMonth(current, -1);
    const months = [];
    for (let month = start; month <= current; month = shiftMonth(month, 1)) months.push(month);
    return months;
  }

  function shiftMonth(month, delta) {
    const [year, value] = month.split("-").map(Number);
    const date = new Date(year, value - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function inboxRawUrl(month) {
    const inbox = inboxConfig();
    return `https://raw.githubusercontent.com/${encodeURIComponent(inbox.owner)}/${encodeURIComponent(inbox.repo)}/${encodeURIComponent(
      inbox.branch
    )}/${INBOX_FOLDER}/${month}.enc.json?t=${Date.now()}`;
  }

  async function fetchInboxMonth(month) {
    const response = await fetch(inboxRawUrl(month), { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`受け取り先を読めませんでした（GitHub ${response.status}）`);
    const doc = await decryptObject(await response.json(), app.settings.syncPassword);
    if (doc?.type !== INBOX_TYPE) throw new Error("受け取り先に別の形式のファイルがあります");
    return doc;
  }

  function applyInboxDocs(docs) {
    const ledger = app.inboxLedger;
    const groups = new Map();
    const posts = new Map();
    docs.forEach((doc) => {
      (Array.isArray(doc.groups) ? doc.groups : []).forEach((item) => {
        const group = isPlainObject(item) ? pickFields(item, CAPTURE_GROUP_FIELDS) : null;
        if (group && normalizeCaptureGroup(group)) groups.set(group.id, group);
      });
      (Array.isArray(doc.posts) ? doc.posts : []).forEach((item) => {
        const post = isPlainObject(item) ? pickFields(item, POST_FIELDS) : null;
        if (post && normalizePost(post)) posts.set(post.id, post);
      });
    });
    const projectNames = new Map([...posts.values()].map((post) => [post.projectId, post.projectName]));
    const touched = new Set();
    let createdGroups = 0;
    groups.forEach((group) => {
      if (ledger.groupMap[group.id]) return;
      const data = inboxProjectData(group.projectId, projectNames.get(group.projectId));
      const target = resolveOrCreateGroup(data, group.id, group.title);
      ledger.groupMap[group.id] = target.id;
      if (target.created) {
        createdGroups += 1;
        touched.add(group.projectId);
      }
    });
    let importedPosts = 0;
    [...posts.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .forEach((post) => {
        if (ledger.importedPosts[post.id]) return;
        const data = inboxProjectData(post.projectId, post.projectName);
        ledger.importedPosts[post.id] = nowIso();
        if (data.notes.some((note) => note.id === post.id)) return;
        const group = findInboxGroup(data, post);
        const spot = group ? spotInGroup(data, group) : spotNearView(data, post.projectId);
        const timestamp = nowIso();
        const note = {
          id: post.id,
          title: "",
          body: post.body,
          createdAt: post.createdAt,
          updatedAt: timestamp,
          localDate: post.localDate,
          x: spot.x,
          y: spot.y,
          groupIds: [],
          locked: false,
          trashedAt: "",
          deletedAt: ""
        };
        data.notes.push(note);
        updateNoteGroups(note, data.groups);
        data.updatedAt = timestamp;
        importedPosts += 1;
        touched.add(post.projectId);
      });
    touched.forEach((projectId) => {
      refreshProjectCounts(projectId);
      if (projectId === app.activeProjectId) {
        // Undo snapshots from before the import would silently drop the new cards, and the ledger would never bring them back.
        app.history = { undo: [], redo: [], restoring: false };
        updateUndoRedoButtons();
        // Leave the inspector alone so typing in it is not interrupted.
        renderGroups();
        renderConnections();
        renderCards();
        renderMobileList();
      }
    });
    return { posts: importedPosts, groups: createdGroups };
  }

  function inboxProjectData(projectId, name) {
    ensureProjectExists(projectId, name || DEFAULT_PROJECT_NAME);
    return projectId === app.activeProjectId ? app.data : app.projectStore[projectId].data;
  }

  function refreshProjectCounts(projectId) {
    const project = app.projects.items.find((item) => item.id === projectId);
    const data = projectId === app.activeProjectId ? app.data : app.projectStore[projectId]?.data;
    if (!project || !data) return;
    updateAllNoteGroupsIn(data);
    project.updatedAt = data.updatedAt || project.updatedAt;
    project.noteCount = data.notes.filter(isVisibleEntity).length;
    project.groupCount = data.groups.filter(isVisibleEntity).length;
    project.connectionCount = data.connections.filter(isVisibleEntity).length;
  }

  function resolveOrCreateGroup(data, id, title) {
    // A group the PC already has (even one deleted later) is never recreated; a same-named group is reused.
    const byId = data.groups.find((group) => group.id === id);
    if (byId) return { id: byId.id, created: false };
    const byTitle = data.groups.find((group) => isVisibleEntity(group) && (group.title || "") === title);
    if (byTitle) return { id: byTitle.id, created: false };
    const bounds = contentBounds(data);
    const timestamp = nowIso();
    data.groups.push({
      id,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
      x: bounds ? Math.round(bounds.x + bounds.w + 80) : 0,
      y: bounds ? Math.round(bounds.y) : 0,
      w: 340,
      h: 240,
      color: GROUP_COLORS[data.groups.length % GROUP_COLORS.length],
      locked: false,
      trashedAt: "",
      deletedAt: ""
    });
    data.updatedAt = timestamp;
    return { id, created: true };
  }

  function findInboxGroup(data, post) {
    const visible = data.groups.filter(isVisibleEntity);
    const mappedId = post.groupId ? app.inboxLedger.groupMap[post.groupId] || post.groupId : "";
    return (
      visible.find((group) => group.id === mappedId) ||
      (post.groupTitle ? visible.find((group) => (group.title || "") === post.groupTitle) : null) ||
      null
    );
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function spotInGroup(data, group) {
    const stepX = NOTE_CARD_WIDTH + 18;
    const stepY = NOTE_CARD_HEIGHT + 18;
    const left = group.x + 24;
    const top = group.y + 52;
    const columns = Math.max(1, Math.floor((group.w - 48 + 18) / stepX));
    const taken = data.notes.filter(isVisibleEntity).map(noteBounds);
    for (let row = 0; row < 500; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const rect = { x: Math.round(left + column * stepX), y: Math.round(top + row * stepY), w: NOTE_CARD_WIDTH, h: NOTE_CARD_HEIGHT };
        if (taken.some((other) => rectsOverlap(rect, other))) continue;
        const bottom = rect.y + rect.h + 24;
        if (bottom > group.y + group.h && !group.locked) {
          group.h = Math.round(bottom - group.y);
          group.updatedAt = nowIso();
        }
        return rect;
      }
    }
    return { x: Math.round(left), y: Math.round(top) };
  }

  function spotNearView(data, projectId) {
    // Unsorted cards land near the middle of what the PC was last looking at, outside every group.
    const view = projectId === app.activeProjectId ? app.view : app.projectStore[projectId]?.view || { x: 0, y: 0, zoom: 1 };
    const zoom = view.zoom || 1;
    const stepX = NOTE_CARD_WIDTH + 18;
    const stepY = NOTE_CARD_HEIGHT + 18;
    const left = Math.round((window.innerWidth / 2 - view.x) / zoom - stepX * 2);
    const top = Math.round((window.innerHeight / 2 - view.y) / zoom - stepY);
    const taken = data.notes.filter(isVisibleEntity).map(noteBounds);
    const groups = data.groups.filter(isVisibleEntity);
    for (let row = 0; row < 500; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const rect = { x: left + column * stepX, y: top + row * stepY, w: NOTE_CARD_WIDTH, h: NOTE_CARD_HEIGHT };
        if (taken.some((other) => rectsOverlap(rect, other))) continue;
        if (getContainingGroups(rect, groups).length) continue;
        return rect;
      }
    }
    return { x: left, y: top };
  }

  async function checkInboxSource() {
    const problem = inboxSourceProblem();
    if (problem) throw new Error(problem);
    const inbox = inboxConfig();
    // No token on the PC: if the anonymous API cannot see the repository, the raw files cannot be read either.
    const repoResponse = await fetch(inboxRepoUrl(), { cache: "no-store" });
    if (repoResponse.status === 404) throw new Error("リポジトリが見つからないか、非公開です。PCから読むには公開リポジトリが必要です");
    if (!repoResponse.ok && repoResponse.status !== 403) throw new Error(`GitHub ${repoResponse.status}`);
    const branchResponse = await fetch(`${inboxRepoUrl()}/branches/${encodeURIComponent(inbox.branch)}`, { cache: "no-store" });
    if (branchResponse.status === 404) {
      return `リポジトリ ${inbox.owner}/${inbox.repo} は見えますが、データ用のブランチ「${inbox.branch}」がまだありません。\nスマホの設定で「接続を確認」を押すと作られます`;
    }
    const doc = await fetchInboxMonth(inboxMonth(nowIso()));
    if (!doc) return `接続OK: ${inbox.owner}/${inbox.repo}（${inbox.branch}）\n今月のカードはまだ届いていません`;
    return `接続OK: ${inbox.owner}/${inbox.repo}（${inbox.branch}）\n今月のファイルを読めました（カード${Array.isArray(doc.posts) ? doc.posts.length : 0}件）`;
  }

  // PC backup: an encrypted copy of every project written to a file the user picked once.
  // The company browser may wipe site data, so this file (plus the inbox) is how the PC recovers.
  function backupSupported() {
    return typeof window.showSaveFilePicker === "function";
  }

  async function loadBackupHandle() {
    try {
      const record = await idbGet(BACKUP_HANDLE_KEY);
      if (!record?.handle) return;
      app.backup.handle = record.handle;
      app.backup.fileName = textValue(record.fileName || record.handle.name);
      app.backup.lastSavedAt = isoValue(record.lastSavedAt, "");
      app.backup.permission = await record.handle.queryPermission({ mode: "readwrite" });
    } catch (error) {
      console.warn(error);
    }
  }

  async function chooseBackupFile() {
    if (!backupSupported()) {
      toast("このブラウザはファイルへの自動保存に対応していません。「ファイルに書き出す」を使ってください");
      return false;
    }
    try {
      requirePassword();
      const handle = await window.showSaveFilePicker({
        suggestedName: "today-fragments-backup.json",
        types: [{ description: "Today Fragments バックアップ", accept: { "application/json": [".json"] } }]
      });
      Object.assign(app.backup, { handle, fileName: handle.name, permission: "granted", lastError: "" });
      return saveBackupNow({ userGesture: true });
    } catch (error) {
      if (error?.name === "AbortError") return false;
      app.backup.lastError = error.message || "保存先を選べませんでした";
      toast(app.backup.lastError);
      updateStatus();
      return false;
    }
  }

  function scheduleBackupSave(delay = BACKUP_SAVE_DELAY) {
    const backup = app.backup;
    backup.revision = (backup.revision || 0) + 1;
    if (!backup.handle) return;
    // Wait for a pause in editing, but never hold a pending save back for more than two minutes.
    if (backup.timer && Date.now() - backup.pendingSince > 120000) return;
    if (!backup.timer) backup.pendingSince = Date.now();
    clearTimeout(backup.timer);
    backup.timer = window.setTimeout(() => saveBackupNow(), delay);
  }

  function hasUnsavedBackup() {
    return Boolean(app.backup.handle && (app.backup.revision || 0) !== (app.backup.savedRevision || 0));
  }

  async function saveBackupNow(options = {}) {
    const backup = app.backup;
    if (app.settings.role !== "pc" || !backup.handle || backup.saving) return false;
    clearTimeout(backup.timer);
    backup.timer = 0;
    const revision = backup.revision || 0;
    backup.saving = true;
    try {
      if (!app.settings.syncPassword) throw new Error("同期パスワードが未設定のため、バックアップを暗号化できません");
      let permission = await backup.handle.queryPermission({ mode: "readwrite" });
      // Browsers ask again after a restart; that prompt is only allowed right after a click.
      if (permission !== "granted" && options.userGesture) permission = await backup.handle.requestPermission({ mode: "readwrite" });
      backup.permission = permission;
      if (permission !== "granted") return false;
      const envelope = await encryptObject(buildBackup(), app.settings.syncPassword);
      const writable = await backup.handle.createWritable();
      await writable.write(JSON.stringify(envelope));
      await writable.close();
      backup.lastSavedAt = nowIso();
      backup.lastError = "";
      backup.savedRevision = revision;
      await idbSet(BACKUP_HANDLE_KEY, { handle: backup.handle, fileName: backup.fileName, lastSavedAt: backup.lastSavedAt });
      if (options.userGesture) toast("バックアップを保存しました");
      return true;
    } catch (error) {
      console.warn(error);
      backup.lastError = error.message || "バックアップを保存できませんでした";
      if (options.userGesture) toast(backup.lastError);
      return false;
    } finally {
      backup.saving = false;
      if (hasUnsavedBackup() && backup.permission === "granted" && !backup.lastError) {
        backup.pendingSince = Date.now();
        backup.timer = window.setTimeout(() => saveBackupNow(), BACKUP_SAVE_DELAY);
      }
      updateStatus();
    }
  }

  function buildBackup() {
    saveActiveProjectToStore();
    return {
      type: BACKUP_TYPE,
      schemaVersion: 1,
      app: "Today Fragments",
      createdAt: nowIso(),
      deviceId: app.settings.deviceId,
      activeProjectId: app.activeProjectId,
      projects: app.projects,
      projectStore: Object.fromEntries(Object.entries(app.projectStore).map(([projectId, entry]) => [projectId, { data: entry.data, view: entry.view }])),
      inboxLedger: app.inboxLedger,
      // Where the cards come from, so a restored PC keeps receiving. No passwords or tokens.
      inbox: { owner: inboxConfig().owner, repo: inboxConfig().repo, branch: inboxConfig().branch }
    };
  }

  async function exportBackupFile() {
    try {
      requirePassword();
      const envelope = await encryptObject(buildBackup(), app.settings.syncPassword);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([JSON.stringify(envelope)], { type: "application/json" }));
      link.download = `today-fragments-backup-${localDate().replaceAll("-", "")}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      toast("バックアップを書き出しました");
    } catch (error) {
      toast(error.message || "書き出せませんでした");
    }
  }

  function pickBackupFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
      input.addEventListener("cancel", () => resolve(null), { once: true });
      input.click();
    });
  }

  async function restoreBackup(file) {
    requirePassword();
    if (file.size > 50 * 1024 * 1024) throw new Error("ファイルが大きすぎます");
    let envelope;
    try {
      envelope = JSON.parse(await file.text());
    } catch {
      throw new Error("バックアップファイルを読めませんでした");
    }
    const backup = await decryptObject(envelope, app.settings.syncPassword);
    if (backup?.type !== BACKUP_TYPE) throw new Error("Today Fragmentsのバックアップファイルではありません");
    app.projects = normalizeProjectsIndex(backup.projects);
    const store = isPlainObject(backup.projectStore) ? backup.projectStore : {};
    app.projectStore = normalizeProjectStore(
      Object.fromEntries(
        Object.entries(store)
          .filter(([projectId]) => isSafeId(projectId))
          .map(([projectId, entry]) => [projectId, { data: entry?.data, view: entry?.view, dirty: createEmptyDirty() }])
      )
    );
    app.inboxLedger = normalizeInboxLedger(backup.inboxLedger);
    const inbox = isPlainObject(backup.inbox) ? backup.inbox : {};
    if (!inboxConfig().repo && textValue(inbox.repo)) {
      app.settings.inbox.owner = textValue(inbox.owner);
      app.settings.inbox.repo = textValue(inbox.repo);
      app.settings.inbox.branch = textValue(inbox.branch) || INBOX_BRANCH;
    }
    const activeId = app.projects.items.some((item) => item.id === backup.activeProjectId) ? backup.activeProjectId : app.projects.items[0].id;
    activateProject(activeId, { render: false, persist: false });
    return { projects: app.projects.items.length };
  }

  // One-time move of everything the phone used to hold (the old GitHub sync files) into the PC.
  // It merges instead of replacing, so running it again or after editing on the PC is safe.
  async function migrateLegacyData() {
    requireGithubSettings(false);
    requirePassword();
    saveActiveProjectToStore();
    const loadOptional = (path) =>
      loadGithubEncryptedObject(path).catch((error) => {
        if (error.status === 404) return null;
        throw error;
      });
    const sources = [];
    const remoteIndex = await loadOptional(githubProjectIndexPath());
    if (remoteIndex?.type === "today-fragments-project-index") {
      for (const item of normalizeProjectsIndex(remoteIndex).items) {
        const data = await loadOptional(githubProjectDataPath(item.id));
        if (data) sources.push({ item, data });
      }
    } else {
      const data = await loadOptional(app.settings.github.path);
      if (!data) throw new Error("旧同期先にデータが見つかりません。スマホの「これまでの画面」でGitHub同期をしてから試してください");
      sources.push({ item: createProjectItem({ id: DEFAULT_PROJECT_ID, name: textValue(data.project?.name) || DEFAULT_PROJECT_NAME }), data });
    }
    const summary = { projects: 0, created: 0, updated: 0 };
    sources.forEach(({ item, data }) => {
      const existed = app.projects.items.some((project) => project.id === item.id);
      const project = ensureProjectExists(item.id, item.name);
      if (!existed) {
        project.createdAt = item.createdAt;
        project.archivedAt = item.archivedAt;
      } else if (item.name && item.updatedAt > (project.updatedAt || "")) {
        project.name = item.name;
      }
      const target = item.id === app.activeProjectId ? app.data : app.projectStore[item.id].data;
      if (item.id === app.activeProjectId) target.project.name = project.name;
      const result = mergeDataInto(target, data);
      summary.projects += 1;
      summary.created += result.created;
      summary.updated += result.updated;
      refreshProjectCounts(item.id);
    });
    // From here on the PC is the main copy, so the old list of changes waiting to go to the phone has no use.
    app.dirty = createEmptyDirty();
    Object.values(app.projectStore).forEach((entry) => {
      entry.dirty = createEmptyDirty();
    });
    app.settings.migratedAt = nowIso();
    app.history = { undo: [], redo: [], restoring: false };
    updateUndoRedoButtons();
    renderAll();
    await persistState();
    return summary;
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

  function githubSyncBasePath() {
    const path = (app.settings.github.path || GITHUB_DEFAULT_PATH).replace(/^\/+|\/+$/g, "");
    const parts = path.split("/").filter(Boolean);
    if (parts.length && /\.[a-z0-9]+$/i.test(parts[parts.length - 1])) parts.pop();
    return parts.join("/") || "daily-fragments-sync";
  }

  function githubProjectIndexPath() {
    return `${githubSyncBasePath()}/projects/index.enc.json`;
  }

  function githubProjectDataPath(projectId) {
    const safeId = String(projectId || DEFAULT_PROJECT_ID).replace(/[^a-zA-Z0-9_-]/g, "");
    return `${githubSyncBasePath()}/projects/${safeId}.enc.json`;
  }

  function githubContentApiUrl(path) {
    const g = app.settings.github;
    return `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  function githubRawUrl(path) {
    const g = app.settings.github;
    return `https://raw.githubusercontent.com/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/${encodeURIComponent(g.branch || "main")}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
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

  // PC → phone: only the project and group list travels by QR now; cards flow the other way through the inbox.
  async function openQrModal() {
    if (app.settings.role !== "pc") return;
    try {
      requirePassword();
      saveActiveProjectToStore();
      const catalog = buildCatalog();
      const envelope = await encryptObject(catalog, app.settings.syncPassword);
      const payload = bytesToBase64Url(utf8(JSON.stringify(envelope)));
      const sessionId = uid("qr").replace(/_/g, "");
      const chunks = chunkString(payload, 300);
      const groupCount = catalog.projects.reduce((total, project) => total + project.groups.length, 0);
      let index = 0;
      let playing = chunks.length > 1;
      openModal(`
        <div class="modal-head">
          <h2>グループ一覧をスマホへ</h2>
          <button class="close-button" data-close type="button">×</button>
        </div>
        <p class="status-line">スマホの投稿画面で「PCの一覧を読み取る」を押して、このQRにカメラを向けてください。${
          chunks.length > 1 ? "QRは自動で切り替わるので、全部読めるまで向けたままにしてください。" : ""
        }（案件${catalog.projects.length}件・グループ${groupCount}件）</p>
        <div class="qr-wrap"><canvas id="qr-canvas"></canvas><textarea id="qr-fallback" class="output-box hidden" readonly></textarea></div>
        <p id="qr-count" class="status-line"></p>
        <div class="button-row">
          <button id="qr-prev" class="soft-button" type="button">前へ</button>
          <button id="qr-toggle" class="soft-button" type="button">${playing ? "一時停止" : "自動で切り替え"}</button>
          <button id="qr-next" class="soft-button" type="button">次へ</button>
        </div>
      `);
      const render = () => {
        const canvas = $("#qr-canvas");
        if (!canvas) return;
        const frame = `TFQR1.${sessionId}.${index + 1}.${chunks.length}.${chunks[index]}`;
        const fallback = $("#qr-fallback");
        $("#qr-count").textContent = `${index + 1} / ${chunks.length}`;
        if (window.qrcode) {
          fallback.classList.add("hidden");
          canvas.classList.remove("hidden");
          drawQrToCanvas(canvas, frame);
        } else {
          canvas.classList.add("hidden");
          fallback.classList.remove("hidden");
          fallback.value = frame;
        }
      };
      const step = (delta) => {
        index = (index + delta + chunks.length) % chunks.length;
        render();
      };
      $("#qr-prev").addEventListener("click", () => step(-1));
      $("#qr-next").addEventListener("click", () => step(1));
      $("#qr-toggle").addEventListener("click", (event) => {
        playing = !playing;
        event.currentTarget.textContent = playing ? "一時停止" : "自動で切り替え";
      });
      $("#qr-toggle").disabled = chunks.length < 2;
      render();
      if (chunks.length > 1) {
        app.qrTimer = window.setInterval(() => {
          if (playing) step(1);
        }, QR_FRAME_INTERVAL);
      }
    } catch (error) {
      toast(error.message || "QRを作れませんでした");
    }
  }

  function stopQrTimer() {
    window.clearInterval(app.qrTimer);
    app.qrTimer = 0;
  }

  function buildCatalog() {
    const projects = app.projects.items
      .filter((project) => !project.archivedAt)
      .sort((a, b) => (b.lastOpenedAt || "").localeCompare(a.lastOpenedAt || ""))
      .map((project) => {
        const data = project.id === app.activeProjectId ? app.data : app.projectStore[project.id]?.data;
        return {
          id: project.id,
          name: project.name || DEFAULT_PROJECT_NAME,
          groups: (data?.groups || []).filter(isVisibleEntity).map((group) => ({ id: group.id, title: group.title || "グループ", color: group.color }))
        };
      });
    return { type: CATALOG_TYPE, schemaVersion: 1, createdAt: nowIso(), projects };
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

  function openImportModal() {
    if (app.settings.role !== "phone") return;
    openModal(`
      <div class="modal-head">
        <h2>PCから読み取り</h2>
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
    stopScanStream();
    const session = app.scanSession;
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
      if (session !== app.scanSession || !video.isConnected) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      app.scanStream = stream;
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
    const status = $("#scan-status") || { textContent: "" };
    const normalized = extractQrFrame(text);
    if (!normalized) {
      status.textContent = options.manual ? "QRの文字列ではありません。PC側のQR表示に出ている文字列を貼ってください" : "QRを読み取れませんでした";
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
      if (total > QR_MAX_FRAMES) throw new Error("QRの枚数が多すぎます");
      if (!app.qrParts.has(sessionId)) {
        // Keep only the most recent sets so stray frames cannot pile up in memory.
        while (app.qrParts.size >= QR_MAX_SESSIONS) app.qrParts.delete(app.qrParts.keys().next().value);
        app.qrParts.set(sessionId, { total, chunks: new Map() });
      }
      const session = app.qrParts.get(sessionId);
      if (session.total !== total) throw new Error("別のQRセットが混ざっています");
      session.chunks.set(index, chunk);
      status.textContent = `${session.chunks.size} / ${session.total} 読み取り済み`;
      if (session.chunks.size !== session.total) return;
      const missing = Array.from({ length: session.total }, (_, i) => i + 1).filter((part) => !session.chunks.has(part));
      if (missing.length) {
        status.textContent = `未読: ${missing.join(", ")}`;
        return;
      }
      const payload = Array.from({ length: session.total }, (_, i) => session.chunks.get(i + 1)).join("");
      const envelope = JSON.parse(decodeUtf8(base64UrlToBytes(payload)));
      let delta;
      try {
        delta = await decryptObject(envelope, app.settings.syncPassword);
      } catch (error) {
        if (/パスワード/.test(error?.message || "")) {
          throw new Error("PCとスマホの同期パスワードが違います。両方の設定画面に出る「確認コード」が同じになるように、どちらかのパスワードを直してください");
        }
        throw error;
      }
      if (delta?.type === CATALOG_TYPE) {
        app.qrParts.delete(sessionId);
        const result = applyCatalog(delta);
        await persistState();
        closeModal();
        if (isCaptureVisible()) renderCapture();
        toast(`PCの一覧を読み込みました（案件${result.projects}件・グループ${result.groups}件）`);
        return;
      }
      if (delta?.type !== "today-fragments-delta") throw new Error("取り込みデータが違います");
      if (delta.projectId && !isSafeId(delta.projectId)) throw new Error("取り込みデータの案件IDが正しくありません");
      if (delta.projectId && delta.projectId !== app.activeProjectId) {
        saveActiveProjectToStore();
        ensureProjectExists(delta.projectId, textValue(delta.projectName) || DEFAULT_PROJECT_NAME);
        activateProject(delta.projectId, { render: false, persist: false });
      }
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

  function mergeData(incoming) {
    return mergeDataInto(app.data, incoming);
  }

  // Merges by id with "newer updatedAt wins"; works on any project's data, not only the one on screen.
  function mergeDataInto(target, incoming) {
    const result = { changed: 0, created: 0, updated: 0, skipped: 0 };
    if (!isPlainObject(incoming)) return result;
    const mergeEntities = (items, fields, normalize, list) => {
      (Array.isArray(items) ? items : []).forEach((item) => {
        // Copy only known fields so unexpected keys in imported JSON never land on live objects.
        const entity = isPlainObject(item) ? pickFields(item, fields) : null;
        if (!entity || !normalize(entity)) {
          result.skipped += 1;
          return;
        }
        const existing = list.find((candidate) => candidate.id === entity.id);
        if (!existing) {
          list.push(entity);
          result.changed += 1;
          result.created += 1;
          return;
        }
        if (entity.updatedAt > (existing.updatedAt || "")) {
          Object.assign(existing, entity);
          result.changed += 1;
          result.updated += 1;
        }
      });
    };
    mergeEntities(incoming.notes, NOTE_FIELDS, normalizeNote, target.notes);
    mergeEntities(incoming.groups, GROUP_FIELDS, normalizeGroup, target.groups);
    mergeEntities(incoming.connections, CONNECTION_FIELDS, normalizeConnection, target.connections);
    if (result.skipped) console.warn(`mergeData skipped ${result.skipped} invalid entities`);
    if (result.changed) {
      target.updatedAt = nowIso();
      updateAllNoteGroupsIn(target);
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
    // The envelope is read before authentication, so its parameters are checked before any expensive work.
    const kdf = envelope?.kdf;
    const cipherInfo = envelope?.cipher;
    const iterations = Number(kdf?.iterations);
    const validEnvelope =
      kdf?.name === "PBKDF2" &&
      kdf?.hash === "SHA-256" &&
      cipherInfo?.name === "AES-GCM" &&
      Number.isInteger(iterations) &&
      iterations >= KDF_MIN_ITERATIONS &&
      iterations <= KDF_MAX_ITERATIONS &&
      [kdf?.salt, cipherInfo?.iv, cipherInfo?.data].every((value) => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value));
    if (!validEnvelope) throw new Error("暗号化データの形式が正しくありません");
    const salt = base64UrlToBytes(kdf.salt);
    const iv = base64UrlToBytes(cipherInfo.iv);
    const data = base64UrlToBytes(cipherInfo.data);
    const key = await deriveKey(password, salt, iterations);
    let plainCompressed;
    try {
      plainCompressed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data));
    } catch {
      throw new Error("同期パスワードが違うか、データが壊れています");
    }
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
    if (useLightweightEffects()) {
      els.canvas.classList.add("disabled");
      return;
    }
    els.canvas.classList.remove("disabled");
    if (app.gl?.running) return;
    if (app.gl) {
      app.gl.running = true;
      resizeGlCanvas();
      requestAnimationFrame(drawWebGl);
      return;
    }
    const gl = els.canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      desynchronized: true,
      powerPreference: "low-power"
    });
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
      time: gl.getUniformLocation(program, "u_time"),
      running: true,
      lastDrawAt: 0
    };
    resizeGlCanvas();
    requestAnimationFrame(drawWebGl);
  }

  function drawWebGl(time) {
    if (!app.gl) return;
    if (useLightweightEffects()) {
      app.gl.running = false;
      els.canvas.classList.add("disabled");
      return;
    }
    app.gl.running = true;
    els.canvas.classList.remove("disabled");
    // The background remains animated, but 30 fps is visually sufficient and halves GPU work.
    if (time - app.gl.lastDrawAt < 1000 / 30) {
      requestAnimationFrame(drawWebGl);
      return;
    }
    app.gl.lastDrawAt = time;
    const { gl, program, pos, resolution, view, zoom } = app.gl;
    const pixelRatio = renderPixelRatio();
    resizeGlCanvas();
    gl.useProgram(program);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(resolution, els.canvas.width, els.canvas.height);
    gl.uniform2f(view, app.view.x * pixelRatio, (window.innerHeight - app.view.y) * pixelRatio);
    gl.uniform1f(zoom, app.view.zoom * pixelRatio);
    gl.uniform1f(app.gl.time, time * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(drawWebGl);
  }

  function resizeGlCanvas() {
    if (useLightweightEffects()) return;
    const pixelRatio = renderPixelRatio();
    const width = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
    const height = Math.max(1, Math.floor(window.innerHeight * pixelRatio));
    if (els.canvas.width !== width || els.canvas.height !== height) {
      els.canvas.width = width;
      els.canvas.height = height;
      app.gl?.gl.viewport(0, 0, width, height);
    }
  }

  function renderPixelRatio() {
    const ratio = window.devicePixelRatio || 1;
    return Math.min(ratio, useLightweightEffects() ? 1.15 : 1.25);
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
    stopQrTimer();
    els.modalRoot.classList.add("active");
    els.modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal-panel">${html}</section></div>`;
    $$("[data-close]", els.modalRoot).forEach((button) => button.addEventListener("click", closeModal));
    $(".modal-backdrop", els.modalRoot).addEventListener("click", (event) => {
      if (event.target.classList.contains("modal-backdrop")) closeModal();
    });
  }

  function closeModal() {
    stopScanStream();
    stopQrTimer();
    els.modalRoot.classList.remove("active");
    els.modalRoot.innerHTML = "";
  }

  function stopScanStream() {
    // Bumping the session also cancels a camera request still waiting for permission, so a closed dialog never leaves the camera on.
    app.scanSession += 1;
    if (app.scanStream) {
      app.scanStream.getTracks().forEach((track) => track.stop());
      app.scanStream = null;
    }
    const video = $("#scan-video");
    const stream = video?.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
  }

  function updateStatus() {
    if (isCaptureVisible()) renderCaptureStatus();
    els.syncStatus.classList.remove("warning");
    els.syncStatus.title = "";
    if (app.storageWriteFailed) {
      els.syncStatus.textContent = "端末保存に失敗";
      els.syncStatus.classList.add("warning");
      return;
    }
    if (app.settings.role === "pc") {
      const status = pcStatus();
      els.syncStatus.textContent = status.text;
      els.syncStatus.title = status.detail;
      els.syncStatus.classList.toggle("warning", status.warning);
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

  function schedulePersist(delay = 120) {
    clearTimeout(app.saveTimer);
    app.saveTimer = window.setTimeout(persistState, delay);
  }

  async function persistState() {
    if (app.storageReadError) return false;
    app.data.updatedAt = app.data.updatedAt || nowIso();
    saveActiveProjectToStore();
    try {
      await idbSet(STATE_KEY, {
        settings: persistableSettings(),
        projects: app.projects,
        activeProjectId: app.activeProjectId,
        projectStore: app.projectStore,
        data: app.data,
        dirty: app.dirty,
        view: app.view,
        capture: app.capture,
        inboxLedger: app.inboxLedger
      });
    } catch (error) {
      console.warn(error);
      app.storageWriteFailed = true;
      updateStatus();
      if (Date.now() - app.storageWarnedAt > 30000) {
        app.storageWarnedAt = Date.now();
        toast("端末内に保存できませんでした。空き容量を確認してください");
      }
      return false;
    }
    if (app.storageWriteFailed) {
      app.storageWriteFailed = false;
      updateStatus();
    }
    if (app.settings.role === "pc") scheduleBackupSave();
    return true;
  }

  function persistableSettings() {
    if (app.settings.savePassword) return app.settings;
    return { ...app.settings, syncPassword: "" };
  }

  function findNote(id) {
    return app.data.notes.find((note) => note.id === id);
  }

  function findGroup(id) {
    return app.data.groups.find((group) => group.id === id);
  }

  function findConnection(id) {
    return app.data.connections.find((connection) => connection.id === id);
  }

  function findEntity(type, id) {
    if (type === "note") return findNote(id);
    if (type === "group") return findGroup(id);
    if (type === "connection") return findConnection(id);
    return null;
  }

  function trashConnectionsFor(type, id, deleted = false) {
    app.data.connections.forEach((connection) => {
      const related = (connection.from.type === type && connection.from.id === id) || (connection.to.type === type && connection.to.id === id);
      if (!related || connection.deletedAt) return;
      const timestamp = nowIso();
      connection.trashedAt = connection.trashedAt || timestamp;
      if (deleted) connection.deletedAt = timestamp;
      connection.updatedAt = timestamp;
      touchEntity("connection", connection.id, { alreadyUpdated: true });
    });
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
    if (idbConnection) return idbConnection;
    idbConnection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("kv");
      };
      request.onsuccess = () => {
        const db = request.result;
        // Reopen lazily if another tab upgrades the database or the browser closes the connection.
        db.onversionchange = () => {
          db.close();
          idbConnection = null;
        };
        db.onclose = () => {
          idbConnection = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
    idbConnection.catch(() => {
      idbConnection = null;
    });
    return idbConnection;
  }

  async function idbRequest(mode, operate) {
    for (let attempt = 0; ; attempt += 1) {
      const db = await idbOpen();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction("kv", mode);
          const request = operate(tx.objectStore("kv"));
          tx.oncomplete = () => resolve(request.result);
          tx.onerror = () => reject(tx.error || request.error);
          // Quota errors abort the transaction without an error event; without this the save never settles.
          tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
        });
      } catch (error) {
        if (attempt >= 1 || error?.name !== "InvalidStateError") throw error;
        idbConnection = null;
      }
    }
  }

  function idbGet(key) {
    return idbRequest("readonly", (store) => store.get(key));
  }

  function idbSet(key, value) {
    return idbRequest("readwrite", (store) => store.put(value, key));
  }
})();
