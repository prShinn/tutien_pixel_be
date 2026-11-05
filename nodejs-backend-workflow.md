# Workflow xây dựng Backend với Node.js

> Stack tham chiếu: **Node.js 20 LTS + TypeScript + Express + PostgreSQL + Prisma + Redis + Zod + JWT + Jest/Supertest + Docker + GitHub Actions**
> Áp dụng cho: REST API app / webgame (kèm Socket.IO cho realtime).
> Chuẩn tham chiếu: BABOK, C4, OpenAPI 3, OWASP Top 10, 12-Factor, ISTQB, DORA.

---

## Mục lục

1. [Phân tích yêu cầu](#1-phân-tích-yêu-cầu)
2. [Thiết kế kiến trúc & chọn stack](#2-thiết-kế-kiến-trúc--chọn-stack)
3. [Thiết kế Database (Prisma)](#3-thiết-kế-database-prisma)
4. [Thiết kế API contract (OpenAPI)](#4-thiết-kế-api-contract-openapi)
5. [Khởi tạo project & cấu trúc thư mục](#5-khởi-tạo-project--cấu-trúc-thư-mục)
6. [Cài đặt các tầng (Model → Repo → Service → Controller → Route)](#6-cài-đặt-các-tầng)
7. [Middleware: Auth, Validation, Error handling](#7-middleware)
8. [Bảo mật (OWASP)](#8-bảo-mật-owasp)
9. [Kiểm thử](#9-kiểm-thử)
10. [Docker & CI/CD](#10-docker--cicd)
11. [Vận hành & Bảo trì](#11-vận-hành--bảo-trì)
12. [Phụ lục: Webgame (Realtime)](#12-phụ-lục-webgame-realtime)
13. [Checklist tổng](#13-checklist-tổng)

---

## 1. Phân tích yêu cầu

**Làm gì**
- Liệt kê stakeholder, mục tiêu, in-scope / out-of-scope.
- Viết User Story + Acceptance Criteria (Given/When/Then).
- Tách Functional / Non-functional (số user đồng thời, latency, uptime).
- Xếp ưu tiên theo **MoSCoW**.

**Mẫu User Story**

```
Là một người chơi,
tôi muốn đăng ký tài khoản bằng email,
để lưu tiến trình chơi của mình.

Acceptance Criteria:
- Given email chưa tồn tại, When gửi form hợp lệ, Then trả 201 và token.
- Given email đã tồn tại, When đăng ký, Then trả 409.
- Given mật khẩu < 8 ký tự, When đăng ký, Then trả 422.
```

**Output:** `docs/01-srs.md`, backlog (GitHub Projects / Jira).

---

## 2. Thiết kế kiến trúc & chọn stack

| Hạng mục | Lựa chọn | Ghi chú |
|---|---|---|
| Runtime | Node.js 20 LTS | |
| Ngôn ngữ | TypeScript (strict) | Type-safe, dễ refactor |
| Framework | Express (đơn giản) / Fastify (nhanh) / NestJS (opinionated) | Bài này dùng Express |
| DB | PostgreSQL | Quan hệ, ACID |
| ORM | Prisma | Migration + type generation |
| Cache / Session | Redis | Leaderboard, rate limit, game state |
| Validation | Zod | Schema = type |
| Auth | JWT (access + refresh) | |
| Logger | pino | Structured log |
| Test | Jest + Supertest | |
| Realtime | Socket.IO | Webgame |

**Kiến trúc:** Modular Monolith (chia theo module nghiệp vụ, dễ tách microservice sau).

**Việc cần làm**
- Vẽ **C4**: Context → Container → Component (dùng draw.io / Mermaid / Structurizr).
- Ghi quyết định vào **ADR**: `docs/adr/0001-chon-express-prisma.md`.

```md
# ADR-0001: Chọn Express + Prisma
- Trạng thái: Accepted
- Bối cảnh: Team nhỏ, cần ra MVP nhanh.
- Quyết định: Express + Prisma + PostgreSQL.
- Hệ quả: Cần tự dựng cấu trúc thư mục; Prisma khóa vào schema riêng.
```

---

## 3. Thiết kế Database (Prisma)

**Quy trình:** Entity → quan hệ → ERD → chuẩn hóa 3NF → viết `schema.prisma` → migrate.

**Quy ước**
- Bảng số nhiều `snake_case`, model Prisma `PascalCase`.
- Mọi bảng có `id`, `createdAt`, `updatedAt`; cân nhắc soft delete (`deletedAt`).
- Đánh **index** cho cột hay filter/join; đặt **unique** và **FK** rõ ràng.

**`prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

model User {
  id           String    @id @default(uuid())
  email        String    @unique
  username     String    @unique
  passwordHash String    @map("password_hash")
  role         Role      @default(USER)
  scores       Score[]
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")
  deletedAt    DateTime? @map("deleted_at")

  @@map("users")
}

model Score {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  value     Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@index([value(sort: Desc)])
  @@map("scores")
}
```

**Lệnh**

```bash
npx prisma migrate dev --name init     # tạo + áp migration (dev)
npx prisma migrate deploy              # áp migration (staging/prod)
npx prisma generate                    # sinh client
npx prisma studio                      # xem dữ liệu
```

> Không bao giờ sửa tay migration đã chạy ở môi trường chung. Thay đổi mới = migration mới.

---

## 4. Thiết kế API contract (OpenAPI)

**Design-first:** viết contract trước khi code.

**Quy ước REST**
- Base: `/api/v1`, tài nguyên là danh từ số nhiều: `/users`, `/scores`.
- Verb: `GET` đọc, `POST` tạo, `PUT/PATCH` sửa, `DELETE` xóa.
- Status code: `200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500`.

**Format chuẩn**

```jsonc
// Thành công
{ "success": true, "data": { ... }, "meta": { "page": 1, "limit": 20, "total": 134 } }

// Lỗi
{ "success": false, "error": { "code": "EMAIL_TAKEN", "message": "Email đã tồn tại", "details": [] } }
```

**`docs/openapi.yaml` (rút gọn)**

```yaml
openapi: 3.0.3
info:
  title: Game API
  version: 1.0.0
servers:
  - url: http://localhost:3000/api/v1
paths:
  /auth/register:
    post:
      summary: Đăng ký
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RegisterInput'
      responses:
        '201': { description: Created }
        '409': { description: Email đã tồn tại }
        '422': { description: Dữ liệu không hợp lệ }
components:
  schemas:
    RegisterInput:
      type: object
      required: [email, username, password]
      properties:
        email:    { type: string, format: email }
        username: { type: string, minLength: 3 }
        password: { type: string, minLength: 8 }
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
```

Hiển thị bằng `swagger-ui-express` tại `/docs`.

---

## 5. Khởi tạo project & cấu trúc thư mục

**Khởi tạo**

```bash
mkdir game-api && cd game-api
npm init -y
git init

# Runtime deps
npm i express zod @prisma/client bcrypt jsonwebtoken pino pino-http \
      helmet cors express-rate-limit dotenv ioredis swagger-ui-express
# Dev deps
npm i -D typescript tsx @types/node @types/express @types/bcrypt \
         @types/jsonwebtoken @types/cors prisma \
         jest ts-jest @types/jest supertest @types/supertest \
         eslint prettier husky lint-staged

npx tsc --init
npx prisma init
```

**`tsconfig.json` (các mục quan trọng)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

**Scripts `package.json`**

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "lint": "eslint .",
    "test": "jest --coverage",
    "migrate": "prisma migrate dev"
  }
}
```

**Cấu trúc thư mục**

```
game-api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── config/
│   │   ├── env.ts            # validate biến môi trường (Zod)
│   │   ├── prisma.ts         # PrismaClient singleton
│   │   ├── redis.ts
│   │   └── logger.ts
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.schema.ts      # Zod DTO
│   │   │   └── auth.routes.ts
│   │   └── user/
│   │       ├── user.controller.ts
│   │       ├── user.service.ts
│   │       ├── user.repository.ts
│   │       ├── user.schema.ts
│   │       └── user.routes.ts
│   ├── middlewares/
│   │   ├── auth.middleware.ts
│   │   ├── validate.middleware.ts
│   │   ├── error.middleware.ts
│   │   └── rateLimit.middleware.ts
│   ├── utils/
│   │   ├── AppError.ts
│   │   └── asyncHandler.ts
│   ├── app.ts                # tạo Express app (dễ test)
│   └── server.ts             # listen + graceful shutdown
├── tests/
│   ├── unit/
│   └── integration/
├── docs/                     # SRS, ADR, openapi.yaml, ERD, C4
├── .env.example
├── .eslintrc.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

**Luồng request**

```
Route → Middleware (auth, validate) → Controller → Service → Repository → DB
```

- **Controller:** chỉ nhận `req`, gọi service, trả `res`.
- **Service:** business logic, **không** biết `req/res`.
- **Repository:** truy cập DB duy nhất ở đây.

---

## 6. Cài đặt các tầng

> Thứ tự code: **Config → Util → Repository → Service → Controller → Route → app.ts**

### 6.1 Config

**`.env.example`**

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/game
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=change_me_access
JWT_REFRESH_SECRET=change_me_refresh
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
CORS_ORIGIN=http://localhost:5173
```

**`src/config/env.ts`**

```ts
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('*'),
});

export const env = schema.parse(process.env); // fail-fast nếu thiếu/sai
```

**`src/config/prisma.ts`**

```ts
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
```

**`src/config/logger.ts`**

```ts
import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: ['req.headers.authorization', 'password', 'passwordHash'],
});
```

### 6.2 Utils

**`src/utils/AppError.ts`**

```ts
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details: unknown[] = [],
  ) {
    super(message);
  }
}
```

**`src/utils/asyncHandler.ts`**

```ts
import { Request, Response, NextFunction, RequestHandler } from 'express';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
```

### 6.3 Schema / DTO (Zod)

**`src/modules/auth/auth.schema.ts`**

```ts
import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    username: z.string().min(3).max(20),
    password: z.string().min(8).max(72),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
```

### 6.4 Repository

**`src/modules/user/user.repository.ts`**

```ts
import { prisma } from '../../config/prisma';

export const userRepository = {
  findByEmail: (email: string) =>
    prisma.user.findFirst({ where: { email, deletedAt: null } }),

  findById: (id: string) =>
    prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, email: true, username: true, role: true, createdAt: true },
    }),

  create: (data: { email: string; username: string; passwordHash: string }) =>
    prisma.user.create({ data }),
};
```

### 6.5 Service

**`src/modules/auth/auth.service.ts`**

```ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { userRepository } from '../user/user.repository';
import { RegisterInput, LoginInput } from './auth.schema';

const signTokens = (user: { id: string; role: string }) => ({
  accessToken: jwt.sign({ sub: user.id, role: user.role }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES,
  }),
  refreshToken: jwt.sign({ sub: user.id }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES,
  }),
});

