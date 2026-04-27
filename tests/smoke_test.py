import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rubik_solver.constants import COLOR_RGB, FACE_NET_POSITIONS, FACE_ORDER
from app import app
from rubik_solver.cube import (
    apply_moves,
    facelets_to_color_faces,
    random_scramble_state,
    solve_faces,
    solve_faces_with_quality,
    solution_states,
    solved_facelets,
)
from rubik_solver.net_parser import parse_bgr_image, parse_image_file


def main() -> int:
    print("Random scramble smoke test")
    scramble, faces, solution = random_scramble_state(20)
    assert_is_solved(solution_states(faces, solution)[-1])
    print("Scramble:", " ".join(scramble))
    print("Solution:", " ".join(solution), f"({len(solution)} moves)")

    print("\nGenerated Ruwix-net parser smoke test")
    parsed = parse_bgr_image(render_synthetic_ruwix_net(faces))
    if parsed["faces"] != faces:
        raise AssertionError("Synthetic net parser did not recover the rendered cube state.")
    assert_is_solved(solution_states(parsed["faces"], solve_faces(parsed["faces"]))[-1])
    print("Grid:", json.dumps(parsed["grid"]))
    print("Warnings:", parsed["warnings"])

    print("\nLarge-margin parser regression test")
    margin_parsed = parse_bgr_image(render_large_margin_net(faces), include_debug_image=True)
    if margin_parsed["faces"] != faces:
        raise AssertionError("Large-margin parser did not recover the rendered cube state.")
    if not margin_parsed["debug"]["overlayImage"].startswith("data:image/png;base64,"):
        raise AssertionError("Parser debug overlay was not returned as a PNG data URL.")
    print("Detection source:", margin_parsed["debug"]["detectionSource"])

    print("\nSolver quality smoke test")
    tight_faces = facelets_to_color_faces(apply_moves(solved_facelets(), ["R", "U", "F2", "L'"]))
    tight_result = solve_faces_with_quality(tight_faces, "god20")
    assert_is_solved(solution_states(tight_faces, tight_result.moves)[-1])
    if tight_result.metadata()["quality"] != "god20":
        raise AssertionError("Solver did not preserve the requested quality profile.")
    print("Quality:", tight_result.metadata()["message"])

    with app.test_client() as client:
        response = client.post("/api/solve", json={"faces": tight_faces, "quality": "god20"})
        if response.status_code != 200:
            raise AssertionError(f"API solve failed: {response.get_data(as_text=True)}")
        payload = response.get_json()
        if payload["solve"]["quality"] != "god20":
            raise AssertionError("API solve did not return solver quality metadata.")
        assert_is_solved(payload["states"][-1])

        replay = client.post("/api/replay", json={"faces": tight_faces, "moves": payload["moves"]})
        if replay.status_code != 200:
            raise AssertionError(f"API replay failed: {replay.get_data(as_text=True)}")
        replay_payload = replay.get_json()
        if replay_payload["moveCount"] != payload["moveCount"]:
            raise AssertionError("API replay did not preserve the move count.")
        assert_is_solved(replay_payload["states"][-1])

    for path in sys.argv[1:]:
        print(f"\nImage parser smoke test: {path}")
        parsed = parse_image_file(path)
        print("Grid:", json.dumps(parsed["grid"]))
        print("Warnings:", parsed["warnings"])
        moves = solve_faces(parsed["faces"])
        assert_is_solved(solution_states(parsed["faces"], moves)[-1])
        print("Solution:", " ".join(moves), f"({len(moves)} moves)")
    return 0


def assert_is_solved(faces):
    for face in FACE_ORDER:
        center = faces[face][4]
        if faces[face] != [center] * 9:
            raise AssertionError(f"Playback did not solve face {face}: {faces[face]}")


def render_synthetic_ruwix_net(faces):
    cell = 48
    border = 2
    pad_x = 32
    pad_y = 28
    width = pad_x * 2 + cell * 12 + 150
    height = pad_y * 2 + cell * 9
    image = np.full((height, width, 3), 245, dtype=np.uint8)

    for face, (grid_x, grid_y) in FACE_NET_POSITIONS.items():
        for row in range(3):
            for col in range(3):
                index = row * 3 + col
                x0 = pad_x + (grid_x + col) * cell
                y0 = pad_y + (grid_y + row) * cell
                x1 = x0 + cell
                y1 = y0 + cell
                rgb = COLOR_RGB[faces[face][index]]
                bgr = (rgb[2], rgb[1], rgb[0])
                cv2.rectangle(image, (x0, y0), (x1, y1), (8, 8, 8), thickness=-1)
                cv2.rectangle(
                    image,
                    (x0 + border, y0 + border),
                    (x1 - border, y1 - border),
                    bgr,
                    thickness=-1,
                )

    cv2.rectangle(image, (width - 118, 18), (width - 20, 58), (222, 235, 250), thickness=-1)
    cv2.putText(image, "Scan", (width - 96, 48), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
    return image


def render_large_margin_net(faces):
    net = render_synthetic_ruwix_net(faces)
    margin_top = 360
    margin_left = 680
    margin_right = 520
    margin_bottom = 260
    image = np.full(
        (
            net.shape[0] + margin_top + margin_bottom,
            net.shape[1] + margin_left + margin_right,
            3,
        ),
        245,
        dtype=np.uint8,
    )
    image[margin_top : margin_top + net.shape[0], margin_left : margin_left + net.shape[1]] = net
    return image


if __name__ == "__main__":
    raise SystemExit(main())
