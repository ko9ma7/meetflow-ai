# ==============================================================================
# MeetFlow AI - Production Docker Container
# Bundles Node.js 20 Web Server + Python 3.11 Faster-Whisper AI STT Engine
# ==============================================================================

FROM python:3.11-slim-bookworm

# 1. Install System Dependencies & FFmpeg for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    ffmpeg \
    ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# 3. Set Working Directory
WORKDIR /app

# 4. Install Python Faster-Whisper and CTranslate2
RUN pip install --no-cache-dir \
    faster-whisper==1.0.3 \
    ctranslate2

# 5. Pre-cache Whisper 'base' model to avoid downloading on first run
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"

# 6. Copy Application Source Code
COPY package*.json ./
COPY server.js ./
COPY transcribe.py ./
COPY public ./public
COPY data ./data
COPY recordings ./recordings

# 7. Environment Variables
ENV PORT=3000
ENV NODE_ENV=production
ENV PYTHONIOENCODING=utf-8
ENV PYTHONUTF8=1

# 8. Expose Web Service Port
EXPOSE 3000

# 9. Start Web Service
CMD ["node", "server.js"]
