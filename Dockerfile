FROM node:22-alpine

ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health

CMD ["node", "server.js"]
