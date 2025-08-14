(() => {
  const widthInput = document.getElementById("width");
  const heightInput = document.getElementById("height");
  const form = document.getElementById("imageForm");
  const previewImage = document.getElementById("previewImage");
  const addPresetBtn = document.getElementById("addPresetBtn");
  const presetsContainer = document.getElementById("presetsContainer");
  const formatSelect = document.getElementById("format");

  const STORAGE_KEY = "presets";
  const defaultPresets = [
    { w: 128, h: 128 },
    { w: 256, h: 256 },
    { w: 512, h: 512 },
  ];
  let presets = [];
  let initialized = false;

  function clampToPositiveInteger(value) {
    const parsed = parseInt(String(value).replace(/[^0-9]/g, ""), 10);
    if (Number.isNaN(parsed) || parsed < 1) return "";
    return String(parsed);
  }

  function getValues() {
    const w = Number(widthInput.value);
    const h = Number(heightInput.value);
    return { w, h };
  }

  function buildUrl(w, h) {
    return `https://fpoimg.com/${w}x${h}`;
  }

  function updatePreview() {
    const { w, h } = getValues();
    if (!w || !h) {
      previewImage.style.display = "none";
      previewImage.removeAttribute("src");
      return;
    }
    const url = buildUrl(w, h);
    previewImage.src = url;
    previewImage.style.display = "block";
  }

  function setValues(w, h) {
    widthInput.value = clampToPositiveInteger(w);
    heightInput.value = clampToPositiveInteger(h);
    updatePreview();
  }

  function getSelectedFormat() {
    const v = (formatSelect?.value || "png").toLowerCase();
    if (["png", "jpg", "jpeg", "webp"].includes(v)) return v;
    return "png";
  }

  function getMimeTypeByFormat(fmt) {
    switch (fmt) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "webp":
        return "image/webp";
      case "png":
      default:
        return "image/png";
    }
  }

  async function convertAndDownload(url, filename, format) {
    const mime = getMimeTypeByFormat(format);
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`이미지 요청 실패 (${res.status})`);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    // OffscreenCanvas 우선, 없으면 HTMLCanvasElement fallback
    const width = bitmap.width;
    const height = bitmap.height;
    let outBlob;
    if (typeof OffscreenCanvas !== "undefined") {
      const off = new OffscreenCanvas(width, height);
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error("캔버스 컨텍스트를 생성할 수 없습니다.");
      // JPEG은 투명도 미지원 → 흰 배경으로 깔고 그리기
      if (mime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0);
      outBlob = await off.convertToBlob({ type: mime, quality: 0.92 });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("캔버스 컨텍스트를 생성할 수 없습니다.");
      if (mime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0);
      const dataUrl = canvas.toDataURL(mime, 0.92);
      outBlob = await (await fetch(dataUrl)).blob();
    }

    const objectUrl = URL.createObjectURL(outBlob);
    await new Promise((resolve) => {
      chrome.downloads.download(
        { url: objectUrl, filename, saveAs: false },
        () => {
          URL.revokeObjectURL(objectUrl);
          resolve();
        }
      );
    });
  }

  // 숫자만 허용
  ["input", "blur"].forEach((evt) => {
    widthInput.addEventListener(evt, (e) => {
      const before = e.target.value;
      const after = clampToPositiveInteger(before);
      if (before !== after) e.target.value = after;
      updatePreview();
    });
    heightInput.addEventListener(evt, (e) => {
      const before = e.target.value;
      const after = clampToPositiveInteger(before);
      if (before !== after) e.target.value = after;
      updatePreview();
    });
  });

  // Storage helpers
  function loadPresets() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        const list = Array.isArray(result[STORAGE_KEY])
          ? result[STORAGE_KEY]
          : null;
        resolve(list);
      });
    });
  }

  function savePresets(list) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [STORAGE_KEY]: list }, () => resolve());
    });
  }

  function renderPresets() {
    presetsContainer.innerHTML = "";
    presets.forEach((item, index) => {
      const itemWrap = document.createElement("span");
      itemWrap.className = "preset-item";

      const btn = document.createElement("button");
      btn.className = "preset";
      btn.type = "button";
      btn.dataset.index = String(index);
      btn.textContent = `${item.w}×${item.h}`;

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "icon-btn";
      deleteBtn.type = "button";
      deleteBtn.title = "삭제";
      deleteBtn.textContent = "✕";
      deleteBtn.dataset.action = "delete";
      deleteBtn.dataset.index = String(index);

      itemWrap.appendChild(btn);
      itemWrap.appendChild(deleteBtn);
      presetsContainer.appendChild(itemWrap);
    });
  }

  async function addPresetIfNew(w, h, options = { notifyDuplicate: true }) {
    if (!w || !h) return false;
    const exists = presets.some((p) => p.w === w && p.h === h);
    if (exists) {
      if (options.notifyDuplicate) {
        alert(`${w}x${h} 프리셋이 이미 존재합니다.`);
      }
      return false;
    }
    presets.push({ w, h });
    renderPresets();
    await savePresets(presets);
    return true;
  }

  function toggleManageMode() {
    manageMode = !manageMode;
    managePresetBtn.textContent = manageMode ? "완료" : "관리";
    renderPresets();
  }

  // Preset events
  addPresetBtn.addEventListener("click", async () => {
    const { w, h } = getValues();
    if (!w || !h) {
      alert("현재 입력된 너비/높이를 먼저 입력해주세요.");
      return;
    }
    await addPresetIfNew(w, h, { notifyDuplicate: true });
  });

  // 스토리지 변경 시 다른 팝업 인스턴스/지연 저장과 동기화
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes[STORAGE_KEY]) return;
      const newValue = changes[STORAGE_KEY].newValue;
      if (Array.isArray(newValue)) {
        presets = newValue.slice();
        renderPresets();
      }
    });
  }

  // 관리 버튼 제거에 따라 토글 기능 삭제

  presetsContainer.addEventListener("click", async (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const action = target.getAttribute("data-action");
    const indexAttr =
      target.getAttribute("data-index") ||
      target.closest(".preset")?.getAttribute("data-index");
    const index = indexAttr ? parseInt(indexAttr, 10) : -1;
    if (index < 0 || index >= presets.length) return;

    if (action === "delete") {
      presets.splice(index, 1);
      await savePresets(presets);
      renderPresets();
      return;
    }

    // 기본: 프리셋 적용
    const item = presets[index];
    setValues(item.w, item.h);
  });

  // 다운로드 동작
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { w, h } = getValues();
    if (!w || !h) {
      alert("너비와 높이를 올바르게 입력해주세요.");
      return;
    }
    const url = buildUrl(w, h);
    const fmt = getSelectedFormat();
    const filename = `placeholder_${w}x${h}.${fmt}`;

    try {
      if (fmt === "png") {
        // 원본 PNG를 그대로 다운로드
        chrome.downloads.download(
          { url, filename, saveAs: false },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              alert(`다운로드 오류: ${chrome.runtime.lastError.message}`);
            } else if (typeof downloadId === "number") {
              void addPresetIfNew(w, h, { notifyDuplicate: false });
            }
          }
        );
      } else {
        await convertAndDownload(url, filename, fmt);
        void addPresetIfNew(w, h, { notifyDuplicate: false });
      }
    } catch (err) {
      alert("다운로드 중 오류가 발생했습니다.");
    }
  });

  // 초기화: 프리셋 로드 및 렌더링 (초기 미리보기 로드는 하지 않음)
  (async () => {
    const loaded = await loadPresets();
    let base;
    // 키가 아예 없을 때만 기본 프리셋 시드
    if (Array.isArray(loaded)) {
      base = loaded.slice();
    } else {
      base = defaultPresets.slice();
      await savePresets(base);
    }

    // 초기 로딩 도중 사용자가 추가한 프리셋과 병합
    if (presets.length > 0) {
      const seen = new Set(base.map((p) => `${p.w}x${p.h}`));
      for (const p of presets) {
        const key = `${p.w}x${p.h}`;
        if (!seen.has(key)) {
          base.push(p);
          seen.add(key);
        }
      }
    }
    presets = base;
    initialized = true;
    renderPresets();
  })();
})();
