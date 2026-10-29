# BluOS Web UI
FROM node:26-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    LISTEN=0.0.0.0

WORKDIR /app

# 依存だけ先に入れてレイヤーキャッシュを効かせる
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY bin ./bin
COPY public ./public
# CLI もコンテナ内で使える（例: docker compose exec bluos-web bluos status）
RUN ln -s /app/bin/bluos.js /usr/local/bin/bluos

USER node
EXPOSE 3000

# Web UI 自体の死活確認（プレーヤーに繋がらなくても UI は動くので、プレーヤーへの疎通は見ない）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/config').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "server.js"]
