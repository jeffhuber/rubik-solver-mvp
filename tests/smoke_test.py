import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rubik_solver.cube import random_scramble_state, solve_faces
from rubik_solver.net_parser import parse_image_file


def main() -> int:
    print("Random scramble smoke test")
    scramble, faces, solution = random_scramble_state(20)
    print("Scramble:", " ".join(scramble))
    print("Solution:", " ".join(solution), f"({len(solution)} moves)")

    for path in sys.argv[1:]:
        print(f"\nImage parser smoke test: {path}")
        parsed = parse_image_file(path)
        print("Grid:", json.dumps(parsed["grid"]))
        print("Warnings:", parsed["warnings"])
        moves = solve_faces(parsed["faces"])
        print("Solution:", " ".join(moves), f"({len(moves)} moves)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
