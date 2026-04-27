const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const DISPLAY_FACE_ORDER = ["U", "L", "F", "R", "B", "D"];
const COLORS = ["white", "yellow", "red", "orange", "blue", "green"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const QUALITY_HINTS = {
  fast: "Fast returns a short two-phase solution quickly.",
  tighter: "Tighter first tries to stay within 21 moves, then falls back if needed.",
  god20: "Try 20 searches harder for a 20-move-or-less solution before falling back.",
};

let reviewedFaces = null;
let cubeFaces = null;
let selectedNetFile = null;
let selectedColor = "white";
let solutionStates = [];
let solutionMoves = [];
let solutionInstructions = [];
let currentStep = 0;
let detectionDiagnostics = null;
let validationReport = null;
let manualCorrections = new Set();
let reviewTargetKey = null;
let isPlaying = false;
let isStepping = false;
let isSolving = false;
let suppressCube3dSync = false;

const statusPill = document.getElementById("statusPill");
const cubeNet = document.getElementById("cubeNet");
const counts = document.getElementById("counts");
const palette = document.getElementById("palette");
const solveButton = document.getElementById("solveButton");
const reviewMeta = document.getElementById("reviewMeta");
const stepContext = document.getElementById("stepContext");
const movesEl = document.getElementById("moves");
const instructionsEl = document.getElementById("instructions");
const moveCount = document.getElementById("moveCount");
const scrambleBox = document.getElementById("scrambleBox");
const stepper = document.getElementById("stepper");
const stepLabel = document.getElementById("stepLabel");
const stepMove = document.getElementById("stepMove");
const detectButton = document.getElementById("detectButton");
const debugOverlayButton = document.getElementById("debugOverlayButton");
const fileDrop = document.getElementById("fileDrop");
const fileLabel = document.getElementById("fileLabel");
const netImage = document.getElementById("netImage");
const uploadMeta = document.getElementById("uploadMeta");
const validationBox = document.getElementById("validationBox");
const nextFlaggedButton = document.getElementById("nextFlaggedButton");
const playSteps = document.getElementById("playSteps");
const stepRange = document.getElementById("stepRange");
const solveMeta = document.getElementById("solveMeta");
const qualityHint = document.getElementById("qualityHint");
const parserDebug = document.getElementById("parserDebug");
const parserDebugImage = document.getElementById("parserDebugImage");
const parserDebugMeta = document.getElementById("parserDebugMeta");

function cloneFaces(faces) {
  return JSON.parse(JSON.stringify(faces));
}

function setStatus(message, isError = false) {
  statusPill.textContent = message;
  statusPill.classList.toggle("is-error", isError);
}

function stickerKey(face, index) {
  return `${face}-${index}`;
}

function stickerDiagnostics(face, index) {
  return detectionDiagnostics?.stickersByKey?.get(stickerKey(face, index));
}

function flaggedStickers() {
  if (!detectionDiagnostics) return [];
  return detectionDiagnostics.stickers.filter((sticker) => {
    const key = stickerKey(sticker.face, sticker.index);
    return !manualCorrections.has(key) && (sticker.lowConfidence || sticker.balanced);
  });
}

function setDetectionDiagnostics(diagnostics) {
  const stickers = diagnostics?.stickers || [];
  detectionDiagnostics = {
    ...diagnostics,
    stickers,
    stickersByKey: new Map(stickers.map((sticker) => [stickerKey(sticker.face, sticker.index), sticker])),
  };
  reviewTargetKey = null;
  manualCorrections = new Set();
}

function clearDetectionDiagnostics() {
  detectionDiagnostics = null;
  validationReport = null;
  manualCorrections = new Set();
  reviewTargetKey = null;
  clearParserDebug();
  renderFlaggedControl();
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type) return ["image/png", "image/jpeg"].includes(file.type);
  return /\.(png|jpe?g)$/i.test(file.name || "");
}

function validateImageFile(file) {
  if (!isImageFile(file)) {
    throw new Error("Use a JPEG or PNG image.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large. Use a file under 8 MB.");
  }
}

