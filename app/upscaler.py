import os
import subprocess
import tempfile
import shutil
from enum import Enum
from pathlib import Path
from PIL import Image, ImageFilter

REALESRGAN_BIN = Path("/usr/local/bin/realesrgan-ncnn-vulkan")
MODELS_DIR = Path("/usr/local/share/realesrgan/models")
MAX_SCALE_PER_PASS = 4

RESOLUTIONS: dict[str, tuple[int, int]] = {
    "hd": (1920, 1080),
    "2k": (2560, 1440),
    "4k": (3840, 2160),
    "5k": (5120, 2880),
    "8k": (7680, 4320),
    "12k": (11520, 6480),
}


class UpscaleDriver(str, Enum):
    CPU = "cpu"
    INTEL = "intel"
    LAVAPIPE = "lavapipe"


_ICD_MAP: dict[UpscaleDriver, str | None] = {
    UpscaleDriver.CPU: None,
    UpscaleDriver.INTEL: "/usr/share/vulkan/icd.d/intel_icd.x86_64.json",
    UpscaleDriver.LAVAPIPE: "/usr/share/vulkan/icd.d/lvp_icd.x86_64.json",
}


def _detect_driver() -> UpscaleDriver:
    val = os.getenv("UPSCALE_DRIVER", "").strip().lower()
    if val == "intel":
        return UpscaleDriver.INTEL
    if val == "lavapipe":
        return UpscaleDriver.LAVAPIPE
    return UpscaleDriver.CPU


DRIVER = _detect_driver()


class UpscaleError(RuntimeError):
    pass


def _decompose_scale(needed: int) -> list[int]:
    factors = []
    while needed > 1:
        s = min(needed, MAX_SCALE_PER_PASS)
        factors.append(s)
        needed = (needed + s - 1) // s
    return factors


def _detect_format(path: Path) -> str:
    ext = path.suffix.lower()
    fmt_map = {
        ".jpg": "JPEG",
        ".jpeg": "JPEG",
        ".png": "PNG",
        ".webp": "PNG",
        ".tiff": "TIFF",
        ".tif": "TIFF",
        ".bmp": "BMP",
    }
    return fmt_map.get(ext, "PNG")


def _calc_scale(w: int, h: int, scale: int | None, target_w: int, target_h: int) -> int:
    if scale is not None:
        return scale
    scale_w = (target_w + w - 1) // w
    scale_h = (target_h + h - 1) // h
    return max(scale_w, scale_h)


def _save(img: Image.Image, path: Path, target_format: str | None, src_path: Path) -> None:
    if target_format:
        fmt = target_format.upper()
    else:
        fmt = _detect_format(src_path)

    if fmt == "JPEG" and img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGB")

    save_kwargs: dict = {}
    if fmt == "JPEG":
        save_kwargs["quality"] = 95

    img.save(path, fmt, **save_kwargs)


# ── CPU backend ──────────────────────────────────────────────────────────────

def _cpu_upscale(
    input_path: Path,
    output_path: Path,
    target_format: str | None = None,
    scale: int | None = None,
    target_w: int = 3840,
    target_h: int = 2160,
    downscale: bool = False,
) -> Path:
    img = Image.open(input_path)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")

    w, h = img.size
    needed = _calc_scale(w, h, scale, target_w, target_h)

    if needed <= 1:
        if downscale and (w > target_w or h > target_h):
            img.thumbnail((target_w, target_h), Image.LANCZOS)
        _save(img, output_path, target_format, input_path)
        return output_path

    current = img
    for s in _decompose_scale(needed):
        current = current.resize((current.width * s, current.height * s), Image.LANCZOS)
        current = current.filter(ImageFilter.UnsharpMask(radius=0.5, percent=30, threshold=2))

    if current.width > target_w or current.height > target_h:
        current.thumbnail((target_w, target_h), Image.LANCZOS)

    _save(current, output_path, target_format, input_path)
    return output_path


# ── Vulkan backend ───────────────────────────────────────────────────────────

