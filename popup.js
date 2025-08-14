(() => {
  const widthInput = document.getElementById("width");
  const heightInput = document.getElementById("height");
  const form = document.getElementById("imageForm");
  const previewImage = document.getElementById("previewImage");
  const addPresetBtn = document.getElementById("addPresetBtn");
  const presetsContainer = document.getElementById("presetsContainer");

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
    const exists = presets.some((p) => p.w === w && p.h === h);
    if (exists) {
      alert(`${w}x${h} 프리셋이 이미 존재합니다.`);
      return;
    }
    presets.push({ w, h });
    // 먼저 즉시 렌더링하여 UI에 바로 반영
    renderPresets();
    // 저장은 비동기로 처리하고 변경 통지는 onChanged로도 동기화
    await savePresets(presets);
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
    const filename = `placeholder_${w}x${h}.png`;

    try {
      // MV3에서 chrome.downloads.download 사용
      chrome.downloads.download(
        {
          url,
          filename,
          saveAs: false,
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            alert(`다운로드 오류: ${chrome.runtime.lastError.message}`);
          }
        }
      );
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
