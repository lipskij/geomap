#if !defined(ARDUINO_ARCH_ESP32)
  #error "This program requires an ESP32S3"
#endif

#include <Arduino.h>
#include <HardwareSerial.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_event.h>
#include <nvs_flash.h>
#include "opendroneid.h"
#include "odid_wifi.h"
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#include <ESP_I2S.h>
#include <mbedtls/base64.h>

const int SERIAL1_RX_PIN = 6;
const int SERIAL1_TX_PIN = 5;

// Up to 4 INMP441s on two I2S buses, two mics per bus sharing SCK/WS/SD:
//   bus 0: SCK D0, WS D1, SD D8  -> mic 1 (L/R to GND), mic 2 (L/R to 3.3V)
//   bus 1: SCK D2, WS D3, SD D9  -> mic 3 (L/R to GND), mic 4 (L/R to 3.3V)
// Missing mics are fine: their slot reads flat and is left out of the mix.
const int MIC_BUSES = 2;
const int MIC_SCK_PINS[MIC_BUSES] = {1, 3};
const int MIC_WS_PINS[MIC_BUSES] = {2, 4};
const int MIC_SD_PINS[MIC_BUSES] = {7, 8};
const int MICS = 2 * MIC_BUSES;
// 16 kHz like batear: the INMP441's own decimation filter then cuts everything above 8 kHz.
// At 48 kHz our 3-sample average let 8-24 kHz whine alias into the drone band.
const int MIC_I2S_RATE = 16000;
const int MIC_RATE = 16000;  // sent to the Pi; must match server/rid_server.py
const int MIC_DECIMATE = MIC_I2S_RATE / MIC_RATE;
const int MIC_FRAME = MIC_RATE / 2;  // samples per line = 0.5 s
const int MIC_CHUNK = 256;  // output samples per I2S read
// A mic is mixed in while its last frame's RMS (16-bit units, DC removed) is in this range:
// below is an empty slot, above is the full-scale noise of a miswired one (two mics on one slot)
const float MIC_LIVE_MIN = 4, MIC_LIVE_MAX = 12000;
I2SClass i2s[MIC_BUSES];
static bool micBusOk[MIC_BUSES];
static SemaphoreHandle_t serialLock;  // mic and Remote ID lines come from different tasks

struct id_data {
  uint8_t  mac[6];
  int      rssi;
  uint32_t last_seen;
  char     op_id[ODID_ID_SIZE + 1];
  char     uav_id[ODID_ID_SIZE + 1];
  double   lat_d;
  double   long_d;
  double   base_lat_d;
  double   base_long_d;
  int      altitude_msl;
  int      height_agl;
  int      speed;
  int      heading;
  int      flag;
};

void callback(void *, wifi_promiscuous_pkt_type_t);
void send_json_fast(const id_data *UAV);
void print_compact_message(const id_data *UAV);

#define MAX_UAVS 8
id_data uavs[MAX_UAVS] = {0};
BLEScan* pBLEScan = nullptr;
ODID_UAS_Data UAS_data;
unsigned long last_status = 0;

static QueueHandle_t printQueue;

id_data* next_uav(uint8_t* mac) {
  for (int i = 0; i < MAX_UAVS; i++) {
    if (memcmp(uavs[i].mac, mac, 6) == 0)
      return &uavs[i];
  }
  for (int i = 0; i < MAX_UAVS; i++) {
    if (uavs[i].mac[0] == 0)
      return &uavs[i];
  }
  return &uavs[0];
}

