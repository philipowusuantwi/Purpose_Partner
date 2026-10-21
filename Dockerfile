# Purpose Partner production image: builds the web app, then runs the API which also serves it.

# ---- Build the client ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY client ./client
RUN npm run build

# ---- Runtime ----
FROM node:22-slim
ENV NODE_ENV=production \
    PP_DB=/data/purpose-partner.db \
    PORT=3001
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
# The SQLite database lives here - mount a persistent volume at /data.
RUN mkdir -p /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings=ExperimentalWarning", "server/src/index.js"]
