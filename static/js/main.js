const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const DISPLAY_FACE_ORDER = ["U", "L", "F", "R", "B", "D"];
const COLORS = ["white", "yellow", "red", "orange", "blue", "green"];

let cubeFaces = null;
let selectedColor = "white";

const statusPill = document.getElementById("statusPill");
const cubeNet = document.getElementById("cubeNet");
const counts = document.getElementById("counts");
const palette = document.getElementById("palette");
const solveButton = document.getElementById("solveButton");
const reviewMeta = document.getElementById("reviewMeta");
const movesEl = document.getElementById("moves");
const instructionsEl = document.getElementById("instructions");
const moveCount = document.getElementById("moveCount");
const scrambleBox = document.getElementById("scrambleBox");

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
      sticker.addEventListener("click", () => {
        cubeFaces[face][index] = selectedColor;
        clearSolution();
        renderCube();
      });
      faceEl.appendChild(sticker);
    });
    cubeNet.appendChild(faceEl);
  });

  solveButton.disabled = !hasValidCounts();
  renderCounts();
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
  movesEl.innerHTML = "";
  instructionsEl.innerHTML = "";
  moveCount.textContent = "";
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
    cubeFaces = data.faces;
    reviewMeta.textContent = data.warnings && data.warnings.length ? data.warnings[0] : "Detected from image";
    scrambleBox.style.display = "none";
    renderCube();
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
    cubeFaces = data.faces;
    reviewMeta.textContent = "Generated scramble";
    scrambleBox.style.display = "block";
    scrambleBox.textContent = data.scramble.join(" ");
    renderCube();
    renderSolution(data);
    setStatus("Generated");
  } catch (error) {
    setStatus(error.message, true);
  }
});

solveButton.addEventListener("click", async () => {
  if (!cubeFaces) return;
  setStatus("Solving...");
  clearSolution();
  try {
    const data = await postJson("/api/solve", { faces: cubeFaces });
    renderSolution(data);
    setStatus("Solved");
  } catch (error) {
    setStatus(error.message, true);
  }
});

function renderSolution(data) {
  movesEl.innerHTML = "";
  instructionsEl.innerHTML = "";
  moveCount.textContent = `${data.moveCount} moves`;
  data.moves.forEach((move) => {
    const chip = document.createElement("div");
    chip.className = "move-chip";
    chip.textContent = move;
    movesEl.appendChild(chip);
  });
  data.instructions.forEach((instruction) => {
    const item = document.createElement("li");
    item.textContent = instruction;
    instructionsEl.appendChild(item);
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

initPalette();
renderCube();