class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
public:
  void onResult(BLEAdvertisedDevice device) override {
    int len = device.getPayloadLength();
    if (len <= 0) return;
      
    uint8_t* payload = device.getPayload();
    if (len > 5 && payload[1] == 0x16 && payload[2] == 0xFA && 
        payload[3] == 0xFF && payload[4] == 0x0D) {
      uint8_t* mac = (uint8_t*) device.getAddress().getNative();
      id_data* UAV = next_uav(mac);
      UAV->last_seen = millis();
      UAV->rssi = device.getRSSI();
      memcpy(UAV->mac, mac, 6);
      
      uint8_t* odid = &payload[6];
      switch (odid[0] & 0xF0) {
        case 0x00: {
          ODID_BasicID_data basic;
          decodeBasicIDMessage(&basic, (ODID_BasicID_encoded*) odid);
          strncpy(UAV->uav_id, (char*) basic.UASID, ODID_ID_SIZE);
          break;
        }
        case 0x10: {
          ODID_Location_data loc;
          decodeLocationMessage(&loc, (ODID_Location_encoded*) odid);
          UAV->lat_d = loc.Latitude;
          UAV->long_d = loc.Longitude;
          UAV->altitude_msl = (int) loc.AltitudeGeo;
          UAV->height_agl = (int) loc.Height;
          UAV->speed = (int) loc.SpeedHorizontal;
          UAV->heading = (int) loc.Direction;
          break;
        }
        case 0x40: {
          ODID_System_data sys;
          decodeSystemMessage(&sys, (ODID_System_encoded*) odid);
          UAV->base_lat_d = sys.OperatorLatitude;
          UAV->base_long_d = sys.OperatorLongitude;
          break;
        }
        case 0x50: {
          ODID_OperatorID_data op;
          decodeOperatorIDMessage(&op, (ODID_OperatorID_encoded*) odid);
          strncpy(UAV->op_id, (char*) op.OperatorId, ODID_ID_SIZE);
          break;
        }
      }
      UAV->flag = 1;
      {
        id_data tmp = *UAV;
        BaseType_t xHigherPriorityTaskWoken = pdFALSE;
        xQueueSendFromISR(printQueue, &tmp, &xHigherPriorityTaskWoken);
        if (xHigherPriorityTaskWoken) portYIELD_FROM_ISR();
      }
    }
  }
};

void send_json_fast(const id_data *UAV) {
  char mac_str[18];
  snprintf(mac_str, sizeof(mac_str), "%02x:%02x:%02x:%02x:%02x:%02x",
           UAV->mac[0], UAV->mac[1], UAV->mac[2],
           UAV->mac[3], UAV->mac[4], UAV->mac[5]);
  char json_msg[256];
  snprintf(json_msg, sizeof(json_msg),
    "{\"mac\":\"%s\",\"rssi\":%d,\"drone_lat\":%.6f,\"drone_long\":%.6f,\"drone_altitude\":%d,\"pilot_lat\":%.6f,\"pilot_long\":%.6f,\"basic_id\":\"%s\"}",
    mac_str, UAV->rssi, UAV->lat_d, UAV->long_d, UAV->altitude_msl,
    UAV->base_lat_d, UAV->base_long_d, UAV->uav_id);
  xSemaphoreTake(serialLock, portMAX_DELAY);
  Serial.println(json_msg);
  xSemaphoreGive(serialLock);
}