def _vulkan_upscale(
    input_path: Path,
    output_path: Path,
    target_format: str | None = None,
    scale: int | None = None,
    target_w: int = 3840,
    target_h: int = 2160,
    downscale: bool = False,
) -> Path:
    if not REALESRGAN_BIN.exists():
        raise UpscaleError(
            f"realesrgan-ncnn-vulkan not found at {REALESRGAN_BIN}. "
            "Use UPSCALE_DRIVER=cpu or rebuild the Docker image."
        )

    workdir = Path(tempfile.mkdtemp(prefix="upscale_"))
    try:
        png_input = workdir / "input.png"
        _convert_to_png(input_path, png_input)

        w, h = _image_size(png_input)
        needed = _calc_scale(w, h, scale, target_w, target_h)

        if needed <= 1:
            if downscale and (w > target_w or h > target_h):
                out = _vulkan_resize(png_input, target_w, target_h, workdir)
                _convert_format(out, output_path, target_format or "JPEG")
                return output_path
            shutil.copy(input_path, output_path)
            return output_path

        current = png_input
        for s in _decompose_scale(needed):
            upscaled = workdir / f"pass_{s}.png"
            _run_vulkan(current, upscaled, s)
            current = upscaled

        final_w, final_h = _image_size(current)
        if final_w > target_w or final_h > target_h:
            current = _vulkan_resize(current, target_w, target_h, workdir)

        if target_format:
            _convert_format(current, output_path, target_format)
        else:
            src_fmt = _detect_format(input_path)
            _convert_format(current, output_path, src_fmt)

        return output_path

    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return img.size


def _convert_to_png(src: Path, dst: Path) -> None:
    with Image.open(src) as img:
        img.save(dst, "PNG")


def _convert_format(src: Path, dst: Path, fmt: str) -> None:
    with Image.open(src) as img:
        if fmt.upper() == "JPEG" and img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGB")
        img.save(dst, fmt.upper())


def _vulkan_resize(path: Path, target_w: int, target_h: int, workdir: Path | None = None) -> Path:
    if workdir:
        out = workdir / "resized.png"
    else:
        out = path.with_suffix(".resized.png")
    with Image.open(path) as img:
        img.thumbnail((target_w, target_h), Image.LANCZOS)
        img.save(out, "PNG")
    return out


def _run_vulkan(input_path: Path, output_path: Path, scale: int) -> None:
    icd = _ICD_MAP.get(DRIVER)
    env = None
    if icd:
        env = {"VK_ICD_FILENAMES": icd}

    threads = os.getenv("UPSCALE_THREADS", "4:4:4")
    model = os.getenv("UPSCALE_MODEL", "realesrgan-x4plus")
    tile = os.getenv("UPSCALE_TILE", "0")

    cmd = [
        str(REALESRGAN_BIN),
        "-i", str(input_path),
        "-o", str(output_path),
        "-s", str(scale),
        "-m", str(MODELS_DIR),
        "-n", model,
        "-g", "0",
        "-j", threads,
    ]
    if tile != "0":
        cmd.extend(["-t", tile])

    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=300,
                       env={**os.environ, **(env or {})})
    except subprocess.CalledProcessError as e:
        msg = e.stderr.decode(errors="replace") if e.stderr else str(e)
        raise UpscaleError(f"Upscale failed (exit {e.returncode}): {msg}") from e
    except subprocess.TimeoutExpired as e:
        raise UpscaleError("Upscale timed out after 300s") from e


# ── Public API ───────────────────────────────────────────────────────────────

def upscale_file(
    input_path: Path,
    output_path: Path,
    target_format: str | None = None,
    scale: int | None = None,
    target: str = "4k",
    downscale: bool = False,
) -> Path:
    target_w, target_h = RESOLUTIONS.get(target, RESOLUTIONS["4k"])
    kwargs = dict(target_w=target_w, target_h=target_h, downscale=downscale)

    if DRIVER == UpscaleDriver.CPU:
        return _cpu_upscale(input_path, output_path, target_format, scale, **kwargs)
    return _vulkan_upscale(input_path, output_path, target_format, scale, **kwargs)
