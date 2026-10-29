FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm run build

# --- Target for API ---
FROM base AS api
WORKDIR /app/packages/api
CMD ["pnpm", "start"]

# --- Target for Web ---
FROM base AS web
WORKDIR /app/packages/web
EXPOSE 3000
CMD ["pnpm", "dev", "--host", "0.0.0.0"]

# --- Targets for Workers ---
FROM base AS ingestion-worker
WORKDIR /app/packages/workers/ingestion-worker
CMD ["pnpm", "start"]

FROM base AS analysis-worker
WORKDIR /app/packages/workers/analysis-worker
CMD ["pnpm", "start"]

FROM base AS similarity-worker
WORKDIR /app/packages/workers/similarity-worker
CMD ["pnpm", "start"]

FROM base AS reachability-worker
WORKDIR /app/packages/workers/reachability-worker
CMD ["pnpm", "start"]

FROM base AS provenance-worker
WORKDIR /app/packages/workers/provenance-worker
CMD ["pnpm", "start"]

FROM base AS llm-verifier-worker
WORKDIR /app/packages/workers/llm-verifier-worker
CMD ["pnpm", "start"]

FROM base AS reporting-worker
WORKDIR /app/packages/workers/reporting-worker
CMD ["pnpm", "start"]
