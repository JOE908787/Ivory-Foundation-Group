FROM node:20-slim

WORKDIR /usr/src/app

# Copy only server package.json first for dependency install
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy the entire project into the image
COPY . .

WORKDIR /usr/src/app/server

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "index.js"]