function setSelectedNetFile(file, sourceLabel) {
  validateImageFile(file);
  selectedNetFile = file;
  clearParserDebug();
  const name = file.name || "clipboard image";
  fileLabel.textContent = `${sourceLabel}: ${name}`;
  uploadMeta.textContent = `${formatBytes(file.size)} image ready`;
  uploadMeta.classList.remove("is-warning");
  setStatus("Image ready");
}

async function handleIncomingImage(file, sourceLabel, detectNow = false) {
  try {
    setMode("upload");
    setSelectedNetFile(file, sourceLabel);
    if (detectNow) await detectSelectedImage();
  } catch (error) {
    setStatus(error.message, true);
    uploadMeta.textContent = error.message;
    uploadMeta.classList.add("is-warning");
  }
}

function initPalette() {
  palette.innerHTML = "";
  COLORS.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.title = color;
    button.className = `palette-button color-${color}`;
    button.dataset.color = color;
    button.addEventListener("click", () => {
      selectedColor = color;
      document.querySelectorAll(".palette-button").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.color === selectedColor);
      });
    });
    palette.appendChild(button);
  });
  palette.querySelector("[data-color='white']").classList.add("is-active");
}

function renderCube() {
  cubeNet.innerHTML = "";
  if (!cubeFaces) {
    cubeNet.innerHTML = "";
    solveButton.disabled = true;
    renderCounts();
    syncCube3d();
    return;
  }

  DISPLAY_FACE_ORDER.forEach((face) => {
    const faceEl = document.createElement("div");
    faceEl.className = `face face-${face}`;
    faceEl.setAttribute("aria-label", `${face} face`);
    cubeFaces[face].forEach((color, index) => {
      const diagnostics = stickerDiagnostics(face, index);
      const key = stickerKey(face, index);
      const sticker = document.createElement("button");
      sticker.type = "button";
      sticker.className = `sticker color-${color}`;
      sticker.classList.toggle("is-low-confidence", Boolean(diagnostics?.lowConfidence));
      sticker.classList.toggle("is-balanced", Boolean(diagnostics?.balanced));
      sticker.classList.toggle("is-review-target", reviewTargetKey === key);
      sticker.dataset.stickerKey = key;
      sticker.dataset.label = index === 4 ? face : "";
      sticker.title = stickerTitle(face, index, color, diagnostics);
      sticker.disabled = !canEditStickers();
      sticker.addEventListener("click", () => {
        if (!canEditStickers()) return;
        if (solutionStates.length) clearSolution();
        if (!reviewedFaces) reviewedFaces = cloneFaces(cubeFaces);
        reviewedFaces[face][index] = selectedColor;
        cubeFaces[face][index] = selectedColor;
        manualCorrections.add(key);
        if (reviewTargetKey === key) reviewTargetKey = null;
        validationReport = null;
        renderCube();
      });
      faceEl.appendChild(sticker);
    });
    cubeNet.appendChild(faceEl);
  });

  solveButton.disabled = !hasValidCounts() || !canEditStickers();
  renderCounts();
  renderFlaggedControl();
  syncCube3d();
}

function stickerTitle(face, index, color, diagnostics) {
  const parts = [`${face}${index + 1}: ${color}`];
  if (diagnostics) {
    parts.push(`confidence ${Math.round(diagnostics.confidence * 100)}%`);
    if (diagnostics.balanced) parts.push(`nearest ${diagnostics.nearestColor}`);
  }
  return parts.join(" - ");
}

function canEditStickers() {
  return !isSolving && (solutionStates.length === 0 || currentStep === 0);
}

function renderCounts() {
  counts.innerHTML = "";
  const totals = Object.fromEntries(COLORS.map((color) => [color, 0]));
  if (cubeFaces) {
    FACE_ORDER.forEach((face) => {
      cubeFaces[face].forEach((color) => {
        if (totals[color] !== undefined) totals[color] += 1;
      });
    });
  }
  COLORS.forEach((color) => {
    const item = document.createElement("div");
    item.className = "count-item";
    item.classList.toggle("is-bad", cubeFaces && totals[color] !== 9);
    item.innerHTML = `<span>${color}</span><strong>${totals[color]}</strong>`;
    counts.appendChild(item);
  });
  renderValidationSummary();
}