export const authService = {
  async register(input: RegisterInput) {
    const existed = await userRepository.findByEmail(input.email);
    if (existed) throw new AppError(409, 'EMAIL_TAKEN', 'Email đã tồn tại');

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await userRepository.create({
      email: input.email,
      username: input.username,
      passwordHash,
    });

    return { user: { id: user.id, email: user.email, username: user.username }, ...signTokens(user) };
  },

  async login(input: LoginInput) {
    const user = await userRepository.findByEmail(input.email);
    // Thông báo chung để tránh lộ email có tồn tại hay không
    const ok = user && (await bcrypt.compare(input.password, user.passwordHash));
    if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Sai email hoặc mật khẩu');

    return { user: { id: user.id, email: user.email, username: user.username }, ...signTokens(user) };
  },
};
```

### 6.6 Controller

**`src/modules/auth/auth.controller.ts`**

```ts
import { Request, Response } from 'express';
import { authService } from './auth.service';

export const authController = {
  register: async (req: Request, res: Response) => {
    const data = await authService.register(req.body);
    res.status(201).json({ success: true, data });
  },

  login: async (req: Request, res: Response) => {
    const data = await authService.login(req.body);
    res.status(200).json({ success: true, data });
  },
};
```

### 6.7 Route

**`src/modules/auth/auth.routes.ts`**

```ts
import { Router } from 'express';
import { authController } from './auth.controller';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { registerSchema, loginSchema } from './auth.schema';

