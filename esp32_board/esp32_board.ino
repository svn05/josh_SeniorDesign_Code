// san vo, nov 21 2026
// utek board: mic + speaker + camera on one usb cable, for the demo page in chrome
// same mic code as esp32_mic.ino, plus a speaker and a relay for the esp32-cam
//
// mic, inmp441 (pin -> esp32):
//   vdd -> 3v3      gnd -> gnd      l/r -> gnd
//   sck -> d26      ws  -> d25      sd  -> d22
// speaker amp, max98357a (pin -> esp32):
//   vin -> vin (5v) gnd -> gnd
//   bclk -> d12     lrc -> d14      din -> d13
// camera, an esp32-cam board running esp32_cam.ino (pin -> esp32):
//   5v -> vin (5v)  gnd -> gnd
//   u0t -> rx2 (d16)                u0r -> tx2 (d17)
// push to talk button: one side to d27, other side to gnd
// built for the arduino esp32 core 3.x (esp_i2s library). board: esp32 dev module
#include <ESP_I2S.h>
#include "driver/gpio.h"

const int PIN_SCK = 26;     // bit clock
const int PIN_WS = 25;      // word select (left/right clock)
const int PIN_SD = 22;      // data from the mic
const int PIN_BUTTON = 27;  // reads low while held

const uint32_t SAMPLE_RATE = 16000;  // has to match the rate in mac_demos/web/demo.js
const uint32_t BAUD = 921600;        // has to match the baud in mac_demos/web/demo.js
const int SHIFT = 14;                // 32 bit sample -> 16 bit. lower = louder, 14 clips around 108 db
const int BLOCK = 256;               // samples per packet (16 ms)

const int PIN_SPK_BCLK = 12;     // speaker amp bit clock
const int PIN_SPK_LRC = 14;      // speaker amp left/right clock
const int PIN_SPK_DIN = 13;      // sound to the speaker amp
const int SPEAKER_VOLUME = 80;   // percent
const int PIN_CAM_RX = 16;       // rx2, wired to u0t on the esp32-cam
const int PIN_CAM_TX = 17;       // tx2, wired to u0r on the esp32-cam
const uint32_t CAM_BAUD = 460800;  // has to match CAM_BAUD in esp32_cam.ino. the mic and the camera share
                                   // the usb cable (921600), this leaves room for both

I2SClass mic;
int32_t frames[BLOCK * 2];   // left and right slot of every frame
int32_t offset[2] = {0, 0};  // slow average of each slot, taken off as dc offset
int16_t held[2] = {0, 0};    // last sample of each slot that made sense
int slot = 0;                // which slot the mic is on (0 left, 1 right)
int votes = 0;

// each packet: 4 magic letters, a flags byte, how many samples in this packet got replaced
// because they were impossible, a 16 bit sample count, then that many 16 bit little endian
// samples. the page decides what to keep
// flags: bit 0 button held, bit 1 right slot in use, bit 2 mic is sending nothing,
// bit 3 this sketch (speaker + camera) and not the mic only one,
// bits 4-5 which wiring below the mic answered on
struct __attribute__((packed)) {
  char magic[4];
  uint8_t flags;
  uint8_t glitches;
  uint16_t count;
  int16_t samples[BLOCK];
} packet = {{'U', 'T', 'E', 'K'}, 0, 0, BLOCK, {0}};
bool lastReading = false, buttonDown = false;
bool started = false, micFound = false;
uint32_t lastSearch = 0;

// ways the mic might be wired: {sck, ws, sd}. first one is how its meant to be. the others
// cover the 2 easy mistakes (clock wires swapped, data wire one pin over) so they
// still work without rewiring. only the data pin is ever an input so trying them is safe
const int WIRINGS[4][3] = {
  {PIN_SCK, PIN_WS, PIN_SD},
  {PIN_WS, PIN_SCK, PIN_SD},
  {PIN_SCK, PIN_WS, 23},
  {PIN_WS, PIN_SCK, 23},
};
int wiring = 0;
int silentBlocks = 0;

// ---- speaker and camera ----
// the mic stops for half a second whenever it goes looking for its wiring, so the speaker
// and the camera relay each run in their own task and dont depend on loop()
I2SClass speaker;
SemaphoreHandle_t usbLock;   // one packet at a time on the usb cable
const int RING = 24000;      // up to 1.5 s of sound waiting for the speaker
const int PREFILL = 2400;    // start playing once 0.15 s has arrived
int16_t *ring = NULL;
volatile int ringHead = 0, ringTail = 0, ringFlushTo = 0;
volatile bool ringFlush = false;

