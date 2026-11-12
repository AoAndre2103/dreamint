#!/usr/bin/env python3
"""Build transparent DreaMint logo assets from logo-source.webp. Do not copy the source into public/."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "logo-source.webp"
OUT = ROOT / "public" / "img"
PUBLIC = ROOT / "public"
QA = Path("/tmp/logo-qa")

NAVY = np.array([19, 35, 48], dtype=np.float64)
CREAM = np.array([244, 239, 228], dtype=np.float64)  # #f4efe4
APPLE_BG = (8, 16, 20, 255)  # deep teal-black
OG_BG = (245, 241, 232, 255)  # site cream #F5F1E8


def save_png(im: Image.Image, path: Path, max_kb: int = 100) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True, compress_level=9)
    size = path.stat().st_size
    print(f"  PNG {path.name:32s} {im.size[0]:4d}x{im.size[1]:<4d} {size/1024:6.1f} KB")
    if size > max_kb * 1024:
        print(f"    WARN over {max_kb}KB")


def save_webp(im: Image.Image, path: Path, quality: int = 90, max_kb: int = 100) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=quality, method=6, lossless=False)
    size = path.stat().st_size
    print(f"  WBP {path.name:32s} {im.size[0]:4d}x{im.size[1]:<4d} {size/1024:6.1f} KB q={quality}")
    if size > max_kb * 1024:
        # retry slightly lower
        for q in (86, 82, 78):
            im.save(path, "WEBP", quality=q, method=6)
            size = path.stat().st_size
            print(f"    retry q={q} {size/1024:6.1f} KB")
            if size <= max_kb * 1024:
                break


def punch_letter_counters(arr: np.ndarray, x0: int, x1: int, y0: int, y1: int) -> np.ndarray:
    """Make opaque white counters inside Drea letters transparent, with feathered edges."""
    out = arr.copy()
    rgb = out[:, :, :3].astype(np.int16)
    a = out[:, :, 3]
    mn = rgb.min(axis=2)
    # Candidate hole pixels: very light and visibly opaque, only in the Drea wordmark band.
    region = np.zeros(a.shape, dtype=bool)
    region[y0:y1, x0:x1] = True
    hole = region & (mn >= 230) & (a >= 24)
    labeled, n = ndimage.label(hole)
    print(f"  counter candidates: {int(hole.sum())} px, {n} components")
    keep = np.zeros_like(hole)
    for i in range(1, n + 1):
        comp = labeled == i
        count = int(comp.sum())
        ys, xs = np.where(comp)
        # Skip tiny specks and anything touching the region border (shouldn't happen)
        if count < 80:
            print(f"    skip small component {i} n={count}")
            continue
        touches = xs.min() <= x0 or xs.max() >= x1 - 1 or ys.min() <= y0 or ys.max() >= y1 - 1
        if touches:
            print(f"    skip touching-border component {i} n={count} bbox={xs.min(),ys.min(),xs.max(),ys.max()}")
            continue
        print(f"    punch component {i} n={count} bbox={int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())}")
        keep |= comp

    if not keep.any():
        return out

    # Dilate slightly and apply color-to-alpha on near-white fringe so edges stay smooth.
    dil = ndimage.binary_dilation(keep, iterations=2)
    fringe = dil & ~keep & region
    # Hard-clear the hole interiors
    out[:, :, 3][keep] = 0
    out[:, :, 0][keep] = 0
    out[:, :, 1][keep] = 0
    out[:, :, 2][keep] = 0
    # Soften fringe: reduce alpha of remaining very light pixels
    if fringe.any():
        fr_rgb = out[:, :, :3][fringe].astype(np.float64)
        fr_a = out[:, :, 3][fringe].astype(np.float64)
        # How close to white (0=white, 1=far)
        dist = (255.0 - fr_rgb.min(axis=1)) / 255.0
        # Near-white fringe gets lower alpha; already-dark navy edges stay
        new_a = fr_a * np.clip(dist / 0.18, 0, 1)
        # Un-premultiply residual white once alpha is reduced
        with np.errstate(divide="ignore", invalid="ignore"):
            fa = np.clip(new_a / 255.0, 0, 1)
            # pc = fg*a + 255*(1-a)  -> fg = (pc - 255*(1-a)) / a
            fg = np.zeros_like(fr_rgb)
            usable = fa > 0.02
            fg[usable] = (fr_rgb[usable] - 255.0 * (1.0 - fa[usable, None])) / fa[usable, None]
            fg = np.clip(fg, 0, 255)
            # For remaining nearly-transparent, just zero
            out[:, :, 0][fringe] = np.where(usable, fg[:, 0], 0)
            out[:, :, 1][fringe] = np.where(usable, fg[:, 1], 0)
            out[:, :, 2][fringe] = np.where(usable, fg[:, 2], 0)
            out[:, :, 3][fringe] = new_a
    return out


def tight_crop(arr: np.ndarray, pad: int = 12) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    a = arr[:, :, 3]
    ys, xs = np.where(a >= 12)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(arr.shape[1], x1 + pad)
    y1 = min(arr.shape[0], y1 + pad)
    return arr[y0:y1, x0:x1], (x0, y0, x1, y1)


def square_crop(arr: np.ndarray, pad: int = 16) -> np.ndarray:
    a = arr[:, :, 3]
    ys, xs = np.where(a >= 12)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    side = max(x1 - x0, y1 - y0) + pad * 2
    # even side
    side = int(np.ceil(side))
    sx0 = int(round(cx - side / 2))
    sy0 = int(round(cy - side / 2))
    canvas = np.zeros((side, side, 4), dtype=np.uint8)
    # paste source into canvas, clipping
    src_x0 = max(0, sx0)
    src_y0 = max(0, sy0)
    src_x1 = min(arr.shape[1], sx0 + side)
    src_y1 = min(arr.shape[0], sy0 + side)
    dst_x0 = src_x0 - sx0
    dst_y0 = src_y0 - sy0
    dst_x1 = dst_x0 + (src_x1 - src_x0)
    dst_y1 = dst_y0 + (src_y1 - src_y0)
    canvas[dst_y0:dst_y1, dst_x0:dst_x1] = arr[src_y0:src_y1, src_x0:src_x1]
    return canvas


def recolor_drea_navy(full: np.ndarray, word_x0: int) -> np.ndarray:
    """In the wordmark half, turn navy 'Drea' letters into a light cream; keep Mint green."""
    out = full.copy()
    rgb = out[:, :, :3].astype(np.float64)
    a = out[:, :, 3]
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    # mint: green-dominant
    mint = (g > 90) & (g >= r + 30) & (g >= b - 20) & (a >= 8)
    # navy / dark letter pixels in the wordmark (and not mint)
    region = np.zeros(a.shape, dtype=bool)
    region[:, word_x0:] = True
    navy = region & (~mint) & (a >= 8) & (luma < 140) & (g < 120) & (r < 130)
    # Also remap slightly lighter edge pixels that are still cooler/dark (antialias)
    edge = region & (~mint) & (~navy) & (a >= 8) & (luma < 200) & (g - r < 30)
    print(f"  recolor navy={int(navy.sum())} edge={int(edge.sum())} mint_kept={int((mint & region).sum())}")

    def remap(mask: np.ndarray, strength: np.ndarray) -> None:
        if not mask.any():
            return
        # Mix original toward cream by strength 0..1
        src = rgb[mask]
        s = strength[mask][:, None]
        dest = src * (1.0 - s) + CREAM[None, :] * s
        out[:, :, 0][mask] = np.clip(dest[:, 0], 0, 255)
        out[:, :, 1][mask] = np.clip(dest[:, 1], 0, 255)
        out[:, :, 2][mask] = np.clip(dest[:, 2], 0, 255)

    strength = np.zeros(a.shape, dtype=np.float64)
    strength[navy] = 1.0
    if edge.any():
        # stronger as luma is lower
        strength[edge] = np.clip((200 - luma[edge]) / 200.0, 0.35, 1.0)
    remap(navy | edge, strength)
    return out


def fit_height(im: Image.Image, height: int) -> Image.Image:
    w, h = im.size
    nw = max(1, round(w * height / h))
    return im.resize((nw, height), Image.Resampling.LANCZOS)


def place_on(bg: Image.Image, fg: Image.Image, box=None) -> Image.Image:
    canvas = bg.copy()
    if box is None:
        x = (canvas.size[0] - fg.size[0]) // 2
        y = (canvas.size[1] - fg.size[1]) // 2
        canvas.alpha_composite(fg, (x, y))
    else:
        canvas.alpha_composite(fg, box)
    return canvas


def icon_on_plate(icon: Image.Image, size: int, padding_ratio: float = 0.14, radius: int | None = None) -> Image.Image:
    plate = Image.new("RGBA", (size, size), APPLE_BG)
    inner = int(size * (1 - 2 * padding_ratio))
    fitted = icon.resize((inner, inner), Image.Resampling.LANCZOS)
    off = (size - inner) // 2
    plate.alpha_composite(fitted, (off, off))
    return plate


def qa_sheet(imgs: dict[str, Image.Image]) -> None:
    QA.mkdir(parents=True, exist_ok=True)
    for name, im in imgs.items():
        for bg_name, color in (("light", (245, 241, 232, 255)), ("dark", (5, 5, 6, 255)), ("gray", (160, 160, 160, 255))):
            bg = Image.new("RGBA", im.size, color)
            Image.alpha_composite(bg, im).convert("RGB").save(QA / f"{name}-on-{bg_name}.png")


def main() -> None:
    QA.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    src = Image.open(SRC).convert("RGBA")
    arr = np.array(src)
    print("source", src.size, SRC.stat().st_size)

    # Existing alpha already knocks out the outer white. Punch D/a counters.
    # Drea wordmark lives at x~443-918, y~137-309 on the original canvas.
    punched = punch_letter_counters(arr, x0=430, x1=930, y0=120, y1=330)

    # Tight full lockup
    full_arr, bbox = tight_crop(punched, pad=10)
    print("full crop bbox", bbox, "size", full_arr.shape[1], "x", full_arr.shape[0])

    # Icon only: original columns left of the gap (422-442)
    # Map gap using original coordinates, then square-crop
    icon_src = punched[:, :430]
    icon_arr = square_crop(icon_src, pad=14)
    print("icon square", icon_arr.shape[1], "x", icon_arr.shape[0])

    # Word_x0 in the cropped full image: original 443 minus crop x0, with a little slack
    word_x0 = max(0, 430 - bbox[0])
    dark_arr = recolor_drea_navy(full_arr, word_x0=word_x0)

    full_im = Image.fromarray(full_arr, "RGBA")
    dark_im = Image.fromarray(dark_arr, "RGBA")
    icon_im = Image.fromarray(icon_arr, "RGBA")

    # Resize for web: sharp on 3x 36px header (~108px) — use height 200 for full, 512 for icon master
    full_web = fit_height(full_im, 200)
    dark_web = fit_height(dark_im, 200)
    icon_web = icon_im.resize((512, 512), Image.Resampling.LANCZOS)

    # Save masters (png + webp)
    print("Saving assets…")
    save_png(full_web, OUT / "dreamint-logo-full.png", max_kb=100)
    save_webp(full_web, OUT / "dreamint-logo-full.webp", quality=90, max_kb=80)
    save_png(dark_web, OUT / "dreamint-logo-full-dark.png", max_kb=100)
    save_webp(dark_web, OUT / "dreamint-logo-full-dark.webp", quality=90, max_kb=80)
    save_png(icon_web, OUT / "dreamint-icon.png", max_kb=100)
    save_webp(icon_web, OUT / "dreamint-icon.webp", quality=90, max_kb=80)

    # Favicons / PWA from icon on a dark plate (safe padding for maskable)
    fav32 = icon_on_plate(icon_web, 32, padding_ratio=0.10)
    apple = icon_on_plate(icon_web, 180, padding_ratio=0.12)
    ico192 = icon_on_plate(icon_web, 192, padding_ratio=0.14)
    ico512 = icon_on_plate(icon_web, 512, padding_ratio=0.14)
    save_png(fav32, PUBLIC / "favicon-32.png", max_kb=20)
    save_png(apple, PUBLIC / "apple-touch-icon.png", max_kb=40)
    save_png(ico192, OUT / "icon-192.png", max_kb=40)
    save_png(ico512, OUT / "icon-512.png", max_kb=80)

    # OG 1200x630 — light cream, full lockup (navy Drea) centered
    og = Image.new("RGBA", (1200, 630), OG_BG)
    # logo width ~ 72% of canvas, max
    target_w = 820
    scale = target_w / full_im.size[0]
    og_logo = full_im.resize((target_w, max(1, round(full_im.size[1] * scale))), Image.Resampling.LANCZOS)
    og = place_on(og, og_logo)
    og_rgb = og.convert("RGB")
    og_path = PUBLIC / "og.png"
    og_rgb.save(og_path, "PNG", optimize=True, compress_level=9)
    print(f"  OG  {og_path.name:32s} {og_rgb.size[0]:4d}x{og_rgb.size[1]:<4d} {og_path.stat().st_size/1024:6.1f} KB")

    # QA composites
    qa_sheet({
        "full": full_web,
        "dark": dark_web,
        "icon": icon_web,
        "icon-plate-180": apple,
        "og": og,
    })
    # also original-res full on dark/light for close inspection of counters
    qa_sheet({"full-hi": full_im, "dark-hi": dark_im})
    print("QA written to", QA)


if __name__ == "__main__":
    main()
