#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 20, 4);

int dialPin = 34; // Used for selecting a language with potentiometer 

// Languages to scroll through
const char* OUTPUT_LANGUAGES[] = {
  "Arabic",
  "French",
  "Hindi",
  "Mandarin",
  "Korean",
  "Portuguese",
  "Punjabi",
  "Spanish",
  "Tagalog",
  "Ukrainian",
  "Urdu"
};

// Output languages note not all display very well
const char* OUTPUT_MESSAGES[] = {
  "مرحبا بالعالم",       // Arabic
  "Bonjour le monde",   // French
  "नमस्ते दुनिया",       // Hindi
  "你好，世界",          // Mandarin
  "안녕하세요 세계",      // Korean
  "Olá Mundo",          // Portuguese
  "ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਦੁਨੀਆ", // Punjabi
  "Hola Mundo",         // Spanish
  "Kumusta Mundo",      // Tagalog
  "Привіт, світе",      // Ukrainian
  "ہیلو دنیا"           // Urdu
};

void setup() {
  Wire.begin(21,22); // SDA and SCL LCD port connects to D21 and D22

  // Initializes LCD
  lcd.init();
  lcd.backlight();
}

void loop() {
  // Derive option from potentiometer rotation and analog voltage
  int value = analogRead(dialPin);
  int chosenOption = value * 11 / 4096;

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Language: ");
  lcd.print(chosenOption);
  lcd.setCursor(0, 1);
  lcd.print(OUTPUT_LANGUAGES[chosenOption]);
  lcd.setCursor(0, 2);
  lcd.print("Message: ");
  lcd.print(chosenOption);
  lcd.setCursor(0, 3);
  lcd.print(OUTPUT_MESSAGES[chosenOption]);
}