void sendToMac(const uint8_t *data, size_t size) {
  xSemaphoreTake(usbLock, portMAX_DELAY);
  Serial.write(data, size);
  xSemaphoreGive(usbLock);
}

// plays what is in the ring, and silence the rest of the time so the amp never pops
void speakerTask(void *) {
  static int16_t out[BLOCK * 2];  // left and right get the same sample
  bool playing = false;
  int lastHead = 0, stale = 0;
  for (;;) {
    if (ringFlush) {
      ringTail = ringFlushTo;
      ringFlush = false;
      playing = false;
    }
    int head = ringHead;
    int waiting = (head - ringTail + RING) % RING;
    stale = (head == lastHead) ? stale + 1 : 0;
    lastHead = head;
    // start once enough is here, or when nothing more has come for 0.1 s (a short clip)
    if (!playing && waiting > 0 && (waiting >= PREFILL || stale > 6)) playing = true;
    for (int i = 0; i < BLOCK; i++) {
      int16_t sample = 0;
      if (playing) {
        if (ringTail == head) {
          playing = false;
        } else {
          sample = (int32_t)ring[ringTail] * SPEAKER_VOLUME / 100;
          ringTail = (ringTail + 1) % RING;
        }
      }
      out[i * 2] = out[i * 2 + 1] = sample;
    }
    if (speaker.write((const uint8_t *)out, sizeof(out)) == 0) delay(16);
  }
}

// packets from the page: 'U' 'T', a type letter, a 16 bit length, then that many bytes
//   S  sound for the speaker, 16 bit little endian samples at SAMPLE_RATE
//   X  stop the speaker and drop what is waiting
//   C  bytes to pass on to the esp32-cam
void fromMac(uint8_t b) {
  static uint8_t state = 0, type = 0, low = 0;
  static uint16_t left = 0;
  static bool half = false;
  switch (state) {
    case 0: state = (b == 'U') ? 1 : 0; break;
    case 1: state = (b == 'T') ? 2 : (b == 'U' ? 1 : 0); break;
    case 2:
      type = b;
      state = (b == 'S' || b == 'X' || b == 'C') ? 3 : 0;
      break;
    case 3: left = b; state = 4; break;
    case 4:
      left |= (uint16_t)b << 8;
      half = false;
      if (type == 'X') {
        ringFlushTo = ringHead;
        ringFlush = true;
      }
      state = (left > 0 && left <= 4096) ? 5 : 0;
      break;
    case 5:
      if (type == 'S') {
        if (!half) {
          low = b;
        } else if (ring) {
          int next = (ringHead + 1) % RING;
          if (next != ringTail) {  // full means the page is sending too fast, drop it
            ring[ringHead] = (int16_t)(low | (b << 8));
            ringHead = next;
          }
        }
        half = !half;
      } else if (type == 'C') {
        Serial2.write(b);
      }
      if (--left == 0) state = 0;
      break;
  }
}

// reads what the page sends, and passes the camera's bytes up the usb cable as they come:
// 'U' 'T' 'E' 'C', a 16 bit length, then that many bytes. the page puts the pictures together
void linkTask(void *) {
  static uint8_t out[6 + 1024] = {'U', 'T', 'E', 'C'};
  for (;;) {
    for (int n = Serial.available(); n > 0; n--) fromMac(Serial.read());
    int have = Serial2.available();
    if (have > 0) {
      int got = Serial2.readBytes(out + 6, min(have, 1024));
      if (got > 0) {
        out[4] = got & 255;
        out[5] = got >> 8;
        sendToMac(out, 6 + got);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(4));
  }
}

void readFrames() {
  size_t wanted = sizeof(frames), got = 0;
  while (got < wanted) {
    got += mic.readBytes((char *)frames + got, wanted - got);
  }
}

// start the i2s bus on one wiring and listen for about half a second
// true if either slot has real mic data (not a wire stuck at 0 or 1, not random bits)
bool listenOn(const int pins[3]) {
  if (started) mic.end();
  mic.setPins(pins[0], pins[1], -1, pins[2]);
  started = mic.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH);
  if (!started) return false;
  // the mic only drives the data wire for one of the two slots and lets go for
  // the other. without a pulldown the free wire picks up the clocks next to it and reads
  // as loud random samples
  gpio_pulldown_en((gpio_num_t)pins[2]);
  gpio_pullup_dis((gpio_num_t)pins[2]);
  for (int i = 0; i < 8; i++) readFrames();  // the mic needs about 0.1 s to wake up
  int stuck[2] = {0, 0}, wild[2] = {0, 0};
  const int blocks = 24;
  for (int b = 0; b < blocks; b++) {
    readFrames();
    for (int i = 0; i < BLOCK * 2; i++) {
      int32_t sample = frames[i] >> SHIFT;
      if (frames[i] == 0 || frames[i] == -1) stuck[i & 1]++;
      else if (sample > 32767 || sample < -32768) wild[i & 1]++;
    }
  }
  const int total = blocks * BLOCK;
  for (int ch = 0; ch < 2; ch++) {
    if (stuck[ch] * 2 < total && wild[ch] * 5 < total) return true;
  }
  return false;
}

