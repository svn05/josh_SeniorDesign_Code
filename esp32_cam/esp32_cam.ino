// san vo, nov 21 2026
// utek camera: esp32-cam (ai thinker) -> main esp32 -> usb -> the demo page in chrome
// sends small jpeg pictures nonstop for the preview. when the page asks ("!s") it sends
// one big sharp picture, thats the one google reads on the read a sign tab
//
// wiring (esp32-cam pin -> main esp32):
//   5v  -> vin (5v)     gnd -> gnd
//   u0t -> rx2 (d16)    u0r -> tx2 (d17)
// pull the u0t and u0r wires off while uploading this sketch, the upload uses the same 2 pins
// board: ai thinker esp32-cam. nothing here prints to serial, the serial port is the picture link
#include "esp_camera.h"

const uint32_t CAM_BAUD = 460800;            // has to match CAM_BAUD in esp32_board.ino
const framesize_t PREVIEW = FRAMESIZE_QVGA;  // 320x240, about 6 pictures a second
const framesize_t STILL = FRAMESIZE_XGA;     // 1024x768, takes about 2 s to send
const int QUALITY = 12;                      // jpeg quality, lower is sharper and bigger
const bool FLIP = false;                     // true if the picture is upside down
const bool MIRROR = false;                   // true if text reads backwards

framesize_t stillSize = STILL;
bool ready = false;

bool startCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  // ai thinker esp32-cam pins
  config.pin_d0 = 5;
  config.pin_d1 = 18;
  config.pin_d2 = 19;
  config.pin_d3 = 21;
  config.pin_d4 = 36;
  config.pin_d5 = 39;
  config.pin_d6 = 34;
  config.pin_d7 = 35;
  config.pin_xclk = 0;
  config.pin_pclk = 22;
  config.pin_vsync = 25;
  config.pin_href = 23;
  config.pin_sccb_sda = 26;
  config.pin_sccb_scl = 27;
  config.pin_pwdn = 32;
  config.pin_reset = -1;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.jpeg_quality = QUALITY;
  // start at the big size so the picture memory is big enough for it, then drop to the preview size
  if (psramFound()) {
    config.frame_size = STILL;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode = CAMERA_GRAB_LATEST;
  } else {  // no extra memory on this board, a smaller still has to do
    stillSize = FRAMESIZE_SVGA;
    config.frame_size = FRAMESIZE_SVGA;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }
  if (esp_camera_init(&config) != ESP_OK) return false;
  sensor_t *sensor = esp_camera_sensor_get();
  sensor->set_framesize(sensor, PREVIEW);
  sensor->set_vflip(sensor, FLIP);
  sensor->set_hmirror(sensor, MIRROR);
  return true;
}

// each picture: 'U' 'C' 'A' 'M', a letter (v preview, s still), a 32 bit length, then the jpeg
void sendHeader(char kind, uint32_t size) {
  uint8_t header[9] = {'U', 'C', 'A', 'M', (uint8_t)kind, (uint8_t)size, (uint8_t)(size >> 8),
                       (uint8_t)(size >> 16), (uint8_t)(size >> 24)};
  Serial.write(header, sizeof(header));
}

void sendPicture(char kind) {
  camera_fb_t *picture = esp_camera_fb_get();
  if (!picture) return;
  sendHeader(kind, picture->len);
  Serial.write(picture->buf, picture->len);
  esp_camera_fb_return(picture);
}

// after a size change the next few pictures are still the old size or badly exposed
void skipPictures(int count) {
  while (count-- > 0) {
    camera_fb_t *picture = esp_camera_fb_get();
    if (picture) esp_camera_fb_return(picture);
  }
}

void sendStill() {
  sensor_t *sensor = esp_camera_sensor_get();
  sensor->set_framesize(sensor, stillSize);
  delay(150);
  skipPictures(3);
  sendPicture('s');
  sensor->set_framesize(sensor, PREVIEW);
  delay(100);
  skipPictures(2);
}

void setup() {
  Serial.setDebugOutput(false);
  Serial.begin(CAM_BAUD);
  ready = startCamera();
}

void loop() {
  if (!ready) {  // tell the page the camera itself isnt answering (ribbon cable) and keep trying
    sendHeader('e', 0);
    delay(1000);
    ready = startCamera();
    return;
  }
  static bool armed = false;
  bool still = false;
  while (Serial.available()) {
    int c = Serial.read();
    if (armed && c == 's') still = true;
    armed = (c == '!');
  }
  if (still) sendStill();
  else sendPicture('v');
}
