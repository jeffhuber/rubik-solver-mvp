const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const DISPLAY_FACE_ORDER = ["U", "L", "F", "R", "B", "D"];
const COLORS = ["white", "yellow", "red", "orange", "blue", "green"];

let reviewedFaces = null;
let cubeFaces = null;
let selectedColor = "white";
let solutionStates = [];
let solutionMoves = [];
let solutionInstructions = [];
let currentStep = 0;

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
const fileLabel = document.getElementById("fileLabel");

function cloneFaces(faces) {
  return JSON.parse(JSON.stringify(faces));
}

function setStatus(message, isError = false) {
  statusPill.textContent = message;
  statusPill.classList.toggle("is-error", isError);
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
    return;
  }

  DISPLAY_FACE_ORDER.forEach((face) => {
    const faceEl = document.createElement("div");
    faceEl.className = `face face-${face}`;
    faceEl.setAttribute("aria-label", `${face} face`);
    cubeFaces[face].forEach((color, index) => {
      const sticker = document.createElement("button");
      sticker.type = "button";
      sticker.className = `sticker color-${color}`;
      sticker.dataset.label = index === 4 ? face : "";
      sticker.title = `${face}${index + 1}: ${color}`;
      sticker.disabled = !canEditStickers();
      sticker.addEventListener("click", () => {
        if (!canEditStickers()) return;
        if (solutionStates.length) clearSolution();
        if (!reviewedFaces) reviewedFaces = cloneFaces(cubeFaces);
        reviewedFaces[face][index] = selectedColor;
        cubeFaces[face][index] = selectedColor;
        renderCube();
      });
      faceEl.appendChild(sticker);
    });
    cubeNet.appendChild(faceEl);
  });

  solveButton.disabled = !hasValidCounts();
  renderCounts();
}

function canEditStickers() {
  return solutionStates.length === 0 || currentStep === 0;
}

function renderCounts() {
  counts.innerHTML = "";
  const totals = Object.fromEntries(COLORS.map((color) => [color, 0]));
  if (cubeFaces) {
    FACE_ORDER.forEach((face) => {
      cubeFaces[face].forEach((color) => {
        totals[color] += 1;
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
}

function hasValidCounts() {
  if (!cubeFaces) return false;
  const totals = Object.fromEntries(COLORS.map((color) => [color, 0]));
  FACE_ORDER.forEach((face) => {
    if (!cubeFaces[face] || cubeFaces[face].length !== 9) return false;
    cubeFaces[face].forEach((color) => {
      totals[color] += 1;
    });
  });
  return COLORS.every((color) => totals[color] === 9);
}

function clearSolution() {
  solutionStates = [];
  solutionMoves = [];
  solutionInstructions = [];
  currentStep = 0;
  stepper.hidden = true;
  movesEl.innerHTML = "";
  instructionsEl.innerHTML = "";
  moveCount.textContent = "";
  stepContext.textContent = reviewedFaces
    ? "Review and correct the starting state before solving."
    : "Load a cube net or random scramble to begin.";
  if (reviewedFaces) cubeFaces = cloneFaces(reviewedFaces);
  renderPlaybackControls();
}

function setReviewedFaces(faces, metaText) {
  reviewedFaces = cloneFaces(faces);
  cubeFaces = cloneFaces(faces);
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
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

document.getElementById("detectButton").addEventListener("click", async () => {
  const fileInput = document.getElementById("netImage");
  const file = fileInput.files[0];
  if (!file) {
    setStatus("Choose an image", true);
    return;
  }

  const body = new FormData();
  body.append("image", file);
  setStatus("Detecting...");
  clearSolution();
  try {
    const response = await fetch("/api/detect-net", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Detection failed");
    setReviewedFaces(
      data.faces,
      data.warnings && data.warnings.length ? data.warnings[0] : "Detected from image"
    );
    scrambleBox.style.display = "none";
    setStatus("Detected");
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("randomButton").addEventListener("click", async () => {
  const length = Number(document.getElementById("scrambleLength").value || 20);
  setStatus("Generating...");
  clearSolution();
  try {
    const data = await postJson("/api/random", { length });
    setReviewedFaces(data.faces, "Generated scramble");
    scrambleBox.style.display = "block";
    scrambleBox.textContent = data.scramble.join(" ");
    renderSolution(data);
    setStatus("Generated");
  } catch (error) {
    setStatus(error.message, true);
  }
});

solveButton.addEventListener("click", async () => {
  if (!reviewedFaces) return;
  setStatus("Solving...");
  clearSolution();
  try {
    const data = await postJson("/api/solve", { faces: reviewedFaces });
    renderSolution(data);
    setStatus("Solved");
  } catch (error) {
    setStatus(error.message, true);
  }
});

function renderSolution(data) {
  movesEl.innerHTML = "";
  instructionsEl.innerHTML = "";
  solutionStates = data.states || [];
  solutionMoves = data.moves || [];
  solutionInstructions = data.instructions || [];
  moveCount.textContent = `${data.moveCount} moves`;
  solutionMoves.forEach((move, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "move-chip";
    chip.textContent = move;
    chip.title = `Jump to step ${index + 1}`;
    chip.addEventListener("click", () => goToStep(index + 1));
    movesEl.appendChild(chip);
  });
  solutionInstructions.forEach((instruction, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "instruction-button";
    button.textContent = instruction;
    button.addEventListener("click", () => goToStep(index + 1));
    item.appendChild(button);
    instructionsEl.appendChild(item);
  });
  if (solutionStates.length) {
    stepper.hidden = false;
    goToStep(0);
  }
}

function goToStep(step) {
  if (!solutionStates.length) return;
  currentStep = Math.max(0, Math.min(step, solutionStates.length - 1));
  cubeFaces = cloneFaces(solutionStates[currentStep]);
  renderCube();
  renderPlaybackControls();
}

function renderPlaybackControls() {
  if (!solutionStates.length) {
    stepLabel.textContent = "Step 0";
    stepMove.textContent = "Starting state";
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

  document.getElementById("firstStep").disabled = currentStep === 0;
  document.getElementById("prevStep").disabled = currentStep === 0;
  document.getElementById("nextStep").disabled = currentStep === solutionStates.length - 1;
  document.getElementById("lastStep").disabled = currentStep === solutionStates.length - 1;

  document.querySelectorAll(".move-chip").forEach((chip, index) => {
    chip.classList.toggle("is-active", currentStep === index + 1);
  });
  document.querySelectorAll(".instruction-button").forEach((button, index) => {
    button.classList.toggle("is-active", currentStep === index + 1);
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
document.getElementById("firstStep").addEventListener("click", () => goToStep(0));
document.getElementById("prevStep").addEventListener("click", () => goToStep(currentStep - 1));
document.getElementById("nextStep").addEventListener("click", () => goToStep(currentStep + 1));
document.getElementById("lastStep").addEventListener("click", () => {
  if (solutionStates.length) goToStep(solutionStates.length - 1);
});
document.getElementById("netImage").addEventListener("change", (event) => {
  const file = event.target.files[0];
  fileLabel.textContent = file ? file.name : "Choose a Ruwix-style flattened cube image";
});
document.addEventListener("keydown", (event) => {
  if (!solutionStates.length) return;
  if (event.key === "ArrowLeft") goToStep(currentStep - 1);
  if (event.key === "ArrowRight") goToStep(currentStep + 1);
});

initPalette();
renderCube();
