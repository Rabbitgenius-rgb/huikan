param([Parameter(Mandatory=$true)][string]$InputFile)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json
# Native desktop capture includes the DWM backdrop. Chromium capturePage does not.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HuikanGlassEvidence {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmIsCompositionEnabled(out bool enabled);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
}
'@
[void][HuikanGlassEvidence]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Drawing
$composition = $false
$compositionResult = [HuikanGlassEvidence]::DwmIsCompositionEnabled([ref]$composition)
$windows = @()
foreach ($window in $request.windows) {
  $material = -1
  $result = [HuikanGlassEvidence]::DwmGetWindowAttribute([IntPtr]([long]$window.handle), 38, [ref]$material, 4)
  $windows += @{ name = $window.name; hresult = $result; systemBackdropType = $material }
}
$rect = New-Object HuikanGlassEvidence+RECT
if (![HuikanGlassEvidence]::GetWindowRect([IntPtr]([long]$request.backdrop), [ref]$rect)) { throw 'Owned backdrop bounds unavailable' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 700 -or $height -lt 450 -or $width -gt 4000 -or $height -gt 3000) { throw 'Unexpected owned backdrop capture bounds' }
[void][HuikanGlassEvidence]::DwmFlush()
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
  $bitmap.Save($request.screenshot, [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
@{ build = [Environment]::OSVersion.Version.Build; compositionEnabled = $composition; compositionHresult = $compositionResult; windows = $windows; screenshotWidth = $width; screenshotHeight = $height } | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath $request.result -Encoding UTF8
