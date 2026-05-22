FROM node:20-slim

WORKDIR /app

# Copy package.json from the server directory to install dependencies
COPY server/package*.json ./
RUN npm install --only=production

# Copy everything from root (frontend and backend)
COPY . .

EXPOSE 8080

# Start from the server entry point
CMD [ "node", "server/index.js" ]
