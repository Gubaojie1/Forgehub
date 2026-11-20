from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "dnake-d-design-reference.png"
OUTPUT = ROOT / "public" / "dnake-mark.png"


def largest_component(mask: np.ndarray) -> np.ndarray:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    largest: list[tuple[int, int]] = []

    for y, x in np.argwhere(mask):
        if visited[y, x]:
            continue
        queue = deque([(int(y), int(x))])
        visited[y, x] = True
        component: list[tuple[int, int]] = []
        while queue:
            cy, cx = queue.popleft()
            component.append((cy, cx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dy == 0 and dx == 0:
                        continue
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        queue.append((ny, nx))
        if len(component) > len(largest):
            largest = component

    result = np.zeros_like(mask, dtype=bool)
    if largest:
        ys, xs = zip(*largest)
        result[np.array(ys), np.array(xs)] = True
    return result


image = Image.open(SOURCE).convert("RGB")
pixels = np.asarray(image)
working = pixels[:, :650]
red, green, blue = working[..., 0], working[..., 1], working[..., 2]

# Select the two large official-logo shapes and discard the diagram grid dots.
black_candidates = (red < 190) & (green < 190) & (blue < 190) & (np.abs(red.astype(int) - green.astype(int)) < 24)
orange_candidates = (red > 175) & (green > 35) & (green < 195) & (blue < 125) & (red > green * 1.25)
logo_mask = largest_component(black_candidates) | largest_component(orange_candidates)

ys, xs = np.where(logo_mask)
if not len(xs):
    raise RuntimeError("DNAKE logo shapes were not detected")

padding = 18
x0, x1 = max(0, int(xs.min()) - padding), min(working.shape[1], int(xs.max()) + padding + 1)
y0, y1 = max(0, int(ys.min()) - padding), min(working.shape[0], int(ys.max()) + padding + 1)

rgba = np.zeros((working.shape[0], working.shape[1], 4), dtype=np.uint8)
rgba[..., :3] = working
rgba[..., 3] = logo_mask.astype(np.uint8) * 255
cropped = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")

target = 408
scale = min(target / cropped.width, target / cropped.height)
resized = cropped.resize((round(cropped.width * scale), round(cropped.height * scale)), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (512, 512), (255, 255, 255, 0))
canvas.alpha_composite(resized, ((512 - resized.width) // 2, (512 - resized.height) // 2))
canvas.save(OUTPUT, optimize=True)

print(f"saved {OUTPUT} ({OUTPUT.stat().st_size} bytes)")