// Streams the mics to the Pi as {"mic":"<base64 16-bit LE PCM, 16 kHz>","lvl":[rms x4]} lines,
// one per 0.5 s. "mic" is the average of the live mics; "lvl" is each mic's RMS, for wiring checks.
// Each bus is read as stereo: S3 mono RX can return all zeros (batear).
// ponytail: averaging MIC_DECIMATE samples is a weak anti-alias filter; enough for a <8 kHz drone check
// ponytail: liveness lags one frame, so a mic joins or leaves the mix 0.5 s late
void micTask(void *param) {
  static int32_t raw[MIC_BUSES][2 * MIC_DECIMATE * MIC_CHUNK];  // L,R pairs per bus
  static int16_t pcm[MIC_FRAME];
  static unsigned char line[64 + 4 * ((sizeof(pcm) + 2) / 3)];
  bool live[MICS] = {};
  for (;;) {
    float sum[MICS] = {}, sumSq[MICS] = {};
    for (int out = 0; out < MIC_FRAME;) {
      int n = min(MIC_CHUNK, MIC_FRAME - out);
      size_t want = 2 * MIC_DECIMATE * n * sizeof(int32_t);
      for (int b = 0; b < MIC_BUSES; b++) {
        if (!micBusOk[b]) continue;
        for (size_t got = 0; got < want;) {
          size_t r = i2s[b].readBytes((char *)raw[b] + got, want - got);
          if (r == 0) delay(10);  // driver error: don't spin
          got += r;
        }
      }
      int nLive = 0;
      for (int m = 0; m < MICS; m++) nLive += live[m];
      for (int i = 0; i < n; i++) {
        int32_t mix = 0;
        for (int m = 0; m < MICS; m++) {
          if (!micBusOk[m / 2]) continue;
          int32_t s = 0;  // 24-bit sample in the top of each 32-bit slot
          for (int k = 0; k < MIC_DECIMATE; k++) s += raw[m / 2][2 * (MIC_DECIMATE * i + k) + m % 2] >> 16;
          s /= MIC_DECIMATE;
          sum[m] += s;
          sumSq[m] += (float)s * s;
          if (live[m]) mix += s;
        }
        pcm[out++] = nLive ? mix / nLive : 0;
      }
    }
    int lvl[MICS];
    for (int m = 0; m < MICS; m++) {
      float mean = sum[m] / MIC_FRAME;
      lvl[m] = sqrtf(max(0.0f, sumSq[m] / MIC_FRAME - mean * mean));
      live[m] = lvl[m] >= MIC_LIVE_MIN && lvl[m] <= MIC_LIVE_MAX;
    }
    size_t n = 0;
    memcpy(line, "{\"mic\":\"", 8);
    mbedtls_base64_encode(line + 8, sizeof(line) - 8, &n, (unsigned char *)pcm, sizeof(pcm));
    n += 8;
    n += snprintf((char *)line + n, sizeof(line) - n, "\",\"lvl\":[%d,%d,%d,%d]}\n", lvl[0], lvl[1], lvl[2], lvl[3]);
    xSemaphoreTake(serialLock, portMAX_DELAY);
    Serial.write(line, n);
    xSemaphoreGive(serialLock);
  }
}

void print_compact_message(const id_data *UAV) {
  static unsigned long lastSendTime = 0;
  const unsigned long sendInterval = 5000;
  const int MAX_MESH_SIZE = 230;
  
  if (millis() - lastSendTime < sendInterval) return;
  lastSendTime = millis();
  
  char mac_str[18];
  snprintf(mac_str, sizeof(mac_str), "%02x:%02x:%02x:%02x:%02x:%02x",
           UAV->mac[0], UAV->mac[1], UAV->mac[2],
           UAV->mac[3], UAV->mac[4], UAV->mac[5]);
  
  char mesh_msg[MAX_MESH_SIZE];
  int msg_len = 0;
  msg_len += snprintf(mesh_msg + msg_len, sizeof(mesh_msg) - msg_len,
                      "Drone: %s RSSI:%d", mac_str, UAV->rssi);
  if (msg_len < MAX_MESH_SIZE && UAV->lat_d != 0.0 && UAV->long_d != 0.0) {
    msg_len += snprintf(mesh_msg + msg_len, sizeof(mesh_msg) - msg_len,
                        " https://maps.google.com/?q=%.6f,%.6f",
                        UAV->lat_d, UAV->long_d, UAV->uav_id);
  }
  if (Serial1.availableForWrite() >= msg_len) {
    Serial1.println(mesh_msg);
  }
  
  delay(1000);
  if (UAV->base_lat_d != 0.0 && UAV->base_long_d != 0.0) {
    char pilot_msg[MAX_MESH_SIZE];
    int pilot_len = snprintf(pilot_msg, sizeof(pilot_msg),
                             "Pilot: https://maps.google.com/?q=%.6f,%.6f",
                             UAV->base_lat_d, UAV->base_long_d);
    if (Serial1.availableForWrite() >= pilot_len) {
      Serial1.println(pilot_msg);
    }
  }
}

