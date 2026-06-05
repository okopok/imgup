(function () {
  "use strict";

  const API = "/api";
  const LS_THEME = "imgup-theme";
  const LS_LANG = "imgup-lang";

  // ── Translations ────────────────────────────────────────────

  const TRANSLATIONS = {
    en: {
      tagline: "Image Upscaler",
      dropzoneText: "Drop images here or click to browse",
      dropzoneHint: "JPEG · PNG · WebP · TIFF · BMP (max 50 MB each)",
      targetLabel: "Target",
      upscaleAllBtn: "\u2191 Upscale All",
      downscaleLabel: "Downscale if larger",
      addMoreBtn: "+ Add more",
      clearBtn: "Clear",
      loaderText: "Upscaling...",
      filePending: "Pending",
      fileProcessing: "Processing...",
      fileDone: "Done",
      fileError: "Error",
      fileCount: "{n} files",
      disconnected: "disconnected",
    },
    ru: {
      tagline: "\u0423\u0432\u0435\u043b\u0438\u0447\u0435\u043d\u0438\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439",
      dropzoneText: "\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435",
      dropzoneHint: "JPEG \u00b7 PNG \u00b7 WebP \u00b7 TIFF \u00b7 BMP (\u043c\u0430\u043a\u0441 50 \u041c\u0411 \u043a\u0430\u0436\u0434\u044b\u0439)",
      targetLabel: "\u0426\u0435\u043b\u044c",
      upscaleAllBtn: "\u2191 \u0423\u0432\u0435\u043b\u0438\u0447\u0438\u0442\u044c \u0432\u0441\u0435",
      downscaleLabel: "\u0423\u043c\u0435\u043d\u044c\u0448\u0438\u0442\u044c, \u0435\u0441\u043b\u0438 \u0431\u043e\u043b\u044c\u0448\u0435",
      addMoreBtn: "+ \u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c",
      clearBtn: "\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c",
      loaderText: "\u0423\u0432\u0435\u043b\u0438\u0447\u0435\u043d\u0438\u0435...",
      filePending: "\u041e\u0436\u0438\u0434\u0430\u043d\u0438\u0435",
      fileProcessing: "\u041e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0430...",
      fileDone: "\u0413\u043e\u0442\u043e\u0432\u043e",
      fileError: "\u041e\u0448\u0438\u0431\u043a\u0430",
      fileCount: "{n} \u0444\u0430\u0439\u043b\u043e\u0432",
      disconnected: "\u043d\u0435\u0442 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u044f",
    },
  };

  // ── DOM refs ────────────────────────────────────────────────

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const langSelect = $("#langSelect");
  const themeToggle = $("#themeToggle");
  const driverBadge = $("#driverBadge");
  const dropzone = $("#dropzone");
  const dropzoneContent = $("#dropzoneContent");
  const fileInput = $("#fileInput");
  const fileQueue = $("#fileQueue");
  const fileQueueTitle = $("#fileQueueTitle");
  const btnAddMore = $("#btnAddMore");
  const btnClearQueue = $("#btnClearQueue");
  const fileList = $("#fileList");
  const controls = $("#controls");
  const targetSelect = $("#targetSelect");
  const downscaleToggle = $("#downscaleToggle");
  const btnUpscaleAll = $("#btnUpscaleAll");
  const loader = $("#loader");
  const loaderText = $("#loaderText");
  const error = $("#error");
  const errorText = $("#errorText");
  const footerInfo = $("#footerInfo");

  // ── State ───────────────────────────────────────────────────

  const files = [];
  let isProcessing = false;
  let currentLang = "en";

  // ── Language ────────────────────────────────────────────────

  function detectLanguage() {
    const saved = localStorage.getItem(LS_LANG);
    if (saved) return saved;
    const browser = (navigator.language || "").slice(0, 2);
    if (browser === "ru") return "ru";
    return "en";
  }

  function t(key) {
    return (TRANSLATIONS[currentLang] || TRANSLATIONS.en)[key] || key;
  }

  function applyLanguage(lang) {
    currentLang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (TRANSLATIONS[lang][key] !== undefined) {
        el.textContent = TRANSLATIONS[lang][key];
      }
    });
    langSelect.value = lang;
    localStorage.setItem(LS_LANG, lang);
  }

  langSelect.addEventListener("change", () => {
    applyLanguage(langSelect.value);
  });

  applyLanguage(detectLanguage());

  // ── Theme ───────────────────────────────────────────────────

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.textContent = theme === "dark" ? "\u2600\ufe0f" : "\ud83c\udf19";
    localStorage.setItem(LS_THEME, theme);
  }

  function loadTheme() {
    const saved = localStorage.getItem(LS_THEME);
    if (saved) setTheme(saved);
  }

  themeToggle.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    setTheme(cur === "dark" ? "light" : "dark");
  });

  loadTheme();

  // ── Health ──────────────────────────────────────────────────

  fetch(API + "/health")
    .then((r) => r.json())
    .then((data) => {
      driverBadge.textContent = data.driver;
      footerInfo.textContent = data.driver_info + " \u00b7 v0.1.0";
    })
    .catch(() => {
      driverBadge.textContent = "?";
      footerInfo.textContent = TRANSLATIONS[currentLang].disconnected;
    });

  // ── File helpers ────────────────────────────────────────────

  function formatSize(bytes) {
    return bytes > 1024 * 1024
      ? (bytes / (1024 * 1024)).toFixed(1) + " MB"
      : (bytes / 1024).toFixed(0) + " KB";
  }

  function findDuplicate(file) {
    return files.some((e) => e.file.name === file.name && e.file.size === file.size);
  }

  // ── Render file list ────────────────────────────────────────

  function renderFileItem(entry, index) {
    const div = document.createElement("div");
    div.className = "file-item";
    div.dataset.index = index;

    const thumb = document.createElement("img");
    thumb.className = "file-thumb";
    thumb.alt = "";
    div.appendChild(thumb);

    const info = document.createElement("div");
    info.className = "file-info";

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = entry.file.name;
    info.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "file-meta";
    meta.textContent = formatSize(entry.file.size) + " · " + entry.fileType;
    if (entry.width) meta.textContent += " · " + entry.width + "×" + entry.height;
    info.appendChild(meta);

    div.appendChild(info);

    const status = document.createElement("span");
    status.className = "file-status";
    status.dataset.state = entry.status;
    status.textContent = t("filePending");
    div.appendChild(status);

    const dlBtn = document.createElement("button");
    dlBtn.className = "btn-download-file";
    dlBtn.textContent = "\ud83d\udce5";
    dlBtn.hidden = true;
    dlBtn.addEventListener("click", () => downloadResult(index));
    div.appendChild(dlBtn);

    return div;
  }

  function renderFileList() {
    fileList.innerHTML = "";

    const pending = files.filter((e) => e.status === "pending");
    const total = files.length;
    const text = total === 1 ? "1 file" : t("fileCount").replace("{n}", total);
    fileQueueTitle.textContent = pending.length > 0
      ? text + " \u00b7 " + pending.length + " " + t("filePending").toLowerCase()
      : text;

    files.forEach((entry, i) => {
      const el = renderFileItem(entry, i);
      fileList.appendChild(el);

      if (entry.thumbUrl) {
        el.querySelector(".file-thumb").src = entry.thumbUrl;
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          entry.thumbUrl = reader.result;
          el.querySelector(".file-thumb").src = entry.thumbUrl;
        };
        reader.readAsDataURL(entry.file);
      }

      updateFileItemUI(i);
    });
  }

  function updateFileItemUI(index) {
    const entry = files[index];
    const el = fileList.children[index];
    if (!el) return;

    el.className = "file-item";
    if (entry.status === "processing") el.classList.add("processing");
    else if (entry.status === "done") el.classList.add("done");
    else if (entry.status === "error") el.classList.add("error");

    const status = el.querySelector(".file-status");
    status.dataset.state = entry.status;
    switch (entry.status) {
      case "pending":
        status.textContent = t("filePending");
        break;
      case "processing":
        status.textContent = t("fileProcessing");
        break;
      case "done":
        status.textContent = t("fileDone");
        break;
      case "error":
        status.textContent = t("fileError") + ": " + (entry.error || "");
        break;
    }

    const dlBtn = el.querySelector(".btn-download-file");
    if (entry.status === "done" && entry.resultBlob) {
      dlBtn.hidden = false;
    } else {
      dlBtn.hidden = true;
    }
  }

  function updateUI() {
    const hasFiles = files.length > 0;
    fileQueue.hidden = !hasFiles;
    controls.hidden = !hasFiles;
    dropzone.classList.toggle("has-files", hasFiles);

    if (hasFiles) {
      renderFileList();
    }

    if (hasFiles) {
      const pending = files.filter((e) => e.status === "pending").length;
      const processing = files.filter((e) => e.status === "processing").length;
      btnUpscaleAll.disabled = isProcessing || pending === 0;
      btnUpscaleAll.textContent = isProcessing
        ? (processing > 0 ? t("fileProcessing") : t("upscaleAllBtn"))
        : t("upscaleAllBtn");
    }
  }

  // ── Add files ───────────────────────────────────────────────

  function loadImageInfo(entry) {
    const img = new Image();
    const url = URL.createObjectURL(entry.file);
    img.onload = () => {
      entry.width = img.naturalWidth;
      entry.height = img.naturalHeight;
      URL.revokeObjectURL(url);
      const idx = files.indexOf(entry);
      if (idx !== -1) {
        const el = fileList.children[idx];
        if (el) {
          const meta = el.querySelector(".file-meta");
          if (meta) meta.textContent = formatSize(entry.file.size) + " · " + entry.fileType + " · " + entry.width + "×" + entry.height;
        }
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
  }

  function addFiles(fileList) {
    let added = 0;

    for (const f of fileList) {
      if (!f.type.startsWith("image/")) continue;
      if (findDuplicate(f)) continue;
      const fileType = f.type || f.name.split(".").pop().toUpperCase();
      files.push({ file: f, status: "pending", error: null, resultBlob: null, resultFilename: "", thumbUrl: null, width: null, height: null, fileType: fileType });
      const entry = files[files.length - 1];
      loadImageInfo(entry);
      added++;
    }

    if (added > 0) {
      hideError();
      updateUI();
    }
  }

  // ── Dropzone ────────────────────────────────────────────────

  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("drag-over");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    addFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      addFiles(fileInput.files);
      fileInput.value = "";
    }
  });

  btnAddMore.addEventListener("click", () => fileInput.click());

  btnClearQueue.addEventListener("click", () => {
    files.length = 0;
    updateUI();
  });

  // ── Hide helpers ────────────────────────────────────────────

  function hideError() { error.hidden = true; }
  function showError(msg) { errorText.textContent = msg; error.hidden = false; }

  hideError();

  // ── Upscale all ─────────────────────────────────────────────

  async function processAll() {
    if (isProcessing) return;
    isProcessing = true;
    hideError();
    updateUI();

    const target = targetSelect.value;
    const downscale = downscaleToggle.checked;

    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (entry.status === "done" || entry.status === "error") continue;

      entry.status = "processing";
      updateFileItemUI(i);

      try {
        const form = new FormData();
        form.append("file", entry.file);

        const params = new URLSearchParams();
        if (target !== "4k") params.set("target", target);
        if (downscale) params.set("downscale", "true");

        const resp = await fetch(API + "/upscale/upload?" + params.toString(), {
          method: "POST",
          body: form,
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || "Server error (" + resp.status + ")");
        }

        entry.resultBlob = await resp.blob();
        entry.resultFilename = entry.file.name.replace(/\.[^.]+$/, "") + "_" + target + ".jpg";
        entry.status = "done";
      } catch (err) {
        entry.error = err.message;
        entry.status = "error";
      }

      updateFileItemUI(i);
      updateUI();

      if (entry.status === "done") {
        downloadResult(i);
      }
    }

    isProcessing = false;
    updateUI();
  }

  btnUpscaleAll.addEventListener("click", processAll);

  // ── Download ────────────────────────────────────────────────

  function downloadResult(index) {
    const entry = files[index];
    if (!entry.resultBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(entry.resultBlob);
    a.download = entry.resultFilename;
    a.click();
  }

  // ── Service Worker ──────────────────────────────────────────

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/static/sw.js").catch(() => {});
  }
})();
