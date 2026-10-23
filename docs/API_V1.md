# API V1

All mutation requests use a client-generated `requestId` where noted. Authenticated routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Body | Auth |
|---|---|---|---|
| GET | `/api/health` | - | No |
| POST | `/api/auth/register` | `username`, `password` | No |
| POST | `/api/auth/login` | `username`, `password` | No |
| GET | `/api/player/me` | - | Player |
| POST | `/api/player` | `name` | Player |
| GET | `/api/catalog/items` | - | No |
| POST | `/api/player/shop/buy` | `requestId`, `itemCode`, `quantity` | Player |

Mutation responses use `{ ok: true, player }`; failures use `{ ok: false, error: { code, message } }`.

Socket.IO uses `game_command` with `{ requestId, type, payload }` and currently accepts `world.join`, `movement.intent`, and `world.resync`.
