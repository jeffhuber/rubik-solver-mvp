import multiprocessing
import queue
import random
import time
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import kociemba
from kociemba.pykociemba.cubiecube import moveCube
from kociemba.pykociemba.facecube import FaceCube

from .constants import COLOR_ORDER, DEFAULT_FACE_COLORS, FACE_ORDER, MOVE_FACES

Faces = Dict[str, List[str]]

SOLVER_PROFILES = {
    "fast": {
        "label": "Fast",
        "target_max_moves": None,
        "attempts": [
            {"label": "Fast search", "max_depth": 24, "timeout": None},
        ],
    },
    "tighter": {
        "label": "Tighter",
        "target_max_moves": 21,
        "attempts": [
            {"label": "21-move search", "max_depth": 21, "timeout": 3.0},
            {"label": "Fast fallback", "max_depth": 24, "timeout": None},
        ],
    },
    "god20": {
        "label": "Try 20",
        "target_max_moves": 20,
        "attempts": [
            {"label": "20-move search", "max_depth": 20, "timeout": 6.0},
            {"label": "21-move fallback", "max_depth": 21, "timeout": 3.0},
            {"label": "Fast fallback", "max_depth": 24, "timeout": None},
        ],
    },
}


class CubeStateError(ValueError):
    """Raised when a submitted cube state cannot be solved."""


class SolveAttemptTimeout(TimeoutError):
    """Raised when a bounded solver attempt exceeds its time budget."""


@dataclass
class SolveResult:
    moves: List[str]
    quality: str
    quality_label: str
    max_depth: int
    target_max_moves: Optional[int]
    used_fallback: bool
    attempts: List[Dict]

    def metadata(self) -> Dict:
        move_count = len(self.moves)
        if self.used_fallback and self.target_max_moves and move_count <= self.target_max_moves:
            message = (
                f"{self.quality_label} fallback still found a "
                f"{move_count}-move solution."
            )
        elif self.used_fallback and self.target_max_moves:
            message = (
                f"{self.quality_label} fell back to a {move_count}-move solution "
                f"after the tighter search did not finish."
            )
        elif self.target_max_moves and move_count <= self.target_max_moves:
            message = f"{self.quality_label} found a {move_count}-move solution."
        else:
            message = f"{self.quality_label} found a {move_count}-move solution."

        return {
            "quality": self.quality,
            "qualityLabel": self.quality_label,
            "maxDepth": self.max_depth,
            "targetMaxMoves": self.target_max_moves,
            "usedFallback": self.used_fallback,
            "attempts": self.attempts,
            "message": message,
        }


def solved_faces() -> Faces:
    return {face: [DEFAULT_FACE_COLORS[face]] * 9 for face in FACE_ORDER}


def copy_faces(faces: Faces) -> Faces:
    return {face: list(stickers) for face, stickers in faces.items()}


def validate_faces_shape(faces: Faces) -> None:
    missing = [face for face in FACE_ORDER if face not in faces]
    if missing:
        raise CubeStateError(f"Missing faces: {', '.join(missing)}")

    for face in FACE_ORDER:
        if len(faces[face]) != 9:
            raise CubeStateError(f"Face {face} must contain exactly 9 stickers.")
        unknown = sorted(set(faces[face]) - set(COLOR_ORDER))
        if unknown:
            raise CubeStateError(f"Face {face} contains unknown colors: {', '.join(unknown)}")


def sticker_counts(faces: Faces) -> Dict[str, int]:
    counts = {color: 0 for color in COLOR_ORDER}
    for face in FACE_ORDER:
        stickers = faces.get(face, []) if isinstance(faces, dict) else []
        if not isinstance(stickers, list):
            continue
        for color in stickers:
            counts[color] = counts.get(color, 0) + 1
    return counts


def validate_faces_report(faces: Faces) -> Dict:
    issues = []
    counts = sticker_counts(faces) if isinstance(faces, dict) else {color: 0 for color in COLOR_ORDER}
    centers = {}

    if not isinstance(faces, dict):
        return {
            "ok": False,
            "counts": counts,
            "centers": centers,
            "issues": ["Cube state must be a faces object."],
        }

    missing = [face for face in FACE_ORDER if face not in faces]
    if missing:
        issues.append(f"Missing faces: {', '.join(missing)}")

    for face in FACE_ORDER:
        stickers = faces.get(face)
        if not isinstance(stickers, list) or len(stickers) != 9:
            issues.append(f"Face {face} must contain exactly 9 stickers.")
            continue
        unknown = sorted(set(stickers) - set(COLOR_ORDER))
        if unknown:
            issues.append(f"Face {face} contains unknown colors: {', '.join(unknown)}")
        centers[face] = stickers[4]

    bad_counts = {color: count for color, count in counts.items() if count != 9}
    if bad_counts:
        details = ", ".join(f"{color}={count}" for color, count in sorted(bad_counts.items()))
        issues.append(f"Each color must appear exactly 9 times ({details}).")

    center_values = [centers[face] for face in FACE_ORDER if face in centers]
    if len(center_values) != 6 or len(set(center_values)) != 6:
        issues.append("Center stickers must be six unique colors.")

    return {
        "ok": not issues,
        "counts": counts,
        "centers": centers,
        "issues": issues,
    }