function hasValidCounts() {
  return cubeValidationIssues().length === 0;
}

function cubeValidationIssues() {
  if (!cubeFaces) return ["No cube loaded"];
  const issues = [];
  const totals = Object.fromEntries(COLORS.map((color) => [color, 0]));
  FACE_ORDER.forEach((face) => {
    if (!cubeFaces[face] || cubeFaces[face].length !== 9) {
      issues.push(`${face} must have 9 stickers.`);
      return;
    }
    cubeFaces[face].forEach((color) => {
      if (totals[color] === undefined) {
        issues.push(`${face} has an unknown color.`);
      } else {
        totals[color] += 1;
      }
    });
  });

  const badCounts = COLORS.filter((color) => totals[color] !== 9)
    .map((color) => `${color} ${totals[color]}`)
    .join(", ");
  if (badCounts) issues.push(`Color counts need 9 each: ${badCounts}.`);

  const centers = FACE_ORDER.map((face) => cubeFaces[face]?.[4]).filter(Boolean);
  const centerSet = new Set(centers);
  if (centers.length !== 6 || centerSet.size !== 6) {
    issues.push("Center stickers must be six unique colors.");
  }

  return issues;
}

function renderValidationSummary() {
  validationBox.innerHTML = "";
  const issues = cubeValidationIssues();
  const flagged = flaggedStickers();
  validationBox.classList.toggle("is-error", cubeFaces && issues.length > 0);
  validationBox.classList.toggle("is-ready", cubeFaces && !issues.length);

  if (!cubeFaces) {
    validationBox.textContent = "No cube loaded";
    return;
  }

  if (!issues.length) {
    const line = document.createElement("div");
    line.textContent = flagged.length
      ? `Counts and centers look ready. ${flagged.length} detected stickers are flagged for review.`
      : "Counts and centers look ready.";
    validationBox.appendChild(line);
  } else {
    issues.forEach((issue) => {
      const line = document.createElement("div");
      line.textContent = issue;
      validationBox.appendChild(line);
    });
  }

  if (validationReport?.issues?.length) {
    validationReport.issues.forEach((issue) => {
      if (issues.includes(issue)) return;
      const line = document.createElement("div");
      line.textContent = issue;
      validationBox.appendChild(line);
    });
  }
}

function renderFlaggedControl() {
  const flagged = flaggedStickers();
  nextFlaggedButton.disabled = !flagged.length || !canEditStickers();
  nextFlaggedButton.textContent = flagged.length
    ? `Review flagged sticker (${flagged.length})`
    : "Review flagged sticker";
}

function clearSolution() {
  stopPlayback();
  solutionStates = [];
  solutionMoves = [];
  solutionInstructions = [];
  currentStep = 0;
  stepper.hidden = true;
  movesEl.innerHTML = "";
  instructionsEl.innerHTML = "";
  moveCount.textContent = "";
  solveMeta.textContent = "";
  solveMeta.className = "solve-meta";
  stepContext.textContent = reviewedFaces
    ? "Review and correct the starting state before solving."
    : "Load a cube net or random scramble to begin.";
  if (reviewedFaces) cubeFaces = cloneFaces(reviewedFaces);
  stepRange.value = 0;
  stepRange.max = 0;
  renderPlaybackControls();
  syncCube3d();
}

function setReviewedFaces(faces, metaText, diagnostics = null, validation = null) {
  reviewedFaces = cloneFaces(faces);
  cubeFaces = cloneFaces(faces);
  clearDetectionDiagnostics();
  if (diagnostics) setDetectionDiagnostics(diagnostics);
  validationReport = validation;
  clearSolution();
  reviewMeta.textContent = metaText;
  renderCube();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function readJson(response) {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) return {};
  return response.json();
}

