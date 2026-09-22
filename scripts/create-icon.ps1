Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force "$PSScriptRoot/../src-tauri/icons" | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::FromArgb(23,29,35))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(246,164,92)),12
$graphics.DrawPolygon($pen,[System.Drawing.Point[]]@([System.Drawing.Point]::new(128,38),[System.Drawing.Point]::new(210,85),[System.Drawing.Point]::new(210,174),[System.Drawing.Point]::new(128,220),[System.Drawing.Point]::new(46,174),[System.Drawing.Point]::new(46,85)))
$graphics.DrawLine($pen,46,85,128,133)
$graphics.DrawLine($pen,210,85,128,133)
$graphics.DrawLine($pen,128,133,128,220)
$bitmap.Save("$PSScriptRoot/../src-tauri/icons/icon.png",[System.Drawing.Imaging.ImageFormat]::Png)
$icon=[System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream=[System.IO.File]::Create("$PSScriptRoot/../src-tauri/icons/icon.ico")
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
$pen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
