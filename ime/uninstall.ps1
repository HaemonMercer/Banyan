# 移除 Banyan 輸入法：從語言清單拿掉、取消註冊、刪掉 Program Files 裡的檔案（還在用的先改名，重新開機後再刪）。
#   .\uninstall.ps1
param([switch]$NoKeyboard)

$ErrorActionPreference = 'Stop'
$clsid = '{77483FA4-B8BD-418A-85E7-90D56CF17EA4}'
$prof = '{AF153006-E6D0-4FCC-A497-A2B082AFAB5E}'
$dest = Join-Path $env:ProgramFiles 'Banyan IME'
$dll = Join-Path $dest 'banyan_ime.dll'

if (-not $NoKeyboard) {
    $tip = "0404:$clsid$prof"
    $list = Get-WinUserLanguageList
    $changed = $false
    foreach ($l in $list) {
        if ($l.InputMethodTips -contains $tip) { [void]$l.InputMethodTips.Remove($tip); $changed = $true }
    }
    if ($changed) { Set-WinUserLanguageList $list -Force; Write-Host '已從語言清單拿掉 Banyan。' }
    $lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Banyan IME Settings.lnk'
    if (Test-Path $lnk) { Remove-Item $lnk }
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -NoKeyboard"
    $p = Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw '取消註冊失敗（系統管理員視窗）' }
    return
}

if (Test-Path $dll) {
    Start-Process regsvr32 -ArgumentList "/u /s `"$dll`"" -Wait | Out-Null
    try { Remove-Item $dll -ErrorAction Stop } catch { Move-Item $dll "$dll.$(Get-Date -Format yyyyMMddHHmmss).old" }
}
Get-ChildItem $dest -Filter '*.old' -ErrorAction SilentlyContinue | ForEach-Object { try { Remove-Item $_.FullName -ErrorAction Stop } catch {} }
Write-Host '已取消註冊。設定（HKCU\Software\Banyan IME）與記住的英文字（%APPDATA%\Banyan IME）留著，不要了可以自己刪。'
