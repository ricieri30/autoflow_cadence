FROM node:20-slim
RUN apt-get update && apt-get install -y tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV TZ=UTC
EXPOSE 3000
CMD ["npm", "start"]
