FROM python:3.11-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN curl -fSLo realesrgan.zip \
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip" && \
    unzip realesrgan.zip && \
    rm realesrgan.zip
# The zip contains realesrgan-ncnn-vulkan binary + models/ (realesrgan-x4plus.param/.bin etc.)

FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 libstdc++6 ca-certificates libvulkan1 mesa-vulkan-drivers && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/realesrgan-ncnn-vulkan \
    /usr/local/bin/realesrgan-ncnn-vulkan
COPY --from=builder /build/models/ \
    /usr/local/share/realesrgan/models/

RUN chmod +x /usr/local/bin/realesrgan-ncnn-vulkan

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/

USER root

ENV PORT=8000
ENV UPSCALE_DRIVER=cpu

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1"]