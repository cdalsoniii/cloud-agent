FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY baseten-proxy.js ./

ENV NODE_ENV=production
ENV BASETEN_PROXY_PORT=9876

EXPOSE 9876

CMD ["node", "baseten-proxy.js"]
