#!/bin/sh
# san vo, nov 21 2026
# compiles esp32_cam/esp32_cam.ino and uploads it to the esp32-cam. double click this file,
# or run it with a port:  ./upload_cam.command /dev/cu.usbserial-0001
# it uses the arduino-cli that comes inside the arduino ide, with a normal PATH (pressing
# upload in the ide itself stopped at "env: bash: No such file or directory" on this mac)
# close the arduino serial monitor and the demo tab in chrome first, only one program can hold the port
PATH=/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin
export PATH
cd "$(/usr/bin/dirname "$0")" || exit 1
LOG="upload_cam.log"
{
  echo "started $(date)"
  PORT="$1"
  if [ -z "$PORT" ]; then
    for candidate in /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART* /dev/cu.wchusbserial* /dev/cu.usbmodem*; do
      if [ -e "$candidate" ]; then PORT="$candidate"; break; fi
    done
  fi
  CLI=""
  for candidate in "/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" \
      "$HOME/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" \
      /opt/homebrew/bin/arduino-cli /usr/local/bin/arduino-cli; do
    if [ -x "$candidate" ]; then CLI="$candidate"; break; fi
  done
  if [ -z "$CLI" ]; then
    echo "arduino-cli was not found. Install the Arduino IDE first."
    echo "RESULT: failed"
  elif [ -z "$PORT" ]; then
    echo "No serial port was found. Plug the board in and try again."
    echo "RESULT: failed"
  else
    echo "port $PORT"
    # say which program has the port open, esptool only says "busy"
    HOLDER="$(/usr/sbin/lsof +c 0 "$PORT" 2>/dev/null | /usr/bin/awk 'NR > 1 { print $1 " (pid " $2 ")" }' | /usr/bin/sort -u)"
    if [ -n "$HOLDER" ]; then
      echo "The port is open in another program right now:"
      echo "$HOLDER"
      echo "Close it (a Chrome tab with the demo, a serial monitor, a recording script) and run this again."
    fi
    if [ -f "$HOME/.arduinoIDE/arduino-cli.yaml" ]; then
      "$CLI" --config-file "$HOME/.arduinoIDE/arduino-cli.yaml" compile --fqbn esp32:esp32:esp32cam --upload --port "$PORT" esp32_cam
    else
      "$CLI" compile --fqbn esp32:esp32:esp32cam --upload --port "$PORT" esp32_cam
    fi
    if [ $? -eq 0 ]; then
      echo "RESULT: ok"
    else
      echo "RESULT: failed"
    fi
  fi
  echo "finished $(date)"
} 2>&1 | /usr/bin/tee "$LOG"
