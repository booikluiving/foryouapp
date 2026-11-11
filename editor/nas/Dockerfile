# For_You voorstelling-editor (catalogus + paden + versies) voor de NAS.
# Bouwen vanuit een pakket van maak-pakket.sh, niet vanuit de hele app.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY . .
RUN chmod -R a+rX /app && mkdir -p /app/editor/data && chown 1000:1000 /app/editor/data
USER 1000:1000
ENV NODE_ENV=production EDITOR_DATA_DIR=/app/editor/data EDITOR_PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:3021/health || exit 1
CMD ["node", "editor/server/server.js"]
