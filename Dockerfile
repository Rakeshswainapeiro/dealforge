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
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev

# Copy backend source and the built frontend
COPY server ./server
COPY --from=build /app/dist ./dist
# Seed data (Sirius org subtree) is imported by the server at boot
COPY src/data/siriusOrgTree.js ./src/data/siriusOrgTree.js
# Locale dictionaries are shared with the server i18n endpoint (W8-02 / PLT-06)
COPY src/lib/i18nMessages.js ./src/lib/i18nMessages.js

# Uploaded files live on a volume
RUN mkdir -p /app/uploads

EXPOSE 3001
CMD [ "node", "server/index.js" ]
