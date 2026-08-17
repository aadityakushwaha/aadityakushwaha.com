# Static Astro build served by nginx.
#
# The Cloudflare Pages Function under functions/ does not run here — nginx is
# not a Workers runtime. /api/contact therefore answers with an explicit
# "not available on this host" rather than an HTML 404, so the form can say
# something true instead of a generic failure.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
