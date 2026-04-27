import argparse
import json
from dataclasses import dataclass
from functools import lru_cache
from typing import Dict, Iterable, List, Sequence, Tuple

import cv2
import numpy as np

from .constants import COLOR_ORDER, COLOR_RGB, DISPLAY_FACE_ORDER, FACE_NET_POSITIONS
from .cube import CubeStateError, faces_to_facelets, solve_faces


@dataclass
class StickerSample:
    face: str
    row: int
    col: int
    rgb: Tuple[int, int, int]
    color: str
    confidence: float
    nearest_color: str
    balanced: bool = False


class NetParseError(ValueError):
    """Raised when an uploaded image does not look like a six-face cube net."""


def parse_image_bytes(image_bytes: bytes) -> Dict:
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise NetParseError("Could not read the uploaded image. Please upload a JPEG or PNG.")
    return parse_bgr_image(image)


def parse_image_file(path: str) -> Dict:
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise NetParseError(f"Could not read image: {path}")
    return parse_bgr_image(image)


def parse_bgr_image(image: np.ndarray) -> Dict:
    x_lines, y_lines = detect_grid_lines(image)
    samples = sample_stickers(image, x_lines, y_lines)

    faces = {face: [None] * 9 for face in DISPLAY_FACE_ORDER}
    rgb_samples = {face: [None] * 9 for face in DISPLAY_FACE_ORDER}
    confidence = {face: [None] * 9 for face in DISPLAY_FACE_ORDER}
    for sample in samples:
        index = sample.row * 3 + sample.col
        faces[sample.face][index] = sample.color
        rgb_samples[sample.face][index] = list(sample.rgb)
        confidence[sample.face][index] = sample.confidence

    warnings = []
    confidence_values = [sample.confidence for sample in samples]
    low_confidence = [sample for sample in samples if sample.confidence < 0.22]
    balanced = [sample for sample in samples if sample.balanced]
    if low_confidence:
        warnings.append(
            f"{len(low_confidence)} stickers had low color confidence; review them before solving."
        )
    if balanced:
        warnings.append(
            f"{len(balanced)} stickers were color-balanced to keep exactly 9 of each color."
        )

    try:
        facelets = faces_to_facelets(faces)
        validation_error = None
    except CubeStateError as exc:
        facelets = None
        validation_error = str(exc)
        warnings.append(validation_error)

    return {
        "faces": faces,
        "facelets": facelets,
        "image": {
            "width": int(image.shape[1]),
            "height": int(image.shape[0]),
        },
        "rgbSamples": rgb_samples,
        "confidence": confidence,
        "diagnostics": {
            "lowestConfidence": round(min(confidence_values), 3),
            "lowConfidenceStickers": len(low_confidence),
            "balancedStickers": len(balanced),
            "classificationMode": "balanced-exact-count" if balanced else "nearest-reference",
            "validationError": validation_error,
            "stickers": [
                {
                    "face": sample.face,
                    "index": sample.row * 3 + sample.col,
                    "row": sample.row,
                    "col": sample.col,
                    "color": sample.color,
                    "nearestColor": sample.nearest_color,
                    "confidence": sample.confidence,
                    "balanced": sample.balanced,
                    "lowConfidence": sample.confidence < 0.22,
                }
                for sample in samples
            ],
        },
        "grid": {
            "xLines": [round(float(value), 2) for value in x_lines],
            "yLines": [round(float(value), 2) for value in y_lines],
        },
        "warnings": warnings,
    }


