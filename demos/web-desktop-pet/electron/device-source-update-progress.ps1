param([string]$Receipt, [string]$Token)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AIBanlvUpdateWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
}
'@
$form = New-Object System.Windows.Forms.Form
$form.Text = 'AIBanlv 源码更新'
$form.ClientSize = New-Object System.Drawing.Size(430, 135)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.ControlBox = $false
# The helper hides its console; explicitly show the dialog after the first ShowWindow.
$form.Add_Shown({ [void][AIBanlvUpdateWindow]::ShowWindow($form.Handle, 5); $form.Activate() })
$label = New-Object System.Windows.Forms.Label
$label.SetBounds(20, 20, 390, 50)
$label.Text = '正在准备源码更新…'
$label.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.SetBounds(20, 90, 390, 18)
$bar.Style = 'Marquee'
$form.Controls.AddRange(@($label, $bar))
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.Add_Tick({
    try {
        $state = Get-Content -LiteralPath $Receipt -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($state.token -ne $Token) { $form.Close(); return }
        $label.Text = $state.message
        if ($state.status -in @('done', 'error', 'cancelled')) { $form.Close(); return }
        if (!(Get-Process -Id $state.pid -ErrorAction SilentlyContinue)) {
            $label.Text = '更新进程已停止。请重新打开 AIBanlv 检查更新。'
            $bar.Visible = $false
            $form.ControlBox = $true
            $timer.Stop()
        }
    } catch { }
})
$timer.Start()
try { [void]$form.ShowDialog() } finally { $timer.Stop(); $timer.Dispose(); $form.Dispose() }
