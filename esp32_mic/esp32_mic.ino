// san vo, nov 21 2026
// utek mic: inmp441 -> esp32 -> usb serial -> translation tab in chrome
//
// wiring (inmp441 pin -> esp32):
//   vdd -> 3v3      gnd -> gnd      l/r -> gnd
//   sck -> d26      ws  -> d25      sd  -> d22
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
  Serial.begin(BAUD);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
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
  packet.flags = (buttonDown ? 1 : 0) | (slot ? 2 : 0) | (micFound ? 0 : 4) | (wiring << 4);
  Serial.write((const uint8_t *)&packet, sizeof(packet));
}
