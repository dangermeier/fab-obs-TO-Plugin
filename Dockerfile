# Slim image on purpose: the one-click GEM login needs a desktop browser and
# cannot work in a container anyway, so no Chromium is installed. The config
# page detects this and steers you to the manual session cookie instead.
FROM node:20-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    FAB_IN_CONTAINER=1

WORKDIR /app

# Dependencies first so a code change does not re-run npm install.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/

# Session, settings and life totals live here — mount a volume or they are
# lost when the container is recreated.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

# Node handles SIGTERM itself (server.js flushes the life totals on it), so run
# it as PID 1 without a shell in between.
STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
