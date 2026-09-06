# SPDX-License-Identifier: MPL-2.0
Add-Type -AssemblyName System.Drawing
$iconsDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'extension\icons'
New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null
foreach ($size in @(16,32,48,128)) {
  $bitmap = [System.Drawing.Bitmap]::new($size,$size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#6264d8'))
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $radius = [single]($size * .4)
  $edge = [single]($size - 1)
  $path.AddArc(0,0,$radius,$radius,180,90)
  $path.AddArc($edge-$radius,0,$radius,$radius,270,90)
  $path.AddArc($edge-$radius,$edge-$radius,$radius,$radius,0,90)
  $path.AddArc(0,$edge-$radius,$radius,$radius,90,90)
  $path.CloseFigure()
  $graphics.FillPath($brush,$path)
  $font = [System.Drawing.Font]::new('Segoe UI',[single]($size * .79),[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $graphics.DrawString('n',$font,[System.Drawing.Brushes]::White,[System.Drawing.RectangleF]::new(0,-$size*.09,$size,$size),$format)
  $bitmap.Save((Join-Path $iconsDir "$size.png"),[System.Drawing.Imaging.ImageFormat]::Png)
  $format.Dispose(); $font.Dispose(); $path.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
