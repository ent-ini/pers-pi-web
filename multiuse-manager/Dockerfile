FROM node:22-bookworm-slim

WORKDIR /app
COPY manager.mjs template-store.mjs workspace-template.mjs workspace-reset.mjs worker-image.mjs ./
EXPOSE 3030
CMD ["node", "manager.mjs"]
