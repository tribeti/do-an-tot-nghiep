#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>
#include <string.h>
#include <math.h>

#include <DHT.h>

#include "secrets.h"

// ================== SENSOR OBJECTS ==================
static constexpr uint8_t DHT_DATA_PIN = 4;
DHT dht(DHT_DATA_PIN, DHT22);

// ================== PMS7003 (UART2) ==================
HardwareSerial PMSSerial(2);
static constexpr int PMS_RX = 16;
static constexpr int PMS_TX = 17;

struct PMSData {
    uint16_t pm1_0 = 0;
    uint16_t pm2_5 = 0;
    uint16_t pm10 = 0;
    bool valid = false;
};

PMSData pms;
unsigned long lastPmsUpdate = 0;
static constexpr unsigned long PMS_STALE_MS = 30000;

// ================== MH-Z19B (UART1) ==================
HardwareSerial MHZSerial(1);
static constexpr int MHZ_RX = 18;
static constexpr int MHZ_TX = 19;

static constexpr unsigned long MHZ_WARMUP_MS = 180000; // Datasheet preheat: about 3 minutes
unsigned long bootTime = 0;
bool mhzOK = false;
bool ntpConfigured = false;

// ================== SAMPLE / NETWORK ==================
static constexpr unsigned long SAMPLE_INTERVAL_MS = 10000; // One sample every 10 seconds
unsigned long lastSampleTime = 0;

// Small circular queue for temporary Wi-Fi/Backend outages (30 samples = 5 minutes).
static constexpr size_t QUEUE_CAPACITY = 30;
static constexpr size_t JSON_BUFFER_SIZE = 384;
char readingQueue[QUEUE_CAPACITY][JSON_BUFFER_SIZE];
size_t queueHead = 0;
size_t queueTail = 0;
size_t queueCount = 0;
unsigned long lastPostAttempt = 0;
unsigned long nextPostDelayMs = 500;
unsigned long lastWiFiReconnectAttempt = 0;
static constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 5000;
static constexpr unsigned long POST_RETRY_DELAY_MS = 2000;

// ================== PMS7003 FRAME READER ==================
// Read continuously from loop() so the latest complete frame is ready at sample time.
void readPMS7003() {
    static uint8_t buffer[32];
    static uint8_t index = 0;

    while (PMSSerial.available() > 0) {
        const uint8_t value = static_cast<uint8_t>(PMSSerial.read());

        if (index == 0) {
            if (value != 0x42) continue;
            buffer[index++] = value;
            continue;
        }

        if (index == 1) {
            if (value != 0x4D) {
                // If this byte could be the start of a new frame, keep it.
                index = (value == 0x42) ? 1 : 0;
                if (index == 1) buffer[0] = value;
                continue;
            }
            buffer[index++] = value;
            continue;
        }

        buffer[index++] = value;

        if (index == sizeof(buffer)) {
            index = 0;

            uint16_t sum = 0;
            for (int i = 0; i < 30; ++i) sum += buffer[i];

            const uint16_t receivedChecksum =
                (static_cast<uint16_t>(buffer[30]) << 8) | buffer[31];

            if (sum != receivedChecksum) continue;

            pms.pm1_0 = (static_cast<uint16_t>(buffer[10]) << 8) | buffer[11];
            pms.pm2_5 = (static_cast<uint16_t>(buffer[12]) << 8) | buffer[13];
            pms.pm10 = (static_cast<uint16_t>(buffer[14]) << 8) | buffer[15];
            pms.valid = true;
            lastPmsUpdate = millis();
            return;
        }
    }
}

// ================== MH-Z19B READER ==================
int readMHZ19B() {
    // Discard any stale bytes before issuing a new command.
    while (MHZSerial.available() > 0) {
        MHZSerial.read();
    }

    const uint8_t command[9] = {
        0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79
    };

    MHZSerial.write(command, sizeof(command));
    MHZSerial.flush();

    uint8_t response[9] = {};
    size_t received = 0;
    const unsigned long startedAt = millis();

    while (received < sizeof(response) && millis() - startedAt < 300) {
        if (MHZSerial.available() > 0) {
            response[received++] = static_cast<uint8_t>(MHZSerial.read());
        }
    }

    if (received != sizeof(response) || response[0] != 0xFF || response[1] != 0x86) {
        mhzOK = false;
        return -1;
    }

    uint8_t checksum = 0;
    for (int i = 1; i <= 7; ++i) checksum += response[i];
    checksum = static_cast<uint8_t>(0xFF - checksum + 1);

    if (checksum != response[8]) {
        mhzOK = false;
        return -1;
    }

    const int ppm = (static_cast<int>(response[2]) << 8) | response[3];
    if (ppm <= 0) {
        mhzOK = false;
        return -1;
    }

    mhzOK = true;
    return ppm;
}

