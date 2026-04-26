import random
from typing import Dict, Iterable, List, Sequence, Tuple

import kociemba

from .constants import COLOR_ORDER, DEFAULT_FACE_COLORS, FACE_ORDER, MOVE_FACES

Faces = Dict[str, List[str]]


class CubeStateError(ValueError):
    """Raised when a submitted cube state cannot be solved."""


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
        for color in faces.get(face, []):
            counts[color] = counts.get(color, 0) + 1
    return counts


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


def solve_faces(faces: Faces) -> List[str]:
    facelets = faces_to_facelets(faces)
    try:
        solution = kociemba.solve(facelets)
    except Exception as exc:
        raise CubeStateError(f"Kociemba could not solve this cube state: {exc}") from exc
    return [] if solution == "" else solution.split()


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


def random_scramble_state(length: int = 20) -> Tuple[List[str], Faces, List[str]]:
    scramble = generate_scramble(length)
    faces = facelets_to_color_faces(apply_moves(solved_facelets(), scramble))
    try:
        solution = solve_faces(faces)
    except CubeStateError:
        solution = invert_moves(scramble)
    return scramble, faces, solution


def solved_facelets() -> str:
    return "".join(face * 9 for face in FACE_ORDER)


def facelets_to_color_faces(facelets: str) -> Faces:
    if len(facelets) != 54:
        raise CubeStateError("Facelet string must contain 54 characters.")
    face_to_color = {face: DEFAULT_FACE_COLORS[face] for face in FACE_ORDER}
    faces = {}
    offset = 0
    for face in FACE_ORDER:
        faces[face] = [face_to_color[ch] for ch in facelets[offset : offset + 9]]
        offset += 9
    return faces


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
        state = _apply_clockwise_turn(state, face)
    return state


def _apply_clockwise_turn(facelets: str, face: str) -> str:
    index_to_coord = _index_to_coord_map()
    coord_to_index = {value: key for key, value in index_to_coord.items()}
    axis, layer, sign = _turn_definition(face)
    result = list(facelets)

    for index, coord in index_to_coord.items():
        position, normal = coord
        if position[axis] != layer:
            continue
        new_position = _rotate_tuple(position, axis, sign)
        new_normal = _rotate_tuple(normal, axis, sign)
        result[coord_to_index[(new_position, new_normal)]] = facelets[index]

    return "".join(result)


def _turn_definition(face: str) -> Tuple[int, int, int]:
    # axis: x=0, y=1, z=2. sign is a quarter turn in right-handed coordinates.
    return {
        "R": (0, 1, 1),
        "L": (0, -1, -1),
        "U": (1, 1, 1),
        "D": (1, -1, -1),
        "F": (2, 1, -1),
        "B": (2, -1, 1),
    }[face]


def _rotate_tuple(values: Tuple[int, int, int], axis: int, sign: int) -> Tuple[int, int, int]:
    x, y, z = values
    if axis == 0:
        return (x, -sign * z, sign * y)
    if axis == 1:
        return (sign * z, y, -sign * x)
    return (sign * y, -sign * x, z)


def _index_to_coord_map() -> Dict[int, Tuple[Tuple[int, int, int], Tuple[int, int, int]]]:
    mapping = {}
    index = 0
    for face in FACE_ORDER:
        for row in range(3):
            for col in range(3):
                mapping[index] = (_facelet_position(face, row, col), _face_normal(face))
                index += 1
    return mapping


def _face_normal(face: str) -> Tuple[int, int, int]:
    return {
        "U": (0, 1, 0),
        "D": (0, -1, 0),
        "F": (0, 0, 1),
        "B": (0, 0, -1),
        "R": (1, 0, 0),
        "L": (-1, 0, 0),
    }[face]


def _facelet_position(face: str, row: int, col: int) -> Tuple[int, int, int]:
    if face == "U":
        return (col - 1, 1, row - 1)
    if face == "D":
        return (col - 1, -1, 1 - row)
    if face == "F":
        return (col - 1, 1 - row, 1)
    if face == "B":
        return (1 - col, 1 - row, -1)
    if face == "R":
        return (1, 1 - row, 1 - col)
    if face == "L":
        return (-1, 1 - row, col - 1)
    raise CubeStateError(f"Unknown face: {face}")


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
