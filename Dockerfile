FROM node:22
MAINTAINER SDF Wallets Team <wallet-eng@stellar.org>

RUN mkdir -p /app
WORKDIR /app

COPY . /app/
RUN yarn
RUN yarn build:prod

EXPOSE 3002
CMD ["node", "build/index.js"]