#pragma once

// Copy this file to secrets.h and enter your actual Wi-Fi credentials.
#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Use the LAN IPv4 address of the computer running the Backend.
// Do NOT use localhost or 127.0.0.1 here: those refer to the ESP32 itself.
#define SERVER_URL "http://192.168.1.100:3000/api/readings"