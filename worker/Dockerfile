FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY worker ./worker
COPY src/lib/supabase/types.ts ./src/lib/supabase/types.ts
COPY src/features/scans/types.ts ./src/features/scans/types.ts
ARG SCAN_CODE_SHA
ENV SCAN_CODE_SHA=$SCAN_CODE_SHA
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 CMD ["node","worker/healthcheck.mjs"]
USER node
CMD ["node","--import","tsx","worker/main.ts"]
