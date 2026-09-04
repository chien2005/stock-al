FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY data/ ./data/

ENV TZ=Asia/Ho_Chi_Minh

CMD ["node", "src/index.js"]
