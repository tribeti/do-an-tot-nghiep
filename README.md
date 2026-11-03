# Hệ thống giám sát chất lượng không khí trong phòng

Dự án thu thập dữ liệu cảm biến bằng ESP32, gửi dữ liệu đến backend qua HTTP và lưu vào PostgreSQL. Backend cung cấp API để truy vấn số đo, tính trung bình theo cửa sổ 8 giờ và 24 giờ, đồng thời ghi nhận cảnh báo chất lượng không khí.

## Thành phần

- `hw/`: firmware PlatformIO dùng Arduino framework cho ESP32.
- `backend/`: API Node.js, TypeScript, Express và PostgreSQL.
- `frontend/`: dashboard HTML/CSS/JavaScript.
- `backend/database/schema.sql`: cấu trúc bảng và chỉ mục cho PostgreSQL.

Luồng dữ liệu: PMS7003, MH-Z19B, AHT20 và BMP280 được đọc bởi ESP32; firmware gửi một mẫu JSON mỗi 10 giây đến `POST /api/readings`. Backend kiểm tra dữ liệu, lưu vào PostgreSQL và đánh giá cảnh báo.

Dashboard lấy số đo mới nhất mỗi 10 giây và tải lại lịch sử mỗi 60 giây. Khi mạng hoặc backend gián đoạn, firmware giữ tối đa 30 mẫu trong RAM để thử gửi lại.

## Thiết bị và kết nối

Firmware hiện hỗ trợ các cảm biến sau:

| Cảm biến | Dữ liệu | Kết nối firmware |
|---|---|---|
| PMS7003 | PM1.0, PM2.5, PM10 | UART2, RX ESP32 GPIO16, TX GPIO17 |
| MH-Z19B | CO2 | UART1, RX ESP32 GPIO18, TX GPIO19 |
| AHT20 | Nhiệt độ, độ ẩm | I2C, SDA GPIO21, SCL GPIO22 |
| BMP280 | Áp suất | I2C, SDA GPIO21, SCL GPIO22 |

Kiểm tra điện áp hoạt động và sơ đồ chân của từng module trước khi đấu nối. Cảm biến BMP280 được khởi tạo ở địa chỉ I2C `0x77`, sau đó thử `0x76`. Firmware chờ khoảng 3 phút để MH-Z19B khởi động trước khi sử dụng số đo CO2.

## Yêu cầu

- Node.js và npm.
- PostgreSQL.
- PlatformIO Core hoặc tiện ích PlatformIO trong VS Code.
- `curl` để kiểm tra nhanh API (tùy chọn).
- ESP32 tương thích với cấu hình board `esp32dev`.

## Cài đặt và chạy backend

Mở terminal tại thư mục backend:

```bash
cd backend
npm install
cp .env.example .env
```

Chỉnh các giá trị kết nối PostgreSQL trong `backend/.env`. Tạo database và tài khoản nếu chưa có:

```sql
CREATE USER air_quality_user WITH PASSWORD 'your_strong_password';
CREATE DATABASE air_quality OWNER air_quality_user;
```

Khởi tạo schema:

```bash
psql -h localhost -U air_quality_user -d air_quality -f database/schema.sql
```

Build và chạy backend ở chế độ phát triển:

```bash
npm run build
npm run dev
```

Để chạy bản đã biên dịch thay cho chế độ phát triển:

```bash
npm run build
npm start
```

Mặc định backend lắng nghe tại cổng `3001` trên mọi giao diện mạng. ESP32 và máy chạy backend cần truy cập được nhau trong mạng LAN; cấu hình URL firmware bằng địa chỉ LAN của máy backend, không dùng `localhost`.

Express phục vụ dashboard từ thư mục `frontend/` ở thư mục gốc của dự án. Khi backend chạy, mở `http://localhost:3001/`. Endpoint `GET /api` trả thông tin API; `GET /health` kiểm tra kết nối database.

## Cấu hình và nạp firmware

Từ thư mục gốc dự án, tạo `hw/include/secrets.h` từ tệp mẫu:

```bash
cd hw
cp include/example.h include/secrets.h
```

Điền Wi-Fi và địa chỉ IPv4 LAN của máy chạy backend vào `include/secrets.h`:

```cpp
#pragma once

#define WIFI_SSID "ten_wifi"
#define WIFI_PASSWORD "mat_khau_wifi"
#define SERVER_URL "http://192.168.1.10:3001/api/readings"
```

Thay địa chỉ IP và cổng trong `SERVER_URL` theo máy chạy backend. Chỉnh cổng nạp trong `hw/platformio.ini` nếu thiết bị không dùng `/dev/ttyUSB0`.

Từ thư mục `hw`, chạy các lệnh PlatformIO:

```bash
pio run
pio run --target upload
pio device monitor
```