// try the next wiring. gets called over and over while no mic answers so fixing a wire
// gets picked up without a reset
void findMicrophone() {
  micFound = listenOn(WIRINGS[wiring]);
  if (!micFound) wiring = (wiring + 1) % 4;
  offset[0] = offset[1] = 0;
  lastSearch = millis();
}

void setup() {
  Serial.setTxBufferSize(4096);
  Serial.setRxBufferSize(8192);
  Serial.begin(BAUD);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  usbLock = xSemaphoreCreateMutex();
  ring = (int16_t *)malloc(RING * sizeof(int16_t));
  speaker.setPins(PIN_SPK_BCLK, PIN_SPK_LRC, PIN_SPK_DIN);
  if (ring && speaker.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO)) {
    xTaskCreatePinnedToCore(speakerTask, "speaker", 4096, NULL, 2, NULL, 0);
  }
  Serial2.setRxBufferSize(8192);
  Serial2.begin(CAM_BAUD, SERIAL_8N1, PIN_CAM_RX, PIN_CAM_TX);
  xTaskCreatePinnedToCore(linkTask, "link", 4096, NULL, 2, NULL, 0);
  for (int tries = 0; tries < 4 && !micFound; tries++) findMicrophone();
}

void loop() {
  if (!micFound && millis() - lastSearch > 1500 && !buttonDown) findMicrophone();
  if (!started) {
    delay(16);
    memset(frames, 0, sizeof(frames));
  } else {
    readFrames();
  }
  // per slot: how much sound, and how many samples are too big to be sound
  int64_t energy[2] = {0, 0};
  int wild[2] = {0, 0}, stuck[2] = {0, 0};
  int16_t clean[2][BLOCK];
  for (int i = 0; i < BLOCK * 2; i++) {
    int ch = i & 1;
    int32_t sample = frames[i] >> SHIFT;
    if (frames[i] == 0 || frames[i] == -1) stuck[ch]++;
    if (sample > 32767 || sample < -32768) {
      wild[ch]++;  // not sound, keep the last good sample instead
    } else {
      offset[ch] += (sample - offset[ch]) / 256;
      held[ch] = constrain(sample - offset[ch], -32768, 32767);
    }
    clean[ch][i >> 1] = held[ch];
    energy[ch] += (int32_t)held[ch] * held[ch];
  }
  // which slot is the mic on? a slot with no signal at all is dead. with two live slots
  // the one with fewer impossible samples is the mic. only switch when 8 packets
  // in a row (128 ms) agree so one weird packet cant flip it
  bool alive[2] = {energy[0] > (int64_t)BLOCK * 4, energy[1] > (int64_t)BLOCK * 4};
  int better = slot;
  if (alive[0] != alive[1]) {
    better = alive[1] ? 1 : 0;
  } else if (alive[0] && alive[1]) {
    better = wild[0] != wild[1] ? (wild[1] < wild[0] ? 1 : 0) : (energy[1] > energy[0] ? 1 : 0);
  }
  if (better == slot) {
    votes = 0;
  } else if (++votes >= 8) {
    slot = better;
    votes = 0;
  }
  memcpy(packet.samples, clean[slot], sizeof(packet.samples));
  packet.glitches = min(wild[slot], 255);
  // mic went quiet on the wire for 1.5 s so its probably loose, start looking again
  silentBlocks = (stuck[0] > BLOCK * 9 / 10 && stuck[1] > BLOCK * 9 / 10) ? silentBlocks + 1 : 0;
  if (micFound && silentBlocks > 90) micFound = false;

  // debounce: button state only changes after 2 packets (32 ms) agree
  bool reading = digitalRead(PIN_BUTTON) == LOW;
  if (reading == lastReading) buttonDown = reading;
  lastReading = reading;
  packet.flags = (buttonDown ? 1 : 0) | (slot ? 2 : 0) | (micFound ? 0 : 4) | 8 | (wiring << 4);
  sendToMac((const uint8_t *)&packet, sizeof(packet));
}
