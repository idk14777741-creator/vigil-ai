# VIGIL AI — production container.
# Python stdlib only: no pip install, no requirements.txt, tiny image, fast cold start.
FROM python:3.12-slim

# Python hygiene in containers
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Ship only what the server needs
COPY server/ ./server/
COPY public/ ./public/
COPY supabase/ ./supabase/

# State (JSON demo store, uploads) lives outside the image; mount a volume here.
# Fly.io: fly volumes create vigil_data --size 1
# Render/Docker: mount a persistent disk (or accept ephemeral state in demo mode)
RUN mkdir -p /app/data

# Serve on the port the platform provides (PORT is set by Fly/Render/Heroku)
ENV VIGIL_HOST=0.0.0.0 \
    VIGIL_PORT=8787
EXPOSE 8787

# deploy.py loads .env if present, validates, then starts the server
CMD ["python3", "server/deploy.py"]
