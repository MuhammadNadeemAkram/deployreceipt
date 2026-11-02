FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY worker ./worker
COPY src/lib/supabase/types.ts ./src/lib/supabase/types.ts
COPY src/features/scans/types.ts ./src/features/scans/types.ts
USER node
CMD ["./node_modules/.bin/tsx","worker/main.ts"]
