#include <Wire.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_Sensor.h>

// ================== CẢM BIẾN I2C ==================
Adafruit_AHTX0 aht;
Adafruit_BMP280 bmp;

bool ahtOK = false;
bool bmpOK = false;

// ================== PMS7003 (UART2) ==================
HardwareSerial PMSSerial(2);
#define PMS_RX 16
#define PMS_TX 17

struct PMSData {
  uint16_t pm1_0;
  uint16_t pm2_5;
  uint16_t pm10;
  bool valid = false;
};
PMSData pms;

// ================== MH-Z19B (UART1) ==================
HardwareSerial MHZSerial(1);
#define MHZ_RX 18
#define MHZ_TX 19

int co2 = 0;
bool mhzOK = false;

// ================== THỜI GIAN ==================
unsigned long lastRead = 0;
const unsigned long INTERVAL = 10000;   // 10 giây

// ================== HÀM ĐỌC PMS7003 ==================
bool readPMS7003() {
  static uint8_t buffer[32];
  static uint8_t index = 0;

  while (PMSSerial.available()) {
    uint8_t c = PMSSerial.read();

    if (index == 0 && c != 0x42) continue;
    if (index == 1 && c != 0x4D) {
      index = 0;
      continue;
    }

    buffer[index++] = c;

    if (index >= 32) {
      index = 0;

      uint16_t sum = 0;
      for (int i = 0; i < 30; i++) sum += buffer[i];
      uint16_t checksum = (buffer[30] << 8) | buffer[31];

      if (sum == checksum) {
        pms.pm1_0 = (buffer[10] << 8) | buffer[11];
        pms.pm2_5 = (buffer[12] << 8) | buffer[13];
        pms.pm10  = (buffer[14] << 8) | buffer[15];
        pms.valid = true;
        return true;
      }
    }
  }
  return false;
}

// ================== HÀM ĐỌC MH-Z19B ==================
int readMHZ19B() {
  byte cmd[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};
  MHZSerial.write(cmd, 9);
  delay(50);

  byte response[9];
  int i = 0;
  unsigned long start = millis();

  while (i < 9 && millis() - start < 300) {
    if (MHZSerial.available()) {
      response[i++] = MHZSerial.read();
    }
  }

  if (i == 9 && response[0] == 0xFF && response[1] == 0x86) {
    int ppm = (response[2] << 8) | response[3];
    mhzOK = true;
    return ppm;
  }

  mhzOK = false;
  return -1;
}

// ================== SETUP ==================
void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("===== ESP32 Air Quality Monitor =====");

  // I2C
  Wire.begin(21, 22);
  Wire.setClock(100000);          // Giảm tốc độ I2C xuống 100kHz
  delay(500);

  Serial.println("I2C: SDA=21, SCL=22");

  // Quét I2C
  Serial.println("Scanning I2C bus...");
  int count = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  Found device at 0x%02X\n", addr);
      count++;
    }
  }
  if (count == 0) Serial.println("  No I2C device found!");

  // Khởi tạo AHT20
  delay(100);
  ahtOK = aht.begin();
  delay(100);
  Serial.println(ahtOK ? "AHT20  : OK" : "AHT20  : LOI");

  // Khởi tạo BMP280
  delay(100);
  bmpOK = bmp.begin(0x77);
  if (!bmpOK) {
    bmpOK = bmp.begin(0x76);
  }
  delay(100);
  Serial.println(bmpOK ? "BMP280 : OK" : "BMP280 : LOI");

  if (bmpOK) {
    bmp.setSampling(
      Adafruit_BMP280::MODE_NORMAL,
      Adafruit_BMP280::SAMPLING_X2,
      Adafruit_BMP280::SAMPLING_X16,
      Adafruit_BMP280::FILTER_X16,
      Adafruit_BMP280::STANDBY_MS_500
    );
  }

  // PMS7003
  PMSSerial.begin(9600, SERIAL_8N1, PMS_RX, PMS_TX);
  Serial.println("PMS7003: RX=16, TX=17");

  // MH-Z19B
  MHZSerial.begin(9600, SERIAL_8N1, MHZ_RX, MHZ_TX);
  Serial.println("MH-Z19B: RX=18, TX=19");

  Serial.println("=====================================");
  Serial.println("Bat dau do trong 10 giay...");
}

// ================== LOOP ==================
void loop() {
  // Đọc PMS liên tục
  readPMS7003();

  if (millis() - lastRead >= INTERVAL) {
    lastRead = millis();

    Serial.println("\n=================================");
    Serial.println("        DU LIEU CAM BIEN");
    Serial.println("=================================");

    // AHT20
    if (ahtOK) {
      sensors_event_t humidity, temp;
      aht.getEvent(&humidity, &temp);
      Serial.printf("AHT20   | Nhiet do : %.2f °C\n", temp.temperature);
      Serial.printf("        | Do am    : %.2f %%\n", humidity.relative_humidity);
    } else {
      Serial.println("AHT20   | Khong ket noi");
    }

    // BMP280
    if (bmpOK) {
      Serial.printf("BMP280  | Nhiet do : %.2f °C\n", bmp.readTemperature());
      Serial.printf("        | Ap suat  : %.2f hPa\n", bmp.readPressure() / 100.0F);
      Serial.printf("        | Do cao   : %.1f m\n", bmp.readAltitude(1013.25));
    } else {
      Serial.println("BMP280  | Khong ket noi");
    }

    // PMS7003
    if (pms.valid) {
      Serial.printf("PMS7003 | PM1.0 : %d ug/m3\n", pms.pm1_0);
      Serial.printf("        | PM2.5 : %d ug/m3\n", pms.pm2_5);
      Serial.printf("        | PM10  : %d ug/m3\n", pms.pm10);
    } else {
      Serial.println("PMS7003 | Dang cho du lieu...");
    }

    // MH-Z19B
    co2 = readMHZ19B();
    if (mhzOK && co2 > 0) {
      Serial.printf("MH-Z19B | CO2   : %d ppm\n", co2);
    } else {
      Serial.println("MH-Z19B | Loi doc du lieu");
    }

    Serial.println("=================================");
  }
}