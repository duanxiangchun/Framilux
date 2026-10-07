<#
.SYNOPSIS
  按 models/manifest.json 下载 Framilux 的端侧模型权重。

.DESCRIPTION
  - 带 downloadUrl 的条目自动下载；没有的打印来源页，手动下载后放进 models/weights/ 再重跑本脚本登记。
  - 下载/登记后把 sha256 与字节数写入 models/lock.json，供构建期校验权重未被替换。
  - 权重目录不入 git（见 .gitignore）。

.EXAMPLE
  pwsh -File models/download.ps1 -DryRun

.EXAMPLE
  pwsh -File models/download.ps1
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$modelsDir    = $PSScriptRoot
$manifestPath = Join-Path $modelsDir 'manifest.json'
$weightsDir   = Join-Path $modelsDir 'weights'
$lockPath     = Join-Path $modelsDir 'lock.json'

if (-not (Test-Path -LiteralPath $manifestPath)) { throw "找不到 manifest: $manifestPath" }

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

$lock = @{}
if (Test-Path -LiteralPath $lockPath) {
    $existing = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
    foreach ($p in $existing.models.PSObject.Properties) { $lock[$p.Name] = $p.Value }
}

if (-not (Test-Path -LiteralPath $weightsDir)) {
    New-Item -ItemType Directory -Path $weightsDir | Out-Null
}

function Get-HfTfliteFiles {
    param([string]$Source)
    if ($Source -notmatch '^https://huggingface\.co/([^/]+/[^/?#]+)/?$') { return @() }
    $repo = $Matches[1]
    try {
        $info = Invoke-RestMethod -Uri ("https://huggingface.co/api/models/" + $repo) -TimeoutSec 20
        return @($info.siblings | ForEach-Object { $_.rfilename } | Where-Object { $_ -like '*.tflite' } | Sort-Object)
    } catch {
        return @()
    }
}

$downloaded = 0
$skipped    = 0
$manual     = 0

foreach ($m in $manifest.models) {
    $key = $m.id
    $url = $m.downloadUrl

    if ([string]::IsNullOrWhiteSpace($url)) {
        $cands = @(Get-HfTfliteFiles -Source $m.source)
        if ($cands.Count -gt 0) {
            $repo = ([uri]$m.source).AbsolutePath.Trim('/')
            Write-Host ("[手动] {0,-22} 候选权重（挑一个填进 manifest 的 downloadUrl 即可自动下载）：" -f $key) -ForegroundColor Yellow
            foreach ($c in $cands) {
                Write-Host ("       https://huggingface.co/" + $repo + "/resolve/main/" + $c) -ForegroundColor DarkYellow
            }
        } else {
            Write-Host ("[手动] {0,-22} 来源页: {1}" -f $key, $m.source) -ForegroundColor Yellow
        }
        $manual++
        continue
    }

    $fileName = [System.IO.Path]::GetFileName(([uri]$url).AbsolutePath)
    $dest     = Join-Path $weightsDir $fileName

    if ((Test-Path -LiteralPath $dest) -and (-not $Force)) {
        $hash     = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLower()
        $expected = $null
        if ($lock.ContainsKey($key)) { $expected = $lock[$key].sha256 }
        $bytes = (Get-Item -LiteralPath $dest).Length

        if ($expected -and ($hash -ne $expected)) {
            Write-Host ("[冲突] {0,-22} 现有文件与 lock.json 的 sha256 不一致；删除后重跑，或加 -Force" -f $key) -ForegroundColor Red
        } else {
            Write-Host ("[跳过] {0,-22} 已存在 {1:N1} MB" -f $key, ($bytes / 1MB)) -ForegroundColor DarkGray
            $lock[$key] = [pscustomobject]@{ file = $fileName; bytes = $bytes; sha256 = $hash; source = $url }
            $skipped++
        }
        continue
    }

    if ($DryRun) {
        Write-Host ("[计划] {0,-22} {1}" -f $key, $url) -ForegroundColor Cyan
        continue
    }

    try {
        Write-Host ("[下载] {0,-22} {1}" -f $key, $url) -ForegroundColor Green
        Invoke-WebRequest -Uri $url -OutFile $dest -MaximumRedirection 10
        $hash  = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLower()
        $bytes = (Get-Item -LiteralPath $dest).Length
        $lock[$key] = [pscustomobject]@{ file = $fileName; bytes = $bytes; sha256 = $hash; source = $url }
        Write-Host ("       完成 {0:N1} MB  sha256={1}..." -f ($bytes / 1MB), $hash.Substring(0, 16)) -ForegroundColor Green
        $downloaded++
    } catch {
        Write-Host ("[失败] {0,-22} {1}" -f $key, $_.Exception.Message) -ForegroundColor Red
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
    }
}

if (-not $DryRun) {
    $sorted = [ordered]@{}
    foreach ($k in ($lock.Keys | Sort-Object)) { $sorted[$k] = $lock[$k] }
    $json = [pscustomobject]@{
        generatedAt = (Get-Date).ToString('o')
        note        = 'sha256 用于构建期校验权重未被替换'
        models      = $sorted
    } | ConvertTo-Json -Depth 6
    Set-Content -LiteralPath $lockPath -Value $json -Encoding utf8
    Write-Host ("已写入 " + $lockPath) -ForegroundColor Green
}

Write-Host ""
Write-Host ("完成：下载 {0} / 跳过 {1} / 待手动 {2}" -f $downloaded, $skipped, $manual)