void bleScanTask(void *parameter) {
  for (;;) {
    BLEScanResults* foundDevices = pBLEScan->start(1, false);
    pBLEScan->clearResults();
    for (int i = 0; i < MAX_UAVS; i++) {
      if (uavs[i].flag) {
        // Removed send_json_fast and print_compact_message calls here
        uavs[i].flag = 0;
      }
    }
    delay(100);
  }
}

void wifiProcessTask(void *parameter) {
  for (;;) {
    // No-op: callback sets uavs[].flag and data, so nothing needed here
    delay(10);
  }
}

void callback(void *buffer, wifi_promiscuous_pkt_type_t type) {
  if (type != WIFI_PKT_MGMT) return;
  
  wifi_promiscuous_pkt_t *packet = (wifi_promiscuous_pkt_t *)buffer;
  uint8_t *payload = packet->payload;
  int length = packet->rx_ctrl.sig_len;
  
  static const uint8_t nan_dest[6] = {0x51, 0x6f, 0x9a, 0x01, 0x00, 0x00};
  if (memcmp(nan_dest, &payload[4], 6) == 0) {
    if (odid_wifi_receive_message_pack_nan_action_frame(&UAS_data, nullptr, payload, length) == 0) {
      id_data UAV;
      memset(&UAV, 0, sizeof(UAV));
      memcpy(UAV.mac, &payload[10], 6);
      UAV.rssi = packet->rx_ctrl.rssi;
      UAV.last_seen = millis();
      
      if (UAS_data.BasicIDValid[0]) {
        strncpy(UAV.uav_id, (char *)UAS_data.BasicID[0].UASID, ODID_ID_SIZE);
      }
      if (UAS_data.LocationValid) {
        UAV.lat_d = UAS_data.Location.Latitude;
        UAV.long_d = UAS_data.Location.Longitude;
        UAV.altitude_msl = (int)UAS_data.Location.AltitudeGeo;
        UAV.height_agl = (int)UAS_data.Location.Height;
        UAV.speed = (int)UAS_data.Location.SpeedHorizontal;
        UAV.heading = (int)UAS_data.Location.Direction;
      }
      if (UAS_data.SystemValid) {
        UAV.base_lat_d = UAS_data.System.OperatorLatitude;
        UAV.base_long_d = UAS_data.System.OperatorLongitude;
      }
      if (UAS_data.OperatorIDValid) {
        strncpy(UAV.op_id, (char *)UAS_data.OperatorID.OperatorId, ODID_ID_SIZE);
      }
      
      id_data* storedUAV = next_uav(UAV.mac);
      *storedUAV = UAV;
      storedUAV->flag = 1;
      {
        id_data tmp = *storedUAV;
        BaseType_t xHigherPriorityTaskWoken = pdFALSE;
        xQueueSendFromISR(printQueue, &tmp, &xHigherPriorityTaskWoken);
        if (xHigherPriorityTaskWoken) portYIELD_FROM_ISR();
      }
    }
  }
  else if (payload[0] == 0x80) {
    int offset = 36;
    while (offset < length) {
      int typ = payload[offset];
      int len = payload[offset + 1];
      if ((typ == 0xdd) &&
          (((payload[offset + 2] == 0x90 && payload[offset + 3] == 0x3a && payload[offset + 4] == 0xe6)) ||
           ((payload[offset + 2] == 0xfa && payload[offset + 3] == 0x0b && payload[offset + 4] == 0xbc)))) {
        int j = offset + 7;
        if (j < length) {
          memset(&UAS_data, 0, sizeof(UAS_data));
          odid_message_process_pack(&UAS_data, &payload[j], length - j);
          
          id_data UAV;
          memset(&UAV, 0, sizeof(UAV));
          memcpy(UAV.mac, &payload[10], 6);
          UAV.rssi = packet->rx_ctrl.rssi;
          UAV.last_seen = millis();
          
          if (UAS_data.BasicIDValid[0]) {
            strncpy(UAV.uav_id, (char *)UAS_data.BasicID[0].UASID, ODID_ID_SIZE);
          }
          if (UAS_data.LocationValid) {
            UAV.lat_d = UAS_data.Location.Latitude;
            UAV.long_d = UAS_data.Location.Longitude;
            UAV.altitude_msl = (int)UAS_data.Location.AltitudeGeo;
            UAV.height_agl = (int)UAS_data.Location.Height;
            UAV.speed = (int)UAS_data.Location.SpeedHorizontal;
            UAV.heading = (int)UAS_data.Location.Direction;
          }
          if (UAS_data.SystemValid) {
            UAV.base_lat_d = UAS_data.System.OperatorLatitude;
            UAV.base_long_d = UAS_data.System.OperatorLongitude;
          }
          if (UAS_data.OperatorIDValid) {
            strncpy(UAV.op_id, (char *)UAS_data.OperatorID.OperatorId, ODID_ID_SIZE);
          }
          
          id_data* storedUAV = next_uav(UAV.mac);
          *storedUAV = UAV;
          storedUAV->flag = 1;
          {
            id_data tmp = *storedUAV;
            BaseType_t xHigherPriorityTaskWoken = pdFALSE;
            xQueueSendFromISR(printQueue, &tmp, &xHigherPriorityTaskWoken);
            if (xHigherPriorityTaskWoken) portYIELD_FROM_ISR();
          }
        }
      }
      offset += len + 2;
    }
  }
}

