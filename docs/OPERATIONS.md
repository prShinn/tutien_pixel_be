# Vận hành và phục hồi dữ liệu

## Trước khi deploy

1. Dừng ghi gameplay/admin hoặc đưa API vào maintenance mode.
2. Tạo snapshot MySQL trước migration/deploy.
3. Xác nhận `.env` có `JWT_SECRET` riêng đủ mạnh, DB đúng môi trường, `CORS_ORIGIN` đúng origin FE; đặt `TRUST_PROXY_HOPS` đúng số reverse proxy tin cậy.
4. Dùng Node 24, import `schema.sql` cho database mới hoặc chạy migration đang phát hành đúng một lần.
5. Kiểm tra `/api/health` và `/api/health/ready`; endpoint readiness phải trả 503 khi MySQL không sẵn sàng.

## Backup và restore MySQL

Chạy lệnh trong `cmd.exe` để backup nhất quán cho InnoDB, gồm schema và dữ liệu:

```bat
set DB_USER=your_db_user
mysqldump --single-transaction --routines --triggers --databases tu_tien_pixel --user=%DB_USER% -p > backup-tu-tien-pixel.sql
```

MySQL hỏi password tương tác. Lưu backup ngoài thư mục public của BE, mã hóa theo chính sách hạ tầng và kiểm tra checksum sau khi chép.

Restore yêu cầu dừng BE và mọi worker đang ghi:

```bat
set DB_USER=your_db_user
mysql --user=%DB_USER% -p < backup-tu-tien-pixel.sql
```

Sau restore, khởi động BE, kiểm tra readiness, đăng nhập bằng tài khoản kiểm thử và xác nhận player, wallet, inventory, quest, admin content/version còn đúng trước khi mở traffic.

## Rollback migration

Migration `20261104_player_progression.sql` thêm bảng và cột, đồng thời đổi `players.x/y` sang `DOUBLE` và khởi tạo HP/MP từ stats. Trước deploy phải giữ backup trước migration. Nếu rollback cần hoàn nguyên dữ liệu, dừng BE và restore snapshot đó; không chạy `DROP` thủ công trên production vì migration sau có thể đã ghi thêm state vào các bảng mới.

## Runtime boundary

Account, player, wallet/ledger, inventory/equipment/skills, quest, admin override/audit, refresh token, loot claim và idempotency commit trong MySQL. Online presence, quái HP/respawn, ground drops, buffs, cooldowns và combat command cache ở memory process. Hiện chỉ hỗ trợ một BE instance; trước khi chạy nhiều instance cần Redis Socket.IO adapter cùng runtime owner/shared state và test reconnect/duplicate trên nhiều instance.

`SIGINT`/`SIGTERM` đóng Socket.IO/HTTP listener và pool MySQL một cách tuần tự. Backup automation, restore drill, centralized metrics/log aggregation và Redis adapter chưa được cấu hình trong repository.
