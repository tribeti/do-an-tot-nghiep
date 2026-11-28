# Hệ thống giám sát chất lượng không khí trong phòng

ESP32 đọc ba cảm biến (PMS7003, MH-Z19B, DHT22), mỗi 10 giây gửi một mẫu JSON qua HTTP đến backend, lưu vào PostgreSQL. Dashboard hiển thị số đo, trung bình 8/24 giờ theo TCVN 13521:2022 và cảnh báo. Khi vượt ngưỡng, thiết bị tự bật quạt (relay), gõ còi và nâng cờ servo cho đến khi các chỉ số trở lại trong ngưỡng.

## Kiến trúc

```text
1. Cảm biến: PMS7003 (UART2), MH-Z19B (UART1), DHT22 (GPIO4)
        |
        v
2. ESP32 firmware: đọc cảm biến, đóng gói JSON mỗi 10 giây (giờ lấy từ NTP),
   điều khiển quạt/servo/còi (GPIO21/22/23) khi vượt ngưỡng tại thiết bị
        |
        |  POST /api/readings -- khi mất mạng: giữ tối đa 30 mẫu trong RAM để gửi lại
        v
3. Backend Express + zod: kiểm tra dữ liệu, lưu PostgreSQL (sensor_readings, alerts),
   đánh giá cảnh báo tức thời, phục vụ dashboard tĩnh cùng host cổng 3001
        |
        v
4. Trình duyệt: dashboard gauge + trung bình 8/24 giờ + biểu đồ + cảnh báo
   (làm mới số đo mỗi 10 giây, lịch sử mỗi 60 giây)
```

## Thành phần

| Thư mục                       | Công nghệ                                     | Vai trò                                                             |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `hw/`                         | PlatformIO + Arduino (C++)                    | Đọc cảm biến, điều khiển quạt/còi/servo, gửi mẫu lên API            |
| `backend/`                    | Node.js, TypeScript, Express, PostgreSQL, zod | REST API, lưu trữ, trung bình 8/24 giờ, cảnh báo, phục vụ dashboard |
| `frontend/`                   | HTML/CSS/JS thuần                             | Dashboard: gauge SVG, biểu đồ canvas, bảng, cảnh báo                |
| `backend/database/schema.sql` | SQL                                           | Cấu trúc 2 bảng và chỉ mục                                          |

## Thiết bị

### Cảm biến

| Cảm biến | Dữ liệu            | Kết nối                                       |
| -------- | ------------------ | --------------------------------------------- |
| PMS7003  | PM1.0, PM2.5, PM10 | UART2: RX GPIO16, TX GPIO17                   |
| MH-Z19B  | CO2                | UART1: RX GPIO18, TX GPIO19                   |
| DHT22    | Nhiệt độ, độ ẩm    | DATA GPIO4 (cần điện trở kéo lên theo module) |

> Kiểm tra điện áp và sơ đồ chân từng module trước khi đấu nối. Chân DHT22 đổi được tại `DHT_DATA_PIN` trong `hw/src/main.cpp`. MH-Z19B cần khoảng 3 phút làm nóng sau khi ESP32 khởi động. Firmware ghi log số đo và trạng thái ra Serial Monitor (115200).

### Cơ cấu chấp hành

| Cơ cấu              | Chân   | Hành vi                                                                       |
| ------------------- | ------ | ----------------------------------------------------------------------------- |
| Quạt qua relay      | GPIO21 | Bật khi ô nhiễm, tắt khi hết; chạy thử 2 giây khi khởi động để kiểm tra relay |
| Servo (cờ cảnh báo) | GPIO22 | 0 độ khi bình thường, 90 độ khi cảnh báo                                      |
| Buzzer              | GPIO23 | Bíp 2000 Hz trong 150 ms, lặp mỗi 3 giây khi cảnh báo                         |

> [!NOTE]
> Quạt và cảnh báo luôn bật/tắt cùng nhau. Ngưỡng tại thiết bị: PM2.5 từ 25, PM10 từ 100 (µg/m³) hoặc CO2 từ 1.000 ppm trở lên; chỉ tính cảm biến còn dữ liệu mới trong 30 giây. Mất mạng/backend: giữ tối đa 30 mẫu (~5 phút) để gửi lại, hàng đợi đầy thì bỏ mẫu cũ nhất, mất hàng đợi khi khởi động lại.

## Yêu cầu

Node.js + npm, PostgreSQL, PlatformIO (Core hoặc tiện ích VS Code), `curl` (tùy chọn), ESP32 tương thích board `esp32dev`.

## Chạy backend

<details>
<summary><b>Cài đặt lần đầu</b></summary>

```bash
cd backend
npm install
cp .env.example .env
```

Tạo database và tài khoản nếu chưa có:

```sql
CREATE USER air_quality_user WITH PASSWORD 'your_strong_password';
CREATE DATABASE air_quality OWNER air_quality_user;
```

Khởi tạo schema:

```bash
psql -h localhost -U air_quality_user -d air_quality -f database/schema.sql
```

</details>

```bash
npm run dev                    # chế độ phát triển, không cần build
npm run build && npm start     # bản đã biên dịch
```

