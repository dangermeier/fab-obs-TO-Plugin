# No Chromium: the one-click GEM login needs a desktop browser and cannot run
# in a container. The config page offers the session cookie instead.
FROM node:20-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    FAB_IN_CONTAINER=1

WORKDIR /app

# Deps first, so code changes keep the npm layer cached.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/

# Session, settings, life totals. Mount a volume or lose them on recreate.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

# Exec form, node as PID 1: server.js flushes the life totals on SIGTERM.
STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
