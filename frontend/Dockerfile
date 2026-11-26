# Stage 1: build static assets
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# cap Node's heap so the build fits on small servers (with swap)
RUN NODE_OPTIONS=--max-old-space-size=640 pnpm build

# Stage 2: serve static files (unprivileged nginx, SPA fallback)
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