function detectionMeta(data) {
  const parts = [];
  if (data.image) parts.push(`${data.image.width}x${data.image.height}`);
  if (data.diagnostics) {
    parts.push(`confidence ${Math.round(data.diagnostics.lowestConfidence * 100)}%+`);
    if (data.diagnostics.balancedStickers) {
      parts.push(`${data.diagnostics.balancedStickers} balanced`);
    }
    if (data.diagnostics.lowConfidenceStickers) {
      parts.push(`${data.diagnostics.lowConfidenceStickers} low confidence`);
    }
  }
  if (data.debug?.detectionSource && data.debug.detectionSource !== "original") {
    parts.push(data.debug.detectionSource);
  }
  if (data.warnings && data.warnings.length) parts.push(data.warnings.join(" "));
  return parts.join(" - ") || "Detected from image";
}

function updateUploadDiagnostics(data) {
  uploadMeta.textContent = detectionMeta(data);
  uploadMeta.classList.toggle("is-warning", Boolean(data.warnings && data.warnings.length));
}

async function detectSelectedImage() {
  if (!selectedNetFile) {
    setStatus("Choose, drop, or paste an image", true);
    return;
  }

  const body = new FormData();
  body.append("image", selectedNetFile, selectedNetFile.name || "cube-net.png");
  setStatus("Detecting...");
  detectButton.disabled = true;
  clearSolution();
  clearParserDebug();
  try {
    const response = await fetch("/api/detect-net", { method: "POST", body });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || "Detection failed");
    setReviewedFaces(data.faces, detectionMeta(data), data.diagnostics, data.validation);
    setParserDebug(data.debug);
    updateUploadDiagnostics(data);
    scrambleBox.style.display = "none";
    setStatus("Detected");
  } catch (error) {
    setStatus(error.message, true);
    uploadMeta.textContent = error.message;
    uploadMeta.classList.add("is-warning");
  } finally {
    detectButton.disabled = false;
  }
}

detectButton.addEventListener("click", detectSelectedImage);
debugOverlayButton.addEventListener("click", () => {
  parserDebug.hidden = !parserDebug.hidden;
  debugOverlayButton.textContent = parserDebug.hidden ? "Show parser overlay" : "Hide parser overlay";
});

document.getElementById("randomButton").addEventListener("click", async () => {
  const length = Number(document.getElementById("scrambleLength").value || 20);
  const quality = selectedSolveQuality();
  setStatus(statusForQuality(quality));
  setSolving(true);
  clearSolution();
  try {
    const data = await postJson("/api/random", { length, quality });
    setReviewedFaces(data.faces, "Generated scramble");
    scrambleBox.style.display = "block";
    scrambleBox.textContent = data.scramble.join(" ");
    renderSolution(data);
    setStatus("Generated");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setSolving(false);
    renderCube();
  }
});

solveButton.addEventListener("click", async () => {
  if (!reviewedFaces) return;
  const quality = selectedSolveQuality();
  setStatus(statusForQuality(quality));
  setSolving(true);
  clearSolution();
  try {
    const data = await postJson("/api/solve", { faces: reviewedFaces, quality });
    validationReport = data.validation || null;
    renderSolution(data);
    setStatus("Solved");
  } catch (error) {
    validationReport = { issues: [error.message] };
    renderValidationSummary();
    setStatus(error.message, true);
  } finally {
    setSolving(false);
    renderCube();
  }
});

function renderSolution(data) {
  movesEl.innerHTML = "";
  instructionsEl.innerHTML = "";
  solutionStates = data.states || [];
  solutionMoves = data.moves || [];
  solutionInstructions = data.instructions || [];
  moveCount.textContent = `${data.moveCount} moves`;
  renderSolveMeta(data.solve);
  stepRange.max = Math.max(0, solutionStates.length - 1);
  stepRange.value = 0;
  solutionMoves.forEach((move, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "move-chip";
    chip.textContent = move;
    chip.title = `Jump to step ${index + 1}`;
    chip.addEventListener("click", () => {
      stopPlayback();
      goToStep(index + 1, { animate: Math.abs(currentStep - (index + 1)) === 1 });
    });
    movesEl.appendChild(chip);
  });
  solutionInstructions.forEach((instruction, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "instruction-button";
    button.textContent = instruction;
    button.addEventListener("click", () => {
      stopPlayback();
      goToStep(index + 1, { animate: Math.abs(currentStep - (index + 1)) === 1 });
    });
    item.appendChild(button);
    instructionsEl.appendChild(item);
  });
  if (solutionStates.length) {
    stepper.hidden = false;
    goToStep(0, { animate: false });
  }
}

