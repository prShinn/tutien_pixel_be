# API V1

BE phục vụ FE tại `D:\Setup\mine\tutien_pixel`. Access token là Bearer JWT 15 phút; refresh token ngẫu nhiên 48 byte, lưu dạng hash trong MySQL và xoay vòng sau mỗi lần refresh (30 ngày). Mutation có side effect yêu cầu `requestId`; một lần retry dùng cùng ID và cùng payload, thao tác mới dùng ID mới.

## Status và lỗi

- `200`: đọc hoặc mutation hoàn tất; `201`: tạo tài khoản/nhân vật/admin resource hoặc liên kết portal.
- `400`: DTO/JSON không hợp lệ; `401`: thiếu/sai/hết hạn token; `403`: sai owner/role; `404`: resource không tồn tại; `409`: state/idempotency conflict; `413`: body vượt giới hạn; `429`: giới hạn tần suất; `503`: dependency hoặc content khởi đầu chưa sẵn sàng.
- REST lỗi có dạng `{ ok:false, error:string, code, details?, requestId? }`. Unexpected 5xx không lộ message nội bộ. Một số endpoint tương thích cũ trả JSON trực tiếp thay vì bọc `ok`.

| Endpoint | Success status | Side effect |
|---|---:|---|
| `POST /api/auth/register`, `/api/auth/demo` (demo chỉ dev) | 201 | Tạo user; tạo refresh session |
| `POST /api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`; `GET /api/auth/me` | 200 | Login tạo session; refresh xoay token; logout thu hồi refresh token |
| `GET /api/health`, `/api/health/ready`, world/catalog/player reads | 200 (readiness có thể 503) | Không ghi state |
| `POST /api/player` | 201 | Tạo một player canonical, wallet và initial skills; retry khi player đã có trả player hiện hữu |
| `PUT /api/player/:id` | 200 | Chỉ đổi tên, kiểm tra owner |
| Player shop/inventory/cultivation/stats/equipment/skills/quest mutations | 200 | Transaction + idempotency tùy mutation; details trong các phần bên dưới |
| `POST /api/admin/worlds`, `/api/admin/content/:collection`, `/api/admin/skill-vfx`, `/api/admin/portals/link` | 201 | Persist version/audit hoặc record/session |
| Admin validate/list/detail/update/delete/publish/portal-delete; content/VFX update/delete | 200 | Đọc không ghi; mutation persist và audit |
| `GET /api/admin/content/accounts` | 200 | Chỉ đọc; accounts không cho ghi qua content API |

Mutation REST thành công luôn trả DTO/snapshot theo dòng endpoint; endpoint tương thích cũ có thể không bọc `ok`. `requestId` mutation được nhận từ body; error handler phản hồi lại cùng ID nếu hợp lệ.

JSON body giới hạn 256 KiB cho API thông thường và 8 MiB cho admin map. Register/login/demo giới hạn 12 request mỗi IP/10 phút; refresh/logout 30 request mỗi IP/10 phút. Khi chạy sau proxy, cấu hình `TRUST_PROXY_HOPS` để rate limit dùng đúng client IP.

### Ví dụ lỗi validation

```json
{
  "ok": false,
  "error": "Số lượng phải là số nguyên từ 1 đến 99",
  "code": "INVALID_QUANTITY",
  "message": "Số lượng phải là số nguyên từ 1 đến 99",
  "requestId": "buy_req_0001"
}
```

### Ví dụ mutation mua vật phẩm

```http
POST /api/player/shop/buy
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{ "requestId": "buy_req_0001", "itemCode": "STONE_LINH_NHO", "quantity": 1 }
```

Response excerpt sau commit (PlayerDTO đầy đủ còn có các alias compatibility):

```json
{
  "ok": true,
  "player": {
    "id": "plr_example",
    "xu": 30,
    "inventory": [{ "id": "STONE_LINH_NHO", "itemCode": "STONE_LINH_NHO", "count": 1, "quantity": 1 }]
  },
  "result": { "type": "bought", "itemId": "STONE_LINH_NHO", "itemCode": "STONE_LINH_NHO", "quantity": 1, "price": 20 }
}
```

