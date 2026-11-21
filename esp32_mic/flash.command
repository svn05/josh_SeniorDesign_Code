#!/bin/sh
# san vo, nov 21 2026
# uploads the prebuilt mic firmware (esp32_mic.merged.bin) to the esp32 without
# compiling in the arduino ide. double click this file, or run it with a port:
#   ./flash.command /dev/cu.usbserial-0001
# close the arduino serial monitor and the demo tab in chrome first, only one program can hold the port
cd "$(/usr/bin/dirname "$0")" || exit 1

PORT="$1"
if [ -z "$PORT" ]; then
  for candidate in /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART* /dev/cu.wchusbserial* /dev/cu.usbmodem*; do
    if [ -e "$candidate" ]; then PORT="$candidate"; break; fi
  done
fi
if [ -z "$PORT" ]; then
  echo "No ESP32 serial port was found. Plug the board in and try again."
  exit 1
fi

TOOL=""
for candidate in "$HOME"/Library/Arduino15/packages/esp32/tools/esptool_py/*/esptool; do
  if [ -x "$candidate" ]; then TOOL="$candidate"; fi
done
if [ -z "$TOOL" ]; then
  echo "esptool was not found. Install the esp32 boards package in the Arduino IDE first."
  exit 1
fi

echo "Uploading esp32_mic.merged.bin to $PORT ..."
"$TOOL" --chip esp32 --port "$PORT" --baud 460800 write-flash 0x0 esp32_mic.merged.bin
status=$?
if [ $status -eq 0 ]; then
  echo "Done. The microphone firmware is on the board."
else
  echo "Upload failed. If it stopped at 'Connecting', hold the BOOT button on the board and run this again."
fi
exit $status
