import tempfile
from pathlib import Path

import httpx
from fastapi import FastAPI, UploadFile, File, Query, HTTPException
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles

from app.models import UpscaleURLRequest, HealthResponse
from app.upscaler import upscale_file, UpscaleError, DRIVER, UpscaleDriver, RESOLUTIONS

app = FastAPI(title="imgup", version="0.1.0")
MAX_FILE_SIZE = 50 * 1024 * 1024

INDEX_HTML = Path(__file__).parent / "static" / "index.html"


@app.exception_handler(UpscaleError)
async def upscale_error_handler(request, exc: UpscaleError):
    raise HTTPException(500, str(exc))


@app.get("/api/health", response_model=HealthResponse)
async def health():
    info = {
        UpscaleDriver.CPU: "Pillow LANCZOS (CPU)",
        UpscaleDriver.INTEL: "Intel GPU Vulkan (realesrgan-x4plus)",
        UpscaleDriver.LAVAPIPE: "Lavapipe software Vulkan (realesrgan-x4plus)",
    }
    return HealthResponse(
        status="ok",
        model="realesrgan-x4plus",
        driver=DRIVER.value,
        driver_info=info.get(DRIVER, "unknown"),
    )


@app.post("/api/upscale")
async def upscale_from_url(
    req: UpscaleURLRequest,
    target: str = Query("4k", description="Target resolution: 4k, 5k, 8k, 12k"),
    downscale: bool = Query(False, description="Downscale if image larger than target"),
):
    if target not in RESOLUTIONS:
        raise HTTPException(400, f"Unsupported target '{target}'. Choose from: {', '.join(RESOLUTIONS)}")

    async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
        resp = await client.get(str(req.url))
        resp.raise_for_status()

    content = resp.content
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "Image too large (max 50 MB)")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".img") as f:
        f.write(content)
        input_path = Path(f.name)

    out_path = input_path.with_suffix(".out")
    try:
        upscale_file(
            input_path, out_path,
            scale=req.scale, target_format=req.output_format,
            target=target, downscale=downscale,
        )
        with open(out_path, "rb") as f:
            data = f.read()
        media_type = _guess_media_type(out_path)
        return Response(content=data, media_type=media_type)
    finally:
        input_path.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)


@app.post("/api/upscale/upload")
async def upscale_from_upload(
    file: UploadFile = File(...),
    scale: int | None = Query(None, description="Override scale factor (e.g. 2, 3, 4)"),
    output_format: str | None = Query(None, description="Output format (JPEG, PNG, WEBP, etc.)"),
    target: str = Query("4k", description="Target resolution: 4k, 5k, 8k, 12k"),
    downscale: bool = Query(False, description="Downscale if image larger than target"),
):
    if target not in RESOLUTIONS:
        raise HTTPException(400, f"Unsupported target '{target}'. Choose from: {', '.join(RESOLUTIONS)}")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "Image too large (max 50 MB)")

    ext = Path(file.filename or "image.png").suffix or ".img"
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as f:
        f.write(content)
        input_path = Path(f.name)

    out_path = input_path.with_suffix(".out")
    try:
        upscale_file(
            input_path, out_path,
            scale=scale, target_format=output_format,
            target=target, downscale=downscale,
        )
        with open(out_path, "rb") as f:
            data = f.read()
        media_type = _guess_media_type(out_path)
        return Response(content=data, media_type=media_type)
    finally:
        input_path.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)


@app.get("/", response_class=HTMLResponse)
async def index():
    if INDEX_HTML.exists():
        return INDEX_HTML.read_text()
    return HTMLResponse("<h1>imgup</h1><p>UI not found</p>", status_code=200)


STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _guess_media_type(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".tiff": "image/tiff",
        ".tif": "image/tiff",
        ".bmp": "image/bmp",
    }.get(ext, "application/octet-stream")
