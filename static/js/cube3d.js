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
const stickerMaterials = new Map();

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

cubeGroup.rotation.set(-0.45, 0.68, 0.08);
scene.add(cubeGroup);

buildCube();
setFaces(DEFAULT_FACES);
resize();
animate();

window.Rubik3D = { setFaces };
document.dispatchEvent(new Event("rubik3d-ready"));

function buildCube() {
  ["U", "R", "F", "D", "L", "B"].forEach((face) => {
    for (let index = 0; index < 9; index += 1) {
      const group = new THREE.Group();
      const row = Math.floor(index / 3);
      const col = index % 3;

      const backing = new THREE.Mesh(
        new THREE.PlaneGeometry(0.94, 0.94),
        new THREE.MeshStandardMaterial({ color: 0x121820, roughness: 0.62 })
      );
      const material = new THREE.MeshStandardMaterial({
        color: COLOR_HEX.white,
        roughness: 0.48,
        metalness: 0.02,
      });
      const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78), material);
      sticker.position.z = 0.012;

      group.add(backing);
      group.add(sticker);
      placeSticker(group, face, row, col);
      cubeGroup.add(group);
      stickerMaterials.set(`${face}-${index}`, material);
    }
  });
}

function placeSticker(group, face, row, col) {
  const offset = 1.51;
  const x = col - 1;
  const y = 1 - row;

  if (face === "F") {
    group.position.set(x, y, offset);
  } else if (face === "B") {
    group.position.set(1 - col, y, -offset);
    group.rotation.y = Math.PI;
  } else if (face === "R") {
    group.position.set(offset, y, 1 - col);
    group.rotation.y = Math.PI / 2;
  } else if (face === "L") {
    group.position.set(-offset, y, col - 1);
    group.rotation.y = -Math.PI / 2;
  } else if (face === "U") {
    group.position.set(x, offset, row - 1);
    group.rotation.x = -Math.PI / 2;
  } else if (face === "D") {
    group.position.set(x, -offset, 1 - row);
    group.rotation.x = Math.PI / 2;
  }
}

function setFaces(faces) {
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

function resize() {
  const parent = canvas.parentElement;
  const width = Math.max(1, parent.clientWidth);
  const height = Math.max(1, parent.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (!isDragging) cubeGroup.rotation.y += 0.003;
  renderer.render(scene, camera);
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
