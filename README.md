# Rubik Solver MVP

Production: [https://rubik-solver-mvp-production.up.railway.app](https://rubik-solver-mvp-production.up.railway.app)

A Railway-ready web MVP for solving a Rubik's Cube from either:

- a randomly generated scramble, or
- a Ruwix-style flattened six-face cube net screenshot.

The app intentionally starts with structured cube-net images rather than arbitrary cube photos. That keeps the first vision milestone deterministic: all 54 stickers are visible, aligned, and reviewable before solving.

Flattened net screenshots can be selected with the file picker, dragged onto the upload target, or pasted from the clipboard.

After detection, the app shows sticker counts, center validation, low-confidence/auto-balanced sticker flags, a focused sticker review panel, manual click-to-paint correction, a parser debug overlay, parser fixture export, selectable solver quality, a move timeline, keyboard step-through controls, playback speed, copy/download/share actions, and a live Three.js cube view with animated layer turns.

Parser fixtures are downloaded as self-contained JSON files containing the original image data URL, detected faces, corrected/expected faces, diagnostics, grid metadata, and debug overlay. They are intended for capturing real parsing edge cases; placing them under `tests/fixtures/parser/` promotes them into smoke-test regression fixtures.

Solution sharing is stateless: the share action creates a URL fragment containing the reviewed starting state, solution moves, optional generated scramble, and solver metadata. Opening that link reconstructs the solution through `/api/replay`; no database-backed saved cases are required.

## Local Development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:8080`.

## Docker Local Run

```bash
docker build -t rubik-solver-mvp .
docker run --rm -p 8080:8080 -e PORT=8080 rubik-solver-mvp
```

Then open `http://localhost:8080`.

## Parse Example Images

```bash
python -m rubik_solver.net_parser "/path/to/ruwix screenshot.jpg"
python -m rubik_solver.net_parser "/path/to/ruwix screenshot.jpg" --solve
python -m rubik_solver.net_parser "/path/to/ruwix screenshot.jpg" --debug-overlay /tmp/parser-overlay.png
```

## Smoke Tests

```bash
python -m compileall app.py rubik_solver tests
node --check static/js/main.js
node --check static/js/cube3d.js
python tests/smoke_test.py
python tests/smoke_test.py "/path/to/ruwix screenshot.jpg"
```

## Current Limitations

- The image parser expects a Ruwix-style 12 by 9 unfolded cube net.
- Uploads must be JPEG or PNG files under 8 MB.
- Arbitrary cube photos, partial cube photos, and three-face perspective photos are not supported yet.
- Solver accuracy still depends on reviewing and correcting any flagged stickers before solving.
- The "Try 20" solver mode is bounded by a timeout. It commonly finds a 20-move-or-less solution, but falls back to a faster solve if the tighter search does not finish.
- Parser detection now retries against cropped image candidates and exposes a visual overlay, but it still needs visible sticker borders or a clean Ruwix-style net structure.

## Licensing

Original application code in this repository is licensed under the MIT License; see `LICENSE`.

Third-party software remains under its own licenses; see `THIRD_PARTY_NOTICES.md`. In particular, the current `kociemba` solver dependency is GPLv2, so review that license before redistributing packaged copies, binaries, Docker images, or modified dependency code.

## Frontend Dependency

Three.js is vendored at `static/vendor/three.module.min.js` and imported locally by `static/js/cube3d.js`. That removes the previous runtime dependency on the `unpkg.com` CDN, so the 3D viewer can load in local and production environments without fetching external JavaScript.

Bundling tradeoffs:

- Better reliability for local/offline demos and production deploys because the app serves a pinned Three.js build itself.
- More deterministic behavior because upgrades happen only when the vendored file is intentionally refreshed.
- Slightly larger repository and Docker image size; the current minified module is about 674 KB.
- No shared browser cache from a public CDN, though normal app static-file caching still applies.
- Security and bugfix updates are manual: refresh the vendored file, verify the 3D viewer, and keep the license header intact.

## Railway

Railway should run this app through Docker. The container listens on `$PORT` when provided, with a local fallback of `8080`.

The active Railway service is connected to the `main` branch.
New commits to `main` trigger a Railway deployment.

`Dockerfile` and `railway.json` are the deployment source of truth; no Procfile is required.

Suggested Railway setup:

1. Create a new Railway project.
2. Choose "Deploy from GitHub repo" and select `jeffhuber/rubik-solver-mvp`.
3. Railway should detect the root `Dockerfile`.
4. The included `railway.json` sets the builder to Dockerfile and the healthcheck path to `/healthz`.
5. Generate a public Railway domain after the first successful deploy.