const router = Router();

router.post('/register', validate(registerSchema), asyncHandler(authController.register));
router.post('/login', validate(loginSchema), asyncHandler(authController.login));

export default router;
```

**`src/modules/user/user.routes.ts`**

```ts
import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { userController } from './user.controller';

const router = Router();
router.get('/me', authenticate, asyncHandler(userController.me));
export default router;
```

### 6.8 App & Server

**`src/app.ts`**

```ts
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { globalLimiter } from './middlewares/rateLimit.middleware';
import { errorHandler, notFound } from './middlewares/error.middleware';
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/user/user.routes';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: '10kb' }));
app.use(pinoHttp({ logger }));
app.use(globalLimiter);

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);

app.use(notFound);
app.use(errorHandler);
```

**`src/server.ts`**

```ts
import { app } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';

const server = app.listen(env.PORT, () => logger.info(`API chạy tại cổng ${env.PORT}`));

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`${signal} nhận được, đang tắt...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

## 7. Middleware

**`src/middlewares/validate.middleware.ts`**

```ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from '../utils/AppError';

export const validate =
  (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
    if (!result.success) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ', result.error.issues);
    }
    next();
  };
```

**`src/middlewares/auth.middleware.ts`**

```ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; role: string };
  }
}

export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHORIZED', 'Thiếu token');

  try {
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as { sub: string; role: string };
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    throw new AppError(401, 'TOKEN_INVALID', 'Token không hợp lệ hoặc đã hết hạn');
  }
};

