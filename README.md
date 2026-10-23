# Tu Tien Pixel Backend

Backend modular-monolith cho vertical slice đầu tiên của webgame:

`Auth → Player → Wallet/Inventory → Shop → game_command`

## Chạy local

```bash
npm install
copy .env.example .env
npm start
```

Persistence dùng MySQL/InnoDB. Với XAMPP, bật MySQL trên port `3306`, import [schema.sql](schema.sql) bằng phpMyAdmin, rồi cấu hình `.env` theo `.env.example`.

## Contract chính

- `GET /api/health`
- `POST /api/auth/register` `{ username, password }`
- `POST /api/auth/login` `{ username, password }`
- `GET /api/player/me` với Bearer token
- `POST /api/player` `{ name }` với Bearer token
- `GET /api/catalog/items` 
- `POST /api/player/shop/buy` `{ requestId, itemCode, quantity }` với Bearer token
- Socket.IO `game_command` cho `world.join`, `movement.intent`, `world.resync`

## Roadmap tiếp theo

1. Refresh-session rotation, RBAC admin, schema validation tập trung.
2. Redis adapter/dedup/resync runtime và test contract.
3. Content/admin, quest, combat persistence và observability.