> [!IMPORTANT]  
> Mặc định lắng nghe cổng `3001` trên mọi giao diện mạng. ESP32 và máy backend phải truy cập được nhau trong LAN; URL firmware dùng địa chỉ LAN của máy backend, không dùng `localhost`.
> Express phục vụ dashboard từ thư mục `frontend/`: mở `http://localhost:3001/`.

## Nạp firmware

<details>
<summary><b>Thiết lập secrets.h</b></summary>

```bash
cd hw
cp include/example.h include/secrets.h
```

```cpp
#pragma once

#define WIFI_SSID "ten_wifi"
#define WIFI_PASSWORD "mat_khau_wifi"
#define SERVER_URL "http://192.168.1.10:3001/api/readings"
```

Thay IP và cổng trong `SERVER_URL` theo máy chạy backend. Đổi cổng nạp trong `hw/platformio.ini` nếu thiết bị không dùng `/dev/ttyUSB0`.

</details>

```bash
pio run --target upload
pio device monitor    # 115200 baud
```

## API

| Phương thức | Endpoint                 | Mô tả                                                                          |
| ----------- | ------------------------ | ------------------------------------------------------------------------------ |
| `GET`       | `/`                      | Dashboard                                                                      |
| `GET`       | `/api`                   | Thông tin API                                                                  |
| `GET`       | `/health`                | Kiểm tra API và kết nối database                                               |
| `POST`      | `/api/readings`          | Nhận và lưu một mẫu đo                                                         |
| `GET`       | `/api/readings/latest`   | Mẫu mới nhất                                                                   |
| `GET`       | `/api/readings/history`  | Lịch sử: `from`, `to`, `limit` (mặc định 24 giờ, tối đa 50.000)                |
| `GET`       | `/api/readings/averages` | Trung bình `?window=8` hoặc `24`; bỏ trống lấy cả hai                          |
| `GET`       | `/api/alerts`            | Cảnh báo: `?status=active` hoặc `resolved`, `limit` (mặc định 100, tối đa 500) |

Mẫu JSON gửi tới `POST /api/readings`:

```json
{
  "measured_at": "2026-11-02T07:00:10.000Z",
  "pm1_0": 10,
  "pm2_5": 18,
  "pm10": 25,
  "co2": 650,
  "temperature": 28.5,
  "humidity": 65
}
```

> `measured_at` do firmware lấy từ NTP (pool.ntp.org, time.google.com); thiếu thì backend dùng thời điểm nhận. Cả sáu trường cảm biến đều bắt buộc: thiếu hoặc `null` bị từ chối với HTTP `400`. Firmware vẫn gửi mẫu khi còn ít nhất một cảm biến hợp lệ và ghi `null` vào các trường còn lại; các mẫu này bị loại nên lịch sử có khoảng trống trong thời gian một cảm biến lỗi hoặc đang làm nóng.

<details>
<summary><b>Kiểm tra nhanh bằng curl</b></summary>

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api
curl http://localhost:3001/api/readings/latest
curl http://localhost:3001/api/readings/history
curl http://localhost:3001/api/readings/averages
curl http://localhost:3001/api/alerts
```

Gửi một mẫu thử (thêm bản ghi vào database, thành công trả HTTP `201`):

```bash
curl -X POST http://localhost:3001/api/readings \
  -H 'Content-Type: application/json' \
  -d '{"measured_at":"2026-11-03T10:00:00Z","pm1_0":10,"pm2_5":18,"pm10":25,"co2":650,"temperature":28.5,"humidity":65}'
```

</details>

## Ngưỡng

Cảnh báo là tức thời: mẫu đo mới nhất vượt ngưỡng là tạo/cập nhật cảnh báo trong bảng `alerts`; trở lại dưới ngưỡng là chuyển trạng thái `resolved`. Trung bình 8/24 giờ chỉ hiển thị tham khảo.

| Tầng                               |         PM2.5 |           PM10 |            CO2 |
| ---------------------------------- | ------------: | -------------: | -------------: |
| Cảnh báo backend (TCVN 13521:2022) | trên 50 µg/m³ | trên 100 µg/m³ | trên 1.000 ppm |
| Bật quạt/còi/servo tại thiết bị    |   từ 25 µg/m³ |   từ 100 µg/m³ |   từ 1.000 ppm |

> [!TIP]
> Thiết bị phản ứng sớm hơn ngưỡng cảnh báo: với PM2.5, quạt bật từ 25 trong khi cảnh báo chỉ ghi nhận từ 50. Giới hạn kiểm tra dữ liệu đầu vào nhằm loại giá trị cảm biến không hợp lệ, không phải là ngưỡng cảnh báo.

## Môi trường backend

Các biến cấu hình khai báo trong `backend/.env.example`:

| Biến                      | Mặc định             | Mô tả                    |
| ------------------------- | -------------------- | ------------------------ |
| `PORT`                    | `3001`               | Cổng HTTP của backend    |
| `DB_HOST` / `DB_PORT`     | `localhost` / `5432` | Máy chủ PostgreSQL       |
| `DB_NAME`                 | `air_quality`        | Tên database             |
| `DB_USER` / `DB_PASSWORD` | không đặt            | Tài khoản database       |
| `CORS_ORIGIN`             | `*`                  | Origin được phép gọi API |
