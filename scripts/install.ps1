[CmdletBinding()]
param(
    [string]$InstallDir = $(if ($env:PODIUM_INSTALL_DIR) { $env:PODIUM_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Podium\bin" }),
    [string]$Version = $(if ($env:PODIUM_VERSION) { $env:PODIUM_VERSION } else { "latest" })
)

$ErrorActionPreference = "Stop"
$repository = "oduan/podium"

$runtimeArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
switch ($runtimeArch) {
    "x64" { $arch = "amd64" }
    "arm64" { $arch = "arm64" }
    default { throw "Unsupported Windows architecture: $runtimeArch" }
}

$asset = "podium-windows-$arch.zip"
if ($env:PODIUM_DOWNLOAD_BASE_URL) {
    $downloadBase = $env:PODIUM_DOWNLOAD_BASE_URL.TrimEnd("/")
} elseif ($Version -eq "latest") {
    $downloadBase = "https://github.com/$repository/releases/latest/download"
} else {
    $downloadBase = "https://github.com/$repository/releases/download/$Version"
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("podium-install-" + [guid]::NewGuid().ToString("N"))
$archive = Join-Path $tempDir $asset
$checksums = Join-Path $tempDir "checksums.txt"
$extractDir = Join-Path $tempDir "extract"

try {
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

    Write-Host "Downloading Podium $Version for windows/$arch..."
    Invoke-WebRequest -UseBasicParsing -Uri "$downloadBase/$asset" -OutFile $archive
    Invoke-WebRequest -UseBasicParsing -Uri "$downloadBase/checksums.txt" -OutFile $checksums

    $escapedAsset = [regex]::Escape($asset)
    $checksumLine = Get-Content -LiteralPath $checksums | Where-Object {
        $_ -match "^[A-Fa-f0-9]{64}\s+\*?$escapedAsset$"
    } | Select-Object -First 1

    if (-not $checksumLine) {
        throw "Checksum not found for $asset"
    }

    $expected = ($checksumLine -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "Checksum verification failed for $asset"
    }

    Expand-Archive -LiteralPath $archive -DestinationPath $extractDir -Force
    $source = Join-Path $extractDir "podium.exe"
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Release archive does not contain podium.exe"
    }

    $resolvedInstallDir = [System.IO.Path]::GetFullPath($InstallDir)
    New-Item -ItemType Directory -Force -Path $resolvedInstallDir | Out-Null
    $target = Join-Path $resolvedInstallDir "podium.exe"
    Copy-Item -LiteralPath $source -Destination $target -Force

    if ($env:PODIUM_NO_PATH_UPDATE -ne "1") {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $pathEntries = @($userPath -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $alreadyOnPath = $pathEntries | Where-Object {
            [string]::Equals($_.TrimEnd("\"), $resolvedInstallDir.TrimEnd("\"), [StringComparison]::OrdinalIgnoreCase)
        }

        if (-not $alreadyOnPath) {
            $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) {
                $resolvedInstallDir
            } else {
                "$userPath;$resolvedInstallDir"
            }
            [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
        }

        if (-not (($env:Path -split ";") -contains $resolvedInstallDir)) {
            $env:Path = "$env:Path;$resolvedInstallDir"
        }
    }

    Write-Host "Installed Podium to $target"
    Write-Host "Open a new terminal and run: podium"
} finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