// RBAC
export const authorize =
  (...roles: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Không đủ quyền');
    }
    next();
  };
```

**`src/middlewares/error.middleware.ts`**

```ts
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';

export const notFound = (_req: Request, _res: Response, next: NextFunction) =>
  next(new AppError(404, 'NOT_FOUND', 'Không tìm thấy tài nguyên'));

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  logger.error(err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống', details: [] },
  });
};
```

**`src/middlewares/rateLimit.middleware.ts`**

```ts
import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({ windowMs: 60_000, limit: 100 });
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10 }); // gắn riêng cho /auth
```

---

## 8. Bảo mật (OWASP)

| Rủi ro OWASP | Biện pháp trong Node.js |
|---|---|
| A01 Broken Access Control | `authenticate` + `authorize` (RBAC); luôn kiểm tra quyền sở hữu resource |
| A02 Cryptographic Failures | `bcrypt` (cost ≥ 12) / `argon2`; HTTPS; secret trong env |
| A03 Injection | Prisma (parameterized); validate mọi input bằng Zod; không nối chuỗi SQL |
| A04 Insecure Design | Threat modeling ở bước thiết kế; rate limit endpoint nhạy cảm |
| A05 Misconfiguration | `helmet`, CORS whitelist, ẩn stack trace ở prod, `NODE_ENV=production` |
| A06 Vulnerable Components | `npm audit`, Dependabot / Snyk trong CI |
| A07 Auth Failures | Access token ngắn hạn, refresh token, `authLimiter`, thông báo lỗi chung |
| A09 Logging Failures | pino + `redact`, không log password/token |
| A10 SSRF | Whitelist domain khi gọi URL do user cung cấp |

**Checklist nhanh**
- [ ] Không commit `.env` (thêm vào `.gitignore`).
- [ ] `express.json({ limit })` để chống payload lớn.
- [ ] Phân trang có giới hạn `limit` tối đa.
- [ ] Không trả `passwordHash` ra response (dùng `select`).

---

## 9. Kiểm thử

**Test Pyramid:** Unit (nhiều) → Integration (vừa) → E2E (ít). Mục tiêu coverage ≥ 70–80%.

**`jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts'],
};
```

**Unit test service (mock repository)**

```ts
// tests/unit/auth.service.test.ts
import { authService } from '../../src/modules/auth/auth.service';
import { userRepository } from '../../src/modules/user/user.repository';

jest.mock('../../src/modules/user/user.repository');
const repo = userRepository as jest.Mocked<typeof userRepository>;

describe('authService.register', () => {
  it('ném 409 khi email đã tồn tại', async () => {
    repo.findByEmail.mockResolvedValue({ id: '1' } as any);
    await expect(
      authService.register({ email: 'a@a.com', username: 'abc', password: '12345678' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_TAKEN' });
  });
});
```

**Integration test API (Supertest + DB test)**

```ts
// tests/integration/auth.test.ts
import request from 'supertest';
import { app } from '../../src/app';

describe('POST /api/v1/auth/register', () => {
  it('201 khi dữ liệu hợp lệ', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `u${Date.now()}@test.com`, username: 'tester', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toBeDefined();
  });

  it('422 khi mật khẩu quá ngắn', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'x@test.com', username: 'tester', password: '123' });
    expect(res.status).toBe(422);
  });
});
```

> Dùng DB riêng cho test (`DATABASE_URL` trỏ DB test), chạy `prisma migrate deploy` trước khi test; dọn dữ liệu sau mỗi test.

**Công cụ khác:** Postman/Newman (API regression), **k6** (load test), ESLint + Prettier (static analysis).

---

## 10. Docker & CI/CD

**`Dockerfile` (multi-stage)**

```dockerfile
# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# ---- run ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

**`docker-compose.yml`**

```yaml
services:
  api:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_started }

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: game
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d game"]
      interval: 5s
      retries: 5

  redis:
    image: redis:7-alpine

volumes:
  pgdata:
```

**`.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: user, POSTGRES_PASSWORD: pass, POSTGRES_DB: game_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U user" --health-interval 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://user:pass@localhost:5432/game_test
      REDIS_URL: redis://localhost:6379
      JWT_ACCESS_SECRET: ci_access_secret_123456
      JWT_REFRESH_SECRET: ci_refresh_secret_123456
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - run: npm audit --audit-level=high
```

