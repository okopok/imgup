# imgup

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
- Driver info в хедере

## Architecture

```
         ┌──────────────────┐
Browser ─┤  GET /           │  Web UI (HTML+CSS+JS)
         └──────────────────┘

         ┌──────────────────┐
Client ──┤  POST /api/*     │  JSON → изображение
         └────────┬─────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
CPU (Pillow)         Vulkan (Real-ESRGAN)
macOS / любой        N100 с Intel GPU
качество ниже        качество Real-ESRGAN
```

**Разделение URL:**
- `GET /` — веб-интерфейс
- `GET /static/*` — статика (CSS, JS)
- `GET /api/health` — health check
- `POST /api/upscale` — апскейл по URL
- `POST /api/upscale/upload` — апскейл загрузки

## Выбор драйвера

Управляется переменной `UPSCALE_DRIVER`.

| Драйвер | Когда использовать | Механизм |
|---|---|---|
| `cpu` **(по умолчанию)** | Разработка на Mac, тесты, любое окружение без GPU | Pillow LANCZOS + UnsharpMask. Работает всегда, качество базовое |
| `intel` | N100 / любой Intel GPU Linux | `realesrgan-ncnn-vulkan` через Intel Vulkan ICD. Требует `--device /dev/dri` |
| `lavapipe` | Linux без физического GPU | Тот же бинарник, но через Lavapipe (софт- Vulkan). Работает везде на Linux, медленно |

### Если драйвер не указан — `cpu`
На Mac Vulkan не эмулируется, бинарник не запускается. Только CPU.

### Если выбран `intel` или `lavapipe`, а Vulkan недоступен
Ошибка пользователя — сервис вернёт 500 с текстом ошибки от драйвера Vulkan.

## Быстрый старт

### Локально на Mac (разработка)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# → http://localhost:8000
```

### Docker на N100 (продакшн)

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

Для `lavapipe` (без GPU):

```bash
docker run -d \
  --name imgup \
  -e PORT=8000 \
  -e UPSCALE_DRIVER=lavapipe \
  -p 8000:8000 \
  imgup
```

### Docker на Mac (тестирование)

```bash
docker build --platform linux/amd64 -t imgup .
docker run --platform linux/amd64 -p 8000:8000 imgup
# → http://localhost:8000
# UPSCALE_DRIVER=cpu по умолчанию, Vulkan не нужен
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

Апскейл изображения по URL.

**Request:**

```json
{
  "url": "https://example.com/photo.jpg",
  "scale": 2,
  "output_format": "JPEG"
}
```

- `url` (req) — ссылка на изображение
- `scale` (opt) — множитель (2, 3, 4…); если `null` — авто-расчёт до 4K
- `output_format` (opt) — `JPEG`, `PNG`, `WEBP`; если `null` — сохранить исходный

**Response:** изображение в теле ответа, `Content-Type` по формату.

### `POST /api/upscale/upload`

Апскейл загруженного файла.

**Request:** `multipart/form-data`

| Поле | Тип | Описание |
|---|---|---|
| `file` | file | Изображение (до 50 MB) |
| `scale` (query) | int? | Множитель |
| `output_format` (query) | str? | Формат на выходе |

**Response:** изображение.

## Как это работает

### Авто-расчёт scale до 4K

```
scale = max(ceil(3840 / width), ceil(2160 / height))
```

Примеры:
- 1920×1080 → 2x → 3840×2160
- 1280×720 → 3x → 3840×2160
- 640×480 → 4+3=12x (два прохода: 4x, потом 3x)

### Multi-pass

Для scale > 4 выполняются последовательные проходы (4, 3, 2), чтобы не превысить максимальный коэффициент модели. После всех проходов, если результат шире/выше 4K, он уменьшается до bounding box 3840×2160 с сохранением пропорций.

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `8000` | Порт HTTP |
| `UPSCALE_DRIVER` | `cpu` | `cpu` / `intel` / `lavapipe` |

## Docker image

```
imgup:latest ~ 330 MB
```

Сборка multi-stage: на первом этапе скачивается `realesrgan-ncnn-vulkan` v0.2.5.0 с моделями (33 MB `realesrgan-x4plus`), на втором — Python-окружение.

## Зависимости

- Python 3.11+
- FastAPI, uvicorn, Pillow, httpx (для CPU-драйвера)
- `realesrgan-ncnn-vulkan` + Vulkan loader (для Vulkan-драйвера)

## Почему не PyTorch / ONNX

Образ с PyTorch (CPU) весит ~2.5 GB. Используя standalone бинарник `realesrgan-ncnn-vulkan` без Python-фреймворков, образ получается ~330 MB, а на N100 с Intel GPU Vulkan-драйвер даёт аппаратное ускорение.