Add-Type -AssemblyName System.Drawing

$src = 'C:\Users\David\AppData\Local\Temp\codex-clipboard-efd59379-cbfd-40b8-abb2-dc90b1a65b1f.jpg'
$outDir = 'F:\EspacioProgramacion\ClubManager\EntrenoLab\src\assets\brand'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir 'cdm-pizarrales-512.png'

$img = [System.Drawing.Bitmap]::FromFile($src)
$w = $img.Width; $h = $img.Height

# 1) Caja del contenido (círculo sobre fondo blanco). La caja debe estar
#    DENTRO del lienzo: recorremos con cuidado.
function IsNonWhite($p) { ($p.R -lt 245) -or ($p.G -lt 245) -or ($p.B -lt 245) }
$minX=$w; $minY=$h; $maxX=-1; $maxY=-1
for ($y=0; $y -lt $h; $y+=2) {
  for ($x=0; $x -lt $w; $x+=2) {
    if (IsNonWhite $img.GetPixel($x,$y)) {
      if ($x -lt $minX) {$minX=$x}
      if ($x -gt $maxX) {$maxX=$x}
      if ($y -lt $minY) {$minY=$y}
      if ($y -gt $maxY) {$maxY=$y}
    }
  }
}

# 2) Lado del círculo = max(ancho, alto) de la caja.
$bw = $maxX - $minX
$bh = $maxY - $minY
$side = [math]::Max($bw, $bh)
$cx = ($minX + $maxX) / 2.0
$cy = ($minY + $maxY) / 2.0

# 3) Caja cuadrada centrada en el círculo, con margen.
$pad = 6
$half = $side/2 + $pad
$cropL = [int][math]::Floor($cx - $half)
$cropT = [int][math]::Floor($cy - $half)
$cropS = [int][math]::Ceiling(2*$half)

# Clamp a los límites del lienzo.
if ($cropL -lt 0) { $cropS += $cropL; $cropL = 0 }
if ($cropT -lt 0) { $cropS += $cropT; $cropT = 0 }
if ($cropL + $cropS -gt $w) { $cropS = $w - $cropL }
if ($cropT + $cropS -gt $h) { $cropS = $h - $cropT }
# Exceso por la no-cuadratura: forzamos cuadrado mínimo válido dentro.
$avail = [math]::Min($w - $cropL, $h - $cropT)
$cropS = [math]::Min($cropS, $avail)

# 4) Escalar a 512.
$target = 512
$bmp = New-Object System.Drawing.Bitmap($target, $target, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Transparent)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$srcCrop = New-Object System.Drawing.Rectangle($cropL, $cropT, $cropS, $cropS)
$dst = New-Object System.Drawing.Rectangle(0, 0, $target, $target)
$g.DrawImage($img, $dst, $srcCrop, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
# $img sigue vivo hasta aquí; disponder al final.

# 5) Máscara circular: fuera del círculo -> transparente.
$radius = $cropS / 2.0
$center = $target / 2.0
for ($y=0; $y -lt $target; $y++) {
  for ($x=0; $x -lt $target; $x++) {
    $dx = $x + 0.5 - $center
    $dy = $y + 0.5 - $center
    $dist = [math]::Sqrt($dx*$dx + $dy*$dy)
    if ($dist -gt $radius) {
      $alpha = 0
      if ($dist -lt ($radius + 1.5)) {
        $alpha = [int](255 * (($radius + 1.5) - $dist) / 1.5)
        if ($alpha -lt 0) {$alpha=0}
        if ($alpha -gt 255) {$alpha=255}
      }
      $c = $bmp.GetPixel($x,$y)
      $bmp.SetPixel($x,$y,[System.Drawing.Color]::FromArgb($alpha,$c.R,$c.G,$c.B))
    }
  }
}
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$img.Dispose()
Write-Output "ESCUDO OK -> $out"
Write-Output "crop: L=$cropL T=$cropT S=$cropS (orig ${w}x${h}); circle side~$([math]::Round($side,1))"
