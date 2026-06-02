const form = document.querySelector("#captureForm");
const input = document.querySelector("#captureInput");
const queueList = document.querySelector("#queueList");
const focusList = document.querySelector("#focusList");
const todayCount = document.querySelector("#todayCount");
const voiceButton = document.querySelector("#voiceButton");
const voiceListenButton = document.querySelector("#voiceListenButton");
const voiceStopButton = document.querySelector("#voiceStopButton");
const voiceSplitButton = document.querySelector("#voiceSplitButton");
const voiceClearButton = document.querySelector("#voiceClearButton");
const voiceStatus = document.querySelector("#voiceStatus");
const voiceTranscript = document.querySelector("#voiceTranscript");
const voicePreview = document.querySelector("#voicePreview");
const resurfaceButton = document.querySelector("#resurfaceButton");
const reportButton = document.querySelector("#reportButton");
const completionReport = document.querySelector("#completionReport");
const reportWeekCount = document.querySelector("#reportWeekCount");
const reportMonthCount = document.querySelector("#reportMonthCount");
const reportNote = document.querySelector("#reportNote");
const queueFilter = document.querySelector("#queueFilter");
const queueFilterNote = document.querySelector("#queueFilterNote");
const workspace = document.querySelector(".workspace");
const columnResizers = document.querySelectorAll(".column-resizer");
const saveButton = document.querySelector("#saveButton");
const loadButton = document.querySelector("#loadButton");
const fileInput = document.querySelector("#fileInput");
const saveStatus = document.querySelector("#saveStatus");
const fileName = document.querySelector("#fileName");
const inspectorPanel = document.querySelector("#inspectorPanel");
const inspectorEmpty = document.querySelector("#inspectorEmpty");
const inspectorForm = document.querySelector("#inspectorForm");
const inspectorRawInput = document.querySelector("#inspectorRawInput");
const inspectorStatus = document.querySelector("#inspectorStatus");
const inspectorStatusSwitch = document.querySelector("#inspectorStatusSwitch");
const inspectorPriority = document.querySelector("#inspectorPriority");
const inspectorPrioritySwitch = document.querySelector("#inspectorPrioritySwitch");
const inspectorEffort = document.querySelector("#inspectorEffort");
const inspectorEffortSwitch = document.querySelector("#inspectorEffortSwitch");
const inspectorCategory = document.querySelector("#inspectorCategory");
const inspectorCategorySwitch = document.querySelector("#inspectorCategorySwitch");
const inspectorReviewAt = document.querySelector("#inspectorReviewAt");
const inspectorAssignee = document.querySelector("#inspectorAssignee");
const inspectorNote = document.querySelector("#inspectorNote");
const closeInspectorButton = document.querySelector("#closeInspectorButton");
const deleteItemButton = document.querySelector("#deleteItemButton");
const metricNote = document.querySelector("#metricNote");
const statButtons = document.querySelectorAll("[data-stat-filter]");
const statNow = document.querySelector("#statNow");
const statPending = document.querySelector("#statPending");
const statDelegate = document.querySelector("#statDelegate");
const statIdea = document.querySelector("#statIdea");
const meterRing = document.querySelector(".meter-ring");
const meterValue = document.querySelector(".meter-ring span");
const categoryLegend = document.querySelector("#categoryLegend");
const loadAdvice = document.querySelector("#loadAdvice");
const burdenBars = document.querySelector("#burdenBars");
const effortRing = document.querySelector(".effort-ring");
const effortHeavyCount = document.querySelector("#effortHeavyCount");
const effortSummary = document.querySelector("#effortSummary");
const effortLegend = document.querySelector("#effortLegend");

const widthStorageKey = "mental-cache-column-widths";
const itemsStorageKey = "mental-cache-items";
const categoryStorageKey = "mental-cache-category-collapsed";
let currentFileHandle = null;
let recognition = null;
let isListening = false;
let finalTranscript = "";
let draggedItemId = null;
let activeQueueFilter = "all";
let adviceFilterItemIds = [];
let isReportVisible = false;

const categoryOrder = [
  { id: "home", label: "家庭" },
  { id: "work", label: "仕事" },
  { id: "side", label: "副業" },
  { id: "done", label: "完了" },
];

const activeCategoryOrder = categoryOrder.filter((category) => category.id !== "done");

const categoryColors = {
  home: "#77c7d2",
  work: "#c97379",
  side: "#d2b765",
  done: "#8a9693",
};

const loadLevelCopy = {
  high: "高負荷",
  medium: "中負荷",
  ok: "余裕あり",
};

const queueFilters = {
  all: "全件を表示",
  now: "今やるだけを表示",
  pending: "保留だけを表示",
  delegate: "委任だけを表示",
  idea: "アイデアだけを表示",
  advice: "アドバイス対象だけを表示",
  week: "再提示日が7日以内",
  month: "再提示日が1か月以内",
  unscheduled: "再提示日なしの保留",
};

let collapsedCategories = loadCollapsedCategories();

const statusCopy = {
  now: "今やる",
  pending: "保留",
  delegate: "委任",
  idea: "アイデア",
  done: "完了",
};

const statusReason = {
  now: "今日の判断に影響。短く処理する候補。",
  pending: "期限まで見ない。脳内監視から外す。",
  delegate: "条件を渡せば他人に任せられる可能性あり。",
  idea: "今は実行せず、素材として保存。",
  done: "完了済み。履歴として保存。",
};

const priorityCopy = {
  high: "高",
  medium: "中",
  low: "低",
};

const effortCopy = {
  high: "高",
  medium: "中",
  low: "低",
};

const effortOrder = [
  { id: "high", label: "高" },
  { id: "medium", label: "中" },
  { id: "low", label: "低" },
];

const effortColors = {
  high: "#d77a82",
  medium: "#d6bd68",
  low: "#80ccd4",
};