function renderSolveMeta(solve) {
  solveMeta.textContent = "";
  solveMeta.className = "solve-meta";
  if (!solve) return;

  const attempts = solve.attempts || [];
  const solved = attempts.find((attempt) => attempt.status === "solved");
  const totalMs = attempts.reduce((sum, attempt) => sum + (attempt.elapsedMs || 0), 0);
  const parts = [solve.message || `${solve.qualityLabel || "Solver"} completed.`];
  if (solved?.elapsedMs !== undefined) {
    parts.push(`Solved in ${(solved.elapsedMs / 1000).toFixed(1)}s.`);
  } else if (totalMs) {
    parts.push(`Searched for ${(totalMs / 1000).toFixed(1)}s.`);
  }
  const missed = attempts.filter((attempt) => attempt.status !== "solved");
  if (missed.length) {
    parts.push(`${missed.map((attempt) => attempt.label).join(", ")} did not finish.`);
  }
  solveMeta.textContent = parts.join(" ");
  solveMeta.classList.add("is-visible");
  solveMeta.classList.toggle("is-fallback", Boolean(solve.usedFallback));
}

function selectedSolveQuality() {
  return document.querySelector("input[name='solverQuality']:checked")?.value || "fast";
}

function statusForQuality(quality) {
  if (quality === "god20") return "Trying 20...";
  if (quality === "tighter") return "Solving tighter...";
  return "Solving...";
}

function setSolving(value) {
  isSolving = value;
  detectButton.disabled = value;
  document.getElementById("randomButton").disabled = value;
  document.querySelectorAll("input[name='solverQuality']").forEach((input) => {
    input.disabled = value;
  });
}

async function goToStep(step, options = {}) {
  if (!solutionStates.length) return;
  if (isStepping) return;

  const previousStep = currentStep;
  const targetStep = Math.max(0, Math.min(step, solutionStates.length - 1));
  const isAdjacent = Math.abs(targetStep - previousStep) === 1;
  const shouldAnimate =
    options.animate !== false && isAdjacent && Boolean(window.Rubik3D?.animateMove);
  const move =
    targetStep > previousStep
      ? solutionMoves[previousStep]
      : targetStep < previousStep
        ? invertMove(solutionMoves[targetStep])
        : null;

  currentStep = targetStep;
  cubeFaces = cloneFaces(solutionStates[currentStep]);
  if (currentStep === solutionStates.length - 1 && !options.fromPlayback) stopPlayback();
  suppressCube3dSync = shouldAnimate;
  renderCube();
  renderPlaybackControls();
  suppressCube3dSync = false;

  if (!shouldAnimate || !move) {
    syncCube3d();
    return;
  }

  isStepping = true;
  renderPlaybackControls();
  try {
    await window.Rubik3D.animateMove(move, cubeFaces);
  } finally {
    isStepping = false;
    renderPlaybackControls();
  }
}

function togglePlayback() {
  if (!solutionStates.length) return;
  if (isPlaying) {
    stopPlayback();
    return;
  }
  runPlayback();
}

async function runPlayback() {
  if (isStepping) return;
  isPlaying = true;
  renderPlaybackControls();
  if (currentStep === solutionStates.length - 1) {
    await goToStep(0, { animate: false, fromPlayback: true });
  }
  while (isPlaying && currentStep < solutionStates.length - 1) {
    await goToStep(currentStep + 1, { animate: true, fromPlayback: true });
    await delay(120);
  }
  isPlaying = false;
  renderPlaybackControls();
}