def detect_grid_lines(image: np.ndarray) -> Tuple[List[float], List[float]]:
    base_mask = cv2.inRange(image, np.array([0, 0, 0]), np.array([75, 75, 75]))
    relaxed_mask = cv2.inRange(image, np.array([0, 0, 0]), np.array([90, 90, 90]))
    kernel = np.ones((3, 3), np.uint8)
    masks = [
        base_mask,
        relaxed_mask,
        cv2.morphologyEx(relaxed_mask, cv2.MORPH_CLOSE, kernel),
    ]
    height, width = base_mask.shape

    for black_mask in masks:
        x_candidates = _axis_line_centers(
            black_mask, axis=0, min_coverage=max(70, height * 0.08)
        )
        y_candidates = _axis_line_centers(
            black_mask, axis=1, min_coverage=max(70, width * 0.08)
        )

        x_lines = _best_even_sequence(x_candidates, expected_count=13, image_span=width)
        y_lines = _best_even_sequence(y_candidates, expected_count=10, image_span=height)

        if x_lines is None or y_lines is None:
            continue
        if _looks_like_cube_net(black_mask, x_lines, y_lines):
            return x_lines, y_lines

    raise NetParseError(
        "Could not detect a 12x9 flattened cube net. Try a cleaner Ruwix-style screenshot."
    )


def _axis_line_centers(mask: np.ndarray, axis: int, min_coverage: float) -> List[float]:
    counts = mask.sum(axis=axis) / 255
    indices = np.flatnonzero(counts >= min_coverage)
    groups = _group_consecutive(indices)
    centers = []
    max_line_width = max(12, mask.shape[1 - axis] * 0.035)
    for group in groups:
        start, end = int(group[0]), int(group[-1])
        width = end - start + 1
        if width > max_line_width:
            continue
        centers.append((start + end) / 2)
    return centers


def _group_consecutive(indices: Iterable[int]) -> List[np.ndarray]:
    indices = np.array(list(indices))
    if len(indices) == 0:
        return []
    breaks = np.where(np.diff(indices) > 1)[0] + 1
    return np.split(indices, breaks)


def _best_even_sequence(
    candidates: Sequence[float], expected_count: int, image_span: int
) -> List[float]:
    if len(candidates) < expected_count:
        return None

    candidates = sorted(candidates)
    plausible_steps = []
    for left, right in zip(candidates, candidates[1:]):
        gap = right - left
        if image_span * 0.045 <= gap <= image_span * 0.13:
            plausible_steps.append(gap)
    if not plausible_steps:
        return None

    median_step = float(np.median(plausible_steps))
    candidate_steps = sorted(
        set(round(step, 2) for step in plausible_steps + [median_step, image_span / 12, image_span / 9])
    )

    best = None
    best_score = -1
    tolerance = max(8, median_step * 0.18)
    for step in candidate_steps:
        if step <= 0:
            continue
        for start in candidates:
            sequence = []
            score = 0
            for offset in range(expected_count):
                target = start + offset * step
                nearest = min(candidates, key=lambda value: abs(value - target))
                if abs(nearest - target) <= tolerance:
                    sequence.append(nearest)
                    score += 1
                else:
                    sequence.append(target)
            span = sequence[-1] - sequence[0]
            expected_span = step * (expected_count - 1)
            if score > best_score and abs(span - expected_span) <= tolerance * expected_count:
                best_score = score
                best = sequence

    if best is None or best_score < expected_count - 1:
        return None
    return [float(value) for value in best]


def _looks_like_cube_net(mask: np.ndarray, x_lines: Sequence[float], y_lines: Sequence[float]) -> bool:
    checks = [
        ("U", 3, 0),
        ("L", 0, 3),
        ("F", 3, 3),
        ("R", 6, 3),
        ("B", 9, 3),
        ("D", 3, 6),
    ]
    for _face, gx, gy in checks:
        x0, x1 = int(x_lines[gx]), int(x_lines[gx + 3])
        y0, y1 = int(y_lines[gy]), int(y_lines[gy + 3])
        region = mask[max(0, y0 - 3) : y1 + 3, max(0, x0 - 3) : x1 + 3]
        if region.size == 0:
            return False
        min_dark_pixels = max(120, region.size * 0.01)
        if np.count_nonzero(region) < min_dark_pixels:
            return False
    return True


def sample_stickers(
    image: np.ndarray, x_lines: Sequence[float], y_lines: Sequence[float]
) -> List[StickerSample]:
    samples = []
    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    for face, (grid_x, grid_y) in FACE_NET_POSITIONS.items():
        for row in range(3):
            for col in range(3):
                x0 = x_lines[grid_x + col]
                x1 = x_lines[grid_x + col + 1]
                y0 = y_lines[grid_y + row]
                y1 = y_lines[grid_y + row + 1]
                rgb = _median_center_rgb(rgb_image, x0, y0, x1, y1)
                color, confidence = classify_rgb(rgb)
                samples.append(StickerSample(face, row, col, rgb, color, confidence, color))
    _balance_samples_to_exact_counts(samples)
    return samples


