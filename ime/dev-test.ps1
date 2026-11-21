# 開發用：不重新安裝就用剛編好的 DLL 跑 typetest。
# 只在測試的這幾秒把 COM 類別指向一份新的複本（HKCU 蓋過 HKLM），跑完立刻拿掉，別的程式繼續用安裝好的那份。
# 每次用新檔名：載入過的 DLL 會被其他程式鎖住。
#   .\dev-test.ps1            # RichEdit 與 EDIT 各跑一次
param([string]$TargetDir = 'target\dev')

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $here
try {
    $env:CARGO_TARGET_DIR = $TargetDir
    cargo build --release; if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' }
    # 剛連結好的 exe 常被防毒軟體掃描、鎖住幾秒：重試幾次
    for ($try = 1; $try -le 4; $try++) {
        cargo build --release --example typetest
        if ($LASTEXITCODE -eq 0) { break }
        if ($try -eq 4) { throw 'cargo build failed' }
        Start-Sleep 8
    }
    $copies = Join-Path $here "$TargetDir\copies"
    New-Item -ItemType Directory -Force $copies | Out-Null
    $dll = Join-Path $copies "banyan_ime_$(Get-Date -Format yyyyMMddHHmmss).dll"
    Copy-Item (Join-Path $here "$TargetDir\release\banyan_ime.dll") $dll
    $key = 'HKCU:\Software\Classes\CLSID\{77483FA4-B8BD-418A-85E7-90D56CF17EA4}'
    $exe = Join-Path $here "$TargetDir\release\examples\typetest.exe"
    $failed = 0
    try {
        New-Item -Force "$key\InprocServer32" | Out-Null
        Set-ItemProperty "$key\InprocServer32" '(default)' $dll
        Set-ItemProperty "$key\InprocServer32" ThreadingModel Apartment
        foreach ($mode in @('', 'edit')) {
            Write-Host "=== $(if ($mode) { $mode } else { 'richedit' })"
            if ($mode) { & $exe $mode } else { & $exe }
            if ($LASTEXITCODE -ne 0) { $failed++ }
        }
    } finally {
        Remove-Item -Recurse -Force $key
    }
    Get-ChildItem $copies -Filter *.dll | Where-Object { $_.FullName -ne $dll } | ForEach-Object { try { Remove-Item $_.FullName -ErrorAction Stop } catch {} }
    if ($failed) { exit 1 }
} finally {
    Pop-Location
}
