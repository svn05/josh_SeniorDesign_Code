// UTEK microphone: INMP441 -> ESP32 -> USB serial -> the Translation tab in Chrome.
//
// Wiring (INMP441 pin -> ESP32):
//   VDD -> 3V3      GND -> GND      L/R -> GND
//   SCK -> D26      WS  -> D25      SD  -> D22
// Push-to-talk button: one side to D27, the other to GND.
// Built for the Arduino ESP32 core 3.x (ESP_I2S.h). Board: ESP32 Dev Module.
#include <ESP_I2S.h>

const int PIN_SCK = 26;     // bit clock
const int PIN_WS = 25;      // word select (left/right clock)
const int PIN_SD = 22;      // data from the microphone
const int PIN_BUTTON = 27;  // reads LOW while held

const uint32_t SAMPLE_RATE = 16000;  // must match BOARD_RATE in mac_demos/web/demo.js
const uint32_t BAUD = 921600;        // must match BOARD_BAUD in mac_demos/web/demo.js
const int SHIFT = 14;                // 32-bit sample -> 16-bit. Lower is louder; 14 clips near 108 dB SPL.
const int BLOCK = 256;               // samples per packet (16 ms)

I2SClass mic;
int32_t frames[BLOCK * 2];  // left and right slot of every frame
int32_t offset[2] = {0, 0};  // slow average of each slot, removed as DC offset

// Each packet: "UTEK", one byte that is 1 while the button is held, a 16-bit sample count,
// then that many 16-bit little-endian samples. The page decides what to keep.
struct __attribute__((packed)) {
  char magic[4];
  uint8_t button;
  uint16_t count;
  int16_t samples[BLOCK];
} packet = {{'U', 'T', 'E', 'K'}, 0, BLOCK, {0}};
bool lastReading = false;

void setup() {
  Serial.setTxBufferSize(4096);
  Serial.begin(BAUD);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  mic.setPins(PIN_SCK, PIN_WS, -1, PIN_SD);
  // Both slots are read, so it does not matter whether L/R is tied to GND or 3V3.
  while (!mic.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) {
    delay(500);
  }
}

void loop() {
  size_t wanted = sizeof(frames), got = 0;
  while (got < wanted) {
    got += mic.readBytes((char *)frames + got, wanted - got);
  }
  // The microphone only drives one slot. Use whichever is louder in this block.
  int64_t energy[2] = {0, 0};
  for (int i = 0; i < BLOCK * 2; i++) {
    int32_t sample = frames[i] >> SHIFT;
    offset[i & 1] += (sample - offset[i & 1]) / 256;
    frames[i] = sample - offset[i & 1];
    energy[i & 1] += (int64_t)frames[i] * frames[i];
  }
  int slot = energy[1] > energy[0] ? 1 : 0;
  for (int i = 0; i < BLOCK; i++) {
    packet.samples[i] = constrain(frames[i * 2 + slot], -32768, 32767);
  }
  // Debounce: the reported state changes only after two packets (32 ms) agree.
  bool reading = digitalRead(PIN_BUTTON) == LOW;
  if (reading == lastReading) packet.button = reading;
  lastReading = reading;
  Serial.write((const uint8_t *)&packet, sizeof(packet));
}