## Auth

| Method | Path | Body | Auth | Response |
|---|---|---|---|---|
| POST | `/api/auth/register` | `username`, `password` | Public | `{ user, token, accessToken, refreshToken }` |
| POST | `/api/auth/login` | `username`, `password` | Public | `{ user, token, accessToken, refreshToken }` |
| POST | `/api/auth/demo` | `{}` | Dev only | `{ user, token, accessToken, refreshToken }` |
| POST | `/api/auth/refresh` | `refreshToken` | Refresh token body | Token pair mới; refresh token cũ bị thu hồi |
| POST | `/api/auth/logout` | `refreshToken` | Refresh token body | `{ ok:true }`; thu hồi refresh token phiên đó |
| GET | `/api/auth/me` | - | Bearer | `{ user }` |

`register/demo` trả 201; `login/refresh/logout/me` trả 200. Tài khoản không `ACTIVE` không đăng nhập hoặc dùng token được. Refresh token cũ bị vô hiệu hóa ngay khi xoay vòng; FE cần tuần tự hóa refresh request. Access token hiện tại vẫn có hiệu lực tối đa 15 phút sau logout.

## Player, inventory, cultivation, shop

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/player/me` | Bearer | `{ player }` |
| GET | `/api/player/state` | Bearer | `PlayerDTO` |
| GET | `/api/player/by-user/:userId` | Bearer, same owner | `PlayerDTO` |
| GET | `/api/player/power` | Bearer | `{ combatPower }` |
| POST | `/api/player` | `name`, optional `stats`, `gender`, `linhCan` | `PlayerDTO` and compatibility `{ player }` |
| PUT | `/api/player/:id` | `{ name }` only | `PlayerDTO`; owner required |
| POST | `/api/player/stats/allocate` | `requestId`, `stat`, optional `amount` | `{ stats, unspentStatPoints, derivedStats, player }` |
| GET | `/api/catalog/items` | - | `{ items }` (shop compatibility) |
| POST | `/api/player/shop/buy` | `requestId`, `itemCode`, `quantity` | `{ ok, player, result }` |
| POST | `/api/player/shop/sell` | `requestId`, `itemCode`, `quantity` | `{ ok, player, result }` |
| POST | `/api/player/inventory/use` | `requestId`, `itemCode` | `{ player, result }` |
| POST | `/api/player/cultivation/absorb` | `requestId`, `itemCode` | `{ player, result }` |
| POST | `/api/player/cultivation/breakthrough` | `requestId` | `{ player, result }` |
| POST | `/api/player/equipment/equip` | `requestId`, `itemCode`, `slot` | `{ player, result }` |
| POST | `/api/player/equipment/unequip` | `requestId`, `slot` | `{ player, result }` |
| POST | `/api/player/skills/learn` | `requestId`, `skillCode`, optional `source` | `{ learnedSkills, skill, combatPower }` |
| PUT | `/api/player/skills/equip` | `requestId`, `skillCodes[]` | `{ equippedSkills, skills }` |

Tạo nhân vật dùng user từ JWT. Server chỉ nhận tên, gender/root đã kiểm tra theo catalog và stats hợp lệ; map, spawn, cảnh giới, HP/MP, wallet, skills, equipment và inventory do server tạo. `PUT /api/player/:id` không mass-assign snapshot. `itemCode` nhận diện stack; không dùng chỉ số `index`.

PlayerDTO duy trì alias `jsonIventory`, `trangBi`, `equip_slot` trong giai đoạn tích hợp. Inventory/equipment/skill/tu vi/stats mutation dùng transaction MySQL, khóa player row, action ledger và idempotency record.

## Quest

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/quests` | Bearer | `{ revision, trackedId, quests[] }` |
| POST | `/api/quests/:id/accept` | `{ requestId }` | `{ ok, revision, trackedId, quests[] }` |
| POST | `/api/quests/:id/track` | `{ requestId }` | `{ ok, revision, trackedId, quests[] }` |
| POST | `/api/quests/:id/claim` | `{ requestId }` | snapshot + `rewards`, `grantedItems`, player summary |

