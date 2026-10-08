# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=22.13.1
FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app
ENV NODE_ENV="production"


# ---- Frontend build stage --------------------------------------------------
FROM base AS build
# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build


# ---- Runtime stage: Express API + built SPA --------------------------------
FROM base AS runtime

# Install backend (API) dependencies only
# Reproducible install from the lockfile
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Copy backend source and the built frontend
COPY server ./server
COPY --from=build /app/dist ./dist
# Seed data (Sirius org subtree) is imported by the server at boot
COPY src/data/siriusOrgTree.js ./src/data/siriusOrgTree.js
# Locale dictionaries are shared with the server i18n endpoint (W8-02 / PLT-06)
COPY src/lib/i18nMessages.js ./src/lib/i18nMessages.js

# Uploaded files live on a volume, owned by the unprivileged runtime user.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

ENV UPLOAD_DIR=/app/uploads
# Run as the image's non-root "node" user (NFR-02).
USER node

# Liveness for the orchestrator: the unauthenticated health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3001
CMD [ "node", "server/index.js" ]
