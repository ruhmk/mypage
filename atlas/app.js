(() => {
  "use strict";

  const SNAP = 128;
  const SCALE_OPTIONS = [1, 0.5, 0.25, 0.125, 0.0625];
  const els = {
    atlasSizeSelect: document.getElementById("atlasSizeSelect"),
    zoomSelect: document.getElementById("zoomSelect"),
    fitZoomBtn: document.getElementById("fitZoomBtn"),
    undoBtn: document.getElementById("undoBtn"),
    redoBtn: document.getElementById("redoBtn"),
    packBtn: document.getElementById("packBtn"),
    saveProjectBtn: document.getElementById("saveProjectBtn"),
    loadProjectBtn: document.getElementById("loadProjectBtn"),
    projectInput: document.getElementById("projectInput"),
    exportPngBtn: document.getElementById("exportPngBtn"),
    exportJsonBtn: document.getElementById("exportJsonBtn"),
    addImagesBtn: document.getElementById("addImagesBtn"),
    fileInput: document.getElementById("fileInput"),
    assetDropZone: document.getElementById("assetDropZone"),
    assetList: document.getElementById("assetList"),
    inspector: document.getElementById("inspector"),
    canvas: document.getElementById("atlasCanvas"),
    canvasWrap: document.getElementById("canvasWrap"),
    stageViewport: document.getElementById("stageViewport"),
    atlasLabel: document.getElementById("atlasLabel"),
    atlasMeta: document.getElementById("atlasMeta"),
    stageStats: document.getElementById("stageStats"),
    statusBar: document.getElementById("statusBar"),
  };

  const ctx = els.canvas.getContext("2d");
  const state = {
    atlasSize: 2048,
    zoom: 0.5,
    assets: [],
    placements: [],
    selected: null,
    pointerDrag: null,
    history: [],
    future: [],
    restoring: false,
  };

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function isPowerOfTwo(value) {
    return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
  }

  function formatScale(scale) {
    return `${Number((scale * 100).toFixed(3))}%`;
  }

  function sameScale(a, b) {
    return Math.abs(a - b) < 0.0001;
  }

  function normalizePixels(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.round(number));
  }

  function assetPadding(asset) {
    return normalizePixels(asset?.padding, 0);
  }

  function assetBleed(asset) {
    return normalizePixels(asset?.bleed, 0);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("File read failed."));
      reader.readAsDataURL(file);
    });
  }

  function loadImageSource(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image load failed."));
      image.src = src;
    });
  }

  function getAsset(assetId) {
    return state.assets.find((asset) => asset.id === assetId);
  }

  function getPlacement(placementId) {
    return state.placements.find((placement) => placement.id === placementId);
  }

  function getPlacementForAsset(assetId) {
    return state.placements.find((placement) => placement.assetId === assetId);
  }

  function getSelected() {
    if (!state.selected) return null;
    if (state.selected.type === "asset") return getAsset(state.selected.id);
    if (state.selected.type === "placement") return getPlacement(state.selected.id);
    return null;
  }

  function scaledSize(asset, scale) {
    return {
      width: Math.max(1, Math.round(asset.width * scale)),
      height: Math.max(1, Math.round(asset.height * scale)),
    };
  }

  function paddedSize(asset, scale) {
    const content = scaledSize(asset, scale);
    const padding = assetPadding(asset);
    return {
      width: content.width + padding * 2,
      height: content.height + padding * 2,
      contentWidth: content.width,
      contentHeight: content.height,
      padding,
    };
  }

  function setPlacementScale(placement, scale) {
    const asset = getAsset(placement.assetId);
    if (!asset) return;
    const size = paddedSize(asset, scale);
    placement.scale = scale;
    placement.width = size.width;
    placement.height = size.height;
  }

  function snapValue(value) {
    return Math.round(value / SNAP) * SNAP;
  }

  function snapCeil(value) {
    return Math.ceil(value / SNAP) * SNAP;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function placementRect(placement) {
    const asset = getAsset(placement.assetId);
    if (!asset) return { x: 0, y: 0, width: 0, height: 0 };
    const size = paddedSize(asset, placement.scale);
    return {
      x: placement.x,
      y: placement.y,
      width: placement.width || size.width,
      height: placement.height || size.height,
    };
  }

  function placementContentRect(placement) {
    const asset = getAsset(placement.assetId);
    const rect = placementRect(placement);
    const maxPadding = Math.max(0, Math.floor(Math.min(rect.width, rect.height) / 2) - 1);
    const padding = Math.min(assetPadding(asset), maxPadding);
    return {
      x: rect.x + padding,
      y: rect.y + padding,
      width: Math.max(1, rect.width - padding * 2),
      height: Math.max(1, rect.height - padding * 2),
      padding,
    };
  }

  function rectanglesOverlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  function clampPlacement(placement) {
    const rect = placementRect(placement);
    placement.x = clamp(snapValue(placement.x), 0, Math.max(0, state.atlasSize - rect.width));
    placement.y = clamp(snapValue(placement.y), 0, Math.max(0, state.atlasSize - rect.height));
  }

  function getCollisionIds() {
    const ids = new Set();
    for (let i = 0; i < state.placements.length; i += 1) {
      for (let j = i + 1; j < state.placements.length; j += 1) {
        const a = state.placements[i];
        const b = state.placements[j];
        if (rectanglesOverlap(placementRect(a), placementRect(b))) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }

  function overlapsAny(rect, excludePlacementId = null) {
    return state.placements.some((placement) => {
      if (placement.id === excludePlacementId) return false;
      return rectanglesOverlap(rect, placementRect(placement));
    });
  }

  function findFreePosition(width, height, preferred = null, excludePlacementId = null) {
    if (width > state.atlasSize || height > state.atlasSize) return null;

    if (preferred) {
      const px = clamp(snapValue(preferred.x), 0, state.atlasSize - width);
      const py = clamp(snapValue(preferred.y), 0, state.atlasSize - height);
      const preferredRect = { x: px, y: py, width, height };
      if (!overlapsAny(preferredRect, excludePlacementId)) return { x: px, y: py };
    }

    for (let y = 0; y <= state.atlasSize - height; y += SNAP) {
      for (let x = 0; x <= state.atlasSize - width; x += SNAP) {
        const rect = { x, y, width, height };
        if (!overlapsAny(rect, excludePlacementId)) return { x, y };
      }
    }
    return null;
  }

  function setStatus(message) {
    els.statusBar.textContent = message;
  }

  function makeSnapshot() {
    return {
      type: "atlas-snapper-project",
      version: 2,
      atlasSize: state.atlasSize,
      assets: state.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        dataUrl: asset.dataUrl || asset.url,
        width: asset.width,
        height: asset.height,
        defaultScale: asset.defaultScale,
        padding: assetPadding(asset),
        bleed: assetBleed(asset),
      })),
      placements: state.placements.map((placement) => ({
        id: placement.id,
        assetId: placement.assetId,
        x: placement.x,
        y: placement.y,
        scale: placement.scale,
        width: placement.width,
        height: placement.height,
      })),
      selected: state.selected ? { ...state.selected } : null,
    };
  }

  function updateHistoryButtons() {
    if (!els.undoBtn || !els.redoBtn) return;
    els.undoBtn.disabled = state.history.length <= 1;
    els.redoBtn.disabled = state.future.length === 0;
  }

  function pushHistory() {
    if (state.restoring) return;
    state.history.push(makeSnapshot());
    if (state.history.length > 40) state.history.shift();
    state.future = [];
    updateHistoryButtons();
  }

  function normalizeSnapshot(payload) {
    const atlasSize = Number(payload.atlasSize || payload.atlas?.width || 2048);
    return {
      atlasSize,
      assets: Array.isArray(payload.assets) ? payload.assets : [],
      placements: Array.isArray(payload.placements) ? payload.placements : [],
      selected: payload.selected || null,
    };
  }

  async function restoreSnapshot(payload) {
    const snapshot = normalizeSnapshot(payload);
    state.restoring = true;
    try {
      const assets = await Promise.all(
        snapshot.assets.map((asset) =>
          createAssetFromDataUrl(asset.dataUrl || asset.url, asset.name || "image.png", {
            id: asset.id,
            defaultScale: asset.defaultScale,
            padding: asset.padding,
            bleed: asset.bleed,
          }),
        ),
      );

      state.atlasSize = snapshot.atlasSize;
      els.atlasSizeSelect.value = String(snapshot.atlasSize);
      els.canvas.width = snapshot.atlasSize;
      els.canvas.height = snapshot.atlasSize;
      state.assets = assets;
      state.placements = snapshot.placements.map((placement) => ({
        id: placement.id || uid("placement"),
        assetId: placement.assetId,
        x: Number(placement.x) || 0,
        y: Number(placement.y) || 0,
        scale: Number(placement.scale) || 1,
        width: Number(placement.width) || undefined,
        height: Number(placement.height) || undefined,
      }));
      state.selected = snapshot.selected;
      state.placements.forEach(clampPlacement);
      applyZoom();
      renderAll();
    } finally {
      state.restoring = false;
      updateHistoryButtons();
    }
  }

  async function undo() {
    if (state.history.length <= 1) return;
    const current = state.history.pop();
    state.future.push(current);
    await restoreSnapshot(state.history[state.history.length - 1]);
    setStatus("元に戻しました。");
  }

  async function redo() {
    if (!state.future.length) return;
    const next = state.future.pop();
    state.history.push(next);
    await restoreSnapshot(next);
    setStatus("やり直しました。");
  }

  function setSelected(type, id) {
    state.selected = type && id ? { type, id } : null;
    renderAssetList();
    renderInspector();
    renderCanvas();
  }

  function setAtlasSize(size, recordHistory = true) {
    state.atlasSize = size;
    els.canvas.width = size;
    els.canvas.height = size;
    state.placements.forEach(clampPlacement);
    applyZoom();
    renderAll();
    if (recordHistory) pushHistory();
  }

  function applyZoom() {
    const cssSize = Math.max(64, Math.round(state.atlasSize * state.zoom));
    els.canvasWrap.style.width = `${cssSize}px`;
    els.canvasWrap.style.height = `${cssSize}px`;
  }

  function fitZoomToViewport() {
    const bounds = els.stageViewport.getBoundingClientRect();
    const target = Math.max(220, Math.min(bounds.width - 36, bounds.height - 36));
    const zoomPercent = clamp((target / state.atlasSize) * 100, 6.25, 100);
    const rounded = zoomPercent < 16 ? 12.5 : zoomPercent < 38 ? 25 : zoomPercent < 63 ? 50 : zoomPercent < 88 ? 75 : 100;
    state.zoom = rounded / 100;
    els.zoomSelect.value = String(rounded);
    applyZoom();
  }

  function canvasPointFromEvent(event) {
    const rect = els.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * state.atlasSize;
    const y = ((event.clientY - rect.top) / rect.height) * state.atlasSize;
    return { x, y };
  }

  function hitTestPlacement(point) {
    for (let i = state.placements.length - 1; i >= 0; i -= 1) {
      const placement = state.placements[i];
      const rect = placementRect(placement);
      if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) {
        return placement;
      }
    }
    return null;
  }

  async function createAssetFromDataUrl(dataUrl, name, options = {}) {
    const image = await loadImageSource(dataUrl);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const padding = normalizePixels(options.padding, 0);
    return {
      id: options.id || uid("asset"),
      name,
      url: dataUrl,
      dataUrl,
      image,
      width,
      height,
      defaultScale: Number(options.defaultScale) || 1,
      padding,
      bleed: Math.min(normalizePixels(options.bleed, 0), padding),
      powerOfTwo: isPowerOfTwo(width) && isPowerOfTwo(height),
    };
  }

  async function loadImageFile(file) {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      return createAssetFromDataUrl(dataUrl, file.name);
    } catch {
      throw new Error(`${file.name} を読み込めませんでした。`);
    }
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (!files.length) {
      setStatus("画像ファイルが見つかりませんでした。");
      return [];
    }

    const results = await Promise.allSettled(files.map(loadImageFile));
    const added = [];
    const failed = [];

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        state.assets.push(result.value);
        added.push(result.value);
      } else {
        failed.push(result.reason.message);
      }
    });

    renderAll();

    if (added.length) {
      setSelected("asset", added[0].id);
    }

    const warningCount = added.filter((asset) => !asset.powerOfTwo).length;
    const parts = [`${added.length}枚を追加しました。`];
    if (warningCount) parts.push(`${warningCount}枚は2のべき乗サイズではありません。`);
    if (failed.length) parts.push(`${failed.length}枚は読み込めませんでした。`);
    setStatus(parts.join(" "));
    if (added.length) pushHistory();
    return added;
  }

  function createPlacement(assetId, preferredPoint = null) {
    const asset = getAsset(assetId);
    if (!asset) return null;

    const existing = getPlacementForAsset(assetId);
    const size = paddedSize(asset, existing ? existing.scale : asset.defaultScale);
    const position = findFreePosition(size.width, size.height, preferredPoint, existing ? existing.id : null);
    if (!position) {
      setStatus(`${asset.name} を置ける空き領域がありません。縮小倍率か最終サイズを変更してください。`);
      return null;
    }

    if (existing) {
      existing.x = position.x;
      existing.y = position.y;
      clampPlacement(existing);
      setSelected("placement", existing.id);
      setStatus(`${asset.name} を ${existing.x}, ${existing.y} に移動しました。`);
      pushHistory();
      return existing;
    }

    const placement = {
      id: uid("placement"),
      assetId,
      x: position.x,
      y: position.y,
      scale: asset.defaultScale,
      width: size.width,
      height: size.height,
    };
    clampPlacement(placement);
    state.placements.push(placement);
    setSelected("placement", placement.id);
    setStatus(`${asset.name} を ${placement.x}, ${placement.y} に配置しました。`);
    pushHistory();
    return placement;
  }

  function inferScaleForSlot(asset, rect, fallbackScale) {
    const padding = assetPadding(asset);
    const scaleX = Math.max(1, rect.width - padding * 2) / asset.width;
    const scaleY = Math.max(1, rect.height - padding * 2) / asset.height;
    if (sameScale(scaleX, scaleY)) return scaleX;
    return fallbackScale;
  }

  function replacePlacementAsset(placementId, assetId) {
    const placement = getPlacement(placementId);
    const asset = getAsset(assetId);
    if (!placement || !asset) return null;

    if (placement.assetId === assetId) {
      setSelected("placement", placement.id);
      setStatus(`${asset.name} はすでにこの枠に配置されています。`);
      return placement;
    }

    const existingPlacement = getPlacementForAsset(assetId);
    if (existingPlacement && existingPlacement.id !== placement.id) {
      state.placements = state.placements.filter((item) => item.id !== existingPlacement.id);
    }

    const oldRect = placementRect(placement);
    const oldAsset = getAsset(placement.assetId);
    placement.assetId = assetId;
    placement.width = oldRect.width;
    placement.height = oldRect.height;
    placement.scale = inferScaleForSlot(asset, oldRect, placement.scale);
    clampPlacement(placement);
    setSelected("placement", placement.id);
    setStatus(`${oldAsset ? oldAsset.name : "画像"} の枠をそのまま ${asset.name} に差し替えました。`);
    pushHistory();
    return placement;
  }

  function removePlacement(placementId) {
    const placement = getPlacement(placementId);
    if (!placement) return;
    const asset = getAsset(placement.assetId);
    state.placements = state.placements.filter((item) => item.id !== placementId);
    setSelected("asset", placement.assetId);
    setStatus(`${asset ? asset.name : "画像"} をアトラスから外しました。`);
    pushHistory();
  }

  function deleteAsset(assetId) {
    const asset = getAsset(assetId);
    if (!asset) return;
    if (asset.url?.startsWith("blob:")) URL.revokeObjectURL(asset.url);
    state.assets = state.assets.filter((item) => item.id !== assetId);
    state.placements = state.placements.filter((item) => item.assetId !== assetId);
    setSelected(null, null);
    setStatus(`${asset.name} をリストから削除しました。`);
    pushHistory();
  }

  function autoPackUnplaced() {
    const candidates = state.assets
      .filter((asset) => !getPlacementForAsset(asset.id))
      .slice()
      .sort((a, b) => {
        const aSize = paddedSize(a, a.defaultScale);
        const bSize = paddedSize(b, b.defaultScale);
        return Math.max(bSize.width, bSize.height) - Math.max(aSize.width, aSize.height);
      });

    let placedCount = 0;
    let failedCount = 0;

    candidates.forEach((asset) => {
      const size = paddedSize(asset, asset.defaultScale);
      const position = findFreePosition(snapCeil(size.width), snapCeil(size.height));
      if (!position) {
        failedCount += 1;
        return;
      }
      state.placements.push({
        id: uid("placement"),
        assetId: asset.id,
        x: position.x,
        y: position.y,
        scale: asset.defaultScale,
        width: size.width,
        height: size.height,
      });
      placedCount += 1;
    });

    renderAll();
    if (placedCount) {
      const last = state.placements[state.placements.length - 1];
      setSelected("placement", last.id);
    }
    setStatus(`未配置画像を${placedCount}枚配置しました。${failedCount ? `${failedCount}枚は空き領域不足です。` : ""}`);
    if (placedCount) pushHistory();
  }

  function clearAtlas() {
    state.placements = [];
    setSelected(null, null);
    setStatus("アトラス上の配置をすべて外しました。画像リストは残っています。");
    pushHistory();
  }

  function drawPlacementImage(targetCtx, placement) {
    const asset = getAsset(placement.assetId);
    if (!asset) return;
    const content = placementContentRect(placement);
    const bleed = Math.min(assetBleed(asset), content.padding);
    const sourceWidth = asset.image.naturalWidth;
    const sourceHeight = asset.image.naturalHeight;

    targetCtx.save();
    targetCtx.imageSmoothingEnabled = true;

    if (bleed > 0) {
      targetCtx.drawImage(asset.image, 0, 0, 1, sourceHeight, content.x - bleed, content.y, bleed, content.height);
      targetCtx.drawImage(asset.image, sourceWidth - 1, 0, 1, sourceHeight, content.x + content.width, content.y, bleed, content.height);
      targetCtx.drawImage(asset.image, 0, 0, sourceWidth, 1, content.x, content.y - bleed, content.width, bleed);
      targetCtx.drawImage(asset.image, 0, sourceHeight - 1, sourceWidth, 1, content.x, content.y + content.height, content.width, bleed);
      targetCtx.drawImage(asset.image, 0, 0, 1, 1, content.x - bleed, content.y - bleed, bleed, bleed);
      targetCtx.drawImage(asset.image, sourceWidth - 1, 0, 1, 1, content.x + content.width, content.y - bleed, bleed, bleed);
      targetCtx.drawImage(asset.image, 0, sourceHeight - 1, 1, 1, content.x - bleed, content.y + content.height, bleed, bleed);
      targetCtx.drawImage(
        asset.image,
        sourceWidth - 1,
        sourceHeight - 1,
        1,
        1,
        content.x + content.width,
        content.y + content.height,
        bleed,
        bleed,
      );
    }

    targetCtx.drawImage(asset.image, content.x, content.y, content.width, content.height);
    targetCtx.restore();
  }

  function renderCanvas() {
    ctx.clearRect(0, 0, state.atlasSize, state.atlasSize);
    ctx.fillStyle = "#273949";
    ctx.fillRect(0, 0, state.atlasSize, state.atlasSize);

    drawGrid();
    if (!state.placements.length) drawEmptyHint();

    const collisionIds = getCollisionIds();

    state.placements.forEach((placement) => {
      const asset = getAsset(placement.assetId);
      if (!asset) return;
      const rect = placementRect(placement);
      ctx.save();
      drawPlacementImage(ctx, placement);
      ctx.lineWidth = 8;
      ctx.strokeStyle = collisionIds.has(placement.id) ? "#e25469" : "rgba(255, 255, 255, 0.78)";
      ctx.strokeRect(rect.x + 4, rect.y + 4, rect.width - 8, rect.height - 8);
      ctx.restore();
    });

    if (state.selected?.type === "placement") {
      const placement = getPlacement(state.selected.id);
      if (placement) {
        const rect = placementRect(placement);
        ctx.save();
        ctx.lineWidth = 12;
        ctx.strokeStyle = "#f0b44d";
        ctx.setLineDash([28, 16]);
        ctx.strokeRect(rect.x + 6, rect.y + 6, rect.width - 12, rect.height - 12);
        ctx.restore();
      }
    }

    updateStats(collisionIds);
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    for (let value = 0; value <= state.atlasSize; value += SNAP) {
      const strong = value % 512 === 0;
      ctx.strokeStyle = strong ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)";
      ctx.lineWidth = strong ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(value, 0);
      ctx.lineTo(value, state.atlasSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, value);
      ctx.lineTo(state.atlasSize, value);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEmptyHint() {
    ctx.save();
    const fontSize = state.atlasSize >= 2048 ? 96 : 52;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `700 ${fontSize}px "Yu Gothic UI", sans-serif`;
    ctx.textBaseline = "top";
    const lines = ["詰める先", "ここにドラッグアンドドロップ", "128pxスナップ"];
    lines.forEach((line, index) => {
      ctx.fillText(line, SNAP * 1.2, SNAP * 1.2 + index * fontSize * 1.55);
    });
    ctx.restore();
  }

  function updateStats(collisionIds = getCollisionIds()) {
    const total = state.assets.length;
    const placed = state.placements.length;
    const usedArea = state.placements.reduce((sum, placement) => {
      const rect = placementRect(placement);
      return sum + rect.width * rect.height;
    }, 0);
    const percent = total ? ((usedArea / (state.atlasSize * state.atlasSize)) * 100).toFixed(1) : "0.0";
    els.stageStats.textContent = `${placed} / ${total} 配置・${percent}% 使用${collisionIds.size ? `・重なり ${collisionIds.size}` : ""}`;
    els.atlasLabel.textContent = `${state.atlasSize} x ${state.atlasSize}`;
    els.atlasMeta.textContent = `${SNAP}px グリッド / 透明PNG出力`;
  }

  function renderAssetList() {
    els.assetList.innerHTML = "";

    if (!state.assets.length) {
      const empty = document.createElement("div");
      empty.className = "emptyState";
      empty.textContent = "まだ画像がありません。追加ボタン、またはこのパネルへのドロップで読み込めます。";
      els.assetList.append(empty);
      return;
    }

    state.assets.forEach((asset) => {
      const placement = getPlacementForAsset(asset.id);
      const item = document.createElement("div");
      item.className = "assetItem";
      item.dataset.assetId = asset.id;
      item.draggable = true;
      item.tabIndex = 0;
      if (state.selected?.type === "asset" && state.selected.id === asset.id) item.classList.add("selected");
      if (state.selected?.type === "placement" && placement?.id === state.selected.id) item.classList.add("selected");

      const image = document.createElement("img");
      image.src = asset.url;
      image.alt = asset.name;

      const meta = document.createElement("div");
      meta.className = "assetMeta";

      const name = document.createElement("strong");
      name.textContent = asset.name;
      name.title = asset.name;

      const size = document.createElement("span");
      size.textContent = `${asset.width} x ${asset.height} / 初期 ${formatScale(asset.defaultScale)}`;

      const badges = document.createElement("div");
      badges.className = "badges";
      const potBadge = document.createElement("span");
      potBadge.className = `badge ${asset.powerOfTwo ? "ok" : "warn"}`;
      potBadge.textContent = asset.powerOfTwo ? "2のべき乗" : "要確認";
      const placedBadge = document.createElement("span");
      placedBadge.className = `badge ${placement ? "ok" : ""}`;
      placedBadge.textContent = placement ? "配置済み" : "未配置";
      badges.append(potBadge, placedBadge);

      meta.append(name, size, badges);
      item.append(image, meta);

      item.addEventListener("click", () => {
        if (placement) {
          setSelected("placement", placement.id);
        } else {
          setSelected("asset", asset.id);
        }
      });
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (placement) setSelected("placement", placement.id);
          else createPlacement(asset.id);
        }
      });
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData("application/x-atlas-asset", asset.id);
        event.dataTransfer.setData("text/plain", asset.id);
      });

      els.assetList.append(item);
    });
  }

  function clearInspector() {
    els.inspector.innerHTML = "";
  }

  function createControlRow(labelText, control) {
    const row = document.createElement("div");
    row.className = "controlRow";
    const label = document.createElement("label");
    label.textContent = labelText;
    row.append(label, control);
    return row;
  }

  function createReadout(labelText, valueText) {
    const row = document.createElement("div");
    row.className = "controlRow";
    const label = document.createElement("div");
    label.className = "readoutLabel";
    label.textContent = labelText;
    const value = document.createElement("div");
    value.className = "readout";
    value.textContent = valueText;
    row.append(label, value);
    return row;
  }

  function createScaleSelect(value, onChange) {
    const select = document.createElement("select");
    const options = SCALE_OPTIONS.some((scale) => sameScale(scale, value)) ? SCALE_OPTIONS : [value, ...SCALE_OPTIONS];
    options.forEach((scale) => {
      const option = document.createElement("option");
      option.value = String(scale);
      option.textContent = `${formatScale(scale)} (${scale})`;
      if (sameScale(scale, value)) option.selected = true;
      select.append(option);
    });
    select.addEventListener("change", () => onChange(Number(select.value)));
    return select;
  }

  function createNumberInput(value, onChange, options = {}) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = String(options.step ?? SNAP);
    input.min = String(options.min ?? 0);
    if (options.max !== undefined) input.max = String(options.max);
    input.value = String(value);
    input.addEventListener("change", () => onChange(Number(input.value)));
    return input;
  }

  function updateAssetSpacing(assetId, nextValues) {
    const asset = getAsset(assetId);
    if (!asset) return;
    if (nextValues.padding !== undefined) asset.padding = normalizePixels(nextValues.padding, assetPadding(asset));
    if (nextValues.bleed !== undefined) asset.bleed = normalizePixels(nextValues.bleed, assetBleed(asset));
    asset.bleed = Math.min(assetBleed(asset), assetPadding(asset));

    const placement = getPlacementForAsset(assetId);
    if (placement) {
      setPlacementScale(placement, placement.scale);
      clampPlacement(placement);
    }

    renderAll();
    if (placement) setSelected("placement", placement.id);
    else setSelected("asset", asset.id);
    pushHistory();
  }

  function renderInspector() {
    clearInspector();
    const selected = getSelected();

    if (!selected) {
      const empty = document.createElement("div");
      empty.className = "emptyState";
      empty.textContent = "右の画像を選ぶと初期縮小倍率、アトラス上の画像を選ぶと座標と縮小倍率を編集できます。";
      els.inspector.append(empty);
      return;
    }

    if (state.selected.type === "asset") {
      renderAssetInspector(selected);
    } else {
      renderPlacementInspector(selected);
    }
  }

  function renderAssetInspector(asset) {
    const title = document.createElement("div");
    title.className = "inspectorTitle";
    const name = document.createElement("strong");
    name.textContent = asset.name;
    const subtitle = document.createElement("span");
    subtitle.textContent = "画像リスト";
    title.append(name, subtitle);

    const grid = document.createElement("div");
    grid.className = "inspectorGrid";
    grid.append(createReadout("元サイズ", `${asset.width} x ${asset.height}`));
    grid.append(createReadout("判定", asset.powerOfTwo ? "幅・高さとも2のべき乗です。" : "幅または高さが2のべき乗ではありません。"));
    grid.append(
      createControlRow(
        "初期倍率",
        createScaleSelect(asset.defaultScale, (scale) => {
          asset.defaultScale = scale;
          renderAll();
          setSelected("asset", asset.id);
          pushHistory();
        }),
      ),
    );
    const spacingPair = document.createElement("div");
    spacingPair.className = "pair";
    spacingPair.append(
      createControlRow(
        "Padding",
        createNumberInput(assetPadding(asset), (value) => updateAssetSpacing(asset.id, { padding: value }), { step: 1 }),
      ),
      createControlRow(
        "Bleed",
        createNumberInput(assetBleed(asset), (value) => updateAssetSpacing(asset.id, { bleed: value }), { step: 1 }),
      ),
    );
    grid.append(spacingPair);

    const previewSize = paddedSize(asset, asset.defaultScale);
    grid.append(createReadout("配置サイズ", `${previewSize.width} x ${previewSize.height}`));

    const actions = document.createElement("div");
    actions.className = "actionRow";
    const placeButton = document.createElement("button");
    placeButton.type = "button";
    placeButton.className = "primary";
    placeButton.textContent = getPlacementForAsset(asset.id) ? "配置済みを選択" : "空きに追加";
    placeButton.addEventListener("click", () => {
      const existing = getPlacementForAsset(asset.id);
      if (existing) setSelected("placement", existing.id);
      else createPlacement(asset.id);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", () => deleteAsset(asset.id));
    actions.append(placeButton, deleteButton);

    els.inspector.append(title, grid, actions);
  }

  function renderPlacementInspector(placement) {
    const asset = getAsset(placement.assetId);
    if (!asset) return;
    const rect = placementRect(placement);
    const content = placementContentRect(placement);
    const collisions = getCollisionIds();

    const title = document.createElement("div");
    title.className = "inspectorTitle";
    const name = document.createElement("strong");
    name.textContent = asset.name;
    const subtitle = document.createElement("span");
    subtitle.textContent = "アトラス上の配置";
    title.append(name, subtitle);

    const grid = document.createElement("div");
    grid.className = "inspectorGrid";
    grid.append(createReadout("元サイズ", `${asset.width} x ${asset.height}`));
    grid.append(createReadout("配置サイズ", `${rect.width} x ${rect.height}`));
    grid.append(createReadout("画像領域", `${content.width} x ${content.height}`));
    grid.append(createReadout("状態", collisions.has(placement.id) ? "ほかの画像と重なっています。" : "重なりはありません。"));

    const pair = document.createElement("div");
    pair.className = "pair";
    const xInput = createNumberInput(placement.x, (value) => {
      placement.x = value;
      clampPlacement(placement);
      renderAll();
      setSelected("placement", placement.id);
      pushHistory();
    });
    const yInput = createNumberInput(placement.y, (value) => {
      placement.y = value;
      clampPlacement(placement);
      renderAll();
      setSelected("placement", placement.id);
      pushHistory();
    });
    pair.append(createControlRow("X", xInput), createControlRow("Y", yInput));
    grid.append(pair);

    const spacingPair = document.createElement("div");
    spacingPair.className = "pair";
    spacingPair.append(
      createControlRow(
        "Padding",
        createNumberInput(assetPadding(asset), (value) => updateAssetSpacing(asset.id, { padding: value }), { step: 1 }),
      ),
      createControlRow(
        "Bleed",
        createNumberInput(assetBleed(asset), (value) => updateAssetSpacing(asset.id, { bleed: value }), { step: 1 }),
      ),
    );
    grid.append(spacingPair);

    grid.append(
      createControlRow(
        "縮小倍率",
        createScaleSelect(placement.scale, (scale) => {
          setPlacementScale(placement, scale);
          clampPlacement(placement);
          renderAll();
          setSelected("placement", placement.id);
          pushHistory();
        }),
      ),
    );

    const actions = document.createElement("div");
    actions.className = "actionRow";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "danger";
    removeButton.textContent = "アトラスから外す";
    removeButton.addEventListener("click", () => removePlacement(placement.id));

    const sendBackButton = document.createElement("button");
    sendBackButton.type = "button";
    sendBackButton.textContent = "背面へ";
    sendBackButton.addEventListener("click", () => {
      state.placements = state.placements.filter((item) => item.id !== placement.id);
      state.placements.unshift(placement);
      renderAll();
      setSelected("placement", placement.id);
      pushHistory();
    });

    const bringFrontButton = document.createElement("button");
    bringFrontButton.type = "button";
    bringFrontButton.textContent = "前面へ";
    bringFrontButton.addEventListener("click", () => {
      state.placements = state.placements.filter((item) => item.id !== placement.id);
      state.placements.push(placement);
      renderAll();
      setSelected("placement", placement.id);
      pushHistory();
    });

    actions.append(removeButton, sendBackButton, bringFrontButton);
    els.inspector.append(title, grid, actions);
  }

  function renderAll() {
    renderAssetList();
    renderInspector();
    renderCanvas();
  }

  function drawExportCanvas() {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = state.atlasSize;
    exportCanvas.height = state.atlasSize;
    const exportCtx = exportCanvas.getContext("2d");
    exportCtx.clearRect(0, 0, state.atlasSize, state.atlasSize);

    state.placements.forEach((placement) => {
      const asset = getAsset(placement.assetId);
      if (!asset) return;
      drawPlacementImage(exportCtx, placement);
    });

    return exportCanvas;
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function exportPng() {
    if (!state.placements.length) {
      setStatus("PNG出力する配置がありません。");
      return;
    }
    const collisions = getCollisionIds();
    const canvas = drawExportCanvas();
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus("PNG出力に失敗しました。");
        return;
      }
      downloadBlob(blob, `atlas_${state.atlasSize}.png`);
      setStatus(`PNGを書き出しました。${collisions.size ? "重なりがあるため内容を確認してください。" : ""}`);
    }, "image/png");
  }

  function exportJson() {
    if (!state.placements.length) {
      setStatus("JSON出力する配置がありません。");
      return;
    }
    const payload = {
      atlas: {
        width: state.atlasSize,
        height: state.atlasSize,
        snap: SNAP,
        exportedAt: new Date().toISOString(),
      },
      images: state.placements.map((placement) => {
        const asset = getAsset(placement.assetId);
        const rect = placementRect(placement);
        const content = placementContentRect(placement);
        return {
          name: asset.name,
          x: placement.x,
          y: placement.y,
          width: rect.width,
          height: rect.height,
          contentX: content.x,
          contentY: content.y,
          contentWidth: content.width,
          contentHeight: content.height,
          scale: placement.scale,
          padding: assetPadding(asset),
          bleed: assetBleed(asset),
          sourceWidth: asset.width,
          sourceHeight: asset.height,
          uv: {
            u0: content.x / state.atlasSize,
            v0: content.y / state.atlasSize,
            u1: (content.x + content.width) / state.atlasSize,
            v1: (content.y + content.height) / state.atlasSize,
          },
          slotUv: {
            u0: placement.x / state.atlasSize,
            v0: placement.y / state.atlasSize,
            u1: (placement.x + rect.width) / state.atlasSize,
            v1: (placement.y + rect.height) / state.atlasSize,
          },
        };
      }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, `atlas_${state.atlasSize}.json`);
    setStatus("JSONを書き出しました。");
  }

  function saveProject() {
    const snapshot = makeSnapshot();
    snapshot.savedAt = new Date().toISOString();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    downloadBlob(blob, `atlas_project_${state.atlasSize}.json`);
    setStatus("配置プロジェクトを書き出しました。");
  }

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("File read failed."));
      reader.readAsText(file, "utf-8");
    });
  }

  async function loadProjectFile(file) {
    if (!file) return;
    try {
      const text = await readTextFile(file);
      const payload = JSON.parse(text);
      await restoreSnapshot(payload);
      state.history = [makeSnapshot()];
      state.future = [];
      updateHistoryButtons();
      setStatus(`${file.name} を読み込みました。`);
    } catch (error) {
      setStatus(`プロジェクトを読み込めませんでした: ${error.message}`);
    }
  }

  function onCanvasDrop(event) {
    event.preventDefault();
    els.canvasWrap.classList.remove("dragActive");
    const point = canvasPointFromEvent(event);
    const targetPlacement = hitTestPlacement(point);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) {
      importFiles(files).then((added) => {
        let cursor = { x: point.x, y: point.y };
        added.forEach((asset, index) => {
          const placement =
            index === 0 && targetPlacement ? replacePlacementAsset(targetPlacement.id, asset.id) : createPlacement(asset.id, cursor);
          if (placement) {
            const rect = placementRect(placement);
            cursor = { x: placement.x + snapCeil(rect.width), y: placement.y };
          }
        });
      });
      return;
    }

    const assetId = event.dataTransfer.getData("application/x-atlas-asset") || event.dataTransfer.getData("text/plain");
    if (assetId) {
      if (targetPlacement) {
        replacePlacementAsset(targetPlacement.id, assetId);
      } else {
        createPlacement(assetId, point);
      }
    }
  }

  function bindEvents() {
    els.addImagesBtn.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", () => {
      importFiles(els.fileInput.files);
      els.fileInput.value = "";
    });

    els.atlasSizeSelect.addEventListener("change", () => setAtlasSize(Number(els.atlasSizeSelect.value)));
    els.zoomSelect.addEventListener("change", () => {
      state.zoom = Number(els.zoomSelect.value) / 100;
      applyZoom();
    });
    els.fitZoomBtn.addEventListener("click", fitZoomToViewport);
    els.undoBtn.addEventListener("click", undo);
    els.redoBtn.addEventListener("click", redo);
    els.packBtn.addEventListener("click", autoPackUnplaced);
    els.saveProjectBtn.addEventListener("click", saveProject);
    els.loadProjectBtn.addEventListener("click", () => els.projectInput.click());
    els.projectInput.addEventListener("change", () => {
      loadProjectFile(els.projectInput.files[0]);
      els.projectInput.value = "";
    });
    els.exportPngBtn.addEventListener("click", exportPng);
    els.exportJsonBtn.addEventListener("click", exportJson);

    els.assetDropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      els.assetDropZone.classList.add("dragActive");
    });
    els.assetDropZone.addEventListener("dragleave", () => els.assetDropZone.classList.remove("dragActive"));
    els.assetDropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      els.assetDropZone.classList.remove("dragActive");
      importFiles(event.dataTransfer.files);
    });

    els.canvas.addEventListener("dragover", (event) => {
      event.preventDefault();
      els.canvasWrap.classList.add("dragActive");
    });
    els.canvas.addEventListener("dragleave", () => els.canvasWrap.classList.remove("dragActive"));
    els.canvas.addEventListener("drop", onCanvasDrop);

    els.canvas.addEventListener("pointerdown", (event) => {
      const point = canvasPointFromEvent(event);
      const placement = hitTestPlacement(point);
      if (!placement) {
        setSelected(null, null);
        return;
      }
      const rect = placementRect(placement);
      setSelected("placement", placement.id);
      state.pointerDrag = {
        placementId: placement.id,
        offsetX: point.x - rect.x,
        offsetY: point.y - rect.y,
        startX: placement.x,
        startY: placement.y,
      };
      els.canvas.setPointerCapture(event.pointerId);
    });

    els.canvas.addEventListener("pointermove", (event) => {
      if (!state.pointerDrag) return;
      const placement = getPlacement(state.pointerDrag.placementId);
      if (!placement) return;
      const point = canvasPointFromEvent(event);
      placement.x = point.x - state.pointerDrag.offsetX;
      placement.y = point.y - state.pointerDrag.offsetY;
      clampPlacement(placement);
      renderCanvas();
      renderInspector();
      renderAssetList();
    });

    els.canvas.addEventListener("pointerup", (event) => {
      if (!state.pointerDrag) return;
      const drag = state.pointerDrag;
      const placement = getPlacement(drag.placementId);
      state.pointerDrag = null;
      try {
        els.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer may already be released by the browser.
      }
      if (placement) {
        setSelected("placement", placement.id);
        setStatus(`配置を ${placement.x}, ${placement.y} に移動しました。`);
        if (drag.startX !== placement.x || drag.startY !== placement.y) pushHistory();
      }
    });

    window.addEventListener("keydown", (event) => {
      const activeTag = document.activeElement?.tagName;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && activeTag !== "INPUT" && activeTag !== "SELECT") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y" && activeTag !== "INPUT" && activeTag !== "SELECT") {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && state.selected?.type === "placement") {
        if (activeTag === "INPUT" || activeTag === "SELECT") return;
        removePlacement(state.selected.id);
      }
    });
  }

  bindEvents();
  setAtlasSize(2048, false);
  pushHistory();
  window.requestAnimationFrame(fitZoomToViewport);
})();
