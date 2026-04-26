import os

from flask import Flask, jsonify, render_template, request

from rubik_solver.cube import CubeStateError, move_to_instruction, random_scramble_state, solve_faces
from rubik_solver.net_parser import NetParseError, parse_image_bytes

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/detect-net")
def detect_net():
    upload = request.files.get("image")
    if upload is None or upload.filename == "":
        return _error("Upload a Ruwix-style cube-net image.", 400)

    try:
        result = parse_image_bytes(upload.read())
    except NetParseError as exc:
        return _error(str(exc), 422)

    return jsonify(result)


@app.post("/api/solve")
def solve():
    payload = request.get_json(silent=True) or {}
    faces = payload.get("faces")
    if not isinstance(faces, dict):
        return _error("Request JSON must include a faces object.", 400)

    try:
        moves = solve_faces(faces)
    except CubeStateError as exc:
        return _error(str(exc), 422)

    return jsonify(
        {
            "moves": moves,
            "instructions": [move_to_instruction(move) for move in moves],
            "moveCount": len(moves),
        }
    )


@app.post("/api/random")
def random_state():
    payload = request.get_json(silent=True) or {}
    try:
        length = int(payload.get("length", 20))
    except (TypeError, ValueError):
        length = 20

    scramble, faces, solution = random_scramble_state(length)
    return jsonify(
        {
            "scramble": scramble,
            "faces": faces,
            "moves": solution,
            "instructions": [move_to_instruction(move) for move in solution],
            "moveCount": len(solution),
        }
    )


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


def _error(message, status):
    return jsonify({"error": message}), status


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=True)