**Quy trình Git**
- Nhánh: `main` (prod) ← `develop` ← `feature/*`.
- Commit theo **Conventional Commits**: `feat(auth): add refresh token`, `fix(user): ...`.
- Bắt buộc PR + review + CI xanh mới merge (dùng `husky` + `lint-staged` để lint trước khi commit).
- Môi trường: `dev` → `staging` → `production`; deploy production có bước duyệt.

---

## 11. Vận hành & Bảo trì

- **Health check:** `/health` (liveness), thêm `/ready` kiểm tra DB/Redis (readiness).
- **Logging:** pino → stdout → gom về ELK / Loki / Datadog.
- **Monitoring:** `prom-client` expose `/metrics` → Prometheus + Grafana (latency, error rate, RPS).
- **Alert:** theo SLO (ví dụ error rate > 1%, p95 > 500ms).
- **Backup:** `pg_dump` định kỳ, thử restore thường xuyên.
- **Rollback:** giữ image version cũ; migration ưu tiên backward-compatible (expand → migrate → contract).
- **Tài liệu:** README, Swagger `/docs`, ADR, `CHANGELOG.md` theo **SemVer** (`standard-version` / `release-please`).
- **Hiệu năng:** dùng pool connection, cache Redis cho dữ liệu đọc nhiều, kiểm tra query chậm (`EXPLAIN`).

---

## 12. Phụ lục: Webgame (Realtime)

### 12.1 Socket.IO có xác thực

```ts
// src/realtime/socket.ts
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export const initSocket = (httpServer: HttpServer) => {
  const io = new Server(httpServer, { cors: { origin: env.CORS_ORIGIN } });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token as string;
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string };
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('room:join', (roomId: string) => socket.join(roomId));
    socket.on('game:move', (payload) => {
      // 1. Validate payload (Zod)  2. Kiểm tra luật chơi ở server  3. Cập nhật state  4. Broadcast
      io.to(payload.roomId).emit('game:state', { /* state mới */ });
    });
  });

  return io;
};
```

### 12.2 Nguyên tắc cho webgame

- **Server là nguồn sự thật (authoritative server):** mọi điểm số, vị trí, kết quả đều do server tính; client chỉ gửi *input*.
- **Chống cheat:** validate tốc độ, giới hạn tần suất sự kiện, kiểm tra tính hợp lệ của hành động, không tin giá trị điểm từ client.
- **Game state** lưu Redis (key `game:{roomId}`, đặt TTL); lưu kết quả cuối vào PostgreSQL.
- **Leaderboard** dùng Redis Sorted Set:

```ts
import { redis } from '../config/redis';

export const leaderboard = {
  async submit(userId: string, score: number) {
    await redis.zadd('leaderboard:global', 'GT', score, userId); // chỉ cập nhật nếu điểm cao hơn
  },
  async top(n = 10) {
    return redis.zrevrange('leaderboard:global', 0, n - 1, 'WITHSCORES');
  },
};
```

- **Scale ngang nhiều instance:** dùng `@socket.io/redis-adapter`, sticky session ở load balancer.
- **Rate limit sự kiện socket:** giới hạn số message/giây mỗi kết nối.

---

## 13. Checklist tổng

| # | Giai đoạn | Output | Xong |
|---|---|---|---|
| 1 | Phân tích | SRS, User Story, backlog MoSCoW | ☐ |
| 2 | Kiến trúc | C4, ADR, chọn stack | ☐ |
| 3 | Database | ERD, `schema.prisma`, migration | ☐ |
| 4 | API contract | `openapi.yaml`, quy ước response/error | ☐ |
| 5 | Khởi tạo | Cấu trúc thư mục, ESLint, Prettier, husky | ☐ |
| 6 | Code | Config → Repo → Service → Controller → Route | ☐ |
| 7 | Middleware | Auth, validate, error handler, rate limit | ☐ |
| 8 | Bảo mật | OWASP checklist, `npm audit` | ☐ |
| 9 | Test | Unit + Integration, coverage ≥ 70% | ☐ |
| 10 | DevOps | Dockerfile, compose, CI/CD pipeline | ☐ |
| 11 | Vận hành | Health, metrics, log, backup, rollback | ☐ |
| 12 | Tài liệu | README, Swagger, CHANGELOG | ☐ |

**Thứ tự tóm gọn:**
`Phân tích → Kiến trúc → ERD/Prisma → OpenAPI → Scaffold → Code (Repo→Service→Controller→Route) → Bảo mật → Test → Docker/CI-CD → Vận hành`
