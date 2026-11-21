#include <Arduino.h>
#include "driver/i2s.h"

constexpr int PIN_BTN = 27;       // Button to GND (active LOW with INPUT_PULLUP)
constexpr int PIN_I2S_SCK = 26;   // INMP441 SCK -> D26[cite: 56]
constexpr int PIN_I2S_WS = 25;    // INMP441 WS  -> D25[cite: 56]
constexpr int PIN_I2S_SD = 22;    // INMP441 SD  -> D22[cite: 56]

constexpr i2s_port_t I2S_PORT = I2S_NUM_0;
constexpr int SAMPLE_RATE = 16000;
constexpr size_t BUFFER_SAMPLES = 256;

int32_t samples[BUFFER_SAMPLES];

void setupMicI2S() {
  i2s_config_t config = {};
  config.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  config.sample_rate = SAMPLE_RATE;
  config.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  config.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  config.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  config.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  config.dma_buf_count = 4;
  config.dma_buf_len = BUFFER_SAMPLES;
  config.use_apll = false;
  config.tx_desc_auto_clear = false;
  config.fixed_mclk = 0;

  esp_err_t e1 = i2s_driver_install(I2S_PORT, &config, 0, nullptr);
  i2s_pin_config_t pins = {};
  pins.bck_io_num = PIN_I2S_SCK;
  pins.ws_io_num = PIN_I2S_WS;
  pins.data_in_num = PIN_I2S_SD;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  pins.mck_io_num = I2S_PIN_NO_CHANGE;

  esp_err_t e2 = i2s_set_pin(I2S_PORT, &pins);
  i2s_zero_dma_buffer(I2S_PORT);
  Serial.printf("I2S init: install=%d set_pin=%d\n", (int)e1, (int)e2);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(PIN_BTN, INPUT_PULLUP);
  Serial.println("BTN_MIC_TEST_READY");
  setupMicI2S();
}

void loop() {
  static bool wasPressed = false;
  bool isPressed = (digitalRead(PIN_BTN) == LOW);

  if (isPressed != wasPressed) {
    delay(20);
    isPressed = (digitalRead(PIN_BTN) == LOW);
    if (isPressed != wasPressed) {
      wasPressed = isPressed;
      if (isPressed) {
        i2s_zero_dma_buffer(I2S_PORT); // Flush stale samples before recording
        Serial.println("[REC_START]");
      } else {
        Serial.println("[REC_STOP]");
      }
    }
  }

  if (!isPressed) {
    delay(15);
    return;
  }

  size_t bytesRead = 0;
  esp_err_t err = i2s_read(I2S_PORT, samples, sizeof(samples), &bytesRead, pdMS_TO_TICKS(50));
  int count = bytesRead / sizeof(int32_t);
  int64_t sumAbs = 0;
  for (int i = 0; i < count; i++) {
    sumAbs += llabs((int64_t)(samples[i] >> 8));
  }
  int64_t avgAbs = (count > 0) ? (sumAbs / count) : 0;
  Serial.printf("err=%d bytes=%u raw0=0x%08X avgAbs=%lld\n",
                (int)err, (unsigned)bytesRead, (uint32_t)samples[0], avgAbs);
}