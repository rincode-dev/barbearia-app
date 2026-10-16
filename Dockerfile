# Imagem de produção do barbearia-app (Next.js em modo `next start`).
# Build em três estágios: dependências → build → runner enxuto, rodando como usuário
# sem privilégios (uid 1001 — a pasta de fotos montada no container precisa pertencer a ele).
#
# Nenhum segredo entra no build: DATABASE_URL, ARQUIVOS_DIR e IP_PELO_CLOUDFLARE são
# injetadas em runtime (docker-compose.yml / --env-file). Por isso toda leitura de dados
# nas páginas públicas chama `await connection()` (nada é pré-renderizado no build).

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER nextjs
EXPOSE 3000
ENV PORT=3000

CMD ["npm", "run", "start"]
