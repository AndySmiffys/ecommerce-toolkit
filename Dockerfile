# The base image can be changed at build time. AWS builds use the copy on Amazon's public registry, because Docker Hub
# limits how many images a shared build machine may pull.
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# React Router only accepts a form post whose origin matches the app's own address or one listed in
# react-router.config.ts, which reads SHOPIFY_APP_URL when the app is built. Behind App Runner the app sees its address
# without https, so the real address is given here. The image is therefore built per environment.
ARG SHOPIFY_APP_URL
ENV SHOPIFY_APP_URL=${SHOPIFY_APP_URL}

# The Prisma client is generated now, so starting the app needs no internet and is quick.
RUN npx prisma generate && npm run build

RUN chmod +x docker-start.sh

CMD ["./docker-start.sh"]
