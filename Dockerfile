FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY parser ./parser
COPY dependency-engine ./dependency-engine
COPY backend ./backend
COPY fixtures ./fixtures
COPY sample-consumers ./sample-consumers
ENV PROJECT_ROOT=/app
ENV PORT=8006
EXPOSE 8006
CMD ["npx", "tsx", "backend/server.ts"]