Quest state persist theo player. Reward xu, tu vi, item, trạng thái hoàn thành và idempotency key commit cùng transaction. Monster kill và item pickup tạo quest progress event; event update được gửi tới socket của người chơi gây ra event.

## World and catalog reads

- World: `GET /api/worlds`, `/api/worlds/default`, `/api/worlds/by-code?code=...`, `/api/world-structure`.
- Realm/root/item/skill/monster: `GET /api/canh-gioi`, `/api/canh-gioi/stt/:stt`, `/api/canh-gioi/:id`, `/api/linh-can`, `/api/items`, `/api/skills`, `/api/monsters`, `/api/balance`.
- Skill book: `GET /api/skills/catalog` (Bearer), response `{ skills, learnedSkills, equippedSkills }`.
- Skill VFX public: `GET /api/skill-vfx`, response `{ profiles: Record<skillCode,VfxProfile> }`.
- Health: `GET /api/health` liveness; `/api/health/ready` checks MySQL.

Catalog seed được sao chép trong `src/data`; item/skill overrides và world published version được nạp từ MySQL sau restart.

## Admin

| Method | Path | Auth | Success / side effect |
|---|---|---|---|
| GET/POST | `/api/admin/worlds` | GM/ADMIN Bearer; optional compatibility key | GET summary array; POST 201 và lưu world DRAFT |
| GET/PUT/DELETE | `/api/admin/worlds/:code` | GM/ADMIN Bearer; optional compatibility key | Detail/update/delete; ghi version và audit khi thay đổi |
| GET/POST | `/api/admin/worlds/:code/validate`, `/publish` | GM/ADMIN Bearer; optional compatibility key | Validate không ghi; publish chỉ khi hợp lệ và ghi version/audit |
| POST/DELETE | `/api/admin/portals/link`, `/api/admin/worlds/:code/portals/:portalId` | GM/ADMIN Bearer; optional compatibility key | Cập nhật map liên quan, ghi version/audit |
| GET/POST | `/api/admin/content/:collection` | GM/ADMIN Bearer; optional compatibility key | `{ collection, demo, persisted, data[] }`; create trả 201 |
| PUT/DELETE | `/api/admin/content/:collection/:id` | GM/ADMIN Bearer; optional compatibility key | Persist override/tombstone và audit |
| GET/POST | `/api/admin/skill-vfx` | GM/ADMIN Bearer; optional compatibility key | List profiles; create trả 201 và audit |
| PUT/DELETE | `/api/admin/skill-vfx/:skillCode` | GM/ADMIN Bearer; optional compatibility key | Persist profile/delete và audit |

Admin Bearer phải có role `GM` hoặc `ADMIN`. `ADMIN_API_KEY` là adapter migration tùy chọn, không phải cơ chế production cuối cùng. Mỗi ghi admin lưu audit record. Content item/skill được áp dụng vào catalog process hiện tại và nạp lại khi restart.

## Socket.IO

Handshake yêu cầu JWT trong `auth.token`. `game_command` envelope `{ requestId, type, payload }`; ack thành công `{ ok:true, requestId, command, serverTime, result }`, lỗi `{ ok:false, requestId, command, serverTime, error:{code,message,details?} }`. Server xác thực join, movement, map portal, combat, skill, loot, quest event và chat; contract chi tiết ở [SOCKET_V1.md](SOCKET_V1.md).

## Errors and rollout

REST error JSON giữ `{ ok:false, error, code, details?, requestId? }`; `error` luôn là chuỗi tương thích `Net._fetch`. FE snapshot autosave hiện chưa được hỗ trợ: xem [FE_INTEGRATION_NOTE.md](FE_INTEGRATION_NOTE.md).

Database hiện vẫn là MySQL/InnoDB. Cơ sở dữ liệu đã có cần chạy migration [20261104_player_progression.sql](../migrations/20261104_player_progression.sql) một lần; database mới import `schema.sql`. User/player/wallet/inventory/equipment/skill/quest/admin, refresh token, loot claim, ledgers và idempotency key được lưu trong MySQL. Presence, vị trí chưa flush, quái, drop, cooldown, buff và dedup của combat/chat chỉ nằm trong một process; chưa bật multi-instance.
