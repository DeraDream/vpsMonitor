FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm install
RUN npm run build:web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 DATA_DIR=/app/data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages ./packages
VOLUME ["/app/data"]
EXPOSE 4173
CMD ["node","apps/api/src/server.mjs"]
