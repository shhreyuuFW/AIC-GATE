# Stage 1: Build React + Vite + Tailwind frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Python FastAPI runtime serving API + built SPA
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend/src \
    PORT=8080

WORKDIR /app

RUN adduser --disabled-password --gecos "" --uid 10001 aicgate

COPY pyproject.toml ./
COPY backend/src ./backend/src
RUN pip install --no-cache-dir .

COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

RUN chown -R aicgate:aicgate /app
USER aicgate

EXPOSE 8080

CMD ["sh", "-c", "uvicorn aic_gate.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'"]
