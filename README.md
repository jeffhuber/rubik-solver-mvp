# Rubik Solver MVP

A Railway-ready web MVP for solving a Rubik's Cube from either:

- a random generated scramble, or
- a Ruwix-style flattened six-face cube net screenshot.

The app intentionally starts with structured cube-net images rather than arbitrary cube photos. That keeps the first vision milestone deterministic: all 54 stickers are visible, aligned, and reviewable before solving.

## Local Development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:8080`.

## Test With Example Images

```bash
python -m rubik_solver.net_parser "/path/to/ruwix screenshot.jpg"
```

## Railway

Railway should run this app through Docker. The container listens on `$PORT` when provided, with a local fallback of `8080`.

Suggested Railway setup:

1. Create a new Railway project.
2. Choose "Deploy from GitHub repo" and select `jeffhuber/rubik-solver-mvp`.
3. Railway should detect the root `Dockerfile`.
4. The included `railway.json` sets the builder to Dockerfile and the healthcheck path to `/healthz`.
5. Generate a public Railway domain after the first successful deploy.
