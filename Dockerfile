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

# The Prisma client is generated now, so starting the app needs no internet and is quick.
RUN npx prisma generate && npm run build

RUN chmod +x docker-start.sh

CMD ["./docker-start.sh"]
