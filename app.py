import os

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import RequestEntityTooLarge

from rubik_solver.cube import (
    CubeStateError,
    move_to_instruction,
    random_scramble_state,
    solution_states,
    solve_faces,
)
from rubik_solver.net_parser import NetParseError, parse_image_bytes

MAX_UPLOAD_BYTES = 8 * 1024 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/detect-net")
def detect_net():
    upload = request.files.get("image")
    if upload is None:
        return _error("Upload a Ruwix-style cube-net image.", 400)

    image_bytes = upload.read()
    if not image_bytes:
        return _error("The uploaded image was empty.", 400)

    try:
        result = parse_image_bytes(image_bytes)
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
            "states": solution_states(faces, moves),
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
            "states": solution_states(faces, solution),
        }
    )


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.errorhandler(RequestEntityTooLarge)
def payload_too_large(_exc):
    return _error("Image is too large. Upload a file under 8 MB.", 413)


def _error(message, status):
    return jsonify({"error": message}), status


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=True)
