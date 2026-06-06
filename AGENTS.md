# AGENTS.md — imgup

> **ВАЖНО: при любых изменениях README.md или AGENTS.md нужно обновлять оба языка**
> - `README.md` (русский) и `README.en.md` (английский) — всегда синхронно
> - `AGENTS.md` — обновлять при изменении архитектуры, переменных, маршрутов, инструкций
> — английской версии AGENTS нет, это внутренняя документация для агентов

## Структура проекта

```
imgup/
├── Dockerfile              # Multi-stage: builder (curl+unzip) + runtime
├── requirements.txt        # Python-зависимости
├── .env.example            # Пример конфига
├── README.md               # Документация
├── AGENTS.md               # Этот файл — для AI-агентов
└── app/
    ├── __init__.py
    ├── main.py             # FastAPI: / (UI), /api/health, /api/upscale, /api/upscale/upload
    ├── models.py           # Pydantic: UpscaleURLRequest, HealthResponse
    ├── upscaler.py         # Ядро: CPU и Vulkan драйвера
    └── static/
        ├── index.html      # Веб-интерфейс
        ├── style.css       # Тёмная/светлая тема, layout
        ├── script.js       # Drag-drop, загрузка, результат
        ├── favicon.svg     # SVG-фавиконка (треугольник ▲)
        ├── app-icon.svg    # PWA иконка 512×512
        ├── manifest.json   # PWA Web Manifest
        └── sw.js           # Service Worker (кеш статики)
```

## Карта маршрутов

| URL | Назначение |
|---|---|
| `GET /` | Web UI (SPA: статика + fetch к API) |
| `GET /static/*` | CSS, JS |
| `GET /api/health` | Health check |
| `POST /api/upscale` | Апскейл по URL (JSON → image) |
| `POST /api/upscale/upload` | Апскейл загрузки (multipart → image) |

UI — это простой HTML + CSS + vanilla JS без фреймворков. Страница загружается, дёргает `/api/health`, показывает driver в хедере. Взаимодействие — fetch к `/api/upscale/upload` с FormData.

Multi-file: dropzone с `multiple`, очередь файлов с превью, именем, размером, типом и разрешением. Кнопка "Upscale All" обрабатывает файлы последовательно. Каждый файл получает статус (pending → processing → done/error) и авто-скачивается при готовности.

## Ключевые файлы

### `app/upscaler.py`

Единственный модуль с бизнес-логикой. Содержит:

- **`UpscaleDriver`** — enum (`cpu`, `intel`, `lavapipe`)
- **`DRIVER`** — глобальный синглтон, инициализируется из `UPSCALE_DRIVER` при импорте
- **`_cpu_upscale()`** — Pillow LANCZOS + UnsharpMask
- **`_vulkan_upscale()`** — subprocess `realesrgan-ncnn-vulkan`
- **`_run_vulkan()`** — настройка `VK_ICD_FILENAMES` под выбранный драйвер, читает `UPSCALE_THREADS`, `UPSCALE_MODEL`, `UPSCALE_TILE`, `UPSCALE_GPU`
- **`_decompose_scale(n)`** — раскладывает нужный scale на проходы (4, 3, 2)
- **`upscale_file()`** — публичное API, диспатчит на драйвер

### `app/main.py`

FastAPI приложение. Три эндпоинта API + корневой маршрут для UI.
Исключения `UpscaleError` перехватываются глобальным `@app.exception_handler`.

### `app/static/`

- `index.html` — разметка: хедер с driver badge и темой, dropzone, file-queue, controls, loader, ошибка. `fileInput` с `multiple` для пачки файлов
- `style.css` — CSS-переменные для тем (`[data-theme="dark"]` / `[data-theme="light"]`), сохраняется в `localStorage`. Стили для `.file-queue`, `.file-item`, `.file-status`, `.file-meta`
- `script.js` — IIFE: всё в замыкании, `API = "/api"`. Multi-file: очередь файлов, асинхронная загрузка размеров (`Image`), статус каждого файла (pending/processing/done/error), последовательная обработка через `processAll()`, авто-скачивание каждого результата. `t()` для переводов на лету
- `favicon.svg` — SVG-фавиконка (залитый треугольник ▲ с градиентом `#7c5cfc → #b99bff`)
- `app-icon.svg` — PWA/Apple Touch иконка 512×512
- `manifest.json` — PWA Web Manifest (standalone, theme `#0f0f1a`, ссылка на иконку)
- `sw.js` — Service Worker: кеш статики при install, отдача из кеша, удаление старых кешей при activate

### `Dockerfile`

Multi-stage:
1. **builder**: `python:3.11-slim-bookworm` + curl → скачивает `realesrgan-ncnn-vulkan` v0.2.5.0 с моделями
2. **runtime**: тот же образ, копирует бинарник + модели + Python-код

Vulkan-драйверы (`mesa-vulkan-drivers`) устанавливаются в образ. Для работы Intel-драйвера нужен проброс `/dev/dri`.

## Выбор драйвера

| Значение | Когда сработает | Что должно быть в системе |
|---|---|---|
| `cpu` | Всегда | Ничего |
| `intel` | `realesrgan-ncnn-vulkan` найден, Intel ICD доступен | `libvulkan1`, `mesa-vulkan-drivers`, `/dev/dri` |
| `lavapipe` | `realesrgan-ncnn-vulkan` найден, Lavapipe ICD доступен | `libvulkan1`, `mesa-vulkan-drivers` |

Если `UPSCALE_DRIVER` не задан или задан неизвестно — `cpu`.

## Граничные случаи

- **Изображение уже >= 4K** → возвращается as-is (needed <= 1)
- **Соотношение сторон ≠ 16:9** → апскейл до вписывания в 4K-бокс (thumbnail), чёрные полосы не добавляются
- **Scale > 4** → multi-pass (напр. 12 = 4×3, 6 = 4×2, 8 = 4×2)
- **Файл > 50 MB** → 413 Payload Too Large
- **JPEG на выходе с альфой** → конвертация в RGB
- **Vulkan-драйвер упал** → `UpscaleError` с текстом stderr бинарника → 500

## Тестирование

### Сборка Docker

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

### Проверка Web UI

Открыть `http://localhost:8000` в браузере — dropzone, выбор пачки файлов, очередь с превью, апскейл всех, результат.

## Переменные окружения

| Var | По умолчанию | Описание |
|---|---|---|
| `PORT` | `8000` | HTTP-порт |
| `UPSCALE_DRIVER` | `cpu` | `cpu` / `intel` / `lavapipe` |
| `UPSCALE_THREADS` | `4:4:4` | Потоки `load:proc:save` для Vulkan |
| `UPSCALE_MODEL` | `realesrgan-x4plus` | `realesrgan-x4plus` или `realesrnet-x4plus` |
| `UPSCALE_GPU` | (не передаётся) | Индекс GPU для Vulkan. Пустая строка = авто |

## Заметки

- `realesrgan-ncnn-vulkan` версии v0.2.0 (из отдельного репо) **не содержит моделей** — нужна v0.2.5.0 из основного репозитория Real-ESRGAN
- На Mac (ARM) Docker-образ требует `--platform linux/amd64` и QEMU-эмуляцию; Vulkan в этом режиме не работает — только CPU
- Нативный запуск на Mac (без Docker): `pip install -r requirements.txt && uvicorn app.main:app`
- UI — статический SPA без шаблонизатора. Вёрстка на flex, темы через CSS-переменные + `data-theme` на `<html>`
