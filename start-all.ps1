$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$tesseract = "C:\Program Files\Tesseract-OCR\tesseract.exe"

if (Test-Path $tesseract) {
  $env:TESSERACT_CMD = $tesseract
}

Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$repoRoot\backend'; npm run start:dev"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$repoRoot\ai-service'; uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$repoRoot\frontend'; npm run dev"