void printerTask(void *param) {
  id_data UAV;
  for (;;) {
    if (xQueueReceive(printQueue, &UAV, portMAX_DELAY)) {
      send_json_fast(&UAV);
      print_compact_message(&UAV);
      // no need to reset flag on copy
    }
  }
}

void initializeSerial() {
  Serial.setTxBufferSize(16384);  // the mic stream (~43 KB/s) stalls on the default 256 B
  Serial.begin(115200);
  Serial1.begin(115200, SERIAL_8N1, SERIAL1_RX_PIN, SERIAL1_TX_PIN);
}

void setup() {
  setCpuFrequencyMhz(160);
  initializeSerial();
  nvs_flash_init();
  
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_promiscuous_rx_cb(&callback);
  esp_wifi_set_channel(6, WIFI_SECOND_CHAN_NONE);
  
  BLEDevice::init("DroneID");
  pBLEScan = BLEDevice::getScan();
  pBLEScan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
  pBLEScan->setActiveScan(true);

  printQueue = xQueueCreate(MAX_UAVS, sizeof(id_data));
  serialLock = xSemaphoreCreateMutex();

  for (int b = 0; b < MIC_BUSES; b++) {
    i2s[b].setPins(MIC_SCK_PINS[b], MIC_WS_PINS[b], -1, MIC_SD_PINS[b]);
    micBusOk[b] = i2s[b].begin(I2S_MODE_STD, MIC_I2S_RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH);
    if (micBusOk[b])
      gpio_pulldown_en((gpio_num_t)MIC_SD_PINS[b]);  // an empty slot reads 0, not floating noise
    else
      Serial.printf("   [!] INMP441 bus %d init failed\n", b);
  }
  if (micBusOk[0] || micBusOk[1])
    xTaskCreatePinnedToCore(micTask, "MicTask", 4096, NULL, 1, NULL, 0);
  
  xTaskCreatePinnedToCore(bleScanTask, "BLEScanTask", 10000, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(wifiProcessTask, "WiFiProcessTask", 10000, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(printerTask, "PrinterTask", 10000, NULL, 1, NULL, 1);
  
  memset(uavs, 0, sizeof(uavs));
}

void loop() {
  unsigned long current_millis = millis();
    if ((current_millis - last_status) > 60000UL) {
      xSemaphoreTake(serialLock, portMAX_DELAY);
      Serial.println("   [+] Device is active and scanning...");
      xSemaphoreGive(serialLock);
      last_status = current_millis;
    }
}