def faces_to_facelets(faces: Faces) -> str:
    validate_faces_shape(faces)

    center_to_face = {}
    for face in FACE_ORDER:
        center = faces[face][4]
        if center in center_to_face:
            raise CubeStateError(
                f"Centers must be unique; {center} appears on both "
                f"{center_to_face[center]} and {face}."
            )
        center_to_face[center] = face

    missing_colors = set(COLOR_ORDER) - set(center_to_face)
    if missing_colors:
        raise CubeStateError(
            "Centers must include all six colors; missing "
            + ", ".join(sorted(missing_colors))
            + "."
        )

    counts = sticker_counts(faces)
    bad_counts = {color: count for color, count in counts.items() if count != 9}
    if bad_counts:
        details = ", ".join(f"{color}={count}" for color, count in sorted(bad_counts.items()))
        raise CubeStateError(f"Each color must appear exactly 9 times ({details}).")

    try:
        return "".join(center_to_face[color] for face in FACE_ORDER for color in faces[face])
    except KeyError as exc:
        raise CubeStateError(f"Color {exc.args[0]} is not represented by a center sticker.") from exc


def verify_facelets(facelets: str) -> None:
    try:
        result = FaceCube(facelets).toCubieCube().verify()
    except Exception as exc:
        raise CubeStateError(f"Cube state could not be validated: {exc}") from exc
    if result != 0:
        raise CubeStateError(f"Cube state is not physically solvable (verification error {result}).")


def solve_faces(faces: Faces, max_depth: int = 24) -> List[str]:
    facelets = faces_to_facelets(faces)
    verify_facelets(facelets)
    return _solve_facelets(facelets, max_depth)


def solve_faces_with_quality(faces: Faces, quality: str = "fast") -> SolveResult:
    facelets = faces_to_facelets(faces)
    verify_facelets(facelets)

    profile_name = quality if quality in SOLVER_PROFILES else "fast"
    profile = SOLVER_PROFILES[profile_name]
    attempts = []
    last_error = None

    for index, attempt in enumerate(profile["attempts"]):
        started = time.perf_counter()
        max_depth = attempt["max_depth"]
        timeout = attempt["timeout"]
        try:
            moves = _solve_facelets_bounded(facelets, max_depth=max_depth, timeout=timeout)
        except SolveAttemptTimeout as exc:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            attempts.append(
                {
                    "label": attempt["label"],
                    "maxDepth": max_depth,
                    "timeoutSeconds": timeout,
                    "status": "timed_out",
                    "elapsedMs": elapsed_ms,
                }
            )
            last_error = exc
            continue
        except CubeStateError as exc:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            attempts.append(
                {
                    "label": attempt["label"],
                    "maxDepth": max_depth,
                    "timeoutSeconds": timeout,
                    "status": "not_found",
                    "elapsedMs": elapsed_ms,
                    "error": str(exc),
                }
            )
            last_error = exc
            if index == len(profile["attempts"]) - 1:
                raise CubeStateError(f"Kociemba could not solve this cube state: {exc}") from exc
            continue

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        attempts.append(
            {
                "label": attempt["label"],
                "maxDepth": max_depth,
                "timeoutSeconds": timeout,
                "status": "solved",
                "elapsedMs": elapsed_ms,
                "moveCount": len(moves),
            }
        )
        return SolveResult(
            moves=moves,
            quality=profile_name,
            quality_label=profile["label"],
            max_depth=max_depth,
            target_max_moves=profile["target_max_moves"],
            used_fallback=index > 0,
            attempts=attempts,
        )

    raise CubeStateError(f"Kociemba could not solve this cube state: {last_error}")


def _solve_facelets(facelets: str, max_depth: int = 24) -> List[str]:
    try:
        solution = kociemba.solve(facelets, max_depth=max_depth)
    except Exception as exc:
        raise CubeStateError(f"Kociemba could not solve this cube state: {exc}") from exc
    return [] if solution == "" else solution.split()


