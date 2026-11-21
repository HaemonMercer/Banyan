# 安裝 Banyan 輸入法：編譯、複製到 Program Files、註冊（regsvr32），再加到「中文（台灣）」的鍵盤。
# 需要系統管理員權限（沒有的話會自己要求提升）。
#   .\install.ps1              # 編譯 release 版並安裝
#   .\install.ps1 -NoBuild     # 用已經編好的 target\release\banyan_ime.dll
#   .\install.ps1 -NoKeyboard  # 只註冊，不改語言清單（自己到設定 > 時間與語言加鍵盤）
#   .\install.ps1 -TargetDir target\dev  # 換一個建置資料夾（原本的 DLL 被開著的程式鎖住時）
param([switch]$NoBuild, [switch]$NoKeyboard, [string]$TargetDir = 'target')

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$clsid = '{77483FA4-B8BD-418A-85E7-90D56CF17EA4}'
$prof = '{AF153006-E6D0-4FCC-A497-A2B082AFAB5E}'
$dest = Join-Path $env:ProgramFiles 'Banyan IME'
$dll = Join-Path $dest 'banyan_ime.dll'

if (-not $NoBuild) {
    Push-Location $here
    try { $env:CARGO_TARGET_DIR = $TargetDir; cargo build --release; if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' } } finally { Pop-Location }
}
$built = Join-Path $here "$TargetDir\release\banyan_ime.dll"
if (-not (Test-Path $built)) { throw "找不到 $built（先 cargo build --release）" }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    # 複製與註冊要系統管理員；語言清單是目前使用者的，提升後的視窗裡改不到，所以在這裡改
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -NoBuild -NoKeyboard -TargetDir `"$TargetDir`""
    $p = Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw '註冊失敗（系統管理員視窗）' }
} else {
    New-Item -ItemType Directory -Force $dest | Out-Null
    if (Test-Path $dll) {
        # 舊的 DLL 可能還載入在別的程式裡：不能覆蓋，但可以改名，下次重新開機後就沒人用了
        $old = "$dll.$(Get-Date -Format yyyyMMddHHmmss).old"
        Move-Item $dll $old
        Get-ChildItem $dest -Filter '*.old' | ForEach-Object { try { Remove-Item $_.FullName -ErrorAction Stop } catch {} }
    }
    Copy-Item $built $dll
    $r = Start-Process regsvr32 -ArgumentList "/s `"$dll`"" -Wait -PassThru
    if ($r.ExitCode -ne 0) { throw "regsvr32 失敗：$($r.ExitCode)" }
    Write-Host "已註冊 $dll"
}

if (-not $NoKeyboard) {
    $tip = "0404:$clsid$prof"
    $list = Get-WinUserLanguageList
    # 已經有的繁體中文（台灣、香港、澳門）都可以：同樣是 0404 的鍵盤；沒有才加「中文（台灣）」
    $zh = $list | Where-Object { $_.LanguageTag -like 'zh-Hant*' -or $_.LanguageTag -in 'zh-TW', 'zh-HK', 'zh-MO' } | Select-Object -First 1
    if (-not $zh) {
        $list.Add('zh-Hant-TW')
        $zh = $list | Where-Object { $_.LanguageTag -eq 'zh-Hant-TW' } | Select-Object -First 1
    }
    if (-not ($zh.InputMethodTips -contains $tip)) {
        $zh.InputMethodTips.Add($tip)
        Set-WinUserLanguageList $list -Force
    }
    Write-Host "已加到「$($zh.LocalizedName)」的鍵盤：用 Win＋空白鍵 切換到 Banyan。"

    # 開始功能表的「Banyan IME Settings」：開關字預測與輔助打字（目前使用者的開始功能表）
    $lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Banyan IME Settings.lnk'
    $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
    $sc.TargetPath = Join-Path $env:SystemRoot 'System32\rundll32.exe'
    $sc.Arguments = "`"$dll`",Settings"
    $sc.IconLocation = "$dll,0"
    $sc.Description = 'Turn word prediction and typing assist on or off'
    $sc.Save()
    Write-Host '開始功能表新增「Banyan IME Settings」（也可以在候選列上按右鍵打開）。'
}
Write-Host '已經開著的程式要重新開啟才會載入新版。'
