param([Parameter(Mandatory=$true)][long]$Handle)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CaptureWindowState {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")]
    public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out Rect rect);
    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);
}
'@
$window = [IntPtr]::new($Handle)
if (-not [CaptureWindowState]::IsWindow($window)) { throw 'Window no longer exists.' }
$style = [CaptureWindowState]::GetWindowLongPtr($window, -16).ToInt64()
$extended = [CaptureWindowState]::GetWindowLongPtr($window, -20).ToInt64()
$rect = New-Object CaptureWindowState+Rect
if (-not [CaptureWindowState]::GetClientRect($window, [ref]$rect)) { throw 'Cannot read client bounds.' }
$cloaked = 0
if ([CaptureWindowState]::DwmGetWindowAttribute($window, 14, [ref]$cloaked, 4) -ne 0) {
    throw 'Cannot read DWM visibility.'
}
[pscustomobject]@{
    visible = [CaptureWindowState]::IsWindowVisible($window)
    minimized = [CaptureWindowState]::IsIconic($window)
    cloaked = ($cloaked -ne 0)
    toolWindow = (($extended -band 0x80) -ne 0)
    appWindow = (($extended -band 0x40000) -ne 0)
    childWindow = (($style -band 0x40000000) -ne 0)
    width = $rect.Right - $rect.Left
    height = $rect.Bottom - $rect.Top
} | ConvertTo-Json -Compress
