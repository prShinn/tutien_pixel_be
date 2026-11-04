# Note phối hợp FE — tích hợp API BE

Tài liệu này đối chiếu trực tiếp với `public/js/api.js`, `auth.js`, `game.js`, `net.js`, `inventory.js`, `shop.js`, `cultivation.js`, `skills.js` và `core/mock-backend.mjs` trong repo `tutien_pixel` ngày 2026-11-04.

## 1. Quy tắc chung

- Giữ nguyên URL `/api/...` hiện tại. BE xác định owner từ Bearer token; `userId` trong body chỉ là field tương thích và không chọn tài khoản đích.
- Với mọi POST/PUT có side effect, FE tạo `requestId` bằng `crypto.randomUUID()` khi người chơi bắt đầu thao tác. Khi retry đúng thao tác, gửi lại cùng ID; thao tác mới phải có ID mới.
- BE trả `{ player, result }` cho mutation player. FE cần áp dụng `player` trả về sau commit làm state chuẩn.
- Giá, hiệu ứng, điều kiện cảnh giới và số lượng vật phẩm do BE tra catalog/kiểm tra. FE không gửi giá, xu, HP, stats dẫn xuất hoặc snapshot player làm dữ liệu có thẩm quyền.
- Login/register/demo hiện trả `token`/`accessToken` 15 phút và `refreshToken` 30 ngày. FE hiện đã lưu refresh token trong `sessionStorage`, gom request refresh đồng thời, thay cả hai token sau khi xoay vòng và gọi logout khi kết thúc phiên; giữ nguyên luồng này khi nối BE.

## 2. Payload mutation cần chuyển sang requestId/itemCode

| Hiện tại trong FE | Hợp đồng tích hợp BE |
|---|---|
| Shop mua `{ itemId }` | `{ requestId, itemCode: itemId, quantity: 1 }` |
| Shop bán `{ index }` | `{ requestId, itemCode: inventory[index].itemCode || inventory[index].id, quantity: 1 }` |
| Dùng vật phẩm `{ index, itemId }` | `{ requestId, itemCode: itemId }` |
| Hấp thụ `{ itemId, amount? }` | `{ requestId, itemCode: itemId }`; bỏ `amount`, BE đọc giá trị từ catalog |
| Đột phá `{}` | `{ requestId }` |
| Cấp stats `{ stat, amount }` | `{ requestId, stat, amount }` |
| Trang bị `{ index, itemId, slot }` | `{ requestId, itemCode: itemId, slot }` |
| Tháo trang bị `{ slot }` | `{ requestId, slot }` |
| Học skill `{ skillCode, source }` | `{ requestId, skillCode, source }` |
| Lưu loadout `{ skillCodes }` | `{ requestId, skillCodes }` |
| Quest accept/track/claim `{}` | `{ requestId }` |

Mỗi stack item chỉ nhận diện bằng `itemCode`; không dùng `index` làm định danh vì thứ tự túi có thể đổi giữa lúc mở UI và lúc request tới server. Trong migration, FE có thể tiếp tục gửi `itemId` cùng `itemCode`, nhưng BE chỉ dùng mã catalog đã kiểm tra.

## 3. Tạo nhân vật và tải lại

- `POST /api/player` vẫn nhận payload hiện tại để tương thích. BE chỉ dùng `name`, `stats`, `gender`, `linhCan`; map/spawn/cảnh giới ban đầu do server chọn. Các field còn lại trong `playerData` như `xu`, HP/MP, inventory, skills, `tuVi*`, `x/y` và equipment chỉ là hint, BE bỏ qua.
- `GET /api/player/by-user/:userId` tiếp tục hoạt động; `userId` phải trùng chủ sở hữu trong token. 404 nghĩa là tài khoản chưa có nhân vật.
- Khi cần lấy cảnh giới theo thứ tự để đột phá, gọi `/api/canh-gioi/stt/:stt`; `/api/canh-gioi/:id` tra theo ID catalog, dù hai giá trị tình cờ trùng trong seed hiện tại.
- FE nên khởi tạo game từ PlayerDTO BE trả về, không ghép lại `playerData` client sau khi tạo thành công.

## 4. Bỏ autosave snapshot rộng

`Net.saveNow()` hiện gửi toàn bộ player mỗi 30 giây. BE không chấp nhận snapshot này vì có thể ghi đè xu, inventory, HP, cảnh giới hoặc vị trí bằng dữ liệu client. FE hãy bỏ chu kỳ PUT snapshot; state được lưu từ từng use case server-authoritative và movement command. Không hiện thông báo “đã lưu” khi request snapshot cũ bị bỏ qua.

## 5. Admin và realtime

- Admin đang dùng `x-admin-key`. BE chuyển dần sang Bearer token có role `GM`/`ADMIN`; FE cần bỏ key lưu trong browser khi endpoint RBAC được bật. Trong migration, không đưa key production vào client bundle hoặc localStorage.
- `game_command` là envelope realtime chuẩn `{ requestId, type, payload }`. Tám command `world.join`, `world.resync`, `movement.intent`, `map.change`, `combat.attack`, `combat.skill`, `loot.pickup`, `chat.send` đã được triển khai.
- `movement.intent.x/y` là số thực theo tile. Server giới hạn tốc độ nền 44 tile/giây rồi tính AGI/buff tốc độ từ state server, kiểm tra va chạm và trả `movement_corrected` khi client vượt tốc độ hoặc đi vào nước/ngoài map. FE tiếp tục prediction, nhưng phải reconcile theo tọa độ trả về.
- `world.join` dùng map/vị trí lưu ở BE; `mapCode/x/y/mapVersion/hasMap` do FE gửi chỉ là hint và không thay nguồn dữ liệu server. `map.change` chỉ thành công khi nhân vật ở trong 14 tile quanh portal; BE tự chọn `toX/toY` trong portal, bỏ qua `x/y` đích FE gửi.
- Quái từ `world_init.monsters` có ID theo `monsterSpawns` của map. Combat dùng ID này; kỹ năng cần thuộc learned + equipped loadout, đủ MP và còn cooldown. Loot do server spawn; `loot.pickup` cập nhật inventory và quest một lần.
- Server phát `world_init`, `player_join/leave/move`, `movement_corrected`, `monster_update/spawn/death`, `combat_result`, `player_combat_result`, `skill_result`, `player_skill_cast`, `ground_loot_*`, `quest_state_update`, `chat_message`. FE có thể bỏ listener `world_state`, `player_map`, `monster_state_update` vì BE không phát các event cũ này.
- Ack lỗi có `{ ok:false, requestId, command, serverTime, error:{ code, message, details? } }`; hãy xử lý cả `COOLDOWN_ACTIVE`, `TARGET_OUT_OF_RANGE`, `PORTAL_NOT_FOUND_OR_OUT_OF_RANGE`, `LOOT_OUT_OF_RANGE` như thất bại authoritative.

## 6. Trạng thái tích hợp

BE cập nhật endpoint/payload đã triển khai trong `docs/API_V1.md`. Realtime room, quái, drop, cooldown và buff hiện ở memory một process; vị trí được flush định kỳ, còn vital mutation, item pickup và quest progress được commit trong MySQL. Nếu FE đang load map cùng code nhưng `mapVersion` khác server, hãy so version và tải lại map trước khi nhận movement.
