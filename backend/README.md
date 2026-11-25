# Backend

Backend dùng Express và PostgreSQL để nhận mẫu đo từ ESP32, lưu lịch sử, tính trung bình 8/24 giờ và quản lý cảnh báo. Hướng dẫn phần cứng và chạy toàn hệ thống nằm trong [README.md](../README.md).

## Cấu trúc code

Một request đi qua đúng 4 lớp, mỗi thư mục một nhiệm vụ:

```
server.ts            đọc .env, kiểm tra PostgreSQL, mở port, tắt server gọn
app.ts               ghép middleware, mount routes, phục vụ dashboard, bắt lỗi
  routes/            khai báo URL -> controller (1 dòng mỗi endpoint)
  controllers/       kiểm tra query/body, gọi service, trả JSON + mã lỗi
  validators/        schema zod chặn mẫu đo thiếu/null trước khi chạm SQL
  services/          toàn bộ SQL: đọc/ghi PostgreSQL, trung bình 8/24 giờ, cảnh báo
config/database.ts   kết nối pool PostgreSQL dùng chung cho cả dự án
database/schema.sql  cấu trúc bảng và chỉ mục
```

Muốn thêm một endpoint: khai báo URL trong `routes/`, viết handler trong `controllers/`, đặt SQL trong `services/`.

## Yêu cầu

- Node.js và npm.
- PostgreSQL đang chạy và có thể truy cập từ máy backend.

## Cấu hình database

Từ thư mục `backend/`, tạo file môi trường:

```bash
cp .env.example .env
```

Điền thông tin PostgreSQL vào `.env`. Nếu cần tạo role và database, chạy các lệnh sau bằng tài khoản quản trị PostgreSQL:

```sql
CREATE USER air_quality_user WITH PASSWORD 'your_strong_password';
CREATE DATABASE air_quality OWNER air_quality_user;
```

Khởi tạo bảng và chỉ mục:

```bash
psql -h localhost -U air_quality_user -d air_quality -f database/schema.sql
```

Đảm bảo `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST` và `DB_PORT` trong `.env` khớp với PostgreSQL.

## Chạy backend

```bash
npm install
npm run build
npm run dev
```

`npm run dev` chạy server phát triển tại port `3001` mặc định. Để chạy bản đã build, dùng `npm start`. Có thể đổi port bằng biến `PORT` trong `.env`.

Express phục vụ dashboard từ thư mục `frontend/` ở thư mục gốc dự án. Mở `http://localhost:3001/`; API được phục vụ cùng host và port. Từ thiết bị khác trong LAN, dùng địa chỉ LAN của máy chạy backend.

## Kiểm tra API

Kiểm tra backend và database:

```bash
curl http://localhost:3001/health
```

Gửi một mẫu thử (sẽ thêm bản ghi vào database):

```bash
curl -X POST http://localhost:3001/api/readings \
	-H 'Content-Type: application/json' \
	-d '{"measured_at":"2026-11-03T10:00:00Z","pm1_0":10,"pm2_5":18,"pm10":25,"co2":650,"temperature":28.5,"humidity":65}'
```

POST thành công trả HTTP `201`. Kiểm tra bản ghi mới nhất:

```bash
curl http://localhost:3001/api/readings/latest
```

Hiện `package.json` chưa khai báo script `test:api`; dùng các lệnh `curl` trên để kiểm thử thủ công.

## Endpoint

| Phương thức | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/` | Dashboard |
| `GET` | `/api` | Thông tin API |
| `GET` | `/health` | Trạng thái backend và database |
| `POST` | `/api/readings` | Lưu một mẫu đo |
| `GET` | `/api/readings/latest` | Mẫu mới nhất |
| `GET` | `/api/readings/history` | Lịch sử đo |
| `GET` | `/api/readings/averages` | Trung bình 8 giờ và 24 giờ |
| `GET` | `/api/alerts` | Danh sách cảnh báo |

History nhận `from`, `to` và `limit`; mặc định lấy 24 giờ gần nhất, mặc định `limit=10000`, tối đa `50000`. Averages nhận `?window=8` hoặc `?window=24`; bỏ `window` để trả cả hai khoảng. Alerts nhận `status=active` hoặc `status=resolved`; `limit` mặc định `100`, tối đa `500`.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3001` | Port HTTP backend |
| `DB_HOST` | `localhost` | Máy chủ PostgreSQL |
| `DB_PORT` | `5432` | Port PostgreSQL |
| `DB_NAME` | `air_quality` | Tên database |
| `DB_USER` | Không đặt | Tài khoản database |
| `DB_PASSWORD` | Không đặt | Mật khẩu database |
| `CORS_ORIGIN` | `*` | Origin được phép gọi API |

Không commit file `.env` hoặc thông tin xác thực vào Git.