def _solve_facelets_bounded(facelets: str, max_depth: int, timeout: Optional[float]) -> List[str]:
    if timeout is None:
        return _solve_facelets(facelets, max_depth)

    context = _multiprocessing_context()
    result_queue = context.Queue()
    process = context.Process(target=_solve_facelets_worker, args=(facelets, max_depth, result_queue))
    process.start()
    process.join(timeout)

    if process.is_alive():
        process.terminate()
        process.join(1)
        raise SolveAttemptTimeout(f"No solution returned within {timeout:g} seconds.")

    try:
        result = result_queue.get_nowait()
    except queue.Empty as exc:
        raise CubeStateError("Solver process exited without returning a result.") from exc

    if result["ok"]:
        return result["moves"]
    raise CubeStateError(result["error"])


def _solve_facelets_worker(facelets: str, max_depth: int, result_queue) -> None:
    try:
        result_queue.put({"ok": True, "moves": _solve_facelets(facelets, max_depth)})
    except Exception as exc:
        result_queue.put({"ok": False, "error": str(exc)})


def _multiprocessing_context():
    if "fork" in multiprocessing.get_all_start_methods():
        return multiprocessing.get_context("fork")
    return multiprocessing.get_context()


def invert_moves(moves: Sequence[str]) -> List[str]:
    inverse = []
    for move in reversed(moves):
        if move.endswith("2"):
            inverse.append(move)
        elif move.endswith("'"):
            inverse.append(move[0])
        else:
            inverse.append(move + "'")
    return inverse


def generate_scramble(length: int = 20) -> List[str]:
    length = max(1, min(length, 80))
    suffixes = ["", "'", "2"]
    moves = []
    previous_face = None
    for _ in range(length):
        choices = [face for face in MOVE_FACES if face != previous_face]
        face = random.choice(choices)
        moves.append(face + random.choice(suffixes))
        previous_face = face
    return moves


def random_scramble_faces(length: int = 20) -> Tuple[List[str], Faces]:
    scramble = generate_scramble(length)
    faces = facelets_to_color_faces(apply_moves(solved_facelets(), scramble))
    return scramble, faces


def random_scramble_state(length: int = 20) -> Tuple[List[str], Faces, List[str]]:
    scramble, faces = random_scramble_faces(length)
    try:
        solution = solve_faces(faces)
    except CubeStateError:
        solution = invert_moves(scramble)
    return scramble, faces, solution


def solved_facelets() -> str:
    return "".join(face * 9 for face in FACE_ORDER)


def facelets_to_color_faces(facelets: str) -> Faces:
    return facelets_to_faces(facelets, {face: DEFAULT_FACE_COLORS[face] for face in FACE_ORDER})


def facelets_to_faces(facelets: str, face_to_color: Dict[str, str]) -> Faces:
    if len(facelets) != 54:
        raise CubeStateError("Facelet string must contain 54 characters.")
    faces = {}
    offset = 0
    for face in FACE_ORDER:
        faces[face] = [face_to_color[ch] for ch in facelets[offset : offset + 9]]
        offset += 9
    return faces


def solution_states(faces: Faces, moves: Sequence[str]) -> List[Faces]:
    facelets = faces_to_facelets(faces)
    face_to_color = {face: faces[face][4] for face in FACE_ORDER}
    states = [facelets_to_faces(facelets, face_to_color)]
    state = facelets
    for move in moves:
        state = apply_move(state, move)
        states.append(facelets_to_faces(state, face_to_color))
    return states


def apply_moves(facelets: str, moves: Iterable[str]) -> str:
    state = facelets
    for move in moves:
        state = apply_move(state, move)
    return state


def apply_move(facelets: str, move: str) -> str:
    if not move:
        return facelets
    face = move[0]
    if face not in MOVE_FACES:
        raise CubeStateError(f"Unknown move: {move}")
    turns = 2 if move.endswith("2") else 3 if move.endswith("'") else 1
    state = facelets
    for _ in range(turns):
        state = _apply_kociemba_clockwise_turn(state, face)
    return state


def _apply_kociemba_clockwise_turn(facelets: str, face: str) -> str:
    cube = FaceCube(facelets).toCubieCube()
    cube.multiply(moveCube[MOVE_FACES.index(face)])
    return cube.toFaceCube().to_String()


def move_to_instruction(move: str) -> str:
    names = {
        "U": "top",
        "D": "bottom",
        "F": "front",
        "B": "back",
        "R": "right",
        "L": "left",
    }
    face = names.get(move[0], move[0])
    if move.endswith("2"):
        return f"Turn the {face} face 180 degrees."
    if move.endswith("'"):
        return f"Turn the {face} face counterclockwise."
    return f"Turn the {face} face clockwise."
