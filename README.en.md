# imgup

> [Русская версия](README.md)

Image upscaling microservice. Accepts an image via API or web UI and upscales it to 4K (3840×2160) by default. Runs in Docker on any x86_64 Linux host — primary target is an Intel N100 with 16 GB RAM.

## Web UI

Open `http://localhost:8000` in a browser:

```
┌──────────────────────────────────────────────────┐
│  imgup                         [🌙] [cpu]        │
│  Image Upscaler to 4K                            │
│                                                  │
│  ┌─────── Drop images here or click ─────────┐   │
│  │  🖼  JPEG · PNG · WebP · TIFF · BMP       │   │
│  └───────────────────────────────────────────┘   │
│  ┌─ 4 files ─────────────────────────────────┐   │
│  │  [thumb] photo_1.jpg  888 KB · JPEG · 640×480  │
│  │  [thumb] photo_2.jpg  2.1 MB · PNG · 1920×1080│
│  │  [thumb] photo_3.jpg  1.5 MB · WebP · 2560×.. │
│  │  [thumb] photo_4.jpg  4.2 MB · TIFF · 3840×.. │
│  │     [+ Add more]  [Clear]                    │
│  └────────────────────────────────────────────┘   │
│  ┌─ Target ──┐  [↑ Upscale All]                  │
│  │ 4K        │                                   │
│  └───────────┘                                   │
└──────────────────────────────────────────────────┘
```

### Features
- Drag & drop or click to upload multiple images
- Batch upscale — process all files sequentially
- File queue with thumbnail, name, size, type, resolution
- Per-file status (Pending / Processing / Done / Error)
- Auto-download each result on completion
- Dark/light theme toggle
- PWA support (installable, offline static, apple-touch-icon)
- Driver info in header

## Architecture

```
         ┌──────────────────┐
Browser ─┤  GET /           │  Web UI (HTML+CSS+JS)
         └──────────────────┘

         ┌──────────────────┐
Client ──┤  POST /api/*     │  JSON → image
         └────────┬─────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
CPU (Pillow)         Vulkan (Real-ESRGAN)
macOS / any          N100 with Intel GPU
lower quality        Real-ESRGAN quality
```

**Routes:**
- `GET /` — web UI
- `GET /static/*` — static assets (CSS, JS, SVG, manifest, worker)
- `GET /api/health` — health check
- `POST /api/upscale` — upscale by URL
- `POST /api/upscale/upload` — upscale uploaded file

## Driver selection

Controlled by the `UPSCALE_DRIVER` env var.

| Driver | When to use | Mechanism |
|---|---|---|
| `cpu` **(default)** | Mac dev, tests, any environment without GPU | Pillow LANCZOS + UnsharpMask. Always works, basic quality |
| `intel` | N100 / any Intel GPU Linux | `realesrgan-ncnn-vulkan` via Intel Vulkan ICD. Requires `--device /dev/dri` |
| `lavapipe` | Linux without physical GPU | Same binary but via Lavapipe (software Vulkan). Works everywhere on Linux, slow |

### If driver is not set — `cpu`
Vulkan is not emulated on Mac, the binary won't run. CPU only.

### If `intel` or `lavapipe` is selected but Vulkan is unavailable
User error — the service returns 500 with the Vulkan driver's error text.

## Quick start

### Published image (Docker Hub)

```bash
docker run -d -p 8000:8000 okopok/imgup
# → http://localhost:8000
```

The image is published as `okopok/imgup` — run it without building.
For a custom build, use `docker build` (section below).

### Locally on Mac (development)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# → http://localhost:8000
```

### Docker on N100 (production)

```bash
docker build -t imgup .

docker run -d \
  --name imgup \
  -e PORT=8000 \
  -e UPSCALE_DRIVER=intel \
  --device /dev/dri:/dev/dri \
  -p 8000:8000 \
  imgup
```

For `lavapipe` (no GPU):

```bash
docker run -d \
  --name imgup \
  -e PORT=8000 \
  -e UPSCALE_DRIVER=lavapipe \
  -p 8000:8000 \
  imgup
```

### Docker on Mac (testing)

```bash
docker build --platform linux/amd64 -t imgup .
docker run --platform linux/amd64 -p 8000:8000 imgup
# → http://localhost:8000
# UPSCALE_DRIVER=cpu by default, Vulkan not needed
```

## API

### `GET /api/health`

```json
{
  "status": "ok",
  "model": "realesrgan-x4plus",
  "driver": "cpu",
  "driver_info": "Pillow LANCZOS (CPU)"
}
```

### `POST /api/upscale`

Upscale an image by URL.

**Request:**

```json
{
  "url": "https://example.com/photo.jpg",
  "scale": 2,
  "output_format": "JPEG"
}
```

- `url` (req) — image URL
- `scale` (opt) — multiplier (2, 3, 4…); if `null` — auto-calculate to 4K
- `output_format` (opt) — `JPEG`, `PNG`, `WEBP`; if `null` — preserve original

**Response:** image in body, `Content-Type` matching format.

### `POST /api/upscale/upload`

Upscale an uploaded file.

**Request:** `multipart/form-data`

| Field | Type | Description |
|---|---|---|
| `file` | file | Image (up to 50 MB) |
| `scale` (query) | int? | Multiplier |
| `output_format` (query) | str? | Output format |

**Response:** image.

## How it works

### Auto-calculating scale to 4K

```
scale = max(ceil(3840 / width), ceil(2160 / height))
```

Examples:
- 1920×1080 → 2x → 3840×2160
- 1280×720 → 3x → 3840×2160
- 640×480 → 4+3=12x (two passes: 4x, then 3x)

### Multi-pass

For scale > 4, sequential passes (4, 3, 2) are performed to stay within the model's maximum coefficient. After all passes, if the result is wider/taller than 4K, it's downscaled to fit the 3840×2160 bounding box while preserving aspect ratio.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `UPSCALE_DRIVER` | `cpu` | `cpu` / `intel` / `lavapipe` |

## Docker image

```
imgup:latest ~ 330 MB
```

Multi-stage build: first stage downloads `realesrgan-ncnn-vulkan` v0.2.5.0 with models (33 MB `realesrgan-x4plus`), second stage sets up the Python environment.

## Dependencies

- Python 3.11+
- FastAPI, uvicorn, Pillow, httpx (for CPU driver)
- `realesrgan-ncnn-vulkan` + Vulkan loader (for Vulkan driver)

## Why not PyTorch / ONNX

A PyTorch (CPU) image weighs ~2.5 GB. By using the standalone `realesrgan-ncnn-vulkan` binary without Python frameworks, the image is ~330 MB, and on N100 with Intel GPU the Vulkan driver provides hardware acceleration.