# Backend execution rules

- Apply the dev and nodejs24-dev skills for backend tasks.
- This is the canonical BE for D:\Work\game\tu-tien-server\tutien_pixel.
- DATA_MODE must be real. Existing .env owns the actual MySQL/Redis endpoints and credentials. Preserve credentials, never print or commit them.
- Every frontend REST/Socket.IO request must reach this BE. Durable mutations must use the configured MySQL store and normal authenticated API paths.
- Use actual BE, MySQL and Redis for API/persistence/gameplay/failover verification. Do not substitute fake requests, fake Redis, in-memory repositories, JSON gameplay stores, or mocked responses.
- If a dependency is unavailable, report its actual error and continue independent work. Do not replace the dependency with a fake or count isolated tests as runtime evidence.
- Historical .backend-staging and .backend-validation copies in FE are not deployment or verification targets.
- Read current source and preserve user changes. Build/test requires an explicit request under the dev workflow.
- Direct SQL is for authorized schema work, diagnostics and verification. Never invent or silently change the database target.