function stopPlayback() {
  isPlaying = false;
  renderPlaybackControls();
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function invertMove(move) {
  if (!move) return move;
  if (move.endsWith("2")) return move;
  if (move.endsWith("'")) return move[0];
  return `${move}'`;
}

function renderPlaybackControls() {
  if (!solutionStates.length) {
    stepLabel.textContent = "Step 0";
    stepMove.textContent = "Starting state";
    playSteps.disabled = true;
    stepRange.value = 0;
    stepRange.max = 0;
    return;
  }

  stepLabel.textContent = `Step ${currentStep} of ${solutionStates.length - 1}`;
  stepMove.textContent =
    currentStep === 0
      ? "Starting state"
      : `${solutionMoves[currentStep - 1]} - ${solutionInstructions[currentStep - 1]}`;
  stepContext.textContent =
    currentStep === 0
      ? "Starting state. You can still correct stickers here."
      : "Playback mode. Use the arrows or click a move to inspect the cube.";

  document.getElementById("firstStep").disabled = isStepping || currentStep === 0;
  document.getElementById("prevStep").disabled = isStepping || currentStep === 0;
  document.getElementById("nextStep").disabled = isStepping || currentStep === solutionStates.length - 1;
  document.getElementById("lastStep").disabled = isStepping || currentStep === solutionStates.length - 1;
  playSteps.disabled = solutionStates.length <= 1 || (isStepping && !isPlaying);
  playSteps.textContent = isPlaying ? "Pause" : "Play";
  stepRange.max = solutionStates.length - 1;
  stepRange.value = currentStep;
  stepRange.disabled = isStepping;

  document.querySelectorAll(".move-chip").forEach((chip, index) => {
    chip.classList.toggle("is-active", currentStep === index + 1);
    chip.disabled = isStepping;
  });
  document.querySelectorAll(".instruction-button").forEach((button, index) => {
    button.classList.toggle("is-active", currentStep === index + 1);
    button.disabled = isStepping;
  });
}

function setMode(mode) {
  const upload = mode === "upload";
  document.getElementById("uploadPanel").classList.toggle("is-active", upload);
  document.getElementById("randomPanel").classList.toggle("is-active", !upload);
  document.getElementById("uploadTab").classList.toggle("is-active", upload);
  document.getElementById("randomTab").classList.toggle("is-active", !upload);
}

document.getElementById("uploadTab").addEventListener("click", () => setMode("upload"));
document.getElementById("randomTab").addEventListener("click", () => setMode("random"));
document.getElementById("firstStep").addEventListener("click", () => {
  stopPlayback();
  goToStep(0, { animate: false });
});
document.getElementById("prevStep").addEventListener("click", () => {
  stopPlayback();
  goToStep(currentStep - 1, { animate: true });
});
document.getElementById("nextStep").addEventListener("click", () => {
  stopPlayback();
  goToStep(currentStep + 1, { animate: true });
});
document.getElementById("lastStep").addEventListener("click", () => {
  stopPlayback();
  if (solutionStates.length) goToStep(solutionStates.length - 1, { animate: false });
});
playSteps.addEventListener("click", togglePlayback);
stepRange.addEventListener("input", () => {
  stopPlayback();
  goToStep(Number(stepRange.value), { animate: false });
});
nextFlaggedButton.addEventListener("click", () => {
  const flagged = flaggedStickers();
  if (!flagged.length) return;
  const currentIndex = flagged.findIndex(
    (sticker) => stickerKey(sticker.face, sticker.index) === reviewTargetKey
  );
  const next = flagged[(currentIndex + 1) % flagged.length];
  reviewTargetKey = stickerKey(next.face, next.index);
  renderCube();
  const target = cubeNet.querySelector(`[data-sticker-key="${reviewTargetKey}"]`);
  target?.focus();
});
netImage.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) {
    handleIncomingImage(file, "Selected image");
  } else {
    selectedNetFile = null;
    fileLabel.textContent = "Choose, drop, or paste a flattened cube net";
    uploadMeta.textContent = "JPEG or PNG under 8 MB";
    uploadMeta.classList.remove("is-warning");
    clearParserDebug();
  }
});

