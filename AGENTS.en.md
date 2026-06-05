# AGENTS.en.md — imgup

## Project structure

```
imgup/
├── Dockerfile              # Multi-stage: builder (curl+unzip) + runtime
├── requirements.txt        # Python dependencies
├── .env.example            # Config example
├── README.md               # Documentation (Russian)
├── README.en.md            # Documentation (English)
├── AGENTS.md               # This file — for AI agents (Russian)
├── AGENTS.en.md            # This file — for AI agents (English)
└── app/
    ├── __init__.py
    ├── main.py             # FastAPI: / (UI), /api/health, /api/upscale, /api/upscale/upload
    ├── models.py           # Pydantic: UpscaleURLRequest, HealthResponse
    ├── upscaler.py         # Core: CPU and Vulkan drivers
    └── static/
        ├── index.html      # Web UI
        ├── style.css       # Dark/light theme, layout
        ├── script.js       # Drag-drop, upload, result
        ├── favicon.svg     # SVG favicon (triangle ▲)
        ├── app-icon.svg    # PWA icon 512×512
        ├── manifest.json   # PWA Web Manifest
        └── sw.js           # Service Worker (static cache)
```

## URL layout

| URL | Purpose |
|---|---|
| `GET /` | Web UI (SPA: static + fetch to API) |
| `GET /static/*` | CSS, JS, assets |
| `GET /api/health` | Health check |
| `POST /api/upscale` | Upscale by URL (JSON → image) |
| `POST /api/upscale/upload` | Upscale by upload (multipart → image) |

UI is plain HTML + CSS + vanilla JS with no frameworks. The page loads, fetches `/api/health`, shows the driver in the header. Interaction is via `fetch` to `/api/upscale/upload` with FormData.

Multi-file: dropzone with `multiple`, file queue with preview, name, size, type, and resolution. "Upscale All" button processes files sequentially. Each file gets a status (pending → processing → done/error) and auto-downloads when ready.

## Key files

### `app/upscaler.py`

The only module with business logic. Contains:

- **`UpscaleDriver`** — enum (`cpu`, `intel`, `lavapipe`)
- **`DRIVER`** — global singleton, initialized from `UPSCALE_DRIVER` on import
- **`_cpu_upscale()`** — Pillow LANCZOS + UnsharpMask
- **`_vulkan_upscale()`** — subprocess `realesrgan-ncnn-vulkan`
- **`_run_vulkan()`** — configures `VK_ICD_FILENAMES` for the selected driver
- **`_decompose_scale(n)`** — decomposes the required scale into passes (4, 3, 2)
- **`upscale_file()`** — public API, dispatches to driver

### `app/main.py`

FastAPI app. Three API endpoints + root route for UI.
`UpscaleError` exceptions are caught by the global `@app.exception_handler`.

### `app/static/`

- `index.html` — markup: header with driver badge and theme, dropzone, file-queue, controls, loader, error. `fileInput` with `multiple` for batch files
- `style.css` — CSS variables for themes (`[data-theme="dark"]` / `[data-theme="light"]`), saved in `localStorage`. Styles for `.file-queue`, `.file-item`, `.file-status`, `.file-meta`
- `script.js` — IIFE: everything in a closure, `API = "/api"`. Multi-file: file queue, async dimension loading (`Image`), per-file status (pending/processing/done/error), sequential processing via `processAll()`, auto-download each result. `t()` for on-the-fly translations
- `favicon.svg` — SVG favicon (filled triangle ▲ with gradient `#7c5cfc → #b99bff`)
- `app-icon.svg` — PWA/Apple Touch icon 512×512
- `manifest.json` — PWA Web Manifest (standalone, theme `#0f0f1a`, icon link)
- `sw.js` — Service Worker: cache static on install, serve from cache, delete old caches on activate

### `Dockerfile`

Multi-stage:
1. **builder**: `python:3.11-slim-bookworm` + curl → downloads `realesrgan-ncnn-vulkan` v0.2.5.0 with models
2. **runtime**: same image, copies binary + models + Python code

Vulkan drivers (`mesa-vulkan-drivers`) are **not** installed by default. The image is minimal (~330 MB), Vulkan drivers are installed by the user when deploying on N100.

## Driver selection

| Value | When it works | System requirements |
|---|---|---|
| `cpu` | Always | Nothing |
| `intel` | `realesrgan-ncnn-vulkan` found, Intel ICD available | `libvulkan1`, `mesa-vulkan-drivers`, `/dev/dri` |
| `lavapipe` | `realesrgan-ncnn-vulkan` found, Lavapipe ICD available | `libvulkan1`, `mesa-vulkan-drivers` |

If `UPSCALE_DRIVER` is not set or unknown — `cpu`.

## Edge cases

- **Image already >= 4K** → returned as-is (needed <= 1)
- **Aspect ratio ≠ 16:9** → upscale to fit inside 4K box (thumbnail), no black bars added
- **Scale > 4** → multi-pass (e.g. 12 = 4×3, 6 = 4×2, 8 = 4×2)
- **File > 50 MB** → 413 Payload Too Large
- **JPEG output with alpha** → convert to RGB
- **Vulkan driver crashed** → `UpscaleError` with binary's stderr text → 500

## Testing

### Docker build

```bash
docker build -t imgup .
```

### Smoke test (CPU)

```bash
docker run --platform linux/amd64 -d -p 8000:8000 --name imgup imgup
# healthcheck
curl localhost:8000/api/health
# upload test
docker exec imgup python3 -c "
from PIL import Image
Image.new('RGB', (320, 240), (100, 150, 200)).save('/tmp/t.jpg', 'JPEG')
"
docker cp imgup:/tmp/t.jpg /tmp/t.jpg
curl -s -F "file=@/tmp/t.jpg" localhost:8000/api/upscale/upload -o /tmp/out.jpg
file /tmp/out.jpg
docker stop imgup
```

### Web UI check

Open `http://localhost:8000` in a browser — dropzone, batch file selection, queue with preview, upscale all, results.

## Environment variables

| Var | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `UPSCALE_DRIVER` | `cpu` | `cpu` / `intel` / `lavapipe` |

## Notes

- `realesrgan-ncnn-vulkan` v0.2.0 (from a separate repo) does **not** contain models — needs v0.2.5.0 from the main Real-ESRGAN repo
- On Mac (ARM) Docker requires `--platform linux/amd64` and QEMU emulation; Vulkan doesn't work in this mode — only CPU
- Native run on Mac (without Docker): `pip install -r requirements.txt && uvicorn app.main:app`
- UI is a static SPA with no template engine. Layout is flex, themes via CSS variables + `data-theme` on `<html>`