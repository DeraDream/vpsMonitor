FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
VOLUME ["/app/data"]
EXPOSE 4173
CMD ["node", "server.mjs"]