// ================== TIME ==================
// Returns UTC ISO-8601. An empty string means NTP has not synchronized yet;
// Backend then uses its own receive time.
String getUtcTimestamp() {
    const time_t now = time(nullptr);
    if (now < 1700000000) return "";

    struct tm utcTime;
    gmtime_r(&now, &utcTime);

    char datePart[24];
    strftime(datePart, sizeof(datePart), "%Y-%m-%dT%H:%M:%S", &utcTime);

    timeval tv;
    gettimeofday(&tv, nullptr);

    char result[32];
    snprintf(result, sizeof(result), "%s.%03ldZ", datePart, tv.tv_usec / 1000);
    return String(result);
}

void configureNtp() {
    if (ntpConfigured) return;
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    ntpConfigured = true;
}

void startNtpTime() {
    configureNtp();

    Serial.print("NTP: synchronizing");
    const unsigned long startedAt = millis();
    while (time(nullptr) < 1700000000 && millis() - startedAt < 10000) {
        Serial.print('.');
        delay(250);
    }
    Serial.println(time(nullptr) >= 1700000000 ? " OK" : " unavailable (Backend time will be used)");
}

// ================== WI-FI ==================
void connectWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.print("Wi-Fi: connecting");
    const unsigned long startedAt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 15000) {
        Serial.print('.');
        delay(300);
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println(" connected");
        Serial.print("ESP32 IP: ");
        Serial.println(WiFi.localIP());
        startNtpTime();
    } else {
        Serial.println(" connection failed; will retry during operation");
    }
}

bool ensureWiFi() {
    if (WiFi.status() == WL_CONNECTED) {
        // If Wi-Fi comes back after boot, start NTP without blocking the sampling loop.
        configureNtp();
        return true;
    }

    const unsigned long now = millis();
    if (now - lastWiFiReconnectAttempt >= WIFI_RECONNECT_INTERVAL_MS) {
        Serial.println("Wi-Fi disconnected; attempting reconnect...");
        WiFi.reconnect();
        lastWiFiReconnectAttempt = now;
    }
    return false;
}

// ================== HTTP POST ==================
enum class PostResult { Success, Retry, Rejected };

PostResult postReading(const char* payload) {
    if (!ensureWiFi()) return PostResult::Retry;

    WiFiClient client;
    HTTPClient http;
    http.setConnectTimeout(3000);
    http.setTimeout(3000);

    if (!http.begin(client, SERVER_URL)) {
        Serial.println("HTTP: could not initialize connection");
        return PostResult::Retry;
    }

    http.addHeader("Content-Type", "application/json");
    const int statusCode = http.POST(String(payload));

    PostResult result = PostResult::Retry;
    if (statusCode >= 200 && statusCode < 300) {
        Serial.printf("HTTP POST: %d\n", statusCode);
        result = PostResult::Success;
    } else if (statusCode >= 400 && statusCode < 500) {
        Serial.printf("HTTP POST rejected: %d\n", statusCode);
        Serial.println(http.getString());
        // A 4xx response normally means the payload or endpoint is wrong.
        // Retrying the same invalid sample forever would block the queue.
        result = PostResult::Rejected;
    } else if (statusCode > 0) {
        Serial.printf("HTTP server error: %d\n", statusCode);
        Serial.println(http.getString());
    } else {
        Serial.printf("HTTP POST failed: %s\n", http.errorToString(statusCode).c_str());
    }

    http.end();
    return result;
}

void enqueueReading(const char* payload) {
    const size_t length = strlen(payload);
    if (length == 0 || length >= JSON_BUFFER_SIZE) {
        Serial.println("Queue: JSON payload is empty or too large");
        return;
    }

    if (queueCount == QUEUE_CAPACITY) {
        // Keep the newest five minutes of samples if the queue becomes full.
        queueHead = (queueHead + 1) % QUEUE_CAPACITY;
        --queueCount;
        Serial.println("Queue full: oldest queued sample was discarded");
    }

    memcpy(readingQueue[queueTail], payload, length + 1);
    queueTail = (queueTail + 1) % QUEUE_CAPACITY;
    ++queueCount;
    Serial.printf("Queue: %u sample(s) waiting\n", static_cast<unsigned>(queueCount));
}

