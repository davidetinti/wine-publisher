FROM node:22-alpine

WORKDIR /app

COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

# la cartella dati deve essere scrivibile dall'utente non privilegiato
RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
VOLUME /app/data

USER node
CMD ["node", "server.js"]
