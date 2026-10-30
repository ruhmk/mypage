// Flow Fragments app.js（2026-10-19 整理版／2026-10-28 データ保護の修正／2026-10-30 親子・表操作の修正、複数タブ・保存状態の表示、差分描画、細部の不整合）
// 構成：状態と保存（load / sanitizeState / persist / 履歴）→ 描画（render / renderWorld / renderEdges / renderInspector。カード・領域・線は patchChildren で差分更新）
//      → 操作（trackPointer を土台にしたドラッグ・リサイズ・接続・パン）→ 時系列表 → 書き出し（PNG / AI用ZIP）→ ファイル入出力 → 初期化
(() => {
  "use strict";
  // 保存キー。KEY／UI_KEY の形式は従来どおり。RECOVERY_KEY は壊れていた保存データの退避先（読込時に書き、アプリからは読まない）。
  // BACKUP_KEY は「新規ファイル」直前の内容の退避先（アプリからは読まない）。FILE_KEY は最後にJSONファイルへ保存・読込した内容の指紋。
  const KEY = "flow-fragments-state-v1",
    UI_KEY = "flow-fragments-ui-v1",
    RECOVERY_KEY = "flow-fragments-state-v1-recovery",
    BACKUP_KEY = "flow-fragments-state-v1-before-new",
    FILE_KEY = "flow-fragments-file-v1",
    FILE_DB = "flow-fragments-recent-files",
    FILE_STORE = "files",
    COLORS = ["#66e7f5", "#ff7da8", "#ffd36b", "#88efbd", "#b196ff"],
    HISTORY_LIMIT = 60,
    SAVE_DELAY = 180;
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)],
    uid = p => `${p}_${crypto.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2)}`;
  // 入力検証用
  const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/,
    HEX_COLOR = /^#[0-9a-f]{6}$/i,
    MONTH = /^\d{4}-(0[1-9]|1[0-2])$/,
    EDGE_KINDS = ["normal", "loopTop", "loopBottom", "self"];
  const num = (v, fallback) => {
      const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
      return Number.isFinite(n) ? n : fallback
    },
    str = (v, fallback = "") => typeof v === "string" ? v : v == null ? fallback : String(v),
    colorOr = (v, fallback) => HEX_COLOR.test(String(v ?? "")) ? String(v) : fallback,
    currentMonth = () => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`
    };
  const app = {
    state: null,
    activeFlowId: "",
    selected: null,
    multiSelected: new Set(),
    multiGroups: new Set(),
    filterTag: "",
    view: {
      x: 90,
      y: 110,
      zoom: 1
    },
    history: {
      undo: [],
      redo: []
    },
    activeDrag: null,
    edgeDraft: null,
    edgeFrame: 0,
    edgeDirty: null,
    edgeNodes: new Map(),
    worldCache: {
      cards: new Map(),
      groups: new Map()
    },
    timelineHtml: "",
    panFrame: 0,
    hoverFrame: 0,
    hoverEvent: null,
    timelineFrame: 0,
    suppressContextMenuUntil: 0,
    saveTimer: 0,
    clipboard: null,
    recentFiles: [],
    currentFileId: "",
    currentFileHandle: null,
    fileTransitionBusy: false,
    recovery: null,
    persistBlocked: "",
    saveFailed: false,
    ui: {
      sidebarCollapsed: false,
      inspectorCollapsed: false
    }
  };

  function emptyFlow(name = "新しいフロー") {
    const now = new Date();
    return {
      id: uid("flow"),
      name,
      cards: [],
      edges: [],
      groups: [],
      timeline: {
        enabled: false,
        x: 0,
        y: 0,
        startMonth: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`,
        monthCount: 4,
        colLabels: ["", "", "", ""],
        rows: ["項目1", "項目2", "項目3"],
        rowColors: [COLORS[0], COLORS[1], COLORS[2]],
        colWidths: [300, 300, 300, 300],
        rowHeights: [150, 150, 150]
      },
      createdAt: new Date().toISOString()
    }
  }

  function defaultState() {
    const f = emptyFlow("サンプルフロー"),
      a = "sample_start",
      b = "sample_plan",
      c = "sample_done";
    f.timeline.enabled = true;
    f.timeline.monthCount = 3;
    f.timeline.rows = ["企画", "制作", "確認"];
    f.timeline.colWidths = [300, 300, 300];
    f.timeline.rowHeights = [150, 150, 150];
    f.cards = [{
      id: a,
      title: "目的を決める",
      body: "このカードを動かして使い始めます。",
      tags: ["サンプル"],
      collapsed: false,
      w: 250,
      h: 100,
      x: 200,
      y: 100,
      groupId: ""
    }, {
      id: b,
      title: "計画を作る",
      body: "右クリックドラッグで次のカードへ接続できます。",
      tags: ["サンプル"],
      collapsed: false,
      w: 300,
      h: 100,
      x: 500,
      y: 250,
      groupId: ""
    }, {
      id: c,
      title: "確認して完了",
      body: "カード右端と下端でサイズを変更できます。",
      tags: ["サンプル"],
      collapsed: false,
      w: 250,
      h: 100,
      x: 850,
      y: 400,
      groupId: ""
    }];
    f.edges = [{
      id: "sample_edge_1",
      from: a,
      to: b,
      label: "方針が決まったら",
      color: COLORS[0]
    }, {
      id: "sample_edge_2",
      from: b,
      to: c,
      label: "準備できたら",
      color: COLORS[0]
    }];
    return {
      version: 1,
      app: "Flow Fragments",
      activeFlowId: f.id,
      flows: [f]
    }
  }

  // ブラウザ内保存データの読込。壊れていた場合は元の文字列を RECOVERY_KEY に退避してからサンプルで開始する。
  // 退避できなかったときは元データを KEY に残すため、自動保存を止める（persistBlocked）。
  function load() {
    let raw = null,
      next = null;
    try {
      raw = localStorage.getItem(KEY)
    } catch {}
    if (raw != null) {
      try {
        next = sanitizeState(JSON.parse(raw))
      } catch {
        next = null
      }
      if (!next) {
        let saved = false;
        try {
          localStorage.setItem(RECOVERY_KEY, raw);
          saved = localStorage.getItem(RECOVERY_KEY) === raw
        } catch {}
        app.recovery = {
          saved,
          raw
        };
        app.persistBlocked = saved ? "" : "recovery"
      }
    }
    app.state = next || defaultState();
    app.activeFlowId = app.state.activeFlowId
  }

  // 読み込んだデータを検証・正規化して返す。使えない場合は null（呼び出し側は現在の状態を維持する）。
  // 既存JSON／ブラウザ保存データの形式はそのまま受け入れ、欠落・不正な値だけを既定値に寄せる。
  function sanitizeState(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.flows)) return null;
    const flows = data.flows.filter(f => f && typeof f === "object");
    if (!flows.length) return null;
    const state = {
      ...data,
      version: num(data.version, 1),
      app: "Flow Fragments",
      flows
    };
    const flowIds = new Set();
    flows.forEach(f => {
      if (!(typeof f.id === "string" && SAFE_ID.test(f.id)) || flowIds.has(f.id)) f.id = uid("flow");
      flowIds.add(f.id);
      f.name = str(f.name, "名称未設定") || "名称未設定";
      f.createdAt = str(f.createdAt, new Date().toISOString());
      f.cards = Array.isArray(f.cards) ? f.cards.filter(c => c && typeof c === "object") : [];
      f.edges = Array.isArray(f.edges) ? f.edges.filter(e => e && typeof e === "object") : [];
      f.groups = Array.isArray(f.groups) ? f.groups.filter(g => g && typeof g === "object") : [];
      const groupMap = fixIds(f.groups, "group"),
        cardMap = fixIds(f.cards, "card");
      fixIds(f.edges, "edge");
      const t = f.timeline = f.timeline && typeof f.timeline === "object" ? f.timeline : {};
      t.enabled = !!t.enabled;
      t.x = grid25(num(t.x, 0));
      t.y = grid25(num(t.y, 0));
      t.startMonth = MONTH.test(String(t.startMonth ?? "")) ? String(t.startMonth) : currentMonth();
      t.monthCount = Math.max(1, Math.min(24, Math.round(num(t.monthCount, 4))));
      t.colLabels = Array.from({
        length: t.monthCount
      }, (_, i) => str(Array.isArray(t.colLabels) ? t.colLabels[i] : ""));
      t.rows = Array.isArray(t.rows) && t.rows.length ? t.rows.map(r => str(r)) : ["項目1"];
      t.rowColors = Array.from({
        length: t.rows.length
      }, (_, i) => colorOr(Array.isArray(t.rowColors) ? t.rowColors[i] : null, COLORS[i % COLORS.length]));
      t.colWidths = Array.from({
        length: t.monthCount
      }, (_, i) => Math.max(175, grid25(num(Array.isArray(t.colWidths) ? t.colWidths[i] : null, 300))));
      t.rowHeights = Array.from({
        length: t.rows.length
      }, (_, i) => Math.max(100, grid25(num(Array.isArray(t.rowHeights) ? t.rowHeights[i] : null, 150))));
      if (t.labelWidth != null) t.labelWidth = Math.max(125, grid25(num(t.labelWidth, 175)));
      f.groups.forEach((g, i) => {
        g.name = str(g.name, "領域");
        g.color = colorOr(g.color, COLORS[i % COLORS.length]);
        g.locked = !!g.locked;
        g.x = grid25(num(g.x, 0));
        g.y = grid25(num(g.y, 0));
        g.w = Math.max(200, grid25(num(g.w, 400)));
        g.h = Math.max(125, grid25(num(g.h, 250)))
      });
      const groupIds = new Set(f.groups.map(g => g.id));
      f.cards.forEach(c => {
        c.title = str(c.title, "カード");
        c.body = str(c.body, "");
        c.tags = Array.isArray(c.tags) ? c.tags.map(x => str(x)).filter(Boolean) : [];
        c.collapsed = !!c.collapsed;
        c.x = grid25(num(c.x, 0));
        c.y = grid25(num(c.y, 0));
        c.w = Math.max(150, grid25(num(c.w, 250)));
        const rowSpan = num(c.rowSpan, 1);
        c.h = Math.max(75, grid25(num(c.h, rowSpan > 1 ? rowSpan * 150 : 100)));
        const gid = groupMap.get(c.groupId) ?? str(c.groupId, "");
        c.groupId = groupIds.has(gid) ? gid : ""
      });
      f.edges.forEach(e => {
        e.from = cardMap.get(e.from) ?? str(e.from, "");
        e.to = cardMap.get(e.to) ?? str(e.to, "");
        e.label = str(e.label, "");
        e.color = colorOr(e.color, COLORS[0]);
        if (e.kind != null && !EDGE_KINDS.includes(e.kind)) e.kind = "normal";
        if (e.arcHeight != null) e.arcHeight = Math.max(75, grid25(num(e.arcHeight, 100)))
      })
    });
    state.activeFlowId = flows.some(f => f.id === data.activeFlowId) ? data.activeFlowId : flows[0].id;
    return state
  }

  // id が無い／不正／重複している要素に新しい id を振る。一意だった不正 id は参照の付け替え用に Map で返す（重複は先頭が従来どおり有効）。
  function fixIds(list, prefix) {
    const count = new Map(),
      used = new Set(),
      remap = new Map();
    list.forEach(item => count.set(item.id, (count.get(item.id) || 0) + 1));
    list.forEach(item => {
      const old = item.id,
        valid = typeof old === "string" && SAFE_ID.test(old);
      if (!valid || used.has(old)) {
        item.id = uid(prefix);
        if (!valid && count.get(old) === 1 && typeof old === "string") remap.set(old, item.id)
      }
      used.add(item.id)
    });
    return remap
  }
  // 表示フローの切替。進行中の操作を終了し、選択・複数選択・タグ絞り込み・ビューをリセットする（全経路共通）。
  function switchFlow(id, {
    resetView = true
  } = {}) {
    app.activeDrag?.finish();
    app.activeFlowId = id;
    app.state.activeFlowId = id;
    app.selected = null;
    app.multiSelected.clear();
    app.multiGroups.clear();
    app.filterTag = "";
    if (resetView) app.view = {
      x: 90,
      y: 110,
      zoom: 1
    }
  }
  const flow = () => app.state.flows.find(f => f.id === app.activeFlowId),
    card = id => flow().cards.find(c => c.id === id),
    group = id => flow().groups.find(g => g.id === id),
    edge = id => flow().edges.find(e => e.id === id);

  function snapshot() {
    return JSON.stringify(app.state)
  }

  // 履歴の各項目は { snap: 状態のJSON, file: その時点の保存先 }。Undo/Redo で保存先も一緒に戻し、
  // ファイルを開く前の内容を開いた後のファイルへ上書きしないようにする。
  function fileContext() {
    return {
      id: app.currentFileId,
      handle: app.currentFileHandle
    }
  }

  // Undo 履歴はすべてここを通す（上限・Redo破棄・ボタン状態を一元化）
  function pushHistory(snap = snapshot()) {
    app.history.undo.push({
      snap,
      file: fileContext()
    });
    if (app.history.undo.length > HISTORY_LIMIT) app.history.undo.shift();
    app.history.redo = [];
    updateHistory()
  }

  // 変更後に呼ぶ版：変更前スナップショットと現在が同じなら履歴に積まない（無変更のリサイズ等）
  function commitHistory(before) {
    if (before !== snapshot()) pushHistory(before)
  }

  function history() {
    pushHistory()
  }

  function restore(entry) {
    app.activeDrag?.finish();
    app.state = JSON.parse(entry.snap);
    app.activeFlowId = app.state.activeFlowId;
    app.currentFileId = entry.file.id;
    app.currentFileHandle = entry.file.handle;
    app.selected = null;
    app.multiSelected.clear();
    app.multiGroups.clear();
    renderRecentFiles();
    render();
    persist()
  }

  // 進行中の操作は履歴を取り出す前に終わらせる（終了処理が積む履歴で Redo が消えないように）
  function undo() {
    app.activeDrag?.finish();
    const s = app.history.undo.pop();
    if (!s) return;
    app.history.redo.push({
      snap: snapshot(),
      file: fileContext()
    });
    restore(s);
    updateHistory()
  }

  function redo() {
    app.activeDrag?.finish();
    const s = app.history.redo.pop();
    if (!s) return;
    app.history.undo.push({
      snap: snapshot(),
      file: fileContext()
    });
    restore(s);
    updateHistory()
  }

  function updateHistory() {
    $("#undo").disabled = !app.history.undo.length;
    $("#redo").disabled = !app.history.redo.length
  }

  // 自動保存を止めている理由ごとの表示（persistBlocked の値）
  const BLOCKED_STATUS = {
    recovery: "ブラウザ内保存を停止中（読めなかった元データを保護しています）",
    otherTab: "ブラウザ内保存を停止中（別のタブで更新されました）"
  };

  function saveNow() {
    app.saveTimer = 0;
    const json = JSON.stringify(app.state);
    updateFileStatus();
    if (app.persistBlocked) {
      $("#save-status").textContent = BLOCKED_STATUS[app.persistBlocked];
      // 別のタブとの食い違いは、選んでもらうまで編集のたびに案内し直す
      if (app.persistBlocked === "otherTab" && !$("#other-tab-dialog")) showOtherTabDialog();
      return
    }
    try {
      localStorage.setItem(KEY, json);
      $("#save-status").textContent = "ブラウザ内に保存済み";
      app.saveFailed = false
    } catch {
      $("#save-status").textContent = "ブラウザ内保存に失敗（JSON保存してください）";
      // 左カラムを閉じていると表示が見えないので、失敗し始めたときだけトーストでも知らせる
      if (!app.saveFailed) toast("ブラウザ内への自動保存に失敗しました。JSONファイルに保存してください");
      app.saveFailed = true
    }
  }

  // 内容の短い指紋（FNV-1a）。JSONファイルに保存した内容と今の内容が同じかの判定に使う。
  // 表示中のフロー（activeFlowId）の切替は編集ではないので、フローの中身だけで作る。
  function fingerprint(state = app.state) {
    const s = JSON.stringify(state.flows);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193)
    }
    return `${(h>>>0).toString(36)}:${s.length}`
  }

  // 「保存」ボタンの印：最後にJSONファイルへ保存（または読込）した内容と今の内容が違えば、未保存の印を付ける。
  // 記録は FILE_KEY に置くので、再訪後や別のタブでも同じ判定になる。
  function updateFileStatus() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(FILE_KEY))
    } catch {}
    const clean = !!saved && saved.hash === fingerprint(),
      button = $("#export-json");
    button.classList.toggle("dirty", !clean);
    button.title = clean ? `JSONファイルに保存済み${saved.name?`（${saved.name}）`:""}` : "JSONファイルに保存していない変更があります"
  }

  function markFileSaved(name, hash = fingerprint()) {
    try {
      localStorage.setItem(FILE_KEY, JSON.stringify({
        hash,
        name,
        savedAt: new Date().toISOString()
      }))
    } catch {}
    updateFileStatus()
  }

  // ブラウザ内への自動保存（SAVE_DELAY ms の遅延書き込み）。タブを閉じる・隠す時は flushPersist で即時書き込み。
  function persist(immediate = false) {
    clearTimeout(app.saveTimer);
    app.saveTimer = 0;
    $("#save-status").textContent = "ブラウザ内に保存中…";
    if (immediate) saveNow();
    else app.saveTimer = setTimeout(saveNow, SAVE_DELAY)
  }

  // タブを閉じる・隠す時：進行中のドラッグ等を先に終わらせ、その結果も含めて即時に書き込む
  function flushPersist() {
    app.activeDrag?.finish();
    if (!app.saveTimer) return;
    clearTimeout(app.saveTimer);
    saveNow()
  }

  function mutate(fn, options) {
    const before = snapshot();
    fn();
    commitHistory(before);
    persist();
    render(options)
  }

  // inspector:false はインスペクター自身の文字入力から呼ぶ。入力欄を作り直さないので、Tab やクリックで次の欄へ移るフォーカスが失われない。
  function render({
    inspector = true
  } = {}) {
    renderSidebar();
    renderWorld();
    if (inspector) renderInspector();
    $("#flow-title").value = flow().name;
    $("#view-caption").textContent = flow().timeline.enabled ? "時系列キャンバス" : "自由配置キャンバス";
    $("#timeline-toggle").classList.toggle("active", flow().timeline.enabled);
    updateTransform();
    updateHistory()
  }

  function renderSidebar() {
    const fs = app.state.flows;
    $("#flow-count").textContent = fs.length;
    $("#flow-list").innerHTML = fs.map(f => `<button class="nav-item ${f.id===app.activeFlowId?"active":""}" data-flow="${f.id}"><span>${esc(f.name)}</span><small>${f.cards.length}</small></button>`).join("");
    $$('[data-flow]').forEach(b => b.onclick = () => {
      if (b.dataset.flow === app.activeFlowId) return;
      switchFlow(b.dataset.flow);
      persist();
      render()
    });
    const tags = [...new Set(flow().cards.flatMap(c => c.tags))].sort();
    if (app.filterTag && !tags.includes(app.filterTag)) app.filterTag = "";
    const select = $("#tag-select");
    select.innerHTML = '<option value="">タグを選択</option>' + tags.map(t => `<option value="${attr(t)}">#${esc(t)}（${flow().cards.filter(c=>c.tags.includes(t)).length}）</option>`).join("");
    select.value = app.filterTag;
    select.onchange = () => {
      app.filterTag = select.value;
      render()
    };
    const cards = app.filterTag ? flow().cards.filter(c => c.tags.includes(app.filterTag)) : [];
    $("#card-count").textContent = app.filterTag ? `${cards.length}件` : "";
    $("#card-index").innerHTML = !app.filterTag ? '<span class="hint">タグを選ぶとカードを表示します</span>' : cards.length ? cards.map(c => `<button class="index-item" data-jump="${c.id}">${esc(c.title)}</button>`).join("") : '<span class="hint">該当するカードはありません</span>';
    $$('[data-jump]').forEach(b => b.onclick = () => jumpToCard(b.dataset.jump))
  }

  // metrics（timelineMetrics の結果）を渡すと表の寸法を計算し直さない（描画で全カードを回すとき用）
  function timelineRowIndexForCard(c, metrics = null) {
    const t = flow().timeline;
    if (!t.enabled) return -1;
    const m = metrics || timelineMetrics(),
      center = c.y + cardHeight(c) / 2;
    return t.rows.findIndex((_, i) => center >= t.y + m.rowY[i] && center < t.y + m.rowY[i + 1])
  }

  function timelineRowColorForCard(c, metrics = null) {
    const index = timelineRowIndexForCard(c, metrics);
    return index >= 0 ? flow().timeline.rowColors[index] : null
  }

  function cardVisualColor(c, metrics = null) {
    return group(c.groupId)?.color || timelineRowColorForCard(c, metrics) || COLORS[0]
  }

  function nextTimelineRowColor(colors, index) {
    return COLORS.find(color => !colors.includes(color)) || COLORS[index % COLORS.length]
  }

  function groupLockButton(g) {
    const label = g.locked ? "グループのロックを解除" : "グループをロック";
    return `<button type="button" class="group-lock-toggle" title="${label}" aria-label="${label}" aria-pressed="${!!g.locked}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="${g.locked?"M8 10V7a4 4 0 0 1 8 0v3":"M8 10V7a4 4 0 0 1 8 0"}"/><path d="M12 14v3"/></svg></button>`
  }

  function toggleGroupLock(id) {
    const g = group(id);
    if (g) mutate(() => g.locked = !g.locked)
  }

  function updateGroupHover(e) {
    const p = screenWorld(e.clientX, e.clientY),
      groups = flow().groups;
    let hit;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h) {
        hit = g;
        break
      }
    }
    const active = $(".group-box.group-hovered");
    if (active?.dataset.group === hit?.id) return;
    active?.classList.remove("group-hovered");
    if (hit) $(`[data-group="${hit.id}"]`)?.classList.add("group-hovered")
  }

  // 子要素を id ごとの HTML で差分更新する。HTML が前回と同じ要素は作り直さずに残し（イベントの割り当ても残る）、
  // 変わった・増えた要素だけを作る。cache は id → { el, html }。after は先頭の要素の直前に置かれた固定の要素。
  // 戻り値の created は新しく作った要素（イベントを割り当てる対象）。
  function patchChildren(parent, items, cache, {
    svg = false,
    after = null
  } = {}) {
    const ids = new Set(items.map(x => x.id));
    cache.forEach((entry, id) => {
      if (!ids.has(id)) cache.delete(id)
    });
    const changed = items.filter(x => cache.get(x.id)?.html !== x.html),
      holder = svg ? document.createElementNS("http://www.w3.org/2000/svg", "svg") : document.createElement("template");
    holder.innerHTML = changed.map(x => x.html).join("");
    const fresh = [...(svg ? holder.children : holder.content.children)];
    changed.forEach((x, i) => cache.set(x.id, {
      el: fresh[i],
      html: x.html
    }));
    // 全部が新しいとき（初回表示・フロー切替）は、要素を1つずつ入れ替えずにまとめて置き換える
    if (changed.length === items.length) {
      parent.replaceChildren(...(after ? [after] : []), ...fresh);
      return {
        created: changed.map((x, i) => ({
          id: x.id,
          el: fresh[i]
        }))
      }
    }
    // 今の要素以外（消えた要素・作り直す前の要素）を取り除いてから、並び順を合わせる
    const live = new Set(items.map(x => cache.get(x.id).el));
    [...parent.children].forEach(el => {
      if (el !== after && !live.has(el) && !el.classList.contains("draft-edge")) el.remove()
    });
    let prev = after;
    items.forEach(x => {
      const el = cache.get(x.id).el,
        next = prev ? prev.nextSibling : parent.firstChild;
      if (el !== next) parent.insertBefore(el, next);
      prev = el
    });
    return {
      created: changed.map(x => ({
        id: x.id,
        el: cache.get(x.id).el
      }))
    }
  }

  // ワールドの描画。カード・領域・線は要素ごとに前回の HTML と比べ、変わったものだけ作り直す。
  // 選択・タグ絞り込みの表示は HTML に含めず、最後に applyWorldClasses で今の状態に合わせる。
  function renderWorld() {
    const f = flow(),
      metrics = f.timeline.enabled ? timelineMetrics() : null;
    renderTimeline();
    const groups = patchChildren($("#group-layer"), f.groups.map(g => ({
      id: g.id,
      html: `<div class="group-box ${g.locked?"locked":""}" data-group="${g.id}" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px;--group-color:${g.color}"><div class="group-label">${esc(g.name)}</div>${groupLockButton(g)}<span class="group-resize" title="ドラッグしてサイズ変更"></span></div>`
    })), app.worldCache.groups);
    const cards = patchChildren($("#card-layer"), f.cards.map(c => {
      const parent = group(c.groupId),
        color = cardVisualColor(c, metrics),
        locked = parent?.locked;
      return {
        id: c.id,
        html: `<article class="flow-card ${locked?"locked":""} ${c.collapsed?"collapsed":""}" data-card="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${cardWidth(c)}px;height:${cardHeight(c)}px;--card-color:${color}"><button class="card-toggle" title="メモを開閉">${c.collapsed?"＋":"−"}</button><div class="card-title">${esc(c.title)}</div><div class="card-body">${esc(c.body)}</div>${c.tags.length?`<div class="card-tags">${c.tags.map(t=>`<span class="mini-tag">#${esc(t)}</span>`).join("")}</div>`:""}<span class="port" title="右クリックドラッグで接続"></span><span class="card-resize" title="ドラッグして高さ変更"></span><span class="card-resize-x" title="ドラッグして期間・横幅を変更"></span></article>`
      }
    }), app.worldCache.cards);
    renderEdges();
    groups.created.forEach(x => bindGroup(x.el));
    cards.created.forEach(x => bindCard(x.el));
    applyWorldClasses()
  }

  // 選択・タグ絞り込みの表示を付け替える（差分描画で残した要素も、描画のたびに今の状態へ合わせる）
  function applyWorldClasses() {
    const cardsById = new Map(flow().cards.map(c => [c.id, c]));
    app.worldCache.cards.forEach((x, id) => {
      x.el.classList.toggle("selected", !!sel("card", id));
      x.el.classList.toggle("dim", !filtered(cardsById.get(id)))
    });
    app.worldCache.groups.forEach((x, id) => x.el.classList.toggle("selected", !!sel("group", id)));
    app.edgeNodes.forEach((x, id) => x.el.classList.toggle("selected", !!sel("edge", id)))
  }

  function renderEdges() {
    const svg = $("#edge-layer"),
      cardsById = new Map(flow().cards.map(c => [c.id, c]));
    if (!$("defs", svg)) {
      const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      holder.innerHTML = `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/></marker></defs>`;
      svg.prepend(holder.firstElementChild)
    }
    const items = flow().edges.map(e => {
      const a = cardsById.get(e.from),
        b = cardsById.get(e.to);
      if (!a || !b) return null;
      const g = edgeGeometry(e, a, b),
        label = e.label || "";
      return {
        id: e.id,
        html: `<g class="edge ${e.kind||"normal"}" data-edge="${e.id}" style="--edge-color:${e.color||COLORS[0]}"><path class="edge-hit" d="${g.d}"/><path class="edge-main" d="${g.d}" marker-end="url(#arrow)"/>${label?edgeLabel(g,label):""}</g>`
      }
    }).filter(Boolean);
    // app.edgeNodes は線の差分描画の記録を兼ね、要素参照を持っておく（ドラッグ中の再配置で DOM 検索をしない）
    patchChildren(svg, items, app.edgeNodes, {
      svg: true,
      after: $("defs", svg)
    }).created.forEach(({
      id,
      el
    }) => {
      const label = $(".edge-label", el),
        rect = label && $("rect", label);
      Object.assign(app.edgeNodes.get(id), {
        paths: $$(".edge-hit,.edge-main", el),
        label,
        w: rect ? Number(rect.getAttribute("width")) || 52 : 0
      });
      el.onpointerdown = e => {
        e.stopPropagation();
        app.multiSelected.clear();
        app.multiGroups.clear();
        app.selected = {
          type: "edge",
          id
        };
        updateSelectionView()
      }
    })
  }

  function updateEdgePositions(ids = null) {
    flow().edges.forEach(e => {
      if (ids && !ids.has(e.from) && !ids.has(e.to)) return;
      const n = app.edgeNodes.get(e.id),
        a = card(e.from),
        b = card(e.to);
      if (!n || !a || !b) return;
      const g = edgeGeometry(e, a, b);
      n.paths.forEach(p => p.setAttribute("d", g.d));
      if (n.label) n.label.setAttribute("transform", `translate(${g.lx-n.w/2} ${g.ly-14})`)
    })
  }

  // 選択状態だけが変わったときは DOM を作り直さず、selected クラスの付け替えとインスペクター更新だけ行う
  function updateSelectionView() {
    $$("#world .selected").forEach(n => {
      const id = n.dataset.card ?? n.dataset.group ?? n.dataset.edge,
        type = n.dataset.card != null ? "card" : n.dataset.group != null ? "group" : "edge";
      if (!sel(type, id)) n.classList.remove("selected")
    });
    app.multiSelected.forEach(id => $(`[data-card="${id}"]`)?.classList.add("selected"));
    app.multiGroups.forEach(id => $(`[data-group="${id}"]`)?.classList.add("selected"));
    if (app.selected) {
      const {
        type,
        id
      } = app.selected;
      $(`[data-${type}="${id}"]`)?.classList.add("selected")
    }
    renderInspector()
  }

  // 線の再配置を次フレームにまとめる。ids（カードid の Set）を渡すとそのカードに接する線だけ更新する。
  function scheduleEdges(ids = null) {
    if (app.edgeDirty !== "all") app.edgeDirty = ids && app.edgeDirty ? new Set([...app.edgeDirty, ...ids]) : ids || "all";
    if (app.edgeFrame) return;
    app.edgeFrame = requestAnimationFrame(() => {
      app.edgeFrame = 0;
      const dirty = app.edgeDirty;
      app.edgeDirty = null;
      updateEdgePositions(dirty === "all" ? null : dirty)
    })
  }

  // 軸リサイズ中の表の再構築を次フレームにまとめる
  function scheduleTimelineRender() {
    if (app.timelineFrame) return;
    app.timelineFrame = requestAnimationFrame(() => {
      app.timelineFrame = 0;
      renderTimeline()
    })
  }

  // 線のラベルの幅と表示する文字（画面と PNG で同じにする）
  function edgeLabelBox(text) {
    return {
      w: Math.min(220, Math.max(52, text.length * 11 + 18)),
      shown: text.length > 18 ? text.slice(0, 18) + "…" : text
    }
  }

  function edgeLabel(g, text) {
    const x = g.lx,
      y = g.ly,
      {
        w,
        shown
      } = edgeLabelBox(text);
    return `<g class="edge-label" transform="translate(${x-w/2} ${y-14})"><rect width="${w}" height="28" rx="8"/><text x="${w/2}" y="18" text-anchor="middle">${esc(shown)}</text></g>`
  }

  function cardWidth(c) {
    return Math.max(150, Number(c.w) || 250)
  }

  function cardHeight(c) {
    return c.collapsed ? 75 : Math.max(75, Number(c.h) || 100)
  }

  function pathPoints(a, b) {
    const ah = cardHeight(a),
      bh = cardHeight(b);
    return {
      x1: a.x + cardWidth(a),
      y1: a.y + ah / 2,
      x2: b.x,
      y2: b.y + bh / 2
    }
  }

  function curve(p) {
    const dx = Math.max(70, Math.abs(p.x2 - p.x1) * .45);
    return `M ${p.x1} ${p.y1} C ${p.x1+dx} ${p.y1}, ${p.x2-dx} ${p.y2}, ${p.x2} ${p.y2}`
  }

  function edgeGeometry(e, a, b) {
    const kind = e.kind || "normal",
      aw = cardWidth(a),
      ah = cardHeight(a),
      bw = cardWidth(b),
      bh = cardHeight(b);
    if (kind === "self") {
      const x1 = a.x + aw,
        y1 = a.y + ah / 2,
        x2 = a.x + aw - 24,
        y2 = a.y,
        rx = Math.max(75, Number(e.arcHeight) || 100),
        top = a.y - rx,
        cx = x1 + rx;
      return {
        d: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${top}, ${x2} ${y2}`,
        lx: (x1 + 6 * cx + x2) / 8,
        ly: (4 * y1 + 3 * top + y2) / 8
      }
    }
    if (kind === "loopTop") {
      const x1 = a.x + aw,
        y1 = a.y + ah / 2,
        x2 = b.x + bw / 2,
        y2 = b.y,
        arc = Math.max(100, Number(e.arcHeight) || 150),
        top = Math.min(a.y, b.y) - arc;
      return {
        d: `M ${x1} ${y1} C ${x1+70} ${top}, ${x2-70} ${top}, ${x2} ${y2}`,
        lx: (x1 + x2) / 2,
        ly: (y1 + 6 * top + y2) / 8
      }
    }
    if (kind === "loopBottom") {
      const x1 = a.x + aw,
        y1 = a.y + ah / 2,
        x2 = b.x + bw / 2,
        y2 = b.y + bh,
        arc = Math.max(75, Number(e.arcHeight) || 100),
        bottom = Math.max(a.y + ah, b.y + bh) + arc;
      return {
        d: `M ${x1} ${y1} C ${x1+55} ${bottom}, ${x2-55} ${bottom}, ${x2} ${y2}`,
        lx: (x1 + x2) / 2,
        ly: (y1 + 6 * bottom + y2) / 8
      }
    }
    const p = pathPoints(a, b);
    return {
      d: curve(p),
      lx: (p.x1 + p.x2) / 2,
      ly: (p.y1 + p.y2) / 2
    }
  }

  // カード・領域の要素にイベントを割り当てる（新しく作った要素だけに呼ぶ。処理はすべて data-* の id から今の状態を引く）
  function bindCard(n) {
    n.oncontextmenu = e => e.preventDefault();
    n.onpointerdown = e => {
      if (e.button === 2) {
        startEdge(e, n.dataset.card);
        return
      }
      if (e.target.closest("button,.port,.card-resize,.card-resize-x")) return;
      e.stopPropagation();
      selectAndDrag(e, "card", n.dataset.card, n)
    };
    n.ondblclick = e => {
      if (!e.target.closest(".port,.card-resize,.card-resize-x")) {
        const c = card(n.dataset.card);
        mutate(() => c.collapsed = !c.collapsed)
      }
    };
    $(".card-toggle", n).onclick = e => {
      e.stopPropagation();
      const c = card(n.dataset.card);
      mutate(() => c.collapsed = !c.collapsed)
    };
    $(".card-resize", n).onpointerdown = e => resizeCard(e, n.dataset.card);
    $(".card-resize-x", n).onpointerdown = e => resizeCardWidth(e, n.dataset.card)
  }

  function bindGroup(n) {
    n.onpointerdown = e => {
      if (e.target.closest(".group-resize,.group-lock-toggle")) return;
      e.stopPropagation();
      if (group(n.dataset.group)?.locked) return selectLockedGroupAndPan(e, n.dataset.group);
      selectAndDrag(e, "group", n.dataset.group, n)
    };
    const lock = $(".group-lock-toggle", n);
    lock.onpointerdown = e => e.stopPropagation();
    lock.onclick = e => {
      e.stopPropagation();
      const focused = document.activeElement === lock;
      toggleGroupLock(n.dataset.group);
      if (focused) $(`[data-group="${n.dataset.group}"] .group-lock-toggle`)?.focus({
        preventScroll: true
      })
    };
    $(".group-resize", n).onpointerdown = e => resizeGroup(e, n.dataset.group)
  }
  const grid25 = value => Math.round(Number(value) / 25) * 25;

  // ポインター操作（ドラッグ・リサイズ・パン・接続）の共通ライフサイクル。
  // pointerId 一致／ボタンが離れた pointermove／pointerup／pointercancel／blur／visibilitychange／lostpointercapture の
  // いずれでも必ず終了し、onEnd を一度だけ呼ぶ。capture を渡すとその要素に pointer capture を取る（画面外でも追従）。
  // 直前の操作が残っていれば先に終了させるので、迷子になったドラッグが次の操作を妨げない。
  function trackPointer(e, {
    onMove,
    onEnd,
    capture = null,
    buttonMask = 1
  }) {
    app.activeDrag?.finish();
    const id = e.pointerId;
    let done = false;
    const session = {
      id,
      finish: null
    };
    const finish = ev => {
      if (done || (ev?.pointerId != null && ev.pointerId !== id)) return;
      done = true;
      if (app.activeDrag === session) app.activeDrag = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      window.removeEventListener("blur", finish);
      document.removeEventListener("visibilitychange", visibility);
      capture?.removeEventListener("lostpointercapture", finish);
      try {
        if (capture?.hasPointerCapture(id)) capture.releasePointerCapture(id)
      } catch {}
      onEnd?.(ev)
    };
    const move = ev => {
      if (ev.pointerId !== id) return;
      if ((ev.buttons & buttonMask) === 0) return finish(ev);
      onMove?.(ev)
    };
    const visibility = () => {
      if (document.hidden) finish()
    };
    session.finish = finish;
    app.activeDrag = session;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    window.addEventListener("blur", finish);
    document.addEventListener("visibilitychange", visibility);
    if (capture) {
      capture.addEventListener("lostpointercapture", finish);
      try {
        capture.setPointerCapture(id)
      } catch {}
    }
    return session
  }

  // 操作中は影などの重い装飾を止める（パン・行並べ替えと同じ扱い）
  function setInteracting(on) {
    document.body.classList.toggle("is-interacting", on)
  }

  // Shift＋クリックで選択に加える／外す。外したときは、残っている要素（無ければ選択なし）を選択中にする
  function toggleShiftSelection(type, id) {
    const own = type === "card" ? app.multiSelected : app.multiGroups;
    if (own.has(id)) {
      own.delete(id);
      const rest = [...[...app.multiSelected].map(x => ({
        type: "card",
        id: x
      })), ...[...app.multiGroups].map(x => ({
        type: "group",
        id: x
      }))];
      app.selected = rest.at(-1) || null
    } else {
      own.add(id);
      app.selected = {
        type,
        id
      }
    }
    updateSelectionView()
  }

  function selectAndDrag(e, type, id, node) {
    const own = type === "card" ? app.multiSelected : app.multiGroups;
    if (e.shiftKey) return toggleShiftSelection(type, id);
    if (!own.has(id)) {
      app.multiSelected.clear();
      app.multiGroups.clear();
      own.add(id)
    }
    app.selected = {
      type,
      id
    };
    updateSelectionView();
    // インスペクターの入力確定で再描画された場合に備え、ドラッグ対象の要素を取り直す
    node = $(`[data-${type}="${id}"]`) || node;
    const item = type === "card" ? card(id) : group(id);
    if (item.locked) {
      toast("ロックされているため移動できません");
      return
    }
    const selectedGroups = flow().groups.filter(g => app.multiGroups.has(g.id) && !g.locked),
      groupIds = new Set(selectedGroups.map(g => g.id)),
      movingGroups = selectedGroups.map(g => ({
        group: g,
        x: g.x,
        y: g.y,
        node: $(`[data-group="${g.id}"]`)
      })),
      movingCards = flow().cards.filter(c => app.multiSelected.has(c.id) || groupIds.has(c.groupId)).map(c => ({
        card: c,
        x: c.x,
        y: c.y,
        node: $(`[data-card="${c.id}"]`)
      })),
      movingIds = new Set(movingCards.map(ch => ch.card.id)),
      start = {
        x: e.clientX,
        y: e.clientY,
        ox: item.x,
        oy: item.y,
        moved: false,
        snap: snapshot()
      };
    node.classList.add("selected");
    trackPointer(e, {
      capture: node,
      onMove: ev => {
        const rawDx = (ev.clientX - start.x) / app.view.zoom,
          rawDy = (ev.clientY - start.y) / app.view.zoom,
          nextX = grid25(start.ox + rawDx),
          nextY = grid25(start.oy + rawDy),
          dx = nextX - start.ox,
          dy = nextY - start.oy;
        if (!dx && !dy && !start.moved) return;
        if (!start.moved) {
          start.moved = true;
          setInteracting(true)
        }
        movingGroups.forEach(ch => {
          ch.group.x = grid25(ch.x + dx);
          ch.group.y = grid25(ch.y + dy);
          if (ch.node) {
            ch.node.style.left = ch.group.x + "px";
            ch.node.style.top = ch.group.y + "px"
          }
        });
        movingCards.forEach(ch => {
          ch.card.x = grid25(ch.x + dx);
          ch.card.y = grid25(ch.y + dy);
          if (ch.node) {
            ch.node.style.left = ch.card.x + "px";
            ch.node.style.top = ch.card.y + "px"
          }
        });
        scheduleEdges(movingIds)
      },
      onEnd: () => {
        setInteracting(false);
        if (!start.moved) return;
        movingCards.filter(ch => !groupIds.has(ch.card.groupId)).forEach(ch => assignCardToGroup(ch.card, ch));
        commitHistory(start.snap);
        persist();
        render()
      }
    })
  }

  // カードの中心が領域（x, y, w, h を持つもの）の内側か。x, y を渡すとその位置にあるものとして判定する。
  function cardInRect(c, r, x = c.x, y = c.y) {
    const cx = x + cardWidth(c) / 2,
      cy = y + cardHeight(c) / 2;
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
  }

  // 移動したカードの所属を決める。中心が入った領域（重なる場合は手前）の子にする。
  // どの領域にも入らないとき、移動前に親の領域内にあった（領域の外へ出した）場合だけ所属を外し、
  // 元から領域外にあった親（インスペクターで明示した親）は保つ。from は移動前の位置 { x, y }。
  function assignCardToGroup(c, from = null) {
    const hit = flow().groups.filter(g => cardInRect(c, g)).at(-1);
    if (hit) {
      c.groupId = hit.id;
      return
    }
    const parent = group(c.groupId);
    if (!parent || !from || cardInRect(c, parent, from.x, from.y)) c.groupId = ""
  }

  // サイズ変更の終了処理。変化が無ければ（クリックだけなら）履歴・保存・再描画をしない。
  function commitResize(snap) {
    if (snapshot() === snap) return;
    pushHistory(snap);
    persist();
    render()
  }

  // カードの高さ／横幅、領域のサイズ変更。25px刻みで即時反映し、終了時に履歴に積む（カードのサイズ変更では所属を変えない）。
  function resizeCard(e, id) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const c = card(id),
      node = $(`[data-card="${id}"]`),
      startY = e.clientY,
      startH = cardHeight(c),
      snap = snapshot();
    trackPointer(e, {
      capture: e.currentTarget,
      onMove: ev => {
        setInteracting(true);
        c.collapsed = false;
        c.h = Math.max(75, grid25(startH + (ev.clientY - startY) / app.view.zoom));
        if (node) node.style.height = c.h + "px";
        scheduleEdges(new Set([id]))
      },
      onEnd: () => {
        setInteracting(false);
        commitResize(snap)
      }
    })
  }

  function resizeCardWidth(e, id) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const c = card(id),
      node = $(`[data-card="${id}"]`),
      startX = e.clientX,
      startW = cardWidth(c),
      snap = snapshot();
    trackPointer(e, {
      capture: e.currentTarget,
      onMove: ev => {
        setInteracting(true);
        c.w = Math.max(150, grid25(startW + (ev.clientX - startX) / app.view.zoom));
        if (node) node.style.width = c.w + "px";
        scheduleEdges(new Set([id]))
      },
      onEnd: () => {
        setInteracting(false);
        commitResize(snap)
      }
    })
  }

  function resizeGroup(e, id) {
    e.preventDefault();
    e.stopPropagation();
    const g = group(id);
    if (g.locked) return toast("ロックを解除してからサイズ変更してください");
    const node = $(`[data-group="${id}"]`),
      startX = e.clientX,
      startY = e.clientY,
      startW = g.w,
      startH = g.h,
      before = {
        x: g.x,
        y: g.y,
        w: g.w,
        h: g.h
      },
      snap = snapshot();
    trackPointer(e, {
      capture: e.currentTarget,
      onMove: ev => {
        setInteracting(true);
        g.w = Math.max(200, grid25(startW + (ev.clientX - startX) / app.view.zoom));
        g.h = Math.max(125, grid25(startH + (ev.clientY - startY) / app.view.zoom));
        if (node) {
          node.style.width = g.w + "px";
          node.style.height = g.h + "px"
        }
      },
      onEnd: () => {
        setInteracting(false);
        assignContainedCards(g, before);
        commitResize(snap)
      }
    })
  }

  // 領域のリサイズ後の所属。新たに内側へ入った未所属カードを子にし、リサイズで外れた子は所属を外す。
  // 他の領域の子や、元から領域外にあった子（インスペクターで明示した子）はそのまま。before はリサイズ前の範囲。
  function assignContainedCards(g, before) {
    flow().cards.forEach(c => {
      const inside = cardInRect(c, g);
      if (inside && !group(c.groupId)) c.groupId = g.id;
      else if (!inside && c.groupId === g.id && cardInRect(c, before)) c.groupId = ""
    })
  }

  function draftEdgePath(kind, a, q) {
    if (kind === "self") return edgeGeometry({
      kind
    }, a, a).d;
    const p = {
      x1: a.x + cardWidth(a),
      y1: a.y + cardHeight(a) / 2,
      x2: q.x,
      y2: q.y
    };
    if (kind === "loopTop") {
      const top = Math.min(a.y, q.y) - 150;
      return `M ${p.x1} ${p.y1} C ${p.x1+70} ${top}, ${p.x2-70} ${top}, ${p.x2} ${p.y2}`
    }
    if (kind === "loopBottom") {
      const bottom = Math.max(a.y + cardHeight(a), q.y) + 100;
      return `M ${p.x1} ${p.y1} C ${p.x1+55} ${bottom}, ${p.x2-55} ${bottom}, ${p.x2} ${p.y2}`
    }
    return curve(p)
  }

  // 右ドラッグによる接続。終了位置のカードへ接続する（Ctrl：自己ループ、Shift：上側ループ、Alt：下側ループ）。
  function startEdge(e, from) {
    if (e.button !== 2) return;
    e.stopPropagation();
    e.preventDefault();
    const kind = e.ctrlKey ? "self" : e.shiftKey ? "loopTop" : e.altKey ? "loopBottom" : "normal",
      a = card(from),
      draft = document.createElementNS("http://www.w3.org/2000/svg", "path");
    draft.setAttribute("class", `draft-edge ${kind}`);
    draft.style.setProperty("--edge-color", defaultEdgeColor(from, null, kind));
    $("#edge-layer").appendChild(draft);
    app.edgeDraft = {
      from,
      draft,
      kind
    };
    trackPointer(e, {
      buttonMask: 2,
      onMove: ev => {
        const q = screenWorld(ev.clientX, ev.clientY);
        draft.setAttribute("d", draftEdgePath(kind, a, q))
      },
      onEnd: ev => {
        draft.remove();
        app.edgeDraft = null;
        // 直後に空白上で出るブラウザのコンテキストメニューを抑止する
        app.suppressContextMenuUntil = performance.now() + 500;
        if (!ev || ev.clientX == null) return;
        const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".flow-card")?.dataset.card,
          target = kind === "self" ? from : hit;
        if (target && (kind === "self" || target !== from)) createEdge(from, target, kind)
      }
    })
  }

  function defaultEdgeColor(from, to, kind = "normal") {
    if (kind === "loopTop") return "#ff7da8";
    if (kind === "loopBottom") return "#ffd36b";
    if (kind === "self") return "#b196ff";
    const source = card(from),
      target = to ? card(to) : null,
      sourceColor = source ? cardVisualColor(source) : COLORS[0],
      targetColor = target ? cardVisualColor(target) : null;
    return sourceColor && (!to || sourceColor === targetColor) ? sourceColor : COLORS[0]
  }

  function createEdge(from, to, kind = "normal", label = kind === "self" ? "再実行" : "") {
    const exists = flow().edges.some(e => e.from === from && e.to === to && (e.kind || "normal") === kind);
    if (exists) {
      toast("同じ種類の接続がすでにあります");
      return
    }
    const color = defaultEdgeColor(from, to, kind);
    mutate(() => flow().edges.push({
      id: uid("edge"),
      from,
      to,
      kind,
      label,
      color,
      arcHeight: kind === "loopTop" ? 150 : 100
    }))
  }

  function renderSingleInspector() {
    const el = $("#inspector");
    if (!app.selected) {
      el.innerHTML = '<div class="empty-inspector"><span>◇</span><p>カード・線・領域を選択すると<br>詳細を編集できます</p></div>';
      return
    }
    const {
      type,
      id
    } = app.selected;
    if (type === "card") {
      const c = card(id);
      if (!c) return clearSelection();
      const groupField = `<label class="field"><span>親グループ</span><select id="i-parent-group"><option value="">なし（位置から自動判定）</option>${flow().groups.map(g=>`<option value="${g.id}" ${c.groupId===g.id?"selected":""}>${esc(g.name)}</option>`).join("")}</select></label>`;
      el.innerHTML = `<h2>カードの詳細</h2><label class="field"><span>タイトル</span><input id="i-title" value="${attr(c.title)}"></label><label class="field"><span>展開メモ</span><textarea id="i-body">${esc(c.body)}</textarea></label><label class="field"><span>タグ（カンマ区切り）</span><input id="i-tags" value="${attr(c.tags.join(", "))}"></label>${groupField}<p class="hint">サイズ ${cardWidth(c)} × ${cardHeight(c)}px。右端で期間、下端で高さを変更できます。</p><div class="inspector-actions"><button id="i-connect">接続先を選択</button><button id="i-collapse">${c.collapsed?"メモを展開":"メモを閉じる"}</button><button id="i-delete" class="danger">削除</button></div><p class="hint">キャンバス上では、カードを右クリックしたまま接続先へドラッグします。</p>`;
      bindInput("#i-title", v => c.title = v);
      bindInput("#i-body", v => c.body = v);
      bindInput("#i-tags", v => c.tags = [...new Set(v.split(",").map(x => x.trim().replace(/^#/, "")).filter(Boolean))]);
      $("#i-parent-group").onchange = e => mutate(() => c.groupId = e.target.value);
      $("#i-collapse").onclick = () => mutate(() => c.collapsed = !c.collapsed);
      $("#i-delete").onclick = () => deleteEntity("card", id);
      $("#i-connect").onclick = () => chooseConnectionTarget(id)
    } else if (type === "edge") {
      const x = edge(id);
      if (!x) return clearSelection();
      const kind = x.kind || "normal",
        // 自己ループには接続先が無いので、ほかの種類へは変えられない（別のカードへの線は作り直してもらう）
        fixed = kind === "self" ? "disabled" : "",
        arc = kind !== "normal" ? `<label class="field"><span>円弧の高さ（px）</span><input id="i-arc-height" type="number" min="75" step="25" value="${Number(x.arcHeight)||100}"></label>` : "";
      el.innerHTML = `<h2>接続線の詳細</h2><label class="field"><span>線の種類</span><select id="i-edge-kind"><option value="normal" ${kind==="normal"?"selected":""} ${fixed}>通常フロー</option><option value="loopTop" ${kind==="loopTop"?"selected":""} ${fixed}>1：上側の戻りループ</option><option value="loopBottom" ${kind==="loopBottom"?"selected":""} ${fixed}>2：下側の差し戻し</option><option value="self" ${kind==="self"?"selected":""}>3：自己ループ（接続先は外れます）</option></select></label>${fixed?'<p class="hint">自己ループはほかの種類に変えられません。別のカードへの線にするときは作り直してください。</p>':""}${arc}<label class="field"><span>条件・説明</span><textarea id="i-label" placeholder="○○だったら">${esc(x.label)}</textarea></label><label class="field"><span>線の色</span><select id="i-color">${COLORS.map(c=>`<option value="${c}" ${x.color===c?"selected":""}>${c}</option>`).join("")}</select></label><div class="inspector-actions"><button id="i-reverse" ${kind==="self"?"disabled":""}>向きを反転</button><button id="i-delete" class="danger">削除</button></div>`;
      bindInput("#i-label", v => x.label = v);
      $("#i-edge-kind").onchange = e => mutate(() => {
        // 色は、今の種類の既定色のままなら新しい種類の既定色にし、利用者が選んだ色は保つ
        const wasDefault = x.color === defaultEdgeColor(x.from, x.to, kind);
        x.kind = e.target.value;
        if (x.kind === "self") x.to = x.from;
        x.arcHeight = x.kind === "loopTop" ? 150 : 100;
        if (wasDefault) x.color = defaultEdgeColor(x.from, x.to, x.kind)
      });
      if ($("#i-arc-height")) $("#i-arc-height").onchange = e => {
        mutate(() => x.arcHeight = Math.max(75, grid25(Number(e.target.value) || 100)), {
          inspector: false
        });
        e.target.value = x.arcHeight
      };
      $("#i-color").onchange = e => mutate(() => x.color = e.target.value);
      $("#i-reverse").onclick = () => mutate(() => [x.from, x.to] = [x.to, x.from]);
      $("#i-delete").onclick = () => deleteEntity("edge", id)
    } else {
      const g = group(id);
      if (!g) return clearSelection();
      const count = flow().cards.filter(c => c.groupId === id).length;
      el.innerHTML = `<h2>グループ領域</h2><label class="field"><span>名前</span><input id="i-name" value="${attr(g.name)}"></label><label class="field"><span>色（子カードにも反映）</span><select id="i-color">${COLORS.map(c=>`<option value="${c}" ${g.color===c?"selected":""}>${c}</option>`).join("")}</select></label><p class="hint">子カード ${count}件。カードを領域内へ移動すると所属し、領域と一緒に移動します。</p><div class="inspector-actions"><button id="i-lock">${g.locked?"ロック解除":"領域をロック"}</button><button id="i-fit" ${g.locked?'disabled title="ロック中は領域の位置・サイズを変えられません"':""}>子カードに合わせる</button><button id="i-delete" class="danger">削除</button></div>`;
      bindInput("#i-name", v => g.name = v);
      $("#i-color").onchange = e => mutate(() => g.color = e.target.value);
      $("#i-lock").onclick = () => mutate(() => g.locked = !g.locked);
      $("#i-fit").onclick = () => {
        if (!g.locked) mutate(() => fitGroup(g))
      };
      $("#i-delete").onclick = () => deleteEntity("group", id)
    }
  }

  function batchSame(cards, get) {
    const first = JSON.stringify(get(cards[0]));
    return cards.every(c => JSON.stringify(get(c)) === first)
  }

  function batchControl(spec, cards) {
    const same = batchSame(cards, spec.get),
      raw = same ? spec.get(cards[0]) : "",
      disabled = same ? "" : "disabled",
      overwrite = same ? "" : `<label class="batch-overwrite"><input type="checkbox" data-batch-enable="${spec.id}"> 異なる値を上書き</label>`;
    let control;
    if (spec.type === "textarea") control = `<textarea id="${spec.id}" ${disabled} placeholder="${same?"":"−"}">${same?esc(raw):""}</textarea>`;
    else if (spec.type === "select") control = `<select id="${spec.id}" ${disabled}>${same?"":'<option value="">−</option>'}${spec.options.map(o=>`<option value="${attr(o.value)}" ${same&&String(raw)===String(o.value)?"selected":""}>${esc(o.label)}</option>`).join("")}</select>`;
    else control = `<input id="${spec.id}" type="${spec.type||"text"}" ${spec.step?`step="${spec.step}"`:""} ${spec.min?`min="${spec.min}"`:""} value="${same?attr(raw):""}" placeholder="${same?"":"−"}" ${disabled}>`;
    return `<label class="field"><span>${esc(spec.label)}</span>${control}${overwrite}</label>`
  }

  function renderMultiCardInspector(cards, el) {
    const groupOptions = [{
        value: "",
        label: "なし"
      }, ...flow().groups.map(g => ({
        value: g.id,
        label: g.name
      }))],
      specs = [{
        id: "batch-title",
        label: "タイトル",
        get: c => c.title,
        set: (c, v) => c.title = v
      }, {
        id: "batch-body",
        label: "展開メモ",
        type: "textarea",
        get: c => c.body,
        set: (c, v) => c.body = v
      }, {
        id: "batch-tags",
        label: "タグ（カンマ区切り）",
        get: c => c.tags.join(", "),
        set: (c, v) => c.tags = [...new Set(v.split(",").map(x => x.trim().replace(/^#/, "")).filter(Boolean))]
      }, {
        id: "batch-parent",
        label: "親グループ",
        type: "select",
        options: groupOptions,
        get: c => c.groupId || "",
        set: (c, v) => c.groupId = v
      }, {
        id: "batch-collapsed",
        label: "メモ表示",
        type: "select",
        options: [{
          value: "false",
          label: "展開"
        }, {
          value: "true",
          label: "閉じる"
        }],
        get: c => String(!!c.collapsed),
        set: (c, v) => c.collapsed = v === "true"
      }, {
        id: "batch-width",
        label: "横幅（px）",
        type: "number",
        step: 25,
        min: 150,
        get: c => cardWidth(c),
        set: (c, v) => c.w = Math.max(150, grid25(Number(v) || 250))
      }, {
        id: "batch-height",
        label: "高さ（px）",
        type: "number",
        step: 25,
        min: 75,
        get: c => cardHeight(c),
        set: (c, v) => c.h = Math.max(75, grid25(Number(v) || 100))
      }];
    el.innerHTML = `<h2>カードを${cards.length}件選択中</h2><p class="hint">共通の値は直接変更できます。「−」の項目は上書きをONにした場合だけ全カードへ反映します。</p>${specs.map(s=>batchControl(s,cards)).join("")}<div class="inspector-actions"><button id="batch-delete" class="danger">選択カードを削除</button></div>`;
    specs.forEach(spec => {
      const control = $("#" + spec.id),
        enable = $(`[data-batch-enable="${spec.id}"]`);
      if (enable) enable.onchange = () => {
        control.disabled = !enable.checked;
        if (enable.checked) {
          if (spec.type === "select" && control.options[0]?.value === "") control.selectedIndex = Math.min(1, control.options.length - 1);
          control.focus()
        }
      };
      control.onkeydown = e => e.stopPropagation();
      control.onchange = () => {
        if (control.disabled) return;
        const typed = spec.type !== "select";
        mutate(() => cards.forEach(c => spec.set(c, control.value)), {
          inspector: !typed
        });
        // 数値欄は作り直さないので、25px 単位に揃えた値を表示へ戻す
        if (spec.type === "number" && batchSame(cards, spec.get)) control.value = String(spec.get(cards[0]))
      }
    });
    $("#batch-delete").onclick = () => deleteItems({
      cardIds: new Set(cards.map(c => c.id))
    })
  }
  // インスペクターを作り直す。作り直す前に入力中の欄を確定し（blur で change を発生させる）、
  // 同じ対象を描き直すときはフォーカスとスクロール位置を戻す（フォーカスが body に落ちると Delete がカード削除になるため）。
  function renderInspector() {
    const el = $("#inspector"),
      active = el.contains(document.activeElement) ? document.activeElement : null,
      focusId = active?.id || "",
      prevKey = el.dataset.key || "",
      scroll = el.scrollTop;
    if (active && /INPUT|TEXTAREA/.test(active.tagName)) active.blur();
    renderInspectorContent(el);
    el.dataset.key = inspectorKey();
    if (el.dataset.key !== prevKey) return;
    el.scrollTop = scroll;
    if (focusId) $("#" + focusId, el)?.focus({
      preventScroll: true
    })
  }

  function inspectorKey() {
    const ids = [...app.multiSelected, ...app.multiGroups];
    return ids.length > 1 ? "multi:" + ids.sort().join(",") : app.selected ? `${app.selected.type}:${app.selected.id}` : ""
  }

  // インスペクターの中身：複数選択なら一括編集（カードのみ）か件数表示、単独なら各要素の詳細
  function renderInspectorContent(el) {
    const cards = flow().cards.filter(c => app.multiSelected.has(c.id)),
      groups = flow().groups.filter(g => app.multiGroups.has(g.id)),
      total = cards.length + groups.length;
    if (total > 1) {
      if (!groups.length) return renderMultiCardInspector(cards, el);
      el.innerHTML = `<h2>${total}件を選択中</h2><p class="hint">カード ${cards.length}件・グループ ${groups.length}件。選択中の要素をまとめて移動できます。</p>`;
      return
    }
    if (cards.length === 1) app.selected = {
      type: "card",
      id: cards[0].id
    };
    if (groups.length === 1) app.selected = {
      type: "group",
      id: groups[0].id
    };
    renderSingleInspector()
  }

  function bindInput(s, set) {
    const n = $(s);
    n.onchange = () => mutate(() => set(n.value), {
      inspector: false
    });
    n.onkeydown = e => e.stopPropagation()
  }

  function clearSelection() {
    app.selected = null;
    render()
  }

  // カード・領域をまとめて削除。カードに付く線は一緒に削除し、領域の子カードは所属なしにする。
  function deleteItems(items) {
    const {
      cardIds = new Set(),
      groupIds = new Set(),
      edgeIds = new Set()
    } = items;
    if (!cardIds.size && !groupIds.size && !edgeIds.size) return;
    mutate(() => removeItems(items))
  }

  // deleteItems と行・列の削除で共用（mutate の中で呼ぶ）。選択も解除する。
  function removeItems({
    cardIds = new Set(),
    groupIds = new Set(),
    edgeIds = new Set()
  }) {
    const f = flow();
    f.cards = f.cards.filter(c => !cardIds.has(c.id));
    f.edges = f.edges.filter(e => !edgeIds.has(e.id) && !cardIds.has(e.from) && !cardIds.has(e.to));
    f.groups = f.groups.filter(g => !groupIds.has(g.id));
    f.cards.forEach(c => {
      if (groupIds.has(c.groupId)) c.groupId = ""
    });
    app.selected = null;
    app.multiSelected.clear();
    app.multiGroups.clear()
  }

  function deleteEntity(type, id) {
    deleteItems({
      cardIds: new Set(type === "card" ? [id] : []),
      groupIds: new Set(type === "group" ? [id] : []),
      edgeIds: new Set(type === "edge" ? [id] : [])
    })
  }

  // Delete キー：複数選択中はカード・領域をまとめて削除、単独選択なら選択中の1件
  function deleteSelection() {
    if (app.multiSelected.size || app.multiGroups.size) return deleteItems({
      cardIds: new Set(app.multiSelected),
      groupIds: new Set(app.multiGroups)
    });
    if (app.selected) deleteEntity(app.selected.type, app.selected.id)
  }

  function chooseConnectionTarget(from) {
    const choices = flow().cards.filter(c => c.id !== from);
    if (!choices.length) return toast("接続先のカードがありません");
    modal(`<h2>接続先を選択</h2><label class="field"><span>カード</span><select id="target-card">${choices.map(c=>`<option value="${c.id}">${esc(c.title)}</option>`).join("")}</select></label><label class="field"><span>条件・説明（後から編集可）</span><textarea id="target-label" placeholder="○○だったら"></textarea></label><div class="modal-actions"><button data-close>キャンセル</button><button id="make-edge" class="primary">接続</button></div>`);
    $("#make-edge").onclick = () => {
      const to = $("#target-card").value,
        label = $("#target-label").value;
      closeModal();
      createEdge(from, to, "normal", label)
    }
  }

  function timelineMetrics() {
    const t = flow().timeline,
      labelW = Math.max(125, Number(t.labelWidth) || 175),
      headH = 70,
      colX = [labelW],
      rowY = [headH];
    t.colWidths.forEach(w => colX.push(colX.at(-1) + w));
    t.rowHeights.forEach(h => rowY.push(rowY.at(-1) + h));
    return {
      t,
      labelW,
      headH,
      colX,
      rowY,
      width: colX.at(-1),
      height: rowY.at(-1)
    }
  }

  function timelineColumnLabel(index) {
    const t = flow().timeline;
    return t.colLabels?.[index] || monthLabel(t.startMonth, index)
  }

  // 時系列表の描画。表の HTML が前回と同じなら作り直さない（force は見出しの直接編集のように DOM を書き換えた後に使う）。
  function renderTimeline(force = false) {
    const layer = $("#timeline-layer"),
      t = flow().timeline;
    if (!t.enabled) {
      app.timelineHtml = "";
      layer.innerHTML = "";
      layer.className = "";
      return
    }
    const m = timelineMetrics();
    layer.style.left = t.x + "px";
    layer.style.top = t.y + "px";
    layer.style.width = m.width + "px";
    layer.style.height = m.height + "px";
    let html = `<div class="timeline-corner" data-timeline-move title="ドラッグして表全体を移動" style="width:${m.labelW}px"><span>表を移動</span><span class="axis-resize label-resize" data-label-resize title="ドラッグして項目名の幅を変更"></span></div>`;
    for (let i = 0; i < t.monthCount; i++) {
      const x = m.colX[i],
        w = t.colWidths[i];
      html += `<div class="timeline-month" data-col-index="${i}" title="ダブルクリックで文字を変更" style="left:${x}px;width:${w}px"><span class="axis-label-text">${esc(timelineColumnLabel(i))}</span>${t.monthCount>1?`<button class="axis-control axis-remove-col" data-remove-col="${i}" title="この列を削除">−</button>`:""}<span class="half-mark"></span><span class="axis-resize col-resize" data-col-resize="${i}" title="ドラッグ：列幅変更／Ctrl＋ドラッグ：後続カードも移動"></span></div>`
    }
    t.rows.forEach((row, i) => {
      const y = m.rowY[i],
        h = t.rowHeights[i],
        rowColor = t.rowColors[i] || COLORS[i % COLORS.length];
      html += `<div class="timeline-row-label" data-row-index="${i}" title="ドラッグで行を入れ替え／ダブルクリックで文字を変更" style="top:${y}px;height:${h}px;width:${m.labelW}px;--row-color:${rowColor}"><span class="axis-label-text">${esc(row)}</span>${t.rows.length>1?`<button class="axis-control axis-remove-row" data-remove-row="${i}" title="この項目を削除">−</button>`:""}<span class="axis-resize row-resize" data-row-resize="${i}" title="ドラッグ：項目高さ変更／Ctrl＋ドラッグ：後続カードも移動"></span></div>`;
      for (let c = 0; c < t.monthCount; c++) html += `<div class="timeline-cell" style="left:${m.colX[c]}px;top:${y}px;width:${t.colWidths[c]}px;height:${h}px;--row-color:${rowColor}"></div>`
    });
    for (let i = 1; i < t.rows.length; i++) html += `<button class="axis-control axis-insert-row" data-insert-row="${i}" data-boundary-y="${m.rowY[i]}" style="top:${m.rowY[i]-14}px;left:${m.labelW/2-14}px" title="ここに項目を差し込む">＋</button>`;
    html += `<button class="axis-control axis-add-col" data-add-axis="col" title="右に列を追加">＋</button><button class="axis-control axis-add-row" data-add-axis="row" style="left:${m.labelW/2-14}px" title="下に項目を追加">＋</button><div class="timeline-row-drop-guide" aria-hidden="true"></div>`;
    if (!force && html === app.timelineHtml && layer.classList.contains("timeline-grid")) return;
    app.timelineHtml = html;
    layer.className = "timeline-grid";
    layer.innerHTML = html;
    $('[data-timeline-move]', layer).onpointerdown = moveTimeline;
    $$('[data-row-index]', layer).forEach(n => {
      n.onpointerdown = e => startTimelineRowDrag(e, Number(n.dataset.rowIndex), n);
      n.ondblclick = e => beginTimelineLabelEdit(e, "row", Number(n.dataset.rowIndex), n)
    });
    $$('[data-col-index]', layer).forEach(n => n.ondblclick = e => beginTimelineLabelEdit(e, "col", Number(n.dataset.colIndex), n));
    $('[data-label-resize]', layer).onpointerdown = resizeTimelineLabel;
    $$('[data-col-resize]', layer).forEach(n => n.onpointerdown = e => resizeTimelineAxis(e, "col", Number(n.dataset.colResize)));
    $$('[data-row-resize]', layer).forEach(n => n.onpointerdown = e => resizeTimelineAxis(e, "row", Number(n.dataset.rowResize)));
    $$('[data-add-axis]', layer).forEach(n => n.onclick = e => {
      e.stopPropagation();
      changeTimelineAxis("add", n.dataset.addAxis)
    });
    $$('[data-insert-row]', layer).forEach(n => n.onclick = e => {
      e.stopPropagation();
      changeTimelineAxis("insert", "row", Number(n.dataset.insertRow))
    });
    $$('[data-remove-col]', layer).forEach(n => n.onclick = e => {
      e.stopPropagation();
      changeTimelineAxis("remove", "col", Number(n.dataset.removeCol))
    });
    $$('[data-remove-row]', layer).forEach(n => n.onclick = e => {
      e.stopPropagation();
      changeTimelineAxis("remove", "row", Number(n.dataset.removeRow))
    })
  }

  // 行の並べ替え。各行にあるカード・領域（中心の位置で判定）を行と一緒に移動する。
  // 移動する領域の子カードは、自分の位置に関わらず領域と同じだけ動かす（親子が離れないように）。
  function reorderTimelineRow(from, insertIndex) {
    const f = flow(),
      t = f.timeline,
      count = t.rows.length,
      destination = insertIndex > from ? insertIndex - 1 : insertIndex;
    if (from < 0 || from >= count || destination < 0 || destination >= count || destination === from) return;
    const before = timelineMetrics(),
      member = (item, center) => {
        const index = t.rows.findIndex((_, i) => center >= t.y + before.rowY[i] && center < t.y + before.rowY[i + 1]);
        return index < 0 ? null : {
          item,
          index,
          offset: item.y - (t.y + before.rowY[index])
        }
      },
      groups = f.groups.map(g => member(g, g.y + g.h / 2)).filter(Boolean),
      movingGroupIds = new Set(groups.map(m => m.item.id)),
      cards = f.cards.filter(c => !movingGroupIds.has(c.groupId)).map(c => member(c, c.y + cardHeight(c) / 2)).filter(Boolean),
      order = Array.from({
        length: count
      }, (_, i) => i);
    mutate(() => {
      const move = (list, index) => {
        const [value] = list.splice(from, 1);
        list.splice(index, 0, value)
      };
      move(t.rows, destination);
      move(t.rowColors, destination);
      move(t.rowHeights, destination);
      const [original] = order.splice(from, 1);
      order.splice(destination, 0, original);
      const after = timelineMetrics(),
        place = m => m.item.y = grid25(t.y + after.rowY[order.indexOf(m.index)] + m.offset);
      cards.forEach(place);
      groups.forEach(m => {
        const oldY = m.item.y;
        place(m);
        const dy = m.item.y - oldY;
        if (dy) f.cards.forEach(c => {
          if (c.groupId === m.item.id) c.y = grid25(c.y + dy)
        })
      })
    })
  }

  // 行ラベルのドラッグで項目を並べ替える（6px 動くまでは開始しない。ドロップ時に付随カードも移動）
  function startTimelineRowDrag(e, index, node) {
    if (e.button !== 0 || e.target.closest(".axis-control,.axis-resize,.axis-inline-input")) return;
    e.stopPropagation();
    const layer = $("#timeline-layer"),
      guide = $(".timeline-row-drop-guide", layer),
      start = {
        x: e.clientX,
        y: e.clientY,
        dragging: false,
        insert: index
      };
    trackPointer(e, {
      capture: node,
      onMove: ev => {
        if (!start.dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        if (!start.dragging) {
          start.dragging = true;
          node.classList.add("row-drag-source");
          layer.classList.add("row-dragging");
          setInteracting(true)
        }
        ev.preventDefault();
        const rect = layer.getBoundingClientRect(),
          m = timelineMetrics(),
          scale = rect.height / (parseFloat(layer.style.height) || rect.height),
          localY = (ev.clientY - rect.top) / scale;
        let insert = 0;
        while (insert < m.t.rows.length && localY > (m.rowY[insert] + m.rowY[insert + 1]) / 2) insert++;
        start.insert = insert;
        guide.style.top = m.rowY[insert] + "px"
      },
      onEnd: () => {
        node.classList.remove("row-drag-source");
        layer.classList.remove("row-dragging");
        setInteracting(false);
        if (start.dragging) reorderTimelineRow(index, start.insert)
      }
    })
  }

  function monthLabel(start, offset) {
    const [y, m] = String(start).split("-").map(Number), d = new Date(y, m - 1 + offset, 1);
    return `${d.getFullYear()}年 ${d.getMonth()+1}月`
  }

  function shiftMonth(start, offset) {
    const [y, m] = String(start).split("-").map(Number), d = new Date(y, m - 1 + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`
  }

  // 項目名列の幅変更。境界より右のカード・領域は幅の増減に合わせて移動／伸縮する。
  function resizeTimelineLabel(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const f = flow(),
      t = f.timeline,
      m = timelineMetrics(),
      original = m.labelW,
      startX = e.clientX,
      boundary = t.x + original,
      bodyTop = t.y + m.headH,
      bodyBottom = t.y + m.height,
      snap = snapshot(),
      cards = f.cards.map(c => ({
        item: c,
        x: c.x,
        move: c.x + cardWidth(c) / 2 >= boundary && c.y + cardHeight(c) / 2 >= bodyTop && c.y + cardHeight(c) / 2 < bodyBottom
      })),
      groups = f.groups.map(g => {
        const inRows = g.y + g.h / 2 >= bodyTop && g.y + g.h / 2 < bodyBottom;
        return {
          item: g,
          x: g.x,
          w: g.w,
          move: inRows && g.x >= boundary,
          stretch: inRows && g.x < boundary && g.x + g.w > boundary
        }
      });
    const applyOffset = delta => {
      cards.forEach(ch => {
        if (ch.move) ch.item.x = grid25(ch.x + delta);
        const node = $(`[data-card="${ch.item.id}"]`);
        if (node) node.style.left = ch.item.x + "px"
      });
      groups.forEach(ch => {
        const g = ch.item;
        if (ch.move) g.x = grid25(ch.x + delta);
        else if (ch.stretch) g.w = Math.max(200, grid25(ch.w + delta));
        const node = $(`[data-group="${g.id}"]`);
        if (node) {
          node.style.left = g.x + "px";
          node.style.width = g.w + "px"
        }
      });
      scheduleEdges()
    };
    trackPointer(e, {
      capture: $("#timeline-layer"),
      onMove: ev => {
        const next = Math.max(125, grid25(original + (ev.clientX - startX) / app.view.zoom));
        if (next === t.labelWidth) return;
        t.labelWidth = next;
        applyOffset(next - original);
        scheduleTimelineRender()
      },
      onEnd: () => {
        commitHistory(snap);
        persist();
        render()
      }
    })
  }

  // 列幅・行高さの変更。Ctrl 押下時は境界より後ろのカード・領域も同じ量だけ移動／伸縮する。
  function resizeTimelineAxis(e, type, index) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const f = flow(),
      t = f.timeline,
      list = type === "col" ? t.colWidths : t.rowHeights,
      min = type === "col" ? 175 : 100,
      start = e[type === "col" ? "clientX" : "clientY"],
      original = list[index],
      snap = snapshot(),
      offsetItems = e.ctrlKey,
      m = timelineMetrics(),
      boundary = type === "col" ? t.x + m.colX[index + 1] : t.y + m.rowY[index + 1],
      cards = f.cards.map(c => ({
        item: c,
        x: c.x,
        y: c.y
      })),
      groups = f.groups.map(g => ({
        item: g,
        x: g.x,
        y: g.y,
        w: g.w,
        h: g.h
      }));
    const applyOffset = delta => {
      if (!offsetItems) return;
      cards.forEach(ch => {
        if (type === "col" && ch.x + cardWidth(ch.item) / 2 >= boundary) ch.item.x = grid25(ch.x + delta);
        if (type === "row" && ch.y + cardHeight(ch.item) / 2 >= boundary) ch.item.y = grid25(ch.y + delta);
        const node = $(`[data-card="${ch.item.id}"]`);
        if (node) {
          node.style.left = ch.item.x + "px";
          node.style.top = ch.item.y + "px"
        }
      });
      groups.forEach(ch => {
        const g = ch.item;
        if (type === "col") {
          if (ch.x >= boundary) g.x = grid25(ch.x + delta);
          else if (ch.x + ch.w > boundary) g.w = Math.max(200, grid25(ch.w + delta))
        } else {
          if (ch.y >= boundary) g.y = grid25(ch.y + delta);
          else if (ch.y + ch.h > boundary) g.h = Math.max(125, grid25(ch.h + delta))
        }
        const node = $(`[data-group="${g.id}"]`);
        if (node) {
          node.style.left = g.x + "px";
          node.style.top = g.y + "px";
          node.style.width = g.w + "px";
          node.style.height = g.h + "px"
        }
      });
      scheduleEdges()
    };
    trackPointer(e, {
      capture: $("#timeline-layer"),
      onMove: ev => {
        const current = ev[type === "col" ? "clientX" : "clientY"],
          next = Math.max(min, grid25(original + (current - start) / app.view.zoom));
        if (next === list[index]) return;
        list[index] = next;
        applyOffset(next - original);
        scheduleTimelineRender()
      },
      onEnd: () => {
        commitHistory(snap);
        persist();
        render()
      }
    })
  }

  // 表の左上をドラッグして表全体を移動（カードは動かさない）
  function moveTimeline(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const t = flow().timeline,
      layer = $("#timeline-layer"),
      start = {
        clientX: e.clientX,
        clientY: e.clientY,
        x: t.x,
        y: t.y,
        snap: snapshot(),
        moved: false
      };
    trackPointer(e, {
      capture: layer,
      onMove: ev => {
        const x = grid25(start.x + (ev.clientX - start.clientX) / app.view.zoom),
          y = grid25(start.y + (ev.clientY - start.clientY) / app.view.zoom);
        if (x === t.x && y === t.y) return;
        start.moved = true;
        t.x = x;
        t.y = y;
        layer.style.left = x + "px";
        layer.style.top = y + "px"
      },
      onEnd: () => {
        if (!start.moved) return;
        commitHistory(start.snap);
        persist();
        // 表が動くとカードのある行が変わり、行の色（カードの色）も変わるので描き直す
        render()
      }
    })
  }

  function beginTimelineLabelEdit(e, type, index, node) {
    if (e.target.closest(".axis-control,.axis-resize")) return;
    e.preventDefault();
    e.stopPropagation();
    if (node.classList.contains("editing")) return;
    const t = flow().timeline,
      current = type === "row" ? t.rows[index] : timelineColumnLabel(index),
      text = $(".axis-label-text", node),
      editor = document.createElement(type === "row" ? "textarea" : "input");
    editor.className = "axis-inline-input";
    editor.value = current;
    node.classList.add("editing");
    text.replaceWith(editor);
    editor.onpointerdown = ev => ev.stopPropagation();
    let done = false,
      cancel = false;
    const finish = () => {
      if (done) return;
      done = true;
      const value = editor.value.trim();
      if (!cancel && value && value !== current) {
        history();
        if (type === "row") t.rows[index] = value;
        else t.colLabels[index] = value;
        persist()
      }
      renderTimeline(true)
    };
    editor.onkeydown = ev => {
      ev.stopPropagation();
      if (ev.key === "Escape") {
        cancel = true;
        editor.blur()
      } else if (ev.key === "Enter" && (type === "col" || ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        editor.blur()
      }
    };
    editor.onblur = finish;
    editor.focus();
    editor.select()
  }

  // 境界（ワールド座標）以降にあるカード・領域を delta だけ移動し、境界をまたぐ領域は伸縮する。
  // 行の挿入と、列・行の削除で共用（挿入は +サイズ、削除は −サイズ）。カードは中心位置で判定する。
  function shiftAfterBoundary(type, boundary, delta) {
    const f = flow(),
      col = type === "col";
    f.cards.forEach(c => {
      const center = col ? c.x + cardWidth(c) / 2 : c.y + cardHeight(c) / 2;
      if (center < boundary) return;
      if (col) c.x = grid25(c.x + delta);
      else c.y = grid25(c.y + delta)
    });
    f.groups.forEach(g => {
      const start = col ? g.x : g.y,
        size = col ? g.w : g.h;
      if (start >= boundary) {
        if (col) g.x = grid25(g.x + delta);
        else g.y = grid25(g.y + delta)
      } else if (start + size > boundary) {
        if (col) g.w = Math.max(200, grid25(g.w + delta));
        else g.h = Math.max(125, grid25(g.h + delta))
      }
    })
  }

  function changeTimelineAxis(action, type, index) {
    const t = flow().timeline,
      m = timelineMetrics();
    if (action === "insert" && type === "row") {
      const height = t.rowHeights[Math.max(0, index - 1)] || 150,
        boundary = t.y + m.rowY[index];
      mutate(() => {
        t.rows.splice(index, 0, "新しい項目");
        t.rowColors.splice(index, 0, nextTimelineRowColor(t.rowColors, index));
        t.rowHeights.splice(index, 0, height);
        shiftAfterBoundary("row", boundary, height)
      });
      return
    }
    if (action === "add") {
      if (type === "col") {
        if (t.monthCount >= 24) return toast("列は24件までです");
        mutate(() => {
          t.monthCount++;
          t.colWidths.push(t.colWidths.at(-1) || 300);
          t.colLabels.push("")
        })
      } else mutate(() => {
        const rowIndex = t.rows.length;
        t.rows.push(`項目${rowIndex+1}`);
        t.rowColors.push(nextTimelineRowColor(t.rowColors, rowIndex));
        t.rowHeights.push(t.rowHeights.at(-1) || 150)
      });
      return
    }
    // 削除：表の範囲内でその列・行に入っているカード（中心で判定）と、そこに収まる領域は、確認のうえ一緒に削除する。
    // 削除した列・行より後ろのカード・領域は、削除した幅・高さの分だけ前へ詰める。
    const col = type === "col";
    if (col && t.monthCount <= 1) return toast("最後の列は削除できません");
    if (!col && t.rows.length <= 1) return toast("最後の項目は削除できません");
    const f = flow(),
      size = col ? t.colWidths[index] : t.rowHeights[index],
      start = col ? t.x + m.colX[index] : t.y + m.rowY[index],
      boundary = start + size,
      crossStart = col ? t.y : t.x,
      crossEnd = crossStart + (col ? m.height : m.width),
      inside = (along, across) => along >= start && along < boundary && across >= crossStart && across < crossEnd,
      cardIds = new Set(f.cards.filter(c => {
        const cx = c.x + cardWidth(c) / 2,
          cy = c.y + cardHeight(c) / 2;
        return col ? inside(cx, cy) : inside(cy, cx)
      }).map(c => c.id)),
      groupIds = new Set(f.groups.filter(g => {
        const from = col ? g.x : g.y,
          length = col ? g.w : g.h,
          across = col ? g.y + g.h / 2 : g.x + g.w / 2;
        return from >= start && from + length <= boundary && across >= crossStart && across < crossEnd
      }).map(g => g.id));
    if (cardIds.size || groupIds.size) {
      const name = String(col ? timelineColumnLabel(index) : t.rows[index]).replace(/\s+/g, " "),
        what = [cardIds.size ? `カード${cardIds.size}枚` : "", groupIds.size ? `領域${groupIds.size}件` : ""].filter(Boolean).join("と");
      if (!confirm(`「${name}」の${col?"列":"行"}にある${what}も一緒に削除します。よろしいですか？\n（「元に戻す」で戻せます）`)) return
    }
    mutate(() => {
      if (col) {
        t.colWidths.splice(index, 1);
        t.colLabels.splice(index, 1);
        t.monthCount--;
        if (index === 0) t.startMonth = shiftMonth(t.startMonth, 1)
      } else {
        t.rows.splice(index, 1);
        t.rowColors.splice(index, 1);
        t.rowHeights.splice(index, 1)
      }
      if (cardIds.size || groupIds.size) removeItems({
        cardIds,
        groupIds
      });
      shiftAfterBoundary(type, boundary, -size)
    })
  }

  function toggleTimeline() {
    mutate(() => flow().timeline.enabled = !flow().timeline.enabled)
  }

  function addCard(text) {
    const lines = text.trim().split(/\n/),
      title = lines.shift() || "新しいカード",
      body = lines.join("\n");
    const center = canvasCenter();
    mutate(() => {
      const c = {
        id: uid("card"),
        title,
        body,
        tags: [],
        collapsed: false,
        w: 250,
        h: 100,
        x: grid25(center.x - 125),
        y: grid25(center.y - 50),
        groupId: ""
      };
      flow().cards.push(c)
    })
  }

  function addGroup() {
    const center = canvasCenter();
    mutate(() => flow().groups.push({
      id: uid("group"),
      name: "新しい領域",
      color: COLORS[flow().groups.length % COLORS.length],
      locked: false,
      x: grid25(center.x - 200),
      y: grid25(center.y - 120),
      w: 400,
      h: 250
    }))
  }

  function fitGroup(g) {
    const inside = flow().cards.filter(c => c.groupId === g.id);
    if (!inside.length) return;
    const minX = Math.min(...inside.map(c => c.x)),
      minY = Math.min(...inside.map(c => c.y)),
      maxX = Math.max(...inside.map(c => c.x + cardWidth(c))),
      maxY = Math.max(...inside.map(c => c.y + cardHeight(c)));
    g.x = grid25(minX - 50);
    g.y = grid25(minY - 50);
    g.w = Math.max(200, grid25(maxX - g.x + 50));
    g.h = Math.max(125, grid25(maxY - g.y + 50))
  }

  // 選択中のカード・領域をコピーする。領域は子カードと内部の線も含め、複数の領域や、カードと領域が混ざった選択もそのまま扱う。
  function copySelected() {
    if (!app.selected || app.selected.type === "edge") return;
    const f = flow(),
      {
        type,
        id
      } = app.selected,
      groupIds = new Set(app.multiGroups.size ? app.multiGroups : type === "group" ? [id] : []),
      cardIds = new Set(app.multiSelected.size ? app.multiSelected : type === "card" ? [id] : []),
      groups = f.groups.filter(g => groupIds.has(g.id)),
      cards = f.cards.filter(c => cardIds.has(c.id) || groupIds.has(c.groupId)),
      ids = new Set(cards.map(c => c.id));
    if (!groups.length && !cards.length) return;
    app.clipboard = {
      groups: structuredClone(groups),
      cards: structuredClone(cards),
      edges: structuredClone(f.edges.filter(e => ids.has(e.from) && ids.has(e.to)))
    };
    toast(groups.length ? `領域${groups.length}件と子カードを含むカード${cards.length}件をコピーしました` : `${cards.length}件のカードをコピーしました`)
  }

  // 貼り付け。ID を振り直し、親子と線の参照を付け替える。一緒にコピーしていない親領域は、
  // 貼り付け先のフローにあればその領域のまま、無ければ貼り付けた位置で所属を決める。
  function pasteSelected() {
    const clip = structuredClone(app.clipboard);
    if (!clip || !clip.cards.length && !clip.groups.length) return;
    history();
    const idMap = new Map(),
      groupMap = new Map();
    clip.groups.forEach(g => {
      const old = g.id;
      g.id = uid("group");
      g.x = grid25(g.x + 25);
      g.y = grid25(g.y + 25);
      g.w = grid25(g.w);
      g.h = grid25(g.h);
      g.locked = false;
      groupMap.set(old, g.id);
      flow().groups.push(g)
    });
    clip.cards.forEach(c => {
      const old = c.id;
      c.id = uid("card");
      c.x = grid25(c.x + 25);
      c.y = grid25(c.y + 25);
      c.w = Math.max(150, grid25(c.w || cardWidth(c)));
      c.h = Math.max(75, grid25(c.h || cardHeight(c)));
      c.groupId = groupMap.get(c.groupId) || (group(c.groupId) ? c.groupId : "");
      if (!c.groupId) assignCardToGroup(c);
      idMap.set(old, c.id);
      flow().cards.push(c)
    });
    clip.edges.forEach(e => {
      const from = idMap.get(e.from),
        to = idMap.get(e.to);
      if (from && to) flow().edges.push({
        ...e,
        id: uid("edge"),
        from,
        to
      })
    });
    // 選択は貼り付けた要素だけにする（元の要素が選択に残ると、直後の Delete で元のほうが消える）
    // 領域の子カードは領域と一緒に動くので、選択には領域と、領域に属さないカードだけを入れる
    const pastedGroups = [...groupMap.values()],
      looseCards = clip.cards.filter(c => !pastedGroups.includes(c.groupId)).map(c => c.id);
    app.multiSelected.clear();
    app.multiGroups.clear();
    pastedGroups.forEach(id => app.multiGroups.add(id));
    looseCards.forEach(id => app.multiSelected.add(id));
    app.selected = pastedGroups.length ? {
      type: "group",
      id: pastedGroups[0]
    } : {
      type: "card",
      id: looseCards[0]
    };
    persist();
    render();
    toast(pastedGroups.length ? `領域${pastedGroups.length}件とカード${clip.cards.length}件を貼り付けました` : `${clip.cards.length}件のカードを貼り付けました`)
  }

  function jumpToCard(id) {
    const c = card(id),
      vp = $("#viewport").getBoundingClientRect(),
      center = canvasCenterScreen();
    app.view.x = center.x - vp.left - (c.x + cardWidth(c) / 2) * app.view.zoom;
    app.view.y = center.y - vp.top - (c.y + cardHeight(c) / 2) * app.view.zoom;
    app.multiSelected.clear();
    app.multiGroups.clear();
    app.multiSelected.add(id);
    app.selected = {
      type: "card",
      id
    };
    updateTransform();
    updateSelectionView()
  }

  function exportBounds() {
    const f = flow(),
      boxes = [];
    if (f.timeline.enabled) {
      const m = timelineMetrics();
      boxes.push({
        x: f.timeline.x,
        y: f.timeline.y,
        w: m.width,
        h: m.height
      })
    }
    f.groups.forEach(g => boxes.push({
      x: g.x,
      y: g.y,
      w: g.w,
      h: g.h
    }));
    f.cards.forEach(c => boxes.push({
      x: c.x,
      y: c.y,
      w: cardWidth(c),
      h: cardHeight(c)
    }));
    // 線（大きいループ・自己ループを含む）とラベル。ベジェ曲線は制御点を囲む矩形に必ず収まるので、その矩形を含める
    f.edges.forEach(e => {
      const a = card(e.from),
        b = card(e.to);
      if (!a || !b) return;
      const g = edgeGeometry(e, a, b),
        n = g.d.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi).map(Number),
        xs = n.filter((_, i) => i % 2 === 0),
        ys = n.filter((_, i) => i % 2 === 1),
        x = Math.min(...xs),
        y = Math.min(...ys);
      boxes.push({
        x,
        y,
        w: Math.max(...xs) - x,
        h: Math.max(...ys) - y
      });
      if (e.label) boxes.push({
        x: g.lx - 110,
        y: g.ly - 14,
        w: 220,
        h: 28
      })
    });
    if (!boxes.length) return {
      x: -80,
      y: -80,
      w: 800,
      h: 500
    };
    const pad = 220,
      minX = Math.min(...boxes.map(b => b.x)) - pad,
      minY = Math.min(...boxes.map(b => b.y)) - pad,
      maxX = Math.max(...boxes.map(b => b.x + b.w)) + pad,
      maxY = Math.max(...boxes.map(b => b.y + b.h)) + pad;
    return {
      x: Math.floor(minX),
      y: Math.floor(minY),
      w: Math.ceil(maxX - minX),
      h: Math.ceil(maxY - minY)
    }
  }

  function safeFileName(value) {
    return String(value || "フローチャート").replace(/[\\/:*?"<>|]/g, "_").trim() || "フローチャート"
  }
  function pngRound(ctx, x, y, w, h, r = 14) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
  }

  function pngText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
    const chars = [...String(text || "")],
      lines = [];
    let line = "";
    for (const ch of chars) {
      if (ch === "\n") {
        lines.push(line);
        line = "";
        continue
      }
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch
      } else line += ch
    }
    if (line) lines.push(line);
    lines.slice(0, maxLines).forEach((s, i) => {
      const last = i === maxLines - 1 && lines.length > maxLines ? s.replace(/.$/, "…") : s;
      ctx.fillText(last, x, y + i * lineHeight)
    })
  }

  function pngTimeline(ctx) {
    const t = flow().timeline;
    if (!t.enabled) return;
    const m = timelineMetrics();
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = "rgba(7,12,20,.94)";
    ctx.strokeStyle = "rgba(102,231,245,.28)";
    ctx.lineWidth = 1;
    pngRound(ctx, 0, 0, m.width, m.height, 16);
    ctx.fill();
    ctx.stroke();
    ctx.font = "700 15px 'Yu Gothic UI',Meiryo,sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#dce9f7";
    for (let i = 0; i < t.monthCount; i++) {
      const x = m.colX[i],
        w = t.colWidths[i];
      ctx.strokeRect(x, 0, w, m.headH);
      ctx.textAlign = "center";
      ctx.fillText(timelineColumnLabel(i), x + w / 2, m.headH / 2);
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, m.headH);
      ctx.lineTo(x + w / 2, m.height);
      ctx.stroke();
      ctx.setLineDash([])
    }
    ctx.font = "700 13px 'Yu Gothic UI',Meiryo,sans-serif";
    t.rows.forEach((row, i) => {
      const y = m.rowY[i],
        h = t.rowHeights[i],
        rowColor = t.rowColors[i] || COLORS[i % COLORS.length];
      ctx.fillStyle = `${rowColor}0d`;
      ctx.fillRect(0, y, m.width, h);
      ctx.fillStyle = "rgba(14,25,40,.88)";
      ctx.fillRect(0, y, m.labelW, h);
      ctx.fillStyle = rowColor;
      ctx.fillRect(0, y, 3, h);
      ctx.strokeStyle = "rgba(102,231,245,.28)";
      ctx.strokeRect(0, y, m.width, h);
      ctx.fillStyle = "#dce9f7";
      ctx.textAlign = "left";
      ctx.save();
      ctx.textBaseline = "top";
      pngText(ctx, row, 20, y + 16, m.labelW - 42, 18, Math.max(1, Math.floor((h - 24) / 18)));
      ctx.restore()
    });
    ctx.restore()
  }

  function pngGroups(ctx) {
    flow().groups.forEach(g => {
      ctx.fillStyle = `${g.color}12`;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(g.locked ? [7, 5] : []);
      pngRound(ctx, g.x, g.y, g.w, g.h, 24);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = g.color;
      ctx.font = "700 12px 'Yu Gothic UI',Meiryo,sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(g.name, g.x + 18, g.y + 14)
    })
  }

  function pngEdges(ctx) {
    flow().edges.forEach(e => {
      const a = card(e.from),
        b = card(e.to);
      if (!a || !b) return;
      const g = edgeGeometry(e, a, b),
        kind = e.kind || "normal",
        color = e.color || COLORS[0];
      ctx.strokeStyle = color;
      ctx.lineWidth = kind === "normal" ? 2 : 2.5;
      ctx.setLineDash(kind === "self" ? [4, 6] : kind === "normal" ? [] : [9, 7]);
      ctx.stroke(new Path2D(g.d));
      ctx.setLineDash([]);
      let x2, y2, angle;
      if (kind === "loopTop") {
        x2 = b.x + cardWidth(b) / 2;
        y2 = b.y;
        angle = Math.PI / 2
      } else if (kind === "loopBottom") {
        x2 = b.x + cardWidth(b) / 2;
        y2 = b.y + cardHeight(b);
        angle = -Math.PI / 2
      } else if (kind === "self") {
        x2 = a.x + cardWidth(a) - 24;
        y2 = a.y;
        angle = Math.PI
      } else {
        const p = pathPoints(a, b);
        x2 = p.x2;
        y2 = p.y2;
        angle = 0
      }
      const size = 10;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - size * Math.cos(angle - .5), y2 - size * Math.sin(angle - .5));
      ctx.lineTo(x2 - size * Math.cos(angle + .5), y2 - size * Math.sin(angle + .5));
      ctx.closePath();
      ctx.fill();
      if (e.label) {
        const {
          w,
          shown
        } = edgeLabelBox(e.label);
        ctx.fillStyle = "#0d1420";
        ctx.strokeStyle = "rgba(185,209,239,.35)";
        pngRound(ctx, g.lx - w / 2, g.ly - 14, w, 28, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#dce9f7";
        ctx.font = "12px 'Yu Gothic UI',Meiryo,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(shown, g.lx, g.ly)
      }
    })
  }

  function pngCards(ctx) {
    flow().cards.forEach(c => {
      const color = cardVisualColor(c),
        w = cardWidth(c),
        h = cardHeight(c);
      ctx.fillStyle = "#151f2e";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      pngRound(ctx, c.x, c.y, w, h, 15);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(c.x, c.y + 12, 3, Math.max(20, h - 24));
      ctx.fillStyle = "#edf6ff";
      ctx.font = "700 15px 'Yu Gothic UI',Meiryo,sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      pngText(ctx, c.title, c.x + 16, c.y + 15, w - 38, 19, 2);
      if (!c.collapsed && c.body) {
        ctx.fillStyle = "#aebbd0";
        ctx.font = "12px 'Yu Gothic UI',Meiryo,sans-serif";
        pngText(ctx, c.body, c.x + 16, c.y + 45, w - 32, 17, Math.max(1, Math.floor((h - 58) / 17)))
      }
      ctx.fillStyle = "#0d1420";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x + w, c.y + h / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke()
    })
  }

  // 図全体を Canvas に描く（PNG保存と AI 用 ZIP で共用）。範囲が大きすぎる場合は例外。
  function paintFlowCanvas() {
    const bounds = exportBounds();
    if (bounds.w > 32767 || bounds.h > 32767 || bounds.w * bounds.h > 120000000) throw Error("PNG範囲が大きすぎます。図を小さく分けてください");
    const canvas = document.createElement("canvas");
    canvas.width = bounds.w;
    canvas.height = bounds.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("PNG作成に失敗しました");
    ctx.fillStyle = "#07090f";
    ctx.fillRect(0, 0, bounds.w, bounds.h);
    ctx.save();
    ctx.translate(-bounds.x, -bounds.y);
    ctx.strokeStyle = "rgba(125,166,220,.055)";
    ctx.lineWidth = 1;
    for (let x = Math.floor(bounds.x / 36) * 36; x < bounds.x + bounds.w; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, bounds.y);
      ctx.lineTo(x, bounds.y + bounds.h);
      ctx.stroke()
    }
    for (let y = Math.floor(bounds.y / 36) * 36; y < bounds.y + bounds.h; y += 36) {
      ctx.beginPath();
      ctx.moveTo(bounds.x, y);
      ctx.lineTo(bounds.x + bounds.w, y);
      ctx.stroke()
    }
    pngTimeline(ctx);
    pngGroups(ctx);
    pngEdges(ctx);
    pngCards(ctx);
    ctx.restore();
    return {
      canvas,
      bounds
    }
  }

  function createFlowPngBlob() {
    let painted;
    try {
      painted = paintFlowCanvas()
    } catch (e) {
      return Promise.reject(e)
    }
    return new Promise((resolve, reject) => painted.canvas.toBlob(blob => blob ? resolve({
      blob,
      bounds: painted.bounds
    }) : reject(Error("PNG作成に失敗しました")), "image/png"))
  }

  async function exportPng() {
    const name = `${safeFileName(flow().name)}-全体.png`;
    try {
      const {
        blob,
        bounds
      } = await createFlowPngBlob();
      downloadBlob(blob, name);
      toast(`PNGを書き出しました（${bounds.w}×${bounds.h}px）`)
    } catch (e) {
      toast(e.message || "PNG作成に失敗しました")
    }
  }

  function aiCardPosition(c) {
    const f = flow();
    if (!f.timeline.enabled) {
      const ordered = [...f.cards].sort((a, b) => a.x - b.x || a.y - b.y),
        index = ordered.findIndex(x => x.id === c.id) + 1;
      return `自由配置（左から${index}番目）`
    }
    const m = timelineMetrics(),
      right = c.x + cardWidth(c),
      bottom = c.y + cardHeight(c),
      periods = [],
      rows = [],
      tx = f.timeline.x,
      ty = f.timeline.y;
    for (let i = 0; i < f.timeline.monthCount; i++)
      if (right > tx + m.colX[i] && c.x < tx + m.colX[i + 1]) periods.push(timelineColumnLabel(i));
    for (let i = 0; i < f.timeline.rows.length; i++)
      if (bottom > ty + m.rowY[i] && c.y < ty + m.rowY[i + 1]) rows.push(f.timeline.rows[i]);
    return `${periods.length?periods.join("〜"):"時系列軸外"}／${rows.length?rows.join("・"):"項目軸外"}`
  }

  function mdText(value) {
    return String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "／").trim()
  }

  function mermaidText(value) {
    return mdText(value).replace(/["[\]{}]/g, "").slice(0, 80)
  }

  function buildAiContext() {
    const f = flow(),
      cards = [...f.cards].sort((a, b) => a.x - b.x || a.y - b.y),
      groups = [...f.groups].sort((a, b) => a.x - b.x || a.y - b.y),
      cardIds = new Map(cards.map((c, i) => [c.id, `C${String(i+1).padStart(2,"0")}`])),
      groupIds = new Map(groups.map((g, i) => [g.id, `G${String(i+1).padStart(2,"0")}`])),
      incoming = new Map(cards.map(c => [c.id, 0])),
      outgoing = new Map(cards.map(c => [c.id, 0])),
      // 存在しないカードを指す線は、件数・一覧・図のどれにも含めない
      edges = f.edges.filter(e => cardIds.has(e.from) && cardIds.has(e.to));
    edges.forEach(e => {
      incoming.set(e.to, incoming.get(e.to) + 1);
      outgoing.set(e.from, outgoing.get(e.from) + 1)
    });
    const lines = [`# ${mdText(f.name)}`, "", "> Flow FragmentsからAI相談用に書き出した文脈です。構造化された接続情報を主に読み、FLOW.pngで位置関係と領域の広がりを補完してください。", "", `- 書き出し日時: ${new Date().toLocaleString("ja-JP")}`, `- カード: ${cards.length}件`, `- 接続: ${edges.length}件`, `- グループ: ${groups.length}件`, ""];
    if (f.timeline.enabled) {
      lines.push("## 軸の意味", "", `- 横軸: ${Array.from({length:f.timeline.monthCount},(_,i)=>timelineColumnLabel(i)).map(mdText).join("／")}`, `- 縦軸: ${f.timeline.rows.map(mdText).join("／")}`, `- 行の色: ${f.timeline.rows.map((row,i)=>`${mdText(row)}=${f.timeline.rowColors[i]||COLORS[i%COLORS.length]}`).join("／")}`, "- カードが複数の期間・項目にまたがる場合は、該当範囲をすべて記載しています。", "")
    } else lines.push("## 配置の意味", "", "- 自由配置キャンバスです。カードの左右関係を大まかな進行順として記載しています。", "");
    lines.push("## グループ", "");
    if (!groups.length) lines.push("- グループなし", "");
    groups.forEach(g => {
      const members = cards.filter(c => c.groupId === g.id).map(c => cardIds.get(c.id));
      lines.push(`### ${groupIds.get(g.id)}: ${mdText(g.name)}`, `- 子カード: ${members.length?members.join("、"):"なし"}`, `- 色: ${g.color||"未設定"}`, `- ロック: ${g.locked?"あり":"なし"}`, "")
    });
    lines.push("## カード", "");
    cards.forEach(c => {
      const parent = group(c.groupId);
      lines.push(`### ${cardIds.get(c.id)}: ${mdText(c.title)}`, `- 位置: ${aiCardPosition(c)}`, `- グループ: ${parent?`${groupIds.get(parent.id)} ${mdText(parent.name)}`:"なし"}`, `- 表示色: ${cardVisualColor(c)}`, `- タグ: ${c.tags.length?c.tags.map(t=>`#${mdText(t)}`).join("、"):"なし"}`, `- メモ: ${c.body?mdText(c.body):"なし"}`, `- 入ってくる接続: ${incoming.get(c.id)||0}本`, `- 出ていく接続: ${outgoing.get(c.id)||0}本`, "")
    });
    lines.push("## 接続関係", "");
    if (!edges.length) lines.push("- 接続なし", "");
    const kindNames = {
      normal: "通常フロー",
      loopTop: "上側の戻りループ",
      loopBottom: "下側の差し戻し",
      self: "自己ループ"
    };
    edges.forEach((e, i) => {
      const from = cardIds.get(e.from),
        to = cardIds.get(e.to);
      lines.push(`${i+1}. ${from}「${mdText(card(e.from)?.title)}」 → ${to}「${mdText(card(e.to)?.title)}」`, `   - 種類: ${kindNames[e.kind||"normal"]||e.kind}`, `   - 条件・説明: ${e.label?mdText(e.label):"記載なし"}`)
    });
    const starts = cards.filter(c => !incoming.get(c.id)),
      ends = cards.filter(c => !outgoing.get(c.id)),
      branches = cards.filter(c => outgoing.get(c.id) > 1),
      merges = cards.filter(c => incoming.get(c.id) > 1),
      isolated = cards.filter(c => !incoming.get(c.id) && !outgoing.get(c.id)),
      loops = edges.filter(e => (e.kind || "normal") !== "normal");
    lines.push("", "## 構造上の特徴", "", `- 開始候補: ${starts.length?starts.map(c=>`${cardIds.get(c.id)}「${mdText(c.title)}」`).join("、"):"なし"}`, `- 終了候補: ${ends.length?ends.map(c=>`${cardIds.get(c.id)}「${mdText(c.title)}」`).join("、"):"なし"}`, `- 分岐元: ${branches.length?branches.map(c=>`${cardIds.get(c.id)}（${outgoing.get(c.id)}経路）`).join("、"):"なし"}`, `- 合流先: ${merges.length?merges.map(c=>`${cardIds.get(c.id)}（${incoming.get(c.id)}経路）`).join("、"):"なし"}`, `- ループ接続: ${loops.length}本`, `- 孤立カード: ${isolated.length?isolated.map(c=>cardIds.get(c.id)).join("、"):"なし"}`, "", "## Mermaid形式の接続図", "", "> 以下は接続構造を機械的に確認するための図です。実際の空間配置はFLOW.pngを参照してください。", "", "```mermaid", "flowchart LR");
    cards.forEach(c => lines.push(`  ${cardIds.get(c.id)}["${mermaidText(c.title)}"]`));
    edges.forEach(e => {
      const from = cardIds.get(e.from),
        to = cardIds.get(e.to),
        loop = (e.kind || "normal") !== "normal",
        label = mermaidText(e.label || (loop ? kindNames[e.kind] : ""));
      lines.push(`  ${from} ${loop?"-.->":"-->"}${label?`|"${label}"|`:""} ${to}`)
    });
    lines.push("```", "", "## 添付ファイル", "", "- `FLOW.png`: 位置関係、グループ範囲、時系列上の距離を視覚的に確認する画像", "- `FLOW_DATA.json`: 座標やサイズを含む現在のフローの詳細データ", "");
    return lines.join("\n")
  }

  function buildAiJson() {
    const f = flow(),
      cards = [...f.cards].sort((a, b) => a.x - b.x || a.y - b.y);
    return JSON.stringify({
      schema: "flow-fragments-ai-context-v1",
      generatedAt: new Date().toISOString(),
      flow: structuredClone(f),
      semanticCardIds: Object.fromEntries(cards.map((c, i) => [c.id, `C${String(i+1).padStart(2,"0")}`]))
    }, null, 2)
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }
  let zipCrcTable = null;

  function zipCrc(data) {
    if (!zipCrcTable) zipCrcTable = Array.from({
      length: 256
    }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0
    });
    let crc = 0xffffffff;
    for (const byte of data) crc = zipCrcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0
  }

  function zipHeader(size) {
    const bytes = new Uint8Array(size);
    return {
      bytes,
      view: new DataView(bytes.buffer)
    }
  }

  function zipSet16(v, o, n) {
    v.setUint16(o, n, true)
  }

  function zipSet32(v, o, n) {
    v.setUint32(o, n >>> 0, true)
  }
  async function createZip(entries) {
    const enc = new TextEncoder(),
      parts = [],
      central = [];
    let offset = 0;
    const now = new Date(),
      dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1),
      dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const entry of entries) {
      const name = enc.encode(entry.name),
        data = entry.data instanceof Blob ? new Uint8Array(await entry.data.arrayBuffer()) : entry.data instanceof Uint8Array ? entry.data : enc.encode(String(entry.data)),
        crc = zipCrc(data),
        local = zipHeader(30);
      zipSet32(local.view, 0, 0x04034b50);
      zipSet16(local.view, 4, 20);
      zipSet16(local.view, 6, 0x0800);
      zipSet16(local.view, 8, 0);
      zipSet16(local.view, 10, dosTime);
      zipSet16(local.view, 12, dosDate);
      zipSet32(local.view, 14, crc);
      zipSet32(local.view, 18, data.length);
      zipSet32(local.view, 22, data.length);
      zipSet16(local.view, 26, name.length);
      parts.push(local.bytes, name, data);
      const center = zipHeader(46);
      zipSet32(center.view, 0, 0x02014b50);
      zipSet16(center.view, 4, 20);
      zipSet16(center.view, 6, 20);
      zipSet16(center.view, 8, 0x0800);
      zipSet16(center.view, 10, 0);
      zipSet16(center.view, 12, dosTime);
      zipSet16(center.view, 14, dosDate);
      zipSet32(center.view, 16, crc);
      zipSet32(center.view, 20, data.length);
      zipSet32(center.view, 24, data.length);
      zipSet16(center.view, 28, name.length);
      zipSet32(center.view, 42, offset);
      central.push(center.bytes, name);
      offset += 30 + name.length + data.length
    }
    const centralSize = central.reduce((n, p) => n + p.length, 0),
      end = zipHeader(22);
    zipSet32(end.view, 0, 0x06054b50);
    zipSet16(end.view, 8, entries.length);
    zipSet16(end.view, 10, entries.length);
    zipSet32(end.view, 12, centralSize);
    zipSet32(end.view, 16, offset);
    return new Blob([...parts, ...central, end.bytes], {
      type: "application/zip"
    })
  }
  async function exportAiPackage() {
    const button = $("#export-context"),
      old = button.textContent;
    button.disabled = true;
    button.textContent = "作成中…";
    try {
      // Markdown・JSON・ファイル名は PNG を作る待ち時間より前に確定させ、3つを同じ時点の内容にそろえる
      const markdown = buildAiContext(),
        json = buildAiJson(),
        name = `${safeFileName(flow().name)}-AI文脈.zip`,
        png = (await createFlowPngBlob()).blob,
        zip = await createZip([{
          name: "AI_CONTEXT.md",
          data: markdown
        }, {
          name: "FLOW.png",
          data: png
        }, {
          name: "FLOW_DATA.json",
          data: json
        }]);
      downloadBlob(zip, name);
      toast("AI用の文脈一式を書き出しました")
    } catch (e) {
      toast(e.message || "文脈の書き出しに失敗しました")
    } finally {
      button.disabled = false;
      button.textContent = old;
      closeContextMenu()
    }
  }
  async function copyAiContext() {
    const text = buildAiContext();
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove()
    }
    toast("AI用文脈をコピーしました");
    closeContextMenu()
  }

  function exportAiMarkdown() {
    downloadBlob(new Blob([buildAiContext()], {
      type: "text/markdown;charset=utf-8"
    }), `${safeFileName(flow().name)}-AI_CONTEXT.md`);
    toast("Markdownを書き出しました");
    closeContextMenu()
  }

  function closeContextMenu() {
    const control = $("#context-export-control"),
      menu = $("#context-export-menu"),
      toggle = $("#context-menu-toggle");
    control?.classList.remove("open");
    menu?.classList.add("hidden");
    toggle?.setAttribute("aria-expanded", "false")
  }

  function initContextExport() {
    const control = $("#context-export-control"),
      menu = $("#context-export-menu"),
      toggle = $("#context-menu-toggle");
    $("#export-context").onclick = exportAiPackage;
    toggle.onclick = e => {
      e.stopPropagation();
      const open = menu.classList.toggle("hidden");
      control.classList.toggle("open", !open);
      toggle.setAttribute("aria-expanded", String(!open))
    };
    $$("[data-context-action]", menu).forEach(button => button.onclick = () => {
      const action = button.dataset.contextAction;
      if (action === "package") exportAiPackage();
      else if (action === "copy") copyAiContext();
      else if (action === "markdown") exportAiMarkdown();
      else if (action === "png") {
        exportPng();
        closeContextMenu()
      }
    });
    document.addEventListener("pointerdown", e => {
      if (!e.target.closest("#context-export-control")) closeContextMenu()
    })
  }

  function openFileDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(FILE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(FILE_STORE, {
        keyPath: "id"
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error)
    })
  }
  async function readRecentFiles() {
    try {
      const db = await openFileDb();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(FILE_STORE, "readonly").objectStore(FILE_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error)
      })
    } catch {
      return []
    }
  }
  async function storeRecentFile(entry) {
    try {
      const db = await openFileDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(FILE_STORE, "readwrite");
        tx.objectStore(FILE_STORE).put(entry);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error)
      })
    } catch {}
  }
  async function deleteRecentFile(id) {
    try {
      const db = await openFileDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(FILE_STORE, "readwrite");
        tx.objectStore(FILE_STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error)
      })
    } catch {}
  }

  // 現在の保存先を一覧から探す（id がまだ無いときは同じハンドルの項目で対応付ける）
  function renderRecentFiles() {
    const select = $("#recent-file-select"),
      current = app.recentFiles.find(x => x.id === app.currentFileId) || app.recentFiles.find(x => x.handle && x.handle === app.currentFileHandle);
    if (current) app.currentFileId = current.id;
    select.innerHTML = '<option value="">最近のファイル</option>' + app.recentFiles.map(x => `<option value="${attr(x.id)}">${esc(x.name)}</option>`).join("");
    select.value = current?.id || "";
    $("#forget-file").disabled = !select.value
  }
  // 最近のファイルへ登録する。保存先（currentFileHandle）の切替は呼び出し側が await の前に済ませ、ここでは一覧の id だけを対応付ける。
  async function rememberFile(handle) {
    let entry = null;
    for (const item of app.recentFiles) {
      try {
        if (item.handle && await handle.isSameEntry(item.handle)) {
          entry = item;
          break
        }
      } catch {}
    }
    if (!entry) entry = {
      id: uid("file"),
      name: handle.name,
      handle,
      updatedAt: Date.now()
    };
    entry.name = handle.name;
    entry.handle = handle;
    entry.updatedAt = Date.now();
    if (app.currentFileHandle === handle) app.currentFileId = entry.id;
    app.recentFiles = [entry, ...app.recentFiles.filter(x => x.id !== entry.id)].slice(0, 12);
    await storeRecentFile(entry);
    renderRecentFiles()
  }
  // 外部JSONの読込。検証・正規化が通った場合だけ状態を差し替える（失敗時は現在のデータをそのまま保つ）。
  // 旧状態への操作を先に終え、保存先は await を挟まずに状態と同時に切り替える（ハンドルの無いアップロードでは保存先なし）。
  // 読込前の状態は、保存先ごと Undo で戻せる。
  async function loadExternalState(file, handle = null) {
    let next = null;
    try {
      const data = JSON.parse(await file.text());
      if (data && data.app === "Flow Fragments") next = sanitizeState(data)
    } catch {
      next = null
    }
    if (!next) return toast("対応していないJSONです");
    app.activeDrag?.finish();
    pushHistory();
    app.state = next;
    app.currentFileHandle = handle;
    app.currentFileId = "";
    switchFlow(next.activeFlowId, {
      resetView: false
    });
    markFileSaved(file.name);
    persist();
    renderRecentFiles();
    render();
    if (handle) {
      try {
        await rememberFile(handle)
      } catch {}
    }
    $("#save-status").textContent = handle ? `${handle.name} を開いています` : "JSONを読み込みました";
    toast(`${file.name}を開きました`)
  }
  async function requestHandlePermission(handle, mode = "read") {
    if (!handle) return false;
    const opts = {
      mode
    };
    if ((await handle.queryPermission?.(opts)) === "granted") return true;
    return (await handle.requestPermission?.(opts)) === "granted"
  }
  async function openExternalFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await showOpenFilePicker({
          types: [{
            description: "Flow Fragments JSON",
            accept: {
              "application/json": [".json"]
            }
          }],
          multiple: false
        });
        await loadExternalState(await handle.getFile(), handle)
      } catch (e) {
        if (e.name !== "AbortError") toast("ファイルを開けませんでした")
      }
      return
    }
    $("#file-input").click()
  }
  // 最近のファイルを開く。開けなかったときは理由を知らせ、プルダウンの表示を今開いているファイルに戻す。
  async function openRecentFile(id) {
    const entry = app.recentFiles.find(x => x.id === id);
    try {
      if (!entry?.handle) return;
      if (!await requestHandlePermission(entry.handle, "read")) return toast("ファイルを開く権限がありません");
      await loadExternalState(await entry.handle.getFile(), entry.handle)
    } catch {
      toast("ファイルを開けませんでした（移動・削除された可能性があります）")
    } finally {
      renderRecentFiles()
    }
  }
  // 書き込む内容は保存を押した時点の状態で確定する。書き込み中に別のファイルへ切り替わった場合は、保存先を差し替えない。
  async function writeCurrentHandle(handle) {
    const state = app.state,
      data = JSON.stringify(state, null, 2),
      hash = fingerprint(state);
    if (!await requestHandlePermission(handle, "readwrite")) throw Error("permission");
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    markFileSaved(handle.name, hash);
    const same = app.state === state;
    if (same && app.currentFileHandle !== handle) {
      app.currentFileHandle = handle;
      app.currentFileId = ""
    }
    await rememberFile(handle);
    if (same) $("#save-status").textContent = `${handle.name} に保存済み`;
    toast(`${handle.name}に上書き保存しました`)
  }
  async function saveAsExternalFile() {
    if (window.showSaveFilePicker) {
      try {
        const handle = await showSaveFilePicker({
          suggestedName: `${safeFileName(flow().name)}.json`,
          types: [{
            description: "Flow Fragments JSON",
            accept: {
              "application/json": [".json"]
            }
          }]
        });
        await writeCurrentHandle(handle);
        return true
      } catch (e) {
        if (e.name !== "AbortError") toast("保存できませんでした");
        return false
      }
    }
    try {
      exportJson();
      return "downloaded"
    } catch {
      toast("保存できませんでした");
      return false
    }
  }
  async function saveExternalFile() {
    if (app.currentFileHandle) {
      try {
        await writeCurrentHandle(app.currentFileHandle);
        return true
      } catch (e) {
        if (e.name !== "AbortError") toast("上書きできません。別名保存を試してください");
        return false
      }
    }
    return await saveAsExternalFile()
  }
  async function forgetCurrentFile() {
    const id = $("#recent-file-select").value;
    if (!id) return;
    await deleteRecentFile(id);
    app.recentFiles = app.recentFiles.filter(x => x.id !== id);
    if (app.currentFileId === id) {
      app.currentFileId = "";
      app.currentFileHandle = null
    }
    renderRecentFiles();
    toast("プルダウンから削除しました")
  }
  async function initFileControls() {
    $("#new-file").onclick = newFile;
    $("#import-json").onclick = openExternalFile;
    $("#export-json").onclick = saveExternalFile;
    $("#save-as-json").onclick = saveAsExternalFile;
    $("#recent-file-select").onchange = e => e.target.value && openRecentFile(e.target.value);
    $("#forget-file").onclick = forgetCurrentFile;
    $("#file-input").onchange = e => {
      if (e.target.files[0]) loadExternalState(e.target.files[0]);
      e.target.value = ""
    };
    app.recentFiles = (await readRecentFiles()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 12);
    renderRecentFiles()
  }

  // 新規ファイル。直前の内容は BACKUP_KEY に1世代退避し、履歴にも保存先ごと積むので「元に戻す」で戻せる。
  function createBlankFile() {
    app.activeDrag?.finish();
    cancelAnimationFrame(app.edgeFrame);
    cancelAnimationFrame(app.panFrame);
    cancelAnimationFrame(app.timelineFrame);
    app.timelineFrame = 0;
    app.edgeDirty = null;
    const before = snapshot();
    try {
      localStorage.setItem(BACKUP_KEY, before)
    } catch {}
    pushHistory(before);
    const f = emptyFlow();
    app.state = {
      version: 1,
      app: "Flow Fragments",
      activeFlowId: f.id,
      flows: [f]
    };
    app.activeFlowId = f.id;
    app.currentFileId = "";
    app.currentFileHandle = null;
    app.selected = null;
    app.multiSelected.clear();
    app.multiGroups.clear();
    app.filterTag = "";
    app.clipboard = null;
    app.edgeDraft = null;
    app.edgeFrame = 0;
    app.panFrame = 0;
    app.edgeNodes.clear();
    app.view = {
      x: 90,
      y: 110,
      zoom: 1
    };
    $("#quick-text").value = "";
    $("#file-input").value = "";
    document.body.classList.remove("is-interacting");
    $("#viewport").classList.remove("panning");
    closeModal();
    closeContextMenu();
    renderRecentFiles();
    render();
    persist(true);
    $("#quick-text").focus();
    toast("新規ファイルを作成しました。前の内容は「元に戻す」で戻せます。JSONファイルへの保存は「保存」から行えます");
  }

  function newFile() {
    if (app.fileTransitionBusy) return;
    app.activeDrag?.finish();
    closeContextMenu();
    modal(`<div id="new-file-dialog" class="new-file-dialog" role="dialog" aria-modal="true" aria-labelledby="new-file-heading" tabindex="-1"><h2 id="new-file-heading">新規ファイルを作成</h2><p>現在開いている全フローを保存しますか？</p><p class="hint">新規作成すると、カード・線・グループのない空のフローに切り替わります。保存済みのJSONファイルは削除しません。保存せずに新規作成しても、「元に戻す」で今の内容に戻せます。</p><p class="hint">新しい内容はブラウザ内に自動保存され、次回も続きから開けます。JSONファイルには「保存」を押すまで保存されません。</p><p id="new-file-status" class="hint" role="status" aria-live="polite"></p><div class="modal-actions"><button id="cancel-new-file" data-close>キャンセル</button><button id="discard-new-file">保存せず新規作成</button><button id="save-new-file" class="primary">保存して新規作成</button></div></div>`);
    const dialog = $("#new-file-dialog"),
      save = $("#save-new-file"),
      status = $("#new-file-status");
    dialog.onkeydown = e => {
      e.stopPropagation();
      if (e.key === "Escape") closeModal();
      if (e.key === "Tab") {
        const buttons = $$("button:not(:disabled)", dialog),
          first = buttons[0],
          last = buttons[buttons.length - 1];
        if (!first) {
          e.preventDefault();
          return
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus()
        }
      }
    };
    $("#cancel-new-file").focus();
    $("#discard-new-file").onclick = createBlankFile;
    save.onclick = async () => {
      if (app.fileTransitionBusy) return;
      app.fileTransitionBusy = true;
      $$("button", dialog).forEach(b => b.disabled = true);
      dialog.focus();
      status.textContent = "現在のデータを保存しています…";
      let result = false;
      try {
        result = await saveExternalFile()
      } finally {
        app.fileTransitionBusy = false
      }
      if ($("#new-file-dialog") !== dialog) return;
      if (result === true) {
        createBlankFile();
        return
      }
      $$("button", dialog).forEach(b => b.disabled = false);
      save.focus();
      if (result === "downloaded") {
        status.textContent = "JSONのダウンロードを開始しました。保存できたことを確認してから新規作成してください。";
        save.textContent = "保存を確認して新規作成";
        save.onclick = createBlankFile;
      } else status.textContent = "保存は完了していません。現在のデータはそのまま残っています。";
    };
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(app.state, null, 2)], {
        type: "application/json"
      }),
      a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safeFileName(flow().name)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    markFileSaved(a.download);
    toast("JSONを書き出しました")
  }
  function newFlow() {
    modal(`<h2>新しいフローチャート</h2><label class="field"><span>名前</span><input id="new-flow-name" value="新しいフロー" autofocus></label><div class="modal-actions"><button data-close>キャンセル</button><button id="create-flow" class="primary">作成</button></div>`);
    $("#create-flow").onclick = () => {
      const f = emptyFlow($("#new-flow-name").value.trim() || "新しいフロー");
      history();
      app.state.flows.push(f);
      switchFlow(f.id);
      persist();
      closeModal();
      render()
    }
  }

  function deleteFlow() {
    if (app.state.flows.length === 1) return toast("最後のフローは削除できません");
    if (!confirm(`「${flow().name}」を削除しますか？`)) return;
    mutate(() => {
      app.state.flows = app.state.flows.filter(f => f.id !== app.activeFlowId);
      switchFlow(app.state.flows[0].id)
    })
  }

  function duplicateFlow() {
    app.activeDrag?.finish();
    history();
    const source = flow(),
      copy = structuredClone(source),
      groupMap = new Map(),
      cardMap = new Map();
    copy.id = uid("flow");
    copy.name = `${source.name} のコピー`;
    copy.createdAt = new Date().toISOString();
    copy.groups.forEach(g => {
      const old = g.id;
      g.id = uid("group");
      groupMap.set(old, g.id)
    });
    copy.cards.forEach(c => {
      const old = c.id;
      c.id = uid("card");
      c.groupId = groupMap.get(c.groupId) || "";
      cardMap.set(old, c.id)
    });
    copy.edges = copy.edges.map(e => ({
      ...e,
      id: uid("edge"),
      from: cardMap.get(e.from),
      to: cardMap.get(e.to)
    })).filter(e => e.from && e.to);
    app.state.flows.push(copy);
    switchFlow(copy.id);
    persist();
    render();
    toast("フローを複製しました")
  }

  function bind() {
    const vp = $("#viewport");
    // パン（空白ドラッグ）は installStablePan() で割り当てる
    vp.onwheel = e => {
      e.preventDefault();
      // ドラッグ中は倍率を変えない（移動量の換算がずれて、つかんだ要素が跳ぶため）
      if (app.activeDrag) return;
      const before = screenWorld(e.clientX, e.clientY),
        rect = vp.getBoundingClientRect(),
        z = Math.max(.3, Math.min(2.2, app.view.zoom * (e.deltaY > 0 ? .9 : 1.1)));
      app.view.zoom = z;
      app.view.x = e.clientX - rect.left - before.x * z;
      app.view.y = e.clientY - rect.top - before.y * z;
      updateTransform()
    };
    $("#quick-add").onsubmit = e => {
      e.preventDefault();
      const t = $("#quick-text").value;
      if (!t.trim()) return;
      addCard(t);
      $("#quick-text").value = ""
    };
    $("#quick-text").onkeydown = e => {
      if (e.ctrlKey && e.key === "Enter") $("#quick-add").requestSubmit()
    };
    $("#new-flow").onclick = newFlow;
    $("#add-group").onclick = addGroup;
    $("#timeline-toggle").onclick = toggleTimeline;
    $("#undo").onclick = undo;
    $("#redo").onclick = redo;
    // ファイル系（保存・開く・file-input）のハンドラは initFileControls で割り当てる
    $("#flow-title").onchange = e => mutate(() => flow().name = e.target.value.trim() || "名称未設定");
    window.onkeydown = e => {
      // ドラッグ中のショートカットは無視（再描画でドラッグ中の要素が差し替わるのを防ぐ）
      if (app.activeDrag) return;
      // 入力欄にフォーカスがある間は、Ctrl+Z 等をブラウザ標準の編集操作に任せる
      const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
      if (editing) return;
      const mod = e.ctrlKey || e.metaKey,
        key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo()
      } else if (mod && key === "y") {
        e.preventDefault();
        redo()
      } else if (mod && key === "c") {
        e.preventDefault();
        copySelected()
      } else if (mod && key === "v") {
        e.preventDefault();
        pasteSelected()
      } else if (e.key === "Delete") deleteSelection()
    };
    $("#modal-root").onclick = e => {
      if (e.target.matches(".modal-backdrop,[data-close]")) closeModal()
    }
  }

  // ロック中の領域はドラッグしても動かさず、選択だけして視点移動にする
  function selectLockedGroupAndPan(e, id) {
    if (e.button !== 0) return;
    if (e.shiftKey) return toggleShiftSelection("group", id);
    if (!app.multiGroups.has(id)) {
      app.multiSelected.clear();
      app.multiGroups.clear();
      app.multiGroups.add(id)
    }
    app.selected = {
      type: "group",
      id
    };
    updateSelectionView();
    startStablePan(e, false)
  }

  // 視点移動。描画は requestAnimationFrame にまとめ、終了条件は trackPointer に任せる。
  function startStablePan(e, clearSelection = false) {
    if (e.button !== 0) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    const vp = $("#viewport"),
      st = {
        x: e.clientX,
        y: e.clientY,
        vx: app.view.x,
        vy: app.view.y
      };
    if (clearSelection && (app.selected || app.multiSelected.size || app.multiGroups.size)) {
      app.selected = null;
      app.multiSelected.clear();
      app.multiGroups.clear();
      updateSelectionView()
    }
    vp.classList.add("panning");
    setInteracting(true);
    const paint = () => {
      app.panFrame = 0;
      updateTransform()
    };
    trackPointer(e, {
      capture: vp,
      onMove: ev => {
        app.view.x = st.vx + ev.clientX - st.x;
        app.view.y = st.vy + ev.clientY - st.y;
        if (!app.panFrame) app.panFrame = requestAnimationFrame(paint)
      },
      onEnd: () => {
        if (app.panFrame) {
          cancelAnimationFrame(app.panFrame);
          app.panFrame = 0
        }
        updateTransform();
        vp.classList.remove("panning");
        setInteracting(false)
      }
    })
  }

  // ホバー表示（領域の南京錠、表の＋ボタン）はフレームごとに1回だけ評価し、操作中は止める
  function scheduleHover(e) {
    app.hoverEvent = e;
    if (app.hoverFrame) return;
    app.hoverFrame = requestAnimationFrame(() => {
      app.hoverFrame = 0;
      const ev = app.hoverEvent;
      app.hoverEvent = null;
      if (!ev || app.activeDrag) return;
      updateTimelineProximity(ev);
      updateGroupHover(ev)
    })
  }

  function updateTimelineProximity(e) {
    const layer = $("#timeline-layer");
    if (!layer.classList.contains("timeline-grid")) return;
    const r = layer.getBoundingClientRect(),
      near = 58,
      scaleX = r.width / (parseFloat(layer.style.width) || r.width),
      scaleY = r.height / (parseFloat(layer.style.height) || r.height),
      labelRight = r.left + timelineMetrics().labelW * scaleX;
    layer.classList.toggle("near-right", Math.abs(e.clientX - r.right) <= near && e.clientY >= r.top - near && e.clientY <= r.bottom + near);
    layer.classList.toggle("near-bottom", Math.abs(e.clientY - r.bottom) <= near && e.clientX >= r.left - near && e.clientX <= labelRight + near);
    $$("[data-insert-row]", layer).forEach(button => {
      const boundary = r.top + Number(button.dataset.boundaryY) * scaleY;
      button.classList.toggle("near", Math.abs(e.clientY - boundary) <= 34 && e.clientX >= r.left - near && e.clientX <= labelRight + near)
    })
  }

  function installStablePan() {
    const vp = $("#viewport");
    vp.onpointerdown = e => {
      if (e.button !== 0 || e.target.closest(".flow-card,.group-box,[data-edge],button,input,textarea,select,.timeline-month,.timeline-row-label,.timeline-corner,.axis-resize")) return;
      if (e.target === vp || e.target === $("#world") || e.target.closest("#world")) startStablePan(e, true)
    };
    // 右ドラッグ接続の直後だけ、空白上のブラウザ右クリックメニューを出さない
    vp.oncontextmenu = e => {
      if (app.suppressContextMenuUntil > performance.now() || app.edgeDraft) e.preventDefault()
    };
    vp.addEventListener("pointermove", scheduleHover);
    vp.addEventListener("pointerleave", () => {
      app.hoverEvent = null;
      $("#timeline-layer").classList.remove("near-right", "near-bottom");
      $(".group-box.group-hovered")?.classList.remove("group-hovered")
    })
  }

  function bindMultiSelectionClear() {
    document.addEventListener("pointerdown", e => {
      if (e.target.closest("[data-edge]")) {
        app.multiSelected.clear();
        app.multiGroups.clear()
      }
      if (e.button === 0 && !e.shiftKey && (e.target === $("#viewport") || e.target === $("#world") || e.target.id === "edge-layer" || e.target.closest(".timeline-grid"))) {
        app.multiSelected.clear();
        app.multiGroups.clear()
      }
    }, true)
  }

  function updateTransform() {
    $("#world").style.transform = `translate(${app.view.x}px,${app.view.y}px) scale(${app.view.zoom})`
  }

  function canvasCenterScreen() {
    const r = $("#viewport").getBoundingClientRect(),
      inspector = $("#inspector"),
      covered = getComputedStyle(inspector).display === "none" ? 0 : inspector.getBoundingClientRect().width;
    return {
      x: r.left + (r.width - covered) / 2,
      y: r.top + r.height / 2
    }
  }

  function canvasCenter() {
    const p = canvasCenterScreen();
    return screenWorld(p.x, p.y)
  }

  function closeWorkspaceMenu(name) {
    $("#" + name + "-menu").classList.add("hidden");
    $("#" + name + "-menu-toggle").setAttribute("aria-expanded", "false")
  }

  function applyPanelState() {
    const root = $("#app");
    root.classList.toggle("sidebar-collapsed", app.ui.sidebarCollapsed);
    root.classList.toggle("inspector-collapsed", app.ui.inspectorCollapsed);
    [
      ["sidebar", "左", app.ui.sidebarCollapsed],
      ["inspector", "右", app.ui.inspectorCollapsed]
    ].forEach(([name, label, collapsed]) => {
      const button = $("#toggle-" + name),
        text = `${label}カラムを${collapsed?"開く":"閉じる"}`;
      button.title = text;
      button.setAttribute("aria-label", text);
      button.setAttribute("aria-expanded", String(!collapsed));
      button.textContent = name === "sidebar" ? (collapsed ? "›" : "‹") : (collapsed ? "‹" : "›")
    });
  }

  function initWorkspaceControls() {
    try {
      const ui = JSON.parse(localStorage.getItem(UI_KEY));
      if (ui) app.ui = {
        sidebarCollapsed: ui.sidebarCollapsed === true,
        inspectorCollapsed: ui.inspectorCollapsed === true
      }
    } catch {}
    applyPanelState();
    ["sidebar", "inspector"].forEach(name => $("#toggle-" + name).onclick = () => {
      app.activeDrag?.finish();
      app.ui[name + "Collapsed"] = !app.ui[name + "Collapsed"];
      applyPanelState();
      try {
        localStorage.setItem(UI_KEY, JSON.stringify(app.ui))
      } catch {}
    });
    ["flow", "file"].forEach(name => {
      const toggle = $("#" + name + "-menu-toggle"),
        menu = $("#" + name + "-menu");
      toggle.onclick = e => {
        e.stopPropagation();
        const open = menu.classList.contains("hidden");
        closeWorkspaceMenu("flow");
        closeWorkspaceMenu("file");
        closeContextMenu();
        if (open) {
          menu.classList.remove("hidden");
          toggle.setAttribute("aria-expanded", "true")
        }
      };
      menu.addEventListener("click", e => {
        if (e.target.closest("button") && !e.target.closest("#forget-file")) closeWorkspaceMenu(name)
      });
    });
    document.addEventListener("pointerdown", e => {
      ["flow", "file"].forEach(name => {
        if (!e.target.closest("#" + name + "-menu-control")) closeWorkspaceMenu(name)
      })
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        closeWorkspaceMenu("flow");
        closeWorkspaceMenu("file")
      }
    });
  }

  function screenWorld(x, y) {
    const r = $("#viewport").getBoundingClientRect();
    return {
      x: (x - r.left - app.view.x) / app.view.zoom,
      y: (y - r.top - app.view.y) / app.view.zoom
    }
  }

  function filtered(c) {
    return !app.filterTag || c.tags.includes(app.filterTag)
  }

  function sel(t, id) {
    return (t === "card" ? app.multiSelected : app.multiGroups).has(id) ? "selected" : app.selected?.type === t && app.selected.id === id ? "selected" : ""
  }

  function esc(v = "") {
    return String(v).replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    } [c]))
  }

  function attr(v = "") {
    return esc(v)
  }

  // 壊れた保存データを退避できなかったときの案内。元データは KEY に残したまま自動保存を止めている。
  // 「元データを書き出す」を押した後でだけ再開できる（再開すると KEY は現在の内容で上書きされる）。
  function showRecoveryFailure() {
    $("#save-status").textContent = BLOCKED_STATUS.recovery;
    modal(`<h2>ブラウザ内の保存データを読めませんでした</h2><p>保存データが壊れていて、退避用の場所（${esc(RECOVERY_KEY)}）にも保存できませんでした。元データを守るため、ブラウザ内の自動保存を止めています。</p><p class="hint">「元データを書き出す」でファイルに保存してから、自動保存を再開してください。再開すると、ブラウザ内の元データは現在の内容で上書きされます。閉じた場合も、JSONファイルへの「保存」は使えます。</p><div class="modal-actions"><button data-close>停止したまま閉じる</button><button id="download-broken">元データを書き出す</button><button id="resume-persist" class="primary" disabled>自動保存を再開</button></div>`);
    $("#download-broken").onclick = () => {
      downloadBlob(new Blob([app.recovery.raw], {
        type: "text/plain;charset=utf-8"
      }), "flow-fragments-読めなかった保存データ.txt");
      $("#resume-persist").disabled = false
    };
    $("#resume-persist").onclick = () => {
      app.persistBlocked = "";
      app.recovery = null;
      closeModal();
      persist(true);
      toast("ブラウザ内の自動保存を再開しました")
    }
  }

  // 別のタブ（ウィンドウ）が同じ保存データを書き換えたとき。このタブが自動保存を続けると相手の変更を消すので、
  // 自動保存を止め、最新の内容を読み込むか、このタブの内容で保存し直すかを選んでもらう（選ぶまでは編集のたびに案内する）。
  function bindOtherTabWatch() {
    window.addEventListener("storage", e => {
      if (e.storageArea !== localStorage) return;
      if (e.key === FILE_KEY) return updateFileStatus();
      if (e.key !== KEY || e.newValue == null) return;
      clearTimeout(app.saveTimer);
      app.saveTimer = 0;
      app.persistBlocked = "otherTab";
      $("#save-status").textContent = BLOCKED_STATUS.otherTab;
      if (!$("#other-tab-dialog")) showOtherTabDialog()
    })
  }

  function showOtherTabDialog() {
    modal(`<div id="other-tab-dialog"><h2>別のタブで内容が更新されました</h2><p>このツールが別のタブ（またはウィンドウ）でも開かれていて、そちらの変更がブラウザ内に保存されました。このタブで自動保存を続けるとそちらの変更を上書きしてしまうため、このタブの自動保存を止めています。</p><p class="hint">「最新の内容を読み込む」を選ぶと、別のタブで保存された内容に切り替わります。このタブの内容は「元に戻す」で戻せます。上書き保存先のJSONファイルの指定は解除されます。</p><p class="hint">「このタブの内容を保存」を選ぶと、別のタブで行った変更はブラウザ内の保存から消えます。</p><div class="modal-actions"><button id="keep-this-tab">このタブの内容を保存</button><button id="load-other-tab" class="primary">最新の内容を読み込む</button></div></div>`);
    $("#keep-this-tab").onclick = () => {
      app.persistBlocked = "";
      closeModal();
      persist(true);
      toast("このタブの内容をブラウザ内に保存しました")
    };
    $("#load-other-tab").onclick = () => {
      closeModal();
      adoptStoredState()
    }
  }

  // 別のタブが保存した内容に切り替える。ファイルを開くときと同じく、切替前の内容は「元に戻す」で戻せる。
  // 相手のタブの内容をこのタブのファイルへ上書きしないよう、上書き保存先は解除する。
  function adoptStoredState() {
    let next = null;
    try {
      next = sanitizeState(JSON.parse(localStorage.getItem(KEY)))
    } catch {}
    if (!next) return toast("最新の内容を読み込めませんでした");
    app.activeDrag?.finish();
    pushHistory();
    app.state = next;
    app.currentFileHandle = null;
    app.currentFileId = "";
    app.persistBlocked = "";
    clearTimeout(app.saveTimer);
    app.saveTimer = 0;
    switchFlow(next.activeFlowId, {
      resetView: false
    });
    renderRecentFiles();
    render();
    updateFileStatus();
    $("#save-status").textContent = "別のタブで保存された内容を読み込みました";
    toast("最新の内容を読み込みました")
  }

  function modal(html) {
    $("#modal-root").innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
    setTimeout(() => $("#modal-root input")?.focus())
  }

  function closeModal() {
    if (app.fileTransitionBusy) return;
    $("#modal-root").innerHTML = ""
  }

  function toast(s) {
    const n = document.createElement("div");
    n.className = "toast";
    n.textContent = s;
    $("#toast-root").appendChild(n);
    setTimeout(() => n.remove(), 2500)
  }
  load();
  bind();
  initWorkspaceControls();
  installStablePan();
  bindMultiSelectionClear();
  $("#export-png").onclick = exportPng;
  $("#duplicate-flow").onclick = duplicateFlow;
  $("#delete-flow").onclick = deleteFlow;
  initContextExport();
  window.addEventListener("pagehide", flushPersist);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushPersist()
  });
  render();
  updateFileStatus();
  bindOtherTabWatch();
  initFileControls();
  if (app.recovery?.saved) toast(`ブラウザ内の保存データが読めなかったため、サンプルから開始しました（元データは ${RECOVERY_KEY} に退避）`);
  else if (app.recovery) showRecoveryFailure();
})();