# Build do SPA (Vite) e serve via nginx com proxy /api → api:3000
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# páginas estáticas auxiliares (entram no Git versionadas)
COPY extra/backup.html /usr/share/nginx/html/backup.html
COPY extra/conta.html  /usr/share/nginx/html/conta.html
EXPOSE 80