Serial monitor dùng tốc độ `115200`. MH-Z19B cần khoảng 3 phút làm nóng sau khi ESP32 khởi động. Khi Wi-Fi hoặc backend tạm thời không truy cập được, firmware giữ tối đa 30 mẫu trong hàng đợi RAM để thử gửi lại. Khi hàng đợi đầy, mẫu cũ nhất sẽ bị loại bỏ; hàng đợi sẽ mất nội dung khi ESP32 khởi động lại.

## API

Các endpoint chính:

| Phương thức | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/` | Dashboard |
| `GET` | `/api` | Thông tin API |
| `GET` | `/health` | Kiểm tra API và kết nối database |
| `POST` | `/api/readings` | Nhận và lưu một mẫu đo |
| `GET` | `/api/readings/latest` | Lấy mẫu mới nhất |
| `GET` | `/api/readings/history` | Lấy lịch sử đo |
| `GET` | `/api/readings/averages` | Lấy trung bình 8 giờ và 24 giờ |
| `GET` | `/api/alerts` | Lấy danh sách cảnh báo |

Lịch sử hỗ trợ `from`, `to` và `limit`; mặc định là 24 giờ gần nhất với tối đa 10.000 bản ghi, giới hạn cho phép tối đa 50.000. Trung bình hỗ trợ `?window=8` hoặc `?window=24`; bỏ `window` để lấy cả hai cửa sổ. Danh sách cảnh báo hỗ trợ `?status=active`, `?status=resolved` và `limit` (mặc định 100, tối đa 500).

Ví dụ payload gửi đến `POST /api/readings`:

```json
{
  "measured_at": "2026-11-02T07:00:10.000Z",
  "pm1_0": 10,
  "pm2_5": 18,
  "pm10": 25,
  "co2": 650,
  "temperature": 28.5,
  "humidity": 65,
  "pressure": 1008.5
}
```

`measured_at` là thời điểm đo theo ISO 8601 có múi giờ; nếu không có, backend dùng thời điểm nhận dữ liệu. Giá trị cảm biến có thể là `null` nếu cảm biến chưa sẵn sàng hoặc không có dữ liệu. Mỗi request cần có ít nhất một giá trị cảm biến khác `null`.

Kiểm tra nhanh khi backend đang chạy:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api
curl http://localhost:3001/api/readings/latest
curl http://localhost:3001/api/readings/history
curl http://localhost:3001/api/readings/averages
curl http://localhost:3001/api/alerts
```

Để thử gửi một mẫu giả lập (lệnh này sẽ thêm một bản ghi vào database):

```bash
curl -X POST http://localhost:3001/api/readings \
  -H 'Content-Type: application/json' \
  -d '{"measured_at":"2026-11-03T10:00:00Z","pm1_0":10,"pm2_5":18,"pm10":25,"co2":650,"temperature":28.5,"humidity":65,"pressure":1008.5}'
```

POST thành công trả HTTP `201`. Sau đó gọi lại `/api/readings/latest` để xác nhận dữ liệu đã được lưu. Có thể bỏ `measured_at`; khi đó backend dùng thời điểm nhận mẫu. Mỗi request cần có ít nhất một giá trị cảm biến khác `null`.

## Trung bình và cảnh báo

Backend tính trung bình trượt cho PM2.5, PM10 và CO2 trong hai cửa sổ 8 giờ và 24 giờ. Chỉ cửa sổ có dữ liệu bao phủ đủ khoảng thời gian mới được so sánh với ngưỡng. Cảnh báo được tạo hoặc cập nhật khi trung bình vượt ngưỡng; khi trung bình không còn vượt ngưỡng, cảnh báo chuyển sang trạng thái `resolved`.

| Thông số | Ngưỡng cảnh báo |
|---|---:|
| PM2.5 | Trên 50 µg/m³ |
| PM10 | Trên 100 µg/m³ |
| CO2 | Trên 1.000 ppm |

Áp suất được lưu làm dữ liệu tham khảo, không dùng để đánh giá cảnh báo. Các giới hạn kiểm tra dữ liệu đầu vào nhằm loại giá trị cảm biến không hợp lệ, không phải là ngưỡng cảnh báo.

## Môi trường backend

Các biến cấu hình được khai báo trong `backend/.env.example`:

| Biến | Mặc định | Mô tả |
|---|---|---|
| `PORT` | `3001` | Cổng HTTP của backend |
| `DB_HOST` | `localhost` | Máy chủ PostgreSQL |
| `DB_PORT` | `5432` | Cổng PostgreSQL |
| `DB_NAME` | `air_quality` | Tên database |
| `DB_USER` | Không đặt | Tài khoản database |
| `DB_PASSWORD` | Không đặt | Mật khẩu database |
| `CORS_ORIGIN` | `*` | Origin được phép gọi API |
