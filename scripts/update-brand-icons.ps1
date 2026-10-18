param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string[]]$Repositories = @((Split-Path $PSScriptRoot -Parent))
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$original = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $Source).Path)
try {
  if ($original.Width -ne $original.Height -or $original.GetPixel(0, 0).A -ne 0) {
    throw 'Expected a square PNG with transparent background.'
  }
  $sizes = @{
    'virelo-icon.png' = 512
    'virelo-icon-512.png' = 512
    'virelo-icon-192.png' = 192
    'virelo-icon-180.png' = 180
    'favicon-48.png' = 48
    'favicon-32.png' = 32
  }
  foreach ($repository in $Repositories) {
    $public = (Resolve-Path -LiteralPath (Join-Path $repository 'web/public')).Path
    foreach ($name in $sizes.Keys) {
      $size = $sizes[$name]
      $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
        try {
          $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
          $graphics.DrawImage($original, [System.Drawing.Rectangle]::new(0, 0, $size, $size), 0, 0, $original.Width, $original.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
        } finally { $attributes.Dispose() }
        $bitmap.Save((Join-Path $public $name), [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
      }
      Write-Output "$public/$name ($size x $size, transparent)"
    }
  }
} finally { $original.Dispose() }