def _median_center_rgb(
    image: np.ndarray, x0: float, y0: float, x1: float, y1: float
) -> Tuple[int, int, int]:
    width = x1 - x0
    height = y1 - y0
    margin_x = width * 0.28
    margin_y = height * 0.28
    left = max(0, int(round(x0 + margin_x)))
    right = min(image.shape[1], int(round(x1 - margin_x)))
    top = max(0, int(round(y0 + margin_y)))
    bottom = min(image.shape[0], int(round(y1 - margin_y)))
    patch = image[top:bottom, left:right]
    if patch.size == 0:
        raise NetParseError("Could not sample sticker colors from the detected grid.")
    median = np.median(patch.reshape(-1, 3), axis=0)
    return tuple(int(round(value)) for value in median)


def classify_rgb(rgb: Tuple[int, int, int]) -> Tuple[str, float]:
    distances = []
    vector = np.array(rgb, dtype=np.float32)
    for color, reference in COLOR_RGB.items():
        ref = np.array(reference, dtype=np.float32)
        distances.append((color, float(np.linalg.norm(vector - ref))))
    distances.sort(key=lambda item: item[1])
    best_color, best_distance = distances[0]
    second_distance = distances[1][1]
    confidence = max(0.0, min(1.0, (second_distance - best_distance) / max(second_distance, 1.0)))
    return best_color, round(confidence, 3)


def _balance_samples_to_exact_counts(samples: List[StickerSample]) -> None:
    counts = {color: 0 for color in COLOR_ORDER}
    for sample in samples:
        counts[sample.color] += 1
    if all(count == 9 for count in counts.values()):
        return

    assignments = _exact_color_assignments([sample.rgb for sample in samples])
    for sample, color in zip(samples, assignments):
        if sample.color != color:
            sample.balanced = True
            sample.color = color
            sample.confidence = min(sample.confidence, 0.19)


def _exact_color_assignments(samples: Sequence[Tuple[int, int, int]]) -> List[str]:
    distances = []
    for rgb in samples:
        vector = np.array(rgb, dtype=np.float32)
        distances.append(
            [
                float(np.linalg.norm(vector - np.array(COLOR_RGB[color], dtype=np.float32)))
                for color in COLOR_ORDER
            ]
        )

    @lru_cache(maxsize=None)
    def best_cost(index: int, counts: Tuple[int, ...]) -> float:
        if index == len(samples):
            return 0.0 if all(count == 9 for count in counts) else float("inf")

        best = float("inf")
        for color_index, distance in enumerate(distances[index]):
            if counts[color_index] >= 9:
                continue
            next_counts = list(counts)
            next_counts[color_index] += 1
            best = min(best, distance + best_cost(index + 1, tuple(next_counts)))
        return best

    counts = (0, 0, 0, 0, 0, 0)
    if best_cost(0, counts) == float("inf"):
        return [classify_rgb(rgb)[0] for rgb in samples]

    path = []
    for index in range(len(samples)):
        best_color = None
        best = float("inf")
        for color_index, distance in enumerate(distances[index]):
            if counts[color_index] >= 9:
                continue
            next_counts = list(counts)
            next_counts[color_index] += 1
            total = distance + best_cost(index + 1, tuple(next_counts))
            if total < best:
                best = total
                best_color = color_index
        if best_color is None:
            return [classify_rgb(rgb)[0] for rgb in samples]
        path.append(COLOR_ORDER[best_color])
        next_counts = list(counts)
        next_counts[best_color] += 1
        counts = tuple(next_counts)
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse a Ruwix-style flattened cube net image.")
    parser.add_argument("image")
    parser.add_argument("--solve", action="store_true")
    args = parser.parse_args()

    result = parse_image_file(args.image)
    if args.solve:
        result["solution"] = solve_faces(result["faces"])
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
