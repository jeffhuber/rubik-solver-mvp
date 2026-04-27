import os

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import RequestEntityTooLarge

from rubik_solver.cube import (
    CubeStateError,
    invert_moves,
    move_to_instruction,
    random_scramble_faces,
    solution_states,
    solve_faces_with_quality,
    validate_faces_report,
)
from rubik_solver.net_parser import NetParseError, parse_image_bytes

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
VALID_MOVES = {face + suffix for face in "UDFBRL" for suffix in ("", "'", "2")}

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
        result = parse_image_bytes(image_bytes, include_debug_image=True)
    except NetParseError as exc:
        return _error(str(exc), 422)

    result["validation"] = validate_faces_report(result["faces"])
    return jsonify(result)


@app.post("/api/solve")
def solve():
    payload = request.get_json(silent=True) or {}
    faces = payload.get("faces")
    if not isinstance(faces, dict):
        return _error("Request JSON must include a faces object.", 400)
    quality = _solver_quality(payload)

    try:
        result = solve_faces_with_quality(faces, quality)
    except CubeStateError as exc:
        return _error(str(exc), 422)

    return jsonify(_solution_payload(faces, result, validation=validate_faces_report(faces)))


@app.post("/api/replay")
def replay():
    payload = request.get_json(silent=True) or {}
    faces = payload.get("faces")
    moves = payload.get("moves")
    if not isinstance(faces, dict):
        return _error("Request JSON must include a faces object.", 400)
    if not isinstance(moves, list) or not all(isinstance(move, str) for move in moves):
        return _error("Request JSON must include a moves array.", 400)
    if len(moves) > 120:
        return _error("Shared solutions are limited to 120 moves.", 400)
    invalid_moves = [move for move in moves if move not in VALID_MOVES]
    if invalid_moves:
        return _error(f"Shared solution includes invalid moves: {', '.join(invalid_moves)}.", 400)

    try:
        states = solution_states(faces, moves)
    except CubeStateError as exc:
        return _error(str(exc), 422)

    return jsonify(
        {
            "moves": moves,
            "instructions": [move_to_instruction(move) for move in moves],
            "moveCount": len(moves),
            "states": states,
            "validation": validate_faces_report(faces),
        }
    )


@app.post("/api/validate")
def validate():
    payload = request.get_json(silent=True) or {}
    return jsonify(validate_faces_report(payload.get("faces")))


@app.post("/api/random")
def random_state():
    payload = request.get_json(silent=True) or {}
    try:
        length = int(payload.get("length", 20))
    except (TypeError, ValueError):
        length = 20
    quality = _solver_quality(payload)

    scramble, faces = random_scramble_faces(length)
    try:
        result = solve_faces_with_quality(faces, quality)
    except CubeStateError:
        fallback_solution = invert_moves(scramble)
        return jsonify(
            {
                "scramble": scramble,
                "faces": faces,
                "moves": fallback_solution,
                "instructions": [move_to_instruction(move) for move in fallback_solution],
                "moveCount": len(fallback_solution),
                "states": solution_states(faces, fallback_solution),
                "solve": {
                    "quality": "fast",
                    "qualityLabel": "Fast fallback",
                    "maxDepth": 24,
                    "targetMaxMoves": None,
                    "usedFallback": True,
                    "attempts": [],
                    "message": "Fast fallback solved this generated scramble.",
                },
            }
        )

    payload = _solution_payload(faces, result)
    payload["scramble"] = scramble
    payload["faces"] = faces
    return jsonify(payload)


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.errorhandler(RequestEntityTooLarge)
def payload_too_large(_exc):
    return _error("Image is too large. Upload a file under 8 MB.", 413)


def _error(message, status):
    return jsonify({"error": message}), status


def _solver_quality(payload):
    quality = payload.get("quality", "fast")
    return quality if quality in {"fast", "tighter", "god20"} else "fast"


def _solution_payload(faces, result, validation=None):
    moves = result.moves
    payload = {
        "moves": moves,
        "instructions": [move_to_instruction(move) for move in moves],
        "moveCount": len(moves),
        "states": solution_states(faces, moves),
        "solve": result.metadata(),
    }
    if validation is not None:
        payload["validation"] = validation
    return payload


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=True)
