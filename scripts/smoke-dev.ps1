# Prueba rápida del entorno local (proxy + API + validación de monto)
$ErrorActionPreference = "Stop"
$baseFront = "http://localhost:3015"
$baseBack = "http://localhost:3012"

Write-Host "`n=== 1. Backend directo ($baseBack/api/health) ===" -ForegroundColor Cyan
try {
  $h = Invoke-RestMethod -Uri "$baseBack/api/health" -TimeoutSec 8
  $h | ConvertTo-Json -Compress
} catch {
  Write-Host "FALLO: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  -> ¿Corre 'npm run dev'? ¿server/.env tiene DATABASE_URL?" -ForegroundColor Yellow
}

Write-Host "`n=== 2. Proxy Angular ($baseFront/api/health) ===" -ForegroundColor Cyan
try {
  $p = Invoke-WebRequest -Uri "$baseFront/api/health" -UseBasicParsing -TimeoutSec 8
  if ($p.Content -like '{*') {
    Write-Host "OK proxy JSON: $($p.Content)" -ForegroundColor Green
  } else {
    Write-Host "FALLO: el proxy no reenvia /api (responde HTML). Reinicia con npm run dev." -ForegroundColor Red
  }
} catch {
  Write-Host "FALLO: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== 3. Home / sorteo activo ===" -ForegroundColor Cyan
try {
  $homeData = Invoke-RestMethod -Uri "$baseFront/api/sorteos/home" -TimeoutSec 12
  if ($homeData.principal) {
    Write-Host "OK sorteo: $($homeData.principal.nombre) ($($homeData.principal.fecha))" -ForegroundColor Green
  } else {
    Write-Host "Sin sorteo activo en esta base de datos." -ForegroundColor Yellow
  }
} catch {
  Write-Host "FALLO: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== 4. Monto manipulado (debe fallar 400) ===" -ForegroundColor Cyan
$body = @{
  amount = 1
  currency = "cop"
  customerEmail = "qa-smoke@test.local"
  successUrl = "http://localhost:3015/comprar-stikers?success=true&session_id={CHECKOUT_SESSION_ID}"
  cancelUrl = "http://localhost:3015/comprar-stikers?canceled=true"
  selectedStikers = @(@{ numeroA = "2634"; numeroB = "8460" })
} | ConvertTo-Json -Depth 5
try {
  Invoke-RestMethod -Uri "$baseBack/api/create-checkout-session" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 12 | Out-Null
  Write-Host "FALLO: acepto amount=1 (validacion no activa o backend viejo)" -ForegroundColor Red
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  $detail = $_.ErrorDetails.Message
  if ($code -eq 400 -and $detail -match "Monto incorrecto") {
    Write-Host "OK rechazado con 400: $detail" -ForegroundColor Green
  } elseif ($code -eq 503) {
    Write-Host "Wompi no configurado (esperado en local). Monto puede haberse validado antes." -ForegroundColor Yellow
    Write-Host $detail
  } else {
    Write-Host "HTTP $code : $detail" -ForegroundColor Yellow
  }
}

Write-Host "`n=== 5. Simular pago (solo NODE_ENV != production) ===" -ForegroundColor Cyan
$cfg = $null
try { $cfg = Invoke-RestMethod -Uri "$baseBack/api/config" -TimeoutSec 8 } catch {}
$precio = if ($cfg) { [int]$cfg.precioStikerCents } else { 2000000 }
$simBody = @{
  amount = $precio
  currency = "cop"
  customerEmail = "qa-smoke@test.local"
  customerName = "QA Smoke"
  metadata = @{ cedula = "9998887770"; telefono = "3000000000"; stikersDetail = "smoke test" }
  selectedStikers = @(@{ numeroA = "2634"; numeroB = "8460" })
} | ConvertTo-Json -Depth 5
try {
  $sim = Invoke-RestMethod -Uri "$baseBack/api/simulate-payment" -Method POST -ContentType "application/json" -Body $simBody -TimeoutSec 15
  Write-Host "OK simulate-payment sessionId=$($sim.sessionId)" -ForegroundColor Green
} catch {
  Write-Host "Simulate: $($_.ErrorDetails.Message)" -ForegroundColor Yellow
}

Write-Host ""