void flushQueuedReading() {
    if (queueCount == 0) return;

    const unsigned long now = millis();
    if (now - lastPostAttempt < nextPostDelayMs) return;

    if (!ensureWiFi()) return;

    lastPostAttempt = now;
    const PostResult result = postReading(readingQueue[queueHead]);
    if (result == PostResult::Success) {
        queueHead = (queueHead + 1) % QUEUE_CAPACITY;
        --queueCount;
        nextPostDelayMs = 500;
        Serial.printf("Backend: sample accepted; %u remaining\n", static_cast<unsigned>(queueCount));
    } else if (result == PostResult::Rejected) {
        queueHead = (queueHead + 1) % QUEUE_CAPACITY;
        --queueCount;
        nextPostDelayMs = 500;
        Serial.printf("Backend: invalid/rejected sample discarded; %u remaining\n", static_cast<unsigned>(queueCount));
    } else {
        nextPostDelayMs = POST_RETRY_DELAY_MS;
        Serial.println("Backend: send failed; sample kept in circular queue for retry");
    }
}

// ================== COLLECT + SEND ONE SAMPLE ==================
void collectAndSendReading() {
    const float temperature = dht.readTemperature();
    const float humidity = dht.readHumidity();

    const bool dhtFresh = isfinite(temperature) && temperature >= -40.0F &&
                          temperature <= 80.0F && isfinite(humidity) &&
                          humidity >= 0.0F && humidity <= 100.0F;

    int co2 = -1;
    if (millis() - bootTime >= MHZ_WARMUP_MS) {
        co2 = readMHZ19B();
    } else {
        mhzOK = false;
        Serial.println("MH-Z19B: warming up (about 3 minutes)");
    }

    const bool pmsFresh = pms.valid && (millis() - lastPmsUpdate <= PMS_STALE_MS);

    StaticJsonDocument<384> document;
    const String timestamp = getUtcTimestamp();
    if (timestamp.length() > 0) {
        document["measured_at"] = timestamp;
    }

    if (pmsFresh) {
        document["pm1_0"] = pms.pm1_0;
        document["pm2_5"] = pms.pm2_5;
        document["pm10"] = pms.pm10;
    } else {
        document["pm1_0"] = nullptr;
        document["pm2_5"] = nullptr;
        document["pm10"] = nullptr;
    }

    if (co2 > 0 && mhzOK) document["co2"] = co2;
    else document["co2"] = nullptr;

    if (dhtFresh) {
        document["temperature"] = temperature;
        document["humidity"] = humidity;
    } else {
        document["temperature"] = nullptr;
        document["humidity"] = nullptr;
    }

    const bool hasSensorData = pmsFresh || (co2 > 0 && mhzOK) || dhtFresh;
    if (!hasSensorData) {
        Serial.println("JSON: no valid sensor measurements; sample not queued");
    }

    char payload[JSON_BUFFER_SIZE];
    if (hasSensorData) {
        const size_t payloadLength = serializeJson(document, payload, sizeof(payload));
        if (payloadLength == 0 || payloadLength >= sizeof(payload)) {
            Serial.println("JSON: serialization failed or payload buffer too small");
            return;
        }
    }

    Serial.println("\n========== SENSOR READING ==========");
    if (pmsFresh) {
        Serial.printf("PMS7003 | PM1.0: %u, PM2.5: %u, PM10: %u ug/m3\n",
                      pms.pm1_0, pms.pm2_5, pms.pm10);
    } else {
        Serial.println("PMS7003 | No recent valid frame");
    }

    if (co2 > 0 && mhzOK) Serial.printf("MH-Z19B | CO2: %d ppm\n", co2);
    else Serial.println("MH-Z19B | Unavailable / warming up");

    if (dhtFresh) Serial.printf("DHT22   | Temperature: %.2f C, Humidity: %.2f %%\n", temperature, humidity);
    else Serial.println("DHT22   | No valid measurement; check sensor and GPIO4 wiring");

    if (hasSensorData) {
        Serial.print("JSON: ");
        Serial.println(payload);
        enqueueReading(payload);
    }
    Serial.println("====================================\n");
}

// ================== SETUP ==================
void setup() {
    Serial.begin(115200);
    delay(1000);
    bootTime = millis();

    Serial.println();
    Serial.println("===== ESP32 Air Quality Monitor =====");
    Serial.println("Sampling interval: 10 seconds");

    dht.begin();
    Serial.printf("DHT22  : initialized on GPIO%u (data read at each sample)\n",
                  static_cast<unsigned>(DHT_DATA_PIN));

    // UART sensors
    PMSSerial.begin(9600, SERIAL_8N1, PMS_RX, PMS_TX);
    MHZSerial.begin(9600, SERIAL_8N1, MHZ_RX, MHZ_TX);
    Serial.println("PMS7003: RX=16, TX=17");
    Serial.println("MH-Z19B: RX=18, TX=19");

    connectWiFi();

    lastSampleTime = millis();
    Serial.println("=====================================");
}

// ================== LOOP ==================
void loop() {
    // Keep the PMS UART buffer drained between 10-second samples.
    readPMS7003();

    const unsigned long now = millis();
    if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
        lastSampleTime = now;
        collectAndSendReading();
    }

    flushQueuedReading();
    delay(2);
}