fileDrop.addEventListener("dragenter", (event) => {
  event.preventDefault();
  fileDrop.classList.add("is-dragover");
});

fileDrop.addEventListener("dragover", (event) => {
  event.preventDefault();
  fileDrop.classList.add("is-dragover");
});

fileDrop.addEventListener("dragleave", (event) => {
  if (!fileDrop.contains(event.relatedTarget)) {
    fileDrop.classList.remove("is-dragover");
  }
});

fileDrop.addEventListener("drop", (event) => {
  event.preventDefault();
  fileDrop.classList.remove("is-dragover");
  const file = firstImageFile(event.dataTransfer.files);
  if (!file) {
    setStatus("Drop an image file", true);
    return;
  }
  handleIncomingImage(file, "Dropped image", true);
});

document.addEventListener("dragover", (event) => {
  if (hasDraggedFiles(event)) event.preventDefault();
});

document.addEventListener("drop", (event) => {
  if (hasDraggedFiles(event)) event.preventDefault();
});

document.addEventListener("paste", (event) => {
  if (isTextInput(event.target)) return;
  const file = imageFileFromClipboard(event);
  if (!file) return;
  event.preventDefault();
  handleIncomingImage(file, "Pasted screenshot", true);
});

function firstImageFile(fileList) {
  return Array.from(fileList || []).find(isImageFile);
}

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function imageFileFromClipboard(event) {
  const files = Array.from(event.clipboardData?.files || []);
  const file = files.find(isImageFile);
  if (file) return file;

  const item = Array.from(event.clipboardData?.items || []).find(
    (entry) => entry.kind === "file" && entry.type.startsWith("image/")
  );
  return item ? item.getAsFile() : null;
}

function isTextInput(target) {
  return (
    target instanceof Element &&
    Boolean(target.closest("input:not([type='file']), textarea, [contenteditable='true']"))
  );
}

function syncCube3d() {
  if (suppressCube3dSync) return;
  if (window.Rubik3D?.setFaces) {
    window.Rubik3D.setFaces(cubeFaces);
  }
}

function setParserDebug(debug) {
  if (!debug?.overlayImage) {
    clearParserDebug();
    return;
  }
  parserDebugImage.src = debug.overlayImage;
  parserDebug.hidden = true;
  debugOverlayButton.disabled = false;
  debugOverlayButton.textContent = "Show parser overlay";
  const crop = debug.crop;
  const cropText =
    crop && debug.detectionSource !== "original"
      ? `crop ${crop.width}x${crop.height} @ ${crop.x},${crop.y}`
      : "full image";
  parserDebugMeta.textContent = `${debug.detectionSource || "original"} - ${cropText}`;
}

function clearParserDebug() {
  parserDebug.hidden = true;
  parserDebugImage.removeAttribute("src");
  parserDebugMeta.textContent = "";
  debugOverlayButton.disabled = true;
  debugOverlayButton.textContent = "Show parser overlay";
}

document.addEventListener("rubik3d-ready", syncCube3d);

document.addEventListener("keydown", (event) => {
  if (isTextInput(event.target)) return;
  if (!solutionStates.length) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    stopPlayback();
    goToStep(currentStep - 1, { animate: true });
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    stopPlayback();
    goToStep(currentStep + 1, { animate: true });
  }
  if (event.key === "Home") {
    event.preventDefault();
    stopPlayback();
    goToStep(0, { animate: false });
  }
  if (event.key === "End") {
    event.preventDefault();
    stopPlayback();
    goToStep(solutionStates.length - 1, { animate: false });
  }
});

initPalette();
document.querySelectorAll("input[name='solverQuality']").forEach((input) => {
  input.addEventListener("change", () => {
    qualityHint.textContent = QUALITY_HINTS[selectedSolveQuality()];
  });
});
qualityHint.textContent = QUALITY_HINTS[selectedSolveQuality()];
renderCube();
