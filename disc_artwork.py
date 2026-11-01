"""Server-side CD scan extraction for Lyrion Carousel.

Runs only on the Pi, never in the browser. OpenCV is optional; a conservative
centre-disc fallback is used when detection is unavailable or inconclusive.
"""
from __future__ import annotations
import io
from PIL import Image, ImageDraw, ImageOps

def extract_disc(payload: bytes, size: int = 768) -> bytes | None:
    """Return a transparent PNG containing a detected CD, or None if uncertain."""
    with Image.open(io.BytesIO(payload)) as source:
        source.load()
        if source.width * source.height > 32_000_000:
            raise ValueError("Artwork dimensions exceed limit")
        original = ImageOps.exif_transpose(source).convert("RGB")
    # Circle detection runs on a small copy to bound CPU and memory.
    thumb = original.copy()
    thumb.thumbnail((600, 600))
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None
    rgb = np.asarray(thumb)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (7, 7), 1.5)
    shortest = min(thumb.size)
    circles = cv2.HoughCircles(
        gray, cv2.HOUGH_GRADIENT, dp=1.2,
        minDist=shortest // 3, param1=110, param2=38,
        minRadius=int(shortest * .22), maxRadius=int(shortest * .49))
    if circles is None:
        return None
    # Prefer a large, fully visible circle. A scan can contain hub-like circles.
    candidates = []
    for x, y, r in circles[0]:
        if x-r < 1 or y-r < 1 or x+r >= thumb.width or y+r >= thumb.height:
            continue
        candidates.append((float(r), float(x), float(y)))
    if not candidates:
        return None
    radius, cx, cy = max(candidates)
    factor_x = original.width / thumb.width
    factor_y = original.height / thumb.height
    cx *= factor_x
    cy *= factor_y
    radius *= (factor_x + factor_y) / 2
    # Keep the disc edge, but exclude any rectangular scan surroundings.
    crop = original.crop((round(cx-radius), round(cy-radius),
                          round(cx+radius), round(cy+radius)))
    crop = crop.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((1, 1, size-2, size-2), fill=255)
    crop.putalpha(mask)
    output = io.BytesIO()
    crop.save(output, format="PNG", optimize=True)
    return output.getvalue()