const initialItems = [
  {
    id: "item-board-meeting",
    rawInput: "来週の役員会、何を決める必要がある？",
    status: "now",
    priority: "high",
    effort: "medium",
    note: "論点だけ先に切り出す。",
    assignee: "",
    reviewAt: "",
    category: "work",
    loopCount: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "item-nursery-docs",
    rawInput: "保育園の書類、誰がいつ出すか未定",
    status: "delegate",
    priority: "medium",
    effort: "low",
    note: "家庭内で担当だけ決めればよい。",
    assignee: "家族",
    reviewAt: "",
    category: "home",
    loopCount: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "item-side-lp",
    rawInput: "副業LPの公開タイミングを迷っている",
    status: "pending",
    priority: "medium",
    effort: "medium",
    note: "公開条件を決めるまでは保留。",
    assignee: "",
    reviewAt: "",
    category: "side",
    loopCount: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "item-recruit-page",
    rawInput: "採用ページの方針",
    status: "pending",
    priority: "high",
    effort: "high",
    note: "21日で6回出現。いったん金曜まで非表示。",
    assignee: "",
    reviewAt: "2026-06-05",
    category: "work",
    loopCount: 6,
    createdAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "item-old-invoice",
    rawInput: "古い請求書の心配",
    status: "pending",
    priority: "low",
    effort: "low",
    note: "確認済み。再確認の必要は低い。",
    assignee: "",
    reviewAt: "",
    category: "work",
    loopCount: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "item-family-trip",
    rawInput: "家族旅行の候補比較",
    status: "delegate",
    priority: "medium",
    effort: "medium",
    note: "条件だけ渡せば任せられる可能性あり。",
    assignee: "家族",
    reviewAt: "",
    category: "home",
    loopCount: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

let items = loadLocalItems();
let selectedItemId = null;

function createId() {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayString() {
  return formatDate(new Date());
}

function dayStringAfter(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function dateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function formatShortDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function classify(text) {
  const normalized = text.toLowerCase();

  if (/(任せ|依頼|お願い|誰か|渡す|共有)/.test(normalized)) {
    return "delegate";
  }

  if (/(いつか|後で|保留|来週|月末|様子見|まだ)/.test(normalized)) {
    return "pending";
  }

  if (/(確認済|もういい|不要|消す|忘れ|気にしなくていい)/.test(normalized)) {
    return "pending";
  }

  if (/(アイデア|思いつき|企画|試したい|ネタ)/.test(normalized)) {
    return "idea";
  }

  if (/(決め|判断|今日|明日|締切|至急|会議|提出)/.test(normalized)) {
    return "now";
  }

  return "pending";
}

function isCategory(value) {
  return categoryOrder.some((category) => category.id === value);
}

function isPriority(value) {
  return Boolean(priorityCopy[value]);
}

function isEffort(value) {
  return Boolean(effortCopy[value]);
}

function inferPriority(text, status, legacyStatus = "") {
  const normalized = text.toLowerCase();

  if (legacyStatus === "drop") {
    return "low";
  }

  if (status === "now" || /(至急|今日|明日|締切|決め|判断|会議|提出)/.test(normalized)) {
    return "high";
  }

  if (/(いつか|後で|様子見|確認済|不要|気にしなくていい|迷っている)/.test(normalized)) {
    return "low";
  }

  return "medium";
}

function inferEffort(text, status, priority) {
  const normalized = text.toLowerCase();

  if (/(大変|重い|腰が重い|時間かか|工数|資料作成|設計|調査|比較|方針|企画|面倒)/.test(normalized)) {
    return "high";
  }

  if (/(すぐ|軽い|短く|確認済|確認だけ|連絡だけ|出すだけ|送るだけ|5分|10分)/.test(normalized)) {
    return "low";
  }

  if (status === "now" && priority === "high") {
    return "medium";
  }

  return "medium";
}

function inferCategory(text, assignee = "") {
  const normalized = `${text} ${assignee}`.toLowerCase();

  if (/(保育|家族|家庭|旅行|子|園|妻|夫|親|家|買い物)/.test(normalized)) {
    return "home";
  }

  if (/(副業|lp|個人|企画|ネタ|週末|試したい)/.test(normalized)) {
    return "side";
  }

  return "work";
}

function sourceLabel(source) {
  return source === "voice" ? "音声メモ" : "入力";
}

function summarize(text) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}...` : trimmed;
}

function normalizeItem(item) {
  const now = new Date().toISOString();
  const rawInput = String(item?.rawInput || item?.summary || "").trim();
  const legacyStatus = String(item?.status || "");
  const status = statusCopy[item?.status] ? item.status : "pending";
  const assignee = String(item?.assignee || "");
  const category =
    status === "done"
      ? "done"
      : isCategory(item?.category) && item.category !== "done"
        ? item.category
        : inferCategory(rawInput, assignee);
  const priority = isPriority(item?.priority)
    ? item.priority
    : inferPriority(rawInput, status, legacyStatus);
  const effort = isEffort(item?.effort) ? item.effort : inferEffort(rawInput, status, priority);
  const completedAt = status === "done" ? String(item?.completedAt || item?.updatedAt || now) : "";

  return {
    id: String(item?.id || createId()),
    rawInput: rawInput || "無題の気がかり",
    status,
    priority,
    effort,
    note: String(item?.note || ""),
    assignee,
    reviewAt: String(item?.reviewAt || ""),
    category,
    completedAt,
    source: String(item?.source || "text"),
    loopCount: Number.isFinite(item?.loopCount) ? item.loopCount : 1,
    createdAt: String(item?.createdAt || now),
    updatedAt: String(item?.updatedAt || now),
  };
}

function loadLocalItems() {
  try {
    const saved = JSON.parse(localStorage.getItem(itemsStorageKey));

    if (Array.isArray(saved) && saved.length > 0) {
      const normalizedItems = saved.map(normalizeItem);
      localStorage.setItem(itemsStorageKey, JSON.stringify(normalizedItems));
      return normalizedItems;
    }
  } catch {
    localStorage.removeItem(itemsStorageKey);
  }

  return initialItems.map(normalizeItem);
}

function loadCollapsedCategories() {
  try {
    const saved = JSON.parse(localStorage.getItem(categoryStorageKey));

    if (saved && typeof saved === "object") {
      return Object.fromEntries(
        categoryOrder.map((category) => [category.id, Boolean(saved[category.id])]),
      );
    }
  } catch {
    localStorage.removeItem(categoryStorageKey);
  }

  return Object.fromEntries(categoryOrder.map((category) => [category.id, false]));
}

function persistCollapsedCategories() {
  localStorage.setItem(categoryStorageKey, JSON.stringify(collapsedCategories));
}

function persistLocalItems() {
  localStorage.setItem(itemsStorageKey, JSON.stringify(items));
}

function markSaveStatus(text) {
  if (saveStatus) {
    saveStatus.textContent = text;
  }
}

function markFileName(text) {
  if (fileName) {
    fileName.textContent = text;
  }
}

function markDirty() {
  persistLocalItems();
  markSaveStatus("未保存");
}

function setVoiceStatus(text) {
  if (voiceStatus) {
    voiceStatus.textContent = text;
  }
}

function isDue(item) {
  return !item.reviewAt || item.reviewAt <= todayString();
}

function focusItems() {
  return items.filter((item) => {
    if (item.status === "now" || item.status === "delegate") {
      return true;
    }

    return item.status === "pending" && isDue(item);
  });
}

function queueItems() {
  return [...items];
}

function isWithinDays(item, days) {
  if (!item.reviewAt) {
    return false;
  }

  return item.reviewAt <= dayStringAfter(days);
}

function matchesQueueFilter(item) {
  if (activeQueueFilter === "now") {
    return item.status === "now";
  }

  if (["pending", "delegate", "idea"].includes(activeQueueFilter)) {
    return item.status === activeQueueFilter;
  }

  if (activeQueueFilter === "advice") {
    return adviceFilterItemIds.includes(item.id);
  }

  if (activeQueueFilter === "week") {
    return isWithinDays(item, 7);
  }

  if (activeQueueFilter === "month") {
    return isWithinDays(item, 30);
  }

  if (activeQueueFilter === "unscheduled") {
    return item.status === "pending" && !item.reviewAt;
  }

  return true;
}

function filteredQueueItems() {
  return queueItems().filter(matchesQueueFilter);
}

function renderFocusList() {
  const visibleItems = focusItems();
  focusList.replaceChildren();
  todayCount.textContent = String(visibleItems.length);

  visibleItems.forEach((item) => {
    const card = document.createElement("button");
    card.className = item.status === "now" ? "focus-item is-hot" : "focus-item";
    card.type = "button";
    card.dataset.focusItemId = item.id;

    const body = document.createElement("p");
    const label = document.createElement("span");

    body.textContent = summarize(item.rawInput);
    label.textContent = statusCopy[item.status];

    card.append(body, label);
    card.addEventListener("click", () => jumpToQueueItem(item.id));
    focusList.append(card);
  });
}

function renderQueueList() {
  queueList.replaceChildren();
  renderQueueFilter();

  categoryOrder.forEach((category) => {
    const categoryItems = filteredQueueItems().filter((item) => item.category === category.id);
    const section = document.createElement("section");
    const header = document.createElement("button");
    const title = document.createElement("span");
    const count = document.createElement("strong");
    const toggle = document.createElement("i");
    const list = document.createElement("div");
    const isCollapsed = Boolean(collapsedCategories[category.id]);

    section.className = "queue-category";
    section.dataset.category = category.id;
    header.className = "category-header";
    header.type = "button";
    header.setAttribute("aria-expanded", String(!isCollapsed));
    title.textContent = category.label;
    count.textContent = String(categoryItems.length);
    toggle.textContent = isCollapsed ? "+" : "-";
    list.className = "category-list";
    list.dataset.category = category.id;

    header.append(toggle, title, count);
    header.addEventListener("click", () => toggleCategory(category.id));
    list.addEventListener("dragover", handleCategoryDragOver);
    list.addEventListener("drop", handleCategoryDrop);
    list.addEventListener("dragleave", clearDragTargets);

    if (isCollapsed) {
      list.hidden = true;
    } else if (categoryItems.length === 0) {
      const empty = document.createElement("p");
      empty.className = "category-empty";
      empty.textContent = "ここへドラッグ";
      list.append(empty);
    } else {
      categoryItems.forEach((item) => {
        list.append(createQueueCard(item));
      });
    }

    section.append(header, list);
    queueList.append(section);
  });
}

function renderQueueFilter() {
  queueFilter.querySelectorAll("button[data-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === activeQueueFilter);
  });

  const total = filteredQueueItems().length;
  queueFilterNote.textContent = `${queueFilters[activeQueueFilter]} / ${total}件`;
}

function createQueueCard(item) {
  const card = document.createElement("article");
  card.className = [
    "queue-item",
    item.id === selectedItemId ? "is-selected" : "",
    item.status === "done" ? "is-done" : "",
  ]
    .filter(Boolean)
    .join(" ");
  card.draggable = item.status !== "done";
  card.dataset.status = item.status;
  card.dataset.priority = item.priority;
  card.dataset.effort = item.effort;
  card.dataset.itemId = item.id;
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-pressed", String(item.id === selectedItemId));

  const content = document.createElement("div");
  const title = document.createElement("strong");
  const reason = document.createElement("p");
  const chip = document.createElement("span");
  const effortChip = document.createElement("span");
  const completeButton = document.createElement("button");
  const tags = document.createElement("div");

  title.textContent = summarize(item.rawInput);
  reason.textContent =
    item.status === "done" && item.completedAt
      ? `完了 ${formatShortDateTime(item.completedAt)}`
      : item.note || statusReason[item.status];
  chip.className =
    item.status === "pending"
      ? `status-chip ${item.status} priority-${item.priority}`
      : `status-chip ${item.status}`;
  chip.textContent =
    item.status === "pending" ? `${statusCopy[item.status]} ${priorityCopy[item.priority]}` : statusCopy[item.status];
  effortChip.className = `effort-chip effort-${item.effort}`;
  effortChip.textContent = `重さ ${effortCopy[item.effort]}`;
  completeButton.className = item.status === "done" ? "complete-button is-done" : "complete-button";
  completeButton.type = "button";
  completeButton.textContent = item.status === "done" ? "完了済" : "完了";
  completeButton.disabled = item.status === "done";
  completeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    completeItem(item.id);
  });

  content.append(title, reason);
  tags.className = "queue-tags";
  tags.append(chip, effortChip, completeButton);
  card.append(content, tags);
  card.addEventListener("click", (event) => {
    if (event.target.closest("button")) {
      return;
    }

    selectItem(item.id);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    selectItem(item.id);
  });
  card.addEventListener("dragstart", handleCardDragStart);
  card.addEventListener("dragend", handleCardDragEnd);

  return card;
}

function toggleCategory(categoryId) {
  collapsedCategories = {
    ...collapsedCategories,
    [categoryId]: !collapsedCategories[categoryId],
  };
  persistCollapsedCategories();
  renderQueueList();
}

function clearDragTargets() {
  queueList.querySelectorAll(".is-drop-target").forEach((element) => {
    element.classList.remove("is-drop-target");
  });
}

function handleCardDragStart(event) {
  draggedItemId = event.currentTarget.dataset.itemId;
  event.currentTarget.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedItemId);
}

function handleCardDragEnd(event) {
  event.currentTarget.classList.remove("is-dragging");
  draggedItemId = null;
  clearDragTargets();
}

function handleCategoryDragOver(event) {
  if (!draggedItemId) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  clearDragTargets();

  const card = event.target.closest(".queue-item");
  const target = card || event.currentTarget;
  target.classList.add("is-drop-target");
}

function handleCategoryDrop(event) {
  if (!draggedItemId) {
    return;
  }

  event.preventDefault();
  const categoryId = event.currentTarget.dataset.category;
  const targetCard = event.target.closest(".queue-item");
  let targetId = targetCard?.dataset.itemId || null;
  let position = "end";

  if (targetCard && targetId !== draggedItemId) {
    const rect = targetCard.getBoundingClientRect();
    position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  } else {
    targetId = null;
  }

  moveItemToCategory(draggedItemId, categoryId, targetId, position);
  draggedItemId = null;
  clearDragTargets();
}

function moveItemToCategory(itemId, categoryId, targetId = null, position = "end") {
  if (!isCategory(categoryId)) {
    return;
  }

  const draggedItem = items.find((item) => item.id === itemId);

  if (!draggedItem) {
    return;
  }

  const movedAt = new Date().toISOString();
  const movedItem = normalizeItem({
    ...draggedItem,
    ...(categoryId === "done"
      ? {
          status: "done",
          reviewAt: "",
          completedAt: draggedItem.completedAt || movedAt,
        }
      : {}),
    category: categoryId,
    updatedAt: movedAt,
  });
  const nextItems = items.filter((item) => item.id !== itemId);
  let insertIndex = nextItems.length;

  if (targetId) {
    const targetIndex = nextItems.findIndex((item) => item.id === targetId);

    if (targetIndex !== -1) {
      insertIndex = position === "before" ? targetIndex : targetIndex + 1;
    }
  } else {
    const lastCategoryIndex = nextItems.reduce(
      (lastIndex, item, index) => (item.category === categoryId ? index : lastIndex),
      -1,
    );

    insertIndex = lastCategoryIndex === -1 ? nextItems.length : lastCategoryIndex + 1;
  }

  nextItems.splice(insertIndex, 0, movedItem);
  items = nextItems;
  markDirty();
  renderAll();
}

function itemLoadScore(item) {
  if (item.status === "done" || item.category === "done") {
    return 0;
  }

  const statusWeight = {
    now: 9,
    pending: 3,
    delegate: 5,
    idea: 1,
  };
  const priorityWeight = {
    high: 4,
    medium: 2,
    low: 0,
  };
  const effortWeight = {
    high: 6,
    medium: 3,
    low: 0,
  };
  const loopWeight = Math.min(Math.max(item.loopCount - 1, 0) * 1.5, 6);
  const dueWeight = item.status === "pending" && isDue(item) ? 2 : 0;

  return (
    (statusWeight[item.status] || 3) +
    (priorityWeight[item.priority] || 0) +
    (effortWeight[item.effort] || 0) +
    loopWeight +
    dueWeight
  );
}

function loadLevel(percent) {
  if (percent >= 70) {
    return "high";
  }

  if (percent >= 40) {
    return "medium";
  }

  return "ok";
}

function categoryStats() {
  return activeCategoryOrder.map((category) => {
    const categoryItems = items.filter((item) => item.category === category.id);
    const score = categoryItems.reduce((sum, item) => sum + itemLoadScore(item), 0);
    const percent = Math.min(100, Math.round(score * 4));

    return {
      ...category,
      items: categoryItems,
      score,
      percent,
      level: loadLevel(percent),
      pending: categoryItems.filter((item) => item.status === "pending").length,
      now: categoryItems.filter((item) => item.status === "now").length,
      delegate: categoryItems.filter((item) => item.status === "delegate").length,
    };
  });
}

function categoryDonutGradient(stats) {
  const totalScore = stats.reduce((sum, category) => sum + category.score, 0);

  if (totalScore === 0) {
    return "conic-gradient(rgba(255, 255, 255, 0.12) 0deg 360deg)";
  }

  let cursor = 0;
  const segments = stats.map((category) => {
    const next = cursor + (category.score / totalScore) * 360;
    const segment = `${categoryColors[category.id]} ${cursor.toFixed(1)}deg ${next.toFixed(1)}deg`;
    cursor = next;
    return segment;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function donutGradient(segments, colors) {
  const totalScore = segments.reduce((sum, segment) => sum + segment.score, 0);

  if (totalScore === 0) {
    return "conic-gradient(rgba(255, 255, 255, 0.12) 0deg 360deg)";
  }

  let cursor = 0;
  const gradientSegments = segments.map((segment) => {
    const next = cursor + (segment.score / totalScore) * 360;
    const gradientSegment = `${colors[segment.id]} ${cursor.toFixed(1)}deg ${next.toFixed(1)}deg`;
    cursor = next;
    return gradientSegment;
  });

  return `conic-gradient(${gradientSegments.join(", ")})`;
}

function renderCategoryLegend(stats) {
  categoryLegend.replaceChildren();
  const totalScore = stats.reduce((sum, category) => sum + category.score, 0);

  stats.forEach((category) => {
    const item = document.createElement("span");
    const dot = document.createElement("i");
    const share = totalScore === 0 ? 0 : Math.round((category.score / totalScore) * 100);

    dot.style.background = categoryColors[category.id];
    item.append(dot, document.createTextNode(`${category.label} ${share}%`));
    categoryLegend.append(item);
  });
}

function effortStats() {
  return effortOrder.map((effort) => {
    const effortItems = items.filter((item) => item.effort === effort.id && item.status !== "done");
    const score = effortItems.reduce((sum, item) => sum + itemLoadScore(item), 0);

    return {
      ...effort,
      items: effortItems,
      score,
    };
  });
}

function renderEffortChart(stats) {
  effortLegend.replaceChildren();
  const totalScore = stats.reduce((sum, effort) => sum + effort.score, 0);
  const highEffort = stats.find((effort) => effort.id === "high");
  const mediumEffort = stats.find((effort) => effort.id === "medium");
  const lowEffort = stats.find((effort) => effort.id === "low");

  effortRing.style.background = donutGradient(stats, effortColors);
  effortHeavyCount.textContent = String(highEffort?.items.length || 0);
  effortSummary.textContent = `高${highEffort?.items.length || 0}件 / 中${mediumEffort?.items.length || 0}件 / 低${lowEffort?.items.length || 0}件`;

  stats.forEach((effort) => {
    const item = document.createElement("span");
    const dot = document.createElement("i");
    const share = totalScore === 0 ? 0 : Math.round((effort.score / totalScore) * 100);

    dot.style.background = effortColors[effort.id];
    item.append(dot, document.createTextNode(`重さ${effort.label} ${share}%`));
    effortLegend.append(item);
  });
}

function renderBurdenBars(stats) {
  burdenBars.replaceChildren();

  stats.forEach((category) => {
    const row = document.createElement("div");
    const label = document.createElement("span");
    const bar = document.createElement("div");
    const fill = document.createElement("i");
    const value = document.createElement("strong");

    row.className = `bar-row load-${category.level}`;
    label.textContent = category.label;
    bar.className = "bar";
    fill.style.width = `${category.percent}%`;
    value.textContent = loadLevelCopy[category.level];

    bar.append(fill);
    row.append(label, bar, value);
    burdenBars.append(row);
  });
}

function reductionAdvice(stats, load) {
  const activeStats = stats.filter((category) => category.items.length > 0);
  const effortRank = {
    high: 3,
    medium: 2,
    low: 1,
  };
  const sortByEffortLoad = (a, b) =>
    (effortRank[b.effort] || 0) - (effortRank[a.effort] || 0) || itemLoadScore(b) - itemLoadScore(a);

  if (activeStats.length === 0) {
    return {
      text: "まだ負荷はありません。思いついたものを入れるだけで、脳内監視を外に出せます。",
      itemIds: [],
    };
  }

  const sortedStats = [...stats].sort((a, b) => b.score - a.score);
  const heaviest = sortedStats[0];
  const average = stats.reduce((sum, category) => sum + category.score, 0) / stats.length;
  const candidates = [...heaviest.items]
    .filter((item) => item.status !== "idea" && !(item.status === "pending" && item.priority === "low"))
    .sort(sortByEffortLoad);

  if (heaviest.score <= average + 4 || candidates.length === 0) {
    const fallbackTargets = [...activeStats]
      .flatMap((category) => category.items)
      .filter((item) => item.status !== "idea" && !(item.status === "pending" && item.priority === "low"))
      .sort(sortByEffortLoad)
      .slice(0, 2);
    const fallbackNames = fallbackTargets.map((item) => `「${summarize(item.rawInput)}」（重さ${effortCopy[item.effort]}）`).join("、");
    const fallbackText =
      fallbackTargets.length > 0
        ? `3カテゴリの負荷は大きく偏っていません。重さインパクトが高い${fallbackTargets.length}件（${fallbackNames}）を低優先の保留か委任に落とすと、余白が作りやすくなります。`
        : "3カテゴリの負荷は大きく偏っていません。低優先の保留を増やせると、さらに余白が残ります。";

    return {
      text: fallbackText,
      itemIds: fallbackTargets.map((item) => item.id),
    };
  }

  const reductionCount = Math.min(candidates.length, Math.max(1, Math.ceil((heaviest.score - average) / 7)));
  const targets = candidates.slice(0, reductionCount);
  const targetNames = targets.map((item) => `「${summarize(item.rawInput)}」（重さ${effortCopy[item.effort]}）`).join("、");
  const projectedDrop = Math.max(4, Math.min(24, Math.round(targets.reduce((sum, item) => sum + itemLoadScore(item), 0) * 1.4)));
  const hasNow = targets.some((item) => item.status === "now");
  const hasDelegate = targets.some((item) => item.status === "delegate");
  const hasHeavyEffort = targets.some((item) => item.effort === "high");
  const action = hasNow
    ? "保留または委任に動かす"
    : hasDelegate
      ? "担当者へ渡して自分の監視から外す"
      : "再提示日を入れて低めの保留に落とす";
  const effortPrefix = hasHeavyEffort ? "重さ高のカードを先に減らすと効きます。" : "重さ中以上のカードから減らすと効きます。";

  return {
    text: `${effortPrefix} ${heaviest.label}の${reductionCount}件（${targetNames}）を${action}と、占有率は約${Math.min(load, projectedDrop)}pt下がり、負荷の偏りが馴らされます。`,
    itemIds: targets.map((item) => item.id),
  };
}

function renderStats() {
  const unresolvedCount = items.filter((item) => item.status !== "idea" && item.status !== "done").length;
  const pendingCount = items.filter((item) => item.status === "pending").length;
  const highPendingCount = items.filter(
    (item) => item.status === "pending" && item.priority === "high",
  ).length;
  const mediumPendingCount = items.filter(
    (item) => item.status === "pending" && item.priority === "medium",
  ).length;
  const lowPendingCount = items.filter(
    (item) => item.status === "pending" && item.priority === "low",
  ).length;
  const decisionCount = items.filter((item) => item.status === "now").length;
  const delegateCount = items.filter((item) => item.status === "delegate").length;
  const ideaCount = items.filter((item) => item.status === "idea").length;
  const loopCount = items.filter((item) => item.loopCount > 1).length;
  const stats = categoryStats();
  const effortLoadStats = effortStats();
  const totalLoadScore = stats.reduce((sum, category) => sum + category.score, 0);
  const load = Math.min(
    95,
    Math.round(totalLoadScore * 1.55 + unresolvedCount * 2 + loopCount * 4 + decisionCount * 3),
  );

  statNow.textContent = String(decisionCount);
  statPending.textContent = String(pendingCount);
  statDelegate.textContent = String(delegateCount);
  statIdea.textContent = String(ideaCount);
  metricNote.textContent = `保留 ${pendingCount} 高${highPendingCount} / 中${mediumPendingCount} / 低${lowPendingCount}`;
  meterRing.style.setProperty("--load", String(load));
  meterRing.style.background = categoryDonutGradient(stats);
  meterValue.textContent = String(load);
  renderCategoryLegend(stats);
  renderEffortChart(effortLoadStats);
  renderBurdenBars(stats);
  const advice = reductionAdvice(stats, load);
  adviceFilterItemIds = advice.itemIds;
  loadAdvice.textContent = advice.text;
  loadAdvice.classList.toggle("is-active", activeQueueFilter === "advice");
  loadAdvice.classList.toggle("is-filterable", adviceFilterItemIds.length > 0);
  loadAdvice.setAttribute("aria-pressed", String(activeQueueFilter === "advice"));

  statButtons.forEach((button) => {
    const isActive = activeQueueFilter === button.dataset.statFilter;

    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function completedItemsWithin(days) {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);

  return items.filter((item) => {
    if (item.status !== "done" || !item.completedAt) {
      return false;
    }

    const completedAt = new Date(item.completedAt);

    return !Number.isNaN(completedAt.getTime()) && completedAt >= threshold;
  });
}

function renderCompletionReport() {
  completionReport.hidden = !isReportVisible;
  reportButton.classList.toggle("is-active", isReportVisible);
  reportButton.setAttribute("aria-pressed", String(isReportVisible));

  if (!isReportVisible) {
    return;
  }

  const weekItems = completedItemsWithin(7);
  const monthItems = completedItemsWithin(30);
  const recentItems = [...monthItems]
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, 3);

  reportWeekCount.textContent = String(weekItems.length);
  reportMonthCount.textContent = String(monthItems.length);
  reportNote.textContent =
    recentItems.length === 0
      ? "完了したカードはまだありません。"
      : `最近の完了: ${recentItems.map((item) => `「${summarize(item.rawInput)}」`).join("、")}`;
}

function renderInspector() {
  const item = items.find((candidate) => candidate.id === selectedItemId);
  workspace.classList.toggle("has-inspector", Boolean(item));

  if (!item) {
    inspectorEmpty.hidden = false;
    inspectorForm.hidden = true;
    return;
  }

  inspectorEmpty.hidden = true;
  inspectorForm.hidden = false;
  inspectorRawInput.value = item.rawInput;
  setInspectorStatus(item.status);
  setInspectorPriority(item.priority);
  setInspectorEffort(item.effort);
  setInspectorCategory(item.category);
  inspectorReviewAt.value = item.reviewAt;
  inspectorAssignee.value = item.assignee;
  inspectorNote.value = item.note;
}

function setInspectorStatus(status) {
  inspectorStatus.value = status;

  inspectorStatusSwitch.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.status === status);
  });
}

function setInspectorPriority(priority) {
  inspectorPriority.value = priority;

  inspectorPrioritySwitch.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.priority === priority);
  });
}

function setInspectorEffort(effort) {
  inspectorEffort.value = effort;

  inspectorEffortSwitch.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.effort === effort);
  });
}

function setInspectorCategory(category) {
  inspectorCategory.value = category;

  inspectorCategorySwitch.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.category === category);
  });
}

function renderAll() {
  renderFocusList();
  renderStats();
  renderCompletionReport();
  renderQueueList();
  renderInspector();
}

function selectItem(itemId) {
  selectedItemId = itemId;
  renderAll();
}

function jumpToQueueItem(itemId) {
  const item = items.find((candidate) => candidate.id === itemId);

  if (!item) {
    return;
  }

  activeQueueFilter = "all";
  collapsedCategories = {
    ...collapsedCategories,
    [item.category]: false,
  };
  selectedItemId = itemId;
  persistCollapsedCategories();
  renderAll();

  requestAnimationFrame(() => {
    const target = queueList.querySelector(`[data-item-id="${itemId}"]`);

    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("is-jump-target");
    window.setTimeout(() => target.classList.remove("is-jump-target"), 1200);
  });
}

function toggleAdviceFilter() {
  if (adviceFilterItemIds.length === 0) {
    return;
  }

  if (activeQueueFilter === "advice") {
    activeQueueFilter = "all";
    renderAll();
    return;
  }

  const targetCategories = new Set(
    items
      .filter((item) => adviceFilterItemIds.includes(item.id))
      .map((item) => item.category),
  );

  collapsedCategories = {
    ...collapsedCategories,
    ...Object.fromEntries([...targetCategories].map((categoryId) => [categoryId, false])),
  };
  activeQueueFilter = "advice";
  persistCollapsedCategories();
  renderAll();
}

function completeItem(itemId) {
  const completedAt = new Date().toISOString();
  const item = items.find((candidate) => candidate.id === itemId);

  if (!item || item.status === "done") {
    return;
  }

  items = items.map((candidate) => {
    if (candidate.id !== itemId) {
      return candidate;
    }

    return normalizeItem({
      ...candidate,
      status: "done",
      category: "done",
      reviewAt: "",
      completedAt,
      updatedAt: completedAt,
    });
  });

  if (selectedItemId === itemId) {
    selectedItemId = null;
  }

  collapsedCategories = {
    ...collapsedCategories,
    done: false,
  };
  persistCollapsedCategories();
  markDirty();
  renderAll();
}

function addItem(text, status = classify(text)) {
  const now = new Date().toISOString();
  const item = normalizeItem({
    id: createId(),
    rawInput: text,
    status,
    note: statusReason[status],
    source: "text",
    createdAt: now,
    updatedAt: now,
  });

  items.unshift(item);
  selectedItemId = item.id;
  markDirty();
  renderAll();
}

function addVoiceItems(tasks) {
  if (tasks.length === 0) {
    setVoiceStatus("候補なし");
    return;
  }

  const now = new Date().toISOString();
  const newItems = tasks.map((text) =>
    normalizeItem({
      id: createId(),
      rawInput: text,
      status: classify(text),
      note: "音声メモから分解",
      source: "voice",
      createdAt: now,
      updatedAt: now,
    }),
  );

  items = [...newItems, ...items];
  selectedItemId = newItems[0].id;
  markDirty();
  renderAll();
  setVoiceStatus(`${newItems.length}件追加`);
}

function updateSelectedItem(fields, options = {}) {
  items = items.map((item) => {
    if (item.id !== selectedItemId) {
      return item;
    }

    return normalizeItem({
      ...item,
      ...fields,
      updatedAt: new Date().toISOString(),
    });
  });

  markDirty();

  if (options.keepInspector) {
    renderFocusList();
    renderStats();
    renderQueueList();
    return;
  }

  renderAll();
}

function deleteSelectedItem() {
  items = items.filter((item) => item.id !== selectedItemId);
  selectedItemId = null;
  markDirty();
  renderAll();
}

function stripBulletPrefix(text) {
  return text
    .replace(/^\s*(?:[-*・•]|[0-9０-９]+[.)．、]|[（(]?[0-9０-９]+[）)])\s*/g, "")
    .trim();
}

function splitVoiceTranscript(text) {
  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/[。！？!?]/g, "$&\n")
    .replace(/(?:^|\s|　|、)(あと|それから|それと|次に|もう一つ|それに|ただ|で、)/g, "\n$1")
    .replace(/、(?=(明日|来週|月末|今日|誰か|任せ|確認|決め|保留|忘れ|依頼|提出|買|連絡))/g, "\n")
    .replace(/[；;]/g, "\n");

  const seen = new Set();

  return normalized
    .split(/\n+/)
    .map((line) =>
      stripBulletPrefix(line)
        .replace(/^(あと|それから|それと|次に|もう一つ|それに|ただ|で、)[、\s　]*/g, "")
        .trim(),
    )
    .filter((line) => line.length >= 4)
    .filter((line) => {
      const key = line.replace(/\s+/g, "");

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function updateVoicePreview() {
  const tasks = splitVoiceTranscript(voiceTranscript.value);
  voicePreview.replaceChildren();

  const count = document.createElement("span");
  count.textContent = `${tasks.length}件`;
  voicePreview.append(count);

  tasks.slice(0, 4).forEach((task) => {
    const chip = document.createElement("span");
    chip.textContent = summarize(task);
    voicePreview.append(chip);
  });
}

function SpeechRecognitionConstructor() {
  return window.webkitSpeechRecognition || window.SpeechRecognition || null;
}

function ensureSpeechRecognition() {
  if (recognition) {
    return recognition;
  }

  const Recognition = SpeechRecognitionConstructor();

  if (!Recognition) {
    setVoiceStatus("Chrome音声認識なし");
    return null;
  }

  recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.addEventListener("start", () => {
    isListening = true;
    voiceButton.classList.add("is-recording");
    voiceListenButton.disabled = true;
    voiceStopButton.disabled = false;
    setVoiceStatus("聞き取り中");
  });

  recognition.addEventListener("end", () => {
    isListening = false;
    voiceButton.classList.remove("is-recording");
    voiceListenButton.disabled = false;
    voiceStopButton.disabled = true;
    setVoiceStatus(voiceTranscript.value.trim() ? "停止中" : "待機中");
  });

  recognition.addEventListener("error", () => {
    isListening = false;
    voiceButton.classList.remove("is-recording");
    voiceListenButton.disabled = false;
    voiceStopButton.disabled = true;
    setVoiceStatus("聞き取り失敗");
  });

  recognition.addEventListener("result", (event) => {
    let interimTranscript = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript;

      if (event.results[index].isFinal) {
        finalTranscript = `${finalTranscript} ${text}`.trim();
      } else {
        interimTranscript += text;
      }
    }

    voiceTranscript.value = `${finalTranscript} ${interimTranscript}`.trim();
    updateVoicePreview();
  });

  return recognition;
}

function startVoiceListening() {
  if (isListening) {
    return;
  }

  const nextRecognition = ensureSpeechRecognition();

  if (!nextRecognition) {
    voiceTranscript.focus();
    return;
  }

  finalTranscript = voiceTranscript.value.trim();

  try {
    nextRecognition.start();
  } catch {
    setVoiceStatus("聞き取り中");
  }
}

function stopVoiceListening() {
  if (!recognition || !isListening) {
    return;
  }

  recognition.stop();
}

function splitAndAddVoiceTranscript() {
  const tasks = splitVoiceTranscript(voiceTranscript.value);
  addVoiceItems(tasks);
  updateVoicePreview();
}

function exportData() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
  };
}

function filePickerTypes() {
  return [
    {
      description: "Mental Cache JSON",
      accept: { "application/json": [".json"] },
    },
  ];
}

function downloadJson(text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mental-cache-${todayString()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function saveToExternalFile() {
  const json = JSON.stringify(exportData(), null, 2);
  const suggestedName = `mental-cache-${todayString()}.json`;

  try {
    markSaveStatus("保存中");

    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: filePickerTypes(),
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      currentFileHandle = handle;
      markFileName(handle.name || suggestedName);
    } else {
      downloadJson(json);
      markFileName(suggestedName);
    }

    markSaveStatus("保存済み");
  } catch (error) {
    if (error?.name === "AbortError") {
      markSaveStatus("未保存");
      return;
    }

    markSaveStatus("保存失敗");
  }
}

async function openExternalFile() {
  try {
    markSaveStatus("読込中");

    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: filePickerTypes(),
      });
      const file = await handle.getFile();
      const text = await file.text();
      importData(JSON.parse(text), file.name, handle);
      return;
    }

    fileInput.click();
  } catch (error) {
    if (error?.name === "AbortError") {
      markSaveStatus("未保存");
      return;
    }

    markSaveStatus("読込失敗");
  }
}

function importData(data, name = "読み込みファイル", handle = null) {
  const importedItems = Array.isArray(data) ? data : data?.items;

  if (!Array.isArray(importedItems)) {
    throw new Error("items array is missing");
  }

  items = importedItems.map(normalizeItem);
  selectedItemId = items[0]?.id || null;
  currentFileHandle = handle;
  persistLocalItems();
  renderAll();
  markFileName(name);
  markSaveStatus("読込済み");
}

function readExternalFile(file) {
  const reader = new FileReader();

  reader.addEventListener("load", () => {
    try {
      importData(JSON.parse(String(reader.result || "{}")), file.name);
    } catch {
      markSaveStatus("読込失敗");
    }
  });

  reader.readAsText(file);
}

function setColumnWidths(left, middle, right) {
  workspace.style.setProperty("--left-col", `${left}px`);
  workspace.style.setProperty("--middle-col", `${middle}px`);
  workspace.style.setProperty("--right-col", `${right}px`);
}

function saveColumnWidths() {
  try {
    localStorage.setItem(widthStorageKey, JSON.stringify(getColumnWidths()));
  } catch {
    // Width persistence is a convenience; dragging should still work without storage.
  }
}

function loadSavedColumnWidths() {
  if (!workspace || window.matchMedia("(max-width: 1120px)").matches) {
    return;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(widthStorageKey));

    if (
      Number.isFinite(saved?.left) &&
      Number.isFinite(saved?.middle) &&
      Number.isFinite(saved?.right)
    ) {
      setColumnWidths(saved.left, saved.middle, saved.right);
    }
  } catch {
    localStorage.removeItem(widthStorageKey);
  }
}

function getColumnWidths() {
  const columns = getComputedStyle(workspace).gridTemplateColumns
    .split(" ")
    .map((value) => Number.parseFloat(value))
    .filter(Number.isFinite);

  return {
    left: columns[0],
    middle: columns[2],
    right: columns[4],
  };
}

function resizeColumns(resizerType, deltaX, startWidths) {
  const minLeft = 260;
  const minMiddle = 240;
  const minRight = 260;
  let { left, middle, right } = startWidths;

  if (resizerType === "left") {
    const minDelta = minLeft - left;
    const maxDelta = middle - minMiddle;
    const usedDelta = Math.min(Math.max(deltaX, minDelta), maxDelta);
    left += usedDelta;
    middle -= usedDelta;
  } else {
    const minDelta = minMiddle - middle;
    const maxDelta = right - minRight;
    const usedDelta = Math.min(Math.max(deltaX, minDelta), maxDelta);
    middle += usedDelta;
    right -= usedDelta;
  }

  setColumnWidths(left, middle, right);
}

function startColumnResize(event) {
  if (!workspace || window.matchMedia("(max-width: 1120px)").matches) {
    return;
  }

  event.preventDefault();

  const resizer = event.currentTarget;
  const pointerId = event.pointerId;
  const resizerType = resizer.dataset.resizer;
  const startX = event.clientX;
  const startWidths = getColumnWidths();
  let isActive = true;

  workspace.classList.add("is-resizing");

  if (resizer.setPointerCapture) {
    resizer.setPointerCapture(pointerId);
  }

  function handleMove(moveEvent) {
    if (!isActive) {
      return;
    }

    resizeColumns(resizerType, moveEvent.clientX - startX, startWidths);
  }

  function finishResize() {
    if (!isActive) {
      return;
    }

    isActive = false;
    workspace.classList.remove("is-resizing");

    if (resizer.hasPointerCapture?.(pointerId)) {
      resizer.releasePointerCapture(pointerId);
    }

    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", finishResize);
    window.removeEventListener("pointercancel", finishResize);
    resizer.removeEventListener("lostpointercapture", finishResize);
    saveColumnWidths();
  }

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", finishResize);
  window.addEventListener("pointercancel", finishResize);
  resizer.addEventListener("lostpointercapture", finishResize);
}

function updateFromInspector(fields) {
  if (!selectedItemId) {
    return;
  }

  const currentItem = items.find((item) => item.id === selectedItemId);

  if (!currentItem) {
    return;
  }

  const nextFields = { ...fields };

  if (fields.status === "done" || fields.category === "done") {
    const completedAt = currentItem.completedAt || new Date().toISOString();
    nextFields.status = "done";
    nextFields.category = "done";
    nextFields.reviewAt = "";
    nextFields.completedAt = completedAt;
  } else if (currentItem.status === "done" && fields.status && fields.status !== "done") {
    nextFields.completedAt = "";
    nextFields.category =
      fields.category && fields.category !== "done"
        ? fields.category
        : inferCategory(currentItem.rawInput, currentItem.assignee);
  }

  updateSelectedItem(nextFields, { keepInspector: true });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();

  if (!text) {
    input.focus();
    return;
  }

  addItem(text);
  input.value = "";
  input.focus();
});

inspectorForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

inspectorStatusSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-status]");

  if (button) {
    setInspectorStatus(button.dataset.status);
    if (button.dataset.status === "done") {
      setInspectorCategory("done");
    }
    updateFromInspector({ status: button.dataset.status });
  }
});

inspectorPrioritySwitch.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-priority]");

  if (button) {
    setInspectorPriority(button.dataset.priority);
    updateFromInspector({ priority: button.dataset.priority });
  }
});

inspectorEffortSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-effort]");

  if (button) {
    setInspectorEffort(button.dataset.effort);
    updateFromInspector({ effort: button.dataset.effort });
  }
});

inspectorCategorySwitch.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");

  if (button) {
    setInspectorCategory(button.dataset.category);
    if (button.dataset.category === "done") {
      setInspectorStatus("done");
    }
    updateFromInspector({ category: button.dataset.category });
  }
});

inspectorRawInput.addEventListener("input", () => {
  updateFromInspector({ rawInput: inspectorRawInput.value });
});

inspectorReviewAt.addEventListener("change", () => {
  updateFromInspector({ reviewAt: inspectorReviewAt.value });
});

inspectorAssignee.addEventListener("input", () => {
  updateFromInspector({ assignee: inspectorAssignee.value });
});

inspectorNote.addEventListener("input", () => {
  updateFromInspector({ note: inspectorNote.value });
});

document.querySelectorAll("[data-review-days], [data-review-clear]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.reviewClear) {
      inspectorReviewAt.value = "";
      updateFromInspector({ reviewAt: "" });
      return;
    }

    inspectorReviewAt.value = dateAfter(Number(button.dataset.reviewDays));
    updateFromInspector({ reviewAt: inspectorReviewAt.value });
  });
});

voiceButton.addEventListener("click", () => {
  if (isListening) {
    stopVoiceListening();
    return;
  }

  startVoiceListening();
});

voiceListenButton.addEventListener("click", startVoiceListening);
voiceStopButton.addEventListener("click", stopVoiceListening);
voiceSplitButton.addEventListener("click", splitAndAddVoiceTranscript);
voiceClearButton.addEventListener("click", () => {
  voiceTranscript.value = "";
  finalTranscript = "";
  setVoiceStatus("待機中");
  updateVoicePreview();
});
voiceTranscript.addEventListener("input", updateVoicePreview);

resurfaceButton.addEventListener("click", () => {
  addItem("採用ページの方針、決めないまま再浮上", "now");
});

reportButton.addEventListener("click", () => {
  isReportVisible = !isReportVisible;
  renderCompletionReport();
});

queueFilter.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");

  if (!button) {
    return;
  }

  activeQueueFilter = button.dataset.filter;
  renderAll();
});

statButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeQueueFilter = activeQueueFilter === button.dataset.statFilter ? "all" : button.dataset.statFilter;
    renderAll();
  });
});

loadAdvice.addEventListener("click", toggleAdviceFilter);

closeInspectorButton.addEventListener("click", () => {
  selectedItemId = null;
  renderAll();
});

deleteItemButton.addEventListener("click", deleteSelectedItem);
saveButton.addEventListener("click", saveToExternalFile);
loadButton.addEventListener("click", openExternalFile);

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;

  if (file) {
    readExternalFile(file);
  }

  fileInput.value = "";
});

columnResizers.forEach((resizer) => {
  resizer.addEventListener("pointerdown", startColumnResize);
});

voiceStopButton.disabled = true;
updateVoicePreview();
loadSavedColumnWidths();
renderAll();
