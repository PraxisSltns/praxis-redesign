# Railway builds from this file. The base image comes from the AWS public mirror of the official
# Node image, so builds don't depend on Docker Hub, whose anonymous pull limit was failing deploys.
FROM public.ecr.aws/docker/library/node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The page's build settings (VITE_*, compiled into the page, so never a secret). Railway passes a
# service variable of the same name into the build only when it is declared here.
ARG VITE_AUTH
ARG VITE_API_BASE_URL
ARG VITE_BACKEND
ARG VITE_AI_PROVIDERS
ARG VITE_RECOMMENDATION_ADAPTER
ARG VITE_TRYON_ADAPTER
ARG VITE_ALLOW_BILLABLE_IMAGES
ARG VITE_INTERNAL_PAGE
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start"]
