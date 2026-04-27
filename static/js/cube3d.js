import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const COLOR_HEX = {
  white: 0xf8f8f4,
  yellow: 0xf3ed12,
  red: 0xee2e32,
  orange: 0xf5a623,
  blue: 0x2865e8,
  green: 0x56ce6e,
};

const DEFAULT_FACES = {
  U: Array(9).fill("yellow"),
  R: Array(9).fill("red"),
  F: Array(9).fill("blue"),
  D: Array(9).fill("white"),
  L: Array(9).fill("orange"),
  B: Array(9).fill("green"),
};

const MOVE_DEFINITIONS = {
  U: { axis: "y", layer: 1, axisSign: 1 },
  D: { axis: "y", layer: -1, axisSign: -1 },
  R: { axis: "x", layer: 1, axisSign: 1 },
  L: { axis: "x", layer: -1, axisSign: -1 },
  F: { axis: "z", layer: 1, axisSign: 1 },
  B: { axis: "z", layer: -1, axisSign: -1 },
};

const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const CUBIE_SPACING = 1.03;
const CUBIE_SIZE = 0.96;
const STICKER_SIZE = 0.72;
const STICKER_OFFSET = 0.492;
const TURN_DURATION_MS = 520;

const canvas = document.getElementById("cube3dCanvas");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
const cubeGroup = new THREE.Group();
const cubies = [];
const stickerMaterials = new Map();
const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x121820,
  roughness: 0.66,
});

let activeTurn = null;
let isDragging = false;
let lastPointer = { x: 0, y: 0 };

camera.position.set(5.2, 4.1, 6.2);
camera.lookAt(0, 0, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);

scene.add(new THREE.AmbientLight(0xffffff, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(5, 7, 4);
scene.add(keyLight);

cubeGroup.rotation.set(0, 0, 0);
scene.add(cubeGroup);

buildCube();
applyFaces(DEFAULT_FACES);
resize();
animate();

window.Rubik3D = {
  animateMove,
  isAnimating: () => Boolean(activeTurn),
  setFaces,
};
document.dispatchEvent(new Event("rubik3d-ready"));

function buildCube() {
  const cubieByCoord = new Map();
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        const group = new THREE.Group();
        const core = new THREE.Mesh(new THREE.BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE), bodyMaterial);
        group.add(core);
        group.position.set(x * CUBIE_SPACING, y * CUBIE_SPACING, z * CUBIE_SPACING);
        cubeGroup.add(group);

        const cubie = { coord: { x, y, z }, group };
        cubies.push(cubie);
        cubieByCoord.set(coordKey(x, y, z), cubie);
      }
    }
  }

  FACE_ORDER.forEach((face) => {
    for (let index = 0; index < 9; index += 1) {
      const placement = facePlacement(face, index);
      const cubie = cubieByCoord.get(coordKey(placement.coord.x, placement.coord.y, placement.coord.z));
      if (!cubie) continue;
      const material = new THREE.MeshStandardMaterial({
        color: COLOR_HEX.white,
        metalness: 0.02,
        roughness: 0.45,
        side: THREE.DoubleSide,
      });
      const sticker = new THREE.Mesh(new THREE.PlaneGeometry(STICKER_SIZE, STICKER_SIZE), material);
      sticker.position.copy(placement.position);
      sticker.rotation.copy(placement.rotation);
      cubie.group.add(sticker);
      stickerMaterials.set(`${face}-${index}`, material);
    }
  });
}

function facePlacement(face, index) {
  const row = Math.floor(index / 3);
  const col = index % 3;
  const x = col - 1;
  const y = 1 - row;
  const rotation = new THREE.Euler();
  const position = new THREE.Vector3();
  let coord;

  if (face === "F") {
    coord = { x, y, z: 1 };
    position.set(0, 0, STICKER_OFFSET);
  } else if (face === "B") {
    coord = { x: 1 - col, y, z: -1 };
    position.set(0, 0, -STICKER_OFFSET);
    rotation.y = Math.PI;
  } else if (face === "R") {
    coord = { x: 1, y, z: 1 - col };
    position.set(STICKER_OFFSET, 0, 0);
    rotation.y = Math.PI / 2;
  } else if (face === "L") {
    coord = { x: -1, y, z: col - 1 };
    position.set(-STICKER_OFFSET, 0, 0);
    rotation.y = -Math.PI / 2;
  } else if (face === "U") {
    coord = { x, y: 1, z: row - 1 };
    position.set(0, STICKER_OFFSET, 0);
    rotation.x = -Math.PI / 2;
  } else {
    coord = { x, y: -1, z: 1 - row };
    position.set(0, -STICKER_OFFSET, 0);
    rotation.x = Math.PI / 2;
  }

  return { coord, position, rotation };
}

