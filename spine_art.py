"""Render narrow CD spine artwork from the real album cover."""
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

SPINE_WIDTH = 128
SPINE_HEIGHT = 1024
SPINE_REVISION = 'spine-v1'

def render_spine(source):
    """Crop, rather than stretch, artwork for a photographic paper insert."""
    original = ImageOps.exif_transpose(source).convert('RGB')
    rotated = original.rotate(90, expand=True)
    strip = ImageOps.fit(rotated, (SPINE_WIDTH, SPINE_HEIGHT),
                         method=getattr(Image, 'Resampling', Image).LANCZOS)
    strip = strip.filter(ImageFilter.GaussianBlur(radius=1.5))
    return ImageEnhance.Contrast(strip).enhance(0.9)
