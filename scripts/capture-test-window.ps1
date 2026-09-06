param([int]$ProcessId, [string]$OutputPath)
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class NeoWindowCapture {
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 public struct RECT {public int left,top,right,bottom;}
}
"@
Add-Type -AssemblyName System.Drawing
$script:targetHandle=[IntPtr]::Zero
[NeoWindowCapture]::EnumWindows({param($h,$l) $pidValue=0;[void][NeoWindowCapture]::GetWindowThreadProcessId($h,[ref]$pidValue); if($pidValue -eq $ProcessId){$s=New-Object Text.StringBuilder 512;[void][NeoWindowCapture]::GetWindowText($h,$s,512); if($s.ToString() -like '*Neo*'){$script:targetHandle=$h; Write-Host $h $s.ToString()}}; return $true},[IntPtr]::Zero) | Out-Null
if($targetHandle -eq [IntPtr]::Zero){throw 'Owned test window not found'}
[void][NeoWindowCapture]::ShowWindow($targetHandle,4)
Start-Sleep -Milliseconds 300
$r=New-Object NeoWindowCapture+RECT
[void][NeoWindowCapture]::GetWindowRect($targetHandle,[ref]$r)
$b=New-Object Drawing.Bitmap ($r.right-$r.left),($r.bottom-$r.top)
$g=[Drawing.Graphics]::FromImage($b);$dc=$g.GetHdc()
[void][NeoWindowCapture]::PrintWindow($targetHandle,$dc,2)
$g.ReleaseHdc($dc);$g.Dispose()
$b.Save($OutputPath);$b.Dispose()