function setFaces(faces) {
  finishActiveTurn(false);
  applyFaces(faces || DEFAULT_FACES);
}

function applyFaces(faces) {
  resetCubies();
  const nextFaces = faces || DEFAULT_FACES;
  Object.entries(nextFaces).forEach(([face, stickers]) => {
    stickers.forEach((color, index) => {
      const material = stickerMaterials.get(`${face}-${index}`);
      if (!material) return;
      material.color.setHex(COLOR_HEX[color] || 0xb8c1cc);
      material.needsUpdate = true;
    });
  });
}

function resetCubies() {
  cubies.forEach((cubie) => {
    cubeGroup.attach(cubie.group);
    cubie.group.position.set(
      cubie.coord.x * CUBIE_SPACING,
      cubie.coord.y * CUBIE_SPACING,
      cubie.coord.z * CUBIE_SPACING
    );
    cubie.group.rotation.set(0, 0, 0);
    cubie.group.scale.set(1, 1, 1);
    cubie.group.updateMatrixWorld();
  });
}

function animateMove(move, nextFaces) {
  const info = moveInfo(move);
  if (!info) {
    setFaces(nextFaces);
    return Promise.resolve();
  }

  finishActiveTurn(true);
  const layerGroup = new THREE.Group();
  cubeGroup.add(layerGroup);

  const movingCubies = cubies.filter((cubie) => cubie.coord[info.axis] === info.layer);
  movingCubies.forEach((cubie) => {
    layerGroup.attach(cubie.group);
  });

  return new Promise((resolve) => {
    activeTurn = {
      axis: info.axis,
      layerGroup,
      movingCubies,
      nextFaces: nextFaces || DEFAULT_FACES,
      resolve,
      startedAt: performance.now(),
      targetAngle: info.angle,
    };
  });
}

function moveInfo(move) {
  if (!move || !MOVE_DEFINITIONS[move[0]]) return null;
  const definition = MOVE_DEFINITIONS[move[0]];
  let angle = -definition.axisSign * (Math.PI / 2);
  if (move.endsWith("'")) angle *= -1;
  if (move.endsWith("2")) angle *= 2;
  return { ...definition, angle };
}

function finishActiveTurn(applyFinalFaces) {
  if (!activeTurn) return;
  activeTurn.layerGroup.rotation[activeTurn.axis] = activeTurn.targetAngle;
  activeTurn.movingCubies.forEach((cubie) => {
    cubeGroup.attach(cubie.group);
  });
  cubeGroup.remove(activeTurn.layerGroup);

  const { nextFaces, resolve } = activeTurn;
  activeTurn = null;
  if (applyFinalFaces) applyFaces(nextFaces);
  if (resolve) resolve();
}

function resize() {
  const parent = canvas.parentElement;
  const width = Math.max(1, parent.clientWidth);
  const height = Math.max(1, parent.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  if (activeTurn) {
    const progress = Math.min(1, (now - activeTurn.startedAt) / TURN_DURATION_MS);
    activeTurn.layerGroup.rotation[activeTurn.axis] = activeTurn.targetAngle * easeInOutCubic(progress);
    if (progress >= 1) finishActiveTurn(true);
  }
  renderer.render(scene, camera);
}

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function coordKey(x, y, z) {
  return `${x},${y},${z}`;
}

canvas.addEventListener("pointerdown", (event) => {
  isDragging = true;
  lastPointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!isDragging) return;
  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;
  cubeGroup.rotation.y += dx * 0.008;
  cubeGroup.rotation.x += dy * 0.008;
  cubeGroup.rotation.x = Math.max(-1.35, Math.min(1.35, cubeGroup.rotation.x));
  lastPointer = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener("pointerup", (event) => {
  isDragging = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", () => {
  isDragging = false;
});

new ResizeObserver(resize).observe(canvas.parentElement);
