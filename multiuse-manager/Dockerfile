FROM node:22-bookworm-slim
WORKDIR /app
COPY multiuse-manager/manager.mjs multiuse-manager/template-store.mjs multiuse-manager/workspace-template.mjs multiuse-manager/workspace-reset.mjs multiuse-manager/worker-image.mjs multiuse-manager/worker-network.mjs multiuse-manager/corporate-models.mjs multiuse-manager/model-admin.mjs multiuse-manager/model-gateway.mjs multiuse-manager/provider-fetch.mjs multiuse-manager/provider-redaction.mjs multiuse-manager/gateway-compat.mjs ./multiuse-manager/
COPY lib/model-discovery.ts lib/model-catalog.ts ./lib/
EXPOSE 3030
CMD ["node", "--experimental-strip-types", "multiuse-manager/manager.mjs"]
