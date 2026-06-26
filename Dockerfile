# Node 24 on Alpine — multi-arch, works on Orange Pi (arm64 / armv7)
FROM node:24-alpine

WORKDIR /app

# Install deps first for better layer caching.
# package-lock.json is present, so `npm ci` gives a reproducible install.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the app source (node_modules is excluded via .dockerignore)
COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
