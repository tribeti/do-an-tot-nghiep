# Indoor Air Quality Backend

Backend cho đề tài giám sát chất lượng không khí trong phòng, sử dụng Node.js, TypeScript, Express và PostgreSQL.

Thiết kế giữ đúng phạm vi đề cương: **một thiết bị trong một phòng**. Database và API không có `device_id`.

## 1. Chức năng

- Nhận một mẫu dữ liệu cảm biến qua HTTP `POST` mỗi 10 giây.
- Kiểm tra phạm vi và kiểu dữ liệu đầu vào bằng Zod.
- Loại bỏ request không hợp lệ; chỉ lưu một mẫu khi toàn bộ mẫu hợp lệ.
- Lưu PM1.0, PM2.5, PM10, CO2, nhiệt độ, độ ẩm và áp suất bổ sung.
- Cung cấp API lấy dữ liệu mới nhất, lịch sử và trung bình 8 giờ/24 giờ.
- So sánh PM2.5, PM10 và CO2 với ngưỡng đề cương: 50 µg/m³, 100 µg/m³ và 1.000 ppm.
- Ghi nhận cảnh báo đang hoạt động; chuyển sang `resolved` khi giá trị trung bình không còn vượt ngưỡng.

## 2. Cài đặt

Yêu cầu: Node.js và PostgreSQL.

```bash
npm install
cp .env.example .env
```

Sửa `.env` theo tài khoản PostgreSQL thực tế.

Tạo user/database nếu chưa có:

```sql
CREATE USER air_quality_user WITH PASSWORD 'your_strong_password';
CREATE DATABASE air_quality OWNER air_quality_user;
```

Khởi tạo schema:

```bash
PGPASSWORD='your_strong_password' psql -h localhost -U air_quality_user -d air_quality -f database/schema.sql
```

Nếu đã tạo database theo schema cũ có `device_id` hoặc `bmp_temperature`, chạy migration:

```bash
PGPASSWORD='your_strong_password' psql -h localhost -U air_quality_user -d air_quality -f database/migrate-from-previous-schema.sql
```

## 3. Chạy ứng dụng

```bash
npm run build
npm run dev
```

Production:

```bash
npm start
```

Mặc định server dùng cổng `3000`, bind `0.0.0.0` để ESP32 trong cùng mạng LAN truy cập được.

Nếu gặp `EADDRINUSE`, cổng đang được tiến trình khác sử dụng:

```bash
sudo lsof -iTCP:3000 -sTCP:LISTEN -n -P
```

Dừng tiến trình cũ bằng `kill <PID>` hoặc đổi `PORT=3001` trong `.env`, sau đó dùng cùng cổng đó trong URL của ESP32.

## 4. Dữ liệu JSON từ ESP32

ESP32 đọc cảm biến mỗi **10 giây** và gửi **một JSON mỗi 10 giây** đến `POST /api/readings`.

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

- `measured_at`: thời điểm ESP32 đo, dạng ISO 8601 có múi giờ. Nếu không gửi, Backend sử dụng thời điểm máy chủ nhận.
- `temperature` và `humidity`: từ AHT20 trên phần cứng hiện tại.
- `pressure`: từ BMP280, đơn vị hPa; lưu để tham khảo, không dùng để cảnh báo.
- PMS7003: `pm1_0`, `pm2_5`, `pm10`.
- MH-Z19B: `co2`.

Mỗi request là một mẫu đo đơn. Backend không cần tự tạo lịch đọc cảm biến; chu kỳ 10 giây do firmware ESP32 điều khiển.

## 5. API

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/` | Thông tin API |
| GET | `/health` | Kiểm tra server và database |
| POST | `/api/readings` | Nhận một mẫu đo |
| GET | `/api/readings/latest` | Lấy mẫu đo mới nhất |
| GET | `/api/readings/history` | Lấy lịch sử; mặc định 24 giờ gần nhất |
| GET | `/api/readings/averages` | Lấy trung bình 8 giờ và 24 giờ |
| GET | `/api/readings/averages?window=24` | Chỉ lấy trung bình 24 giờ |
| GET | `/api/alerts` | Danh sách cảnh báo |
| GET | `/api/alerts?status=active` | Chỉ cảnh báo đang hoạt động |
| GET | `/api/alerts?status=resolved` | Chỉ cảnh báo đã kết thúc |

History hỗ trợ `from`, `to`, `limit`. Mặc định lấy 24 giờ gần nhất với `limit=10000`, đủ cho khoảng 8.640 mẫu ở chu kỳ 10 giây. `limit` nhận giá trị từ 1 đến 20.000.

## 6. Kiểm tra nhanh

```bash
curl http://localhost:3000/health
```

Gửi một mẫu:

```bash
curl -X POST http://localhost:3000/api/readings \
  -H 'Content-Type: application/json' \
  -d '{
    "pm1_0": 10,
    "pm2_5": 18,
    "pm10": 25,
    "co2": 650,
    "temperature": 28.5,
    "humidity": 65,
    "pressure": 1008.5
  }'
```

Truy vấn:

```bash
curl http://localhost:3000/api/readings/latest
curl http://localhost:3000/api/readings/history
curl http://localhost:3000/api/readings/averages
curl http://localhost:3000/api/alerts
```

## 7. Quy tắc trung bình và cảnh báo

- Backend tính trung bình trượt trên các bản ghi thuộc 8 giờ gần nhất và 24 giờ gần nhất.
- Chỉ so sánh khi cửa sổ dữ liệu đủ độ phủ thời gian; không dùng vài mẫu lúc vừa khởi động để đánh giá trọn cửa sổ 8/24 giờ.
- Ngưỡng: PM2.5 > 50 µg/m³; PM10 > 100 µg/m³; CO2 > 1.000 ppm.
- Nếu vượt ngưỡng, tạo/cập nhật cảnh báo `active`. Khi trung bình trở lại không vượt ngưỡng, cảnh báo chuyển sang `resolved`.
- Áp suất được lưu nhưng không dùng để đánh giá chất lượng không khí.

Các giới hạn trong validator là kiểm tra dữ liệu cảm biến, không phải ngưỡng TCVN.

## 8. Ghi chú

Phần cứng hiện tại của bạn dùng ESP32 + PMS7003 + MH-Z19B + AHT20 + BMP280. Đề cương ban đầu mô tả ESP8266 + PMS7003 + MH-Z19B + BME280; phần mô tả thiết bị trong báo cáo cần cập nhật cho khớp cấu hình thực tế.
