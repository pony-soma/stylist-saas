#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$')]
    [string] $ExpectedRecipient,
    [string] $IdentityPath = (Join-Path $env:USERPROFILE 'LiNo-backup-keys\backup-key.txt'),
    [string] $AgeExe
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$temporaryDirectory = $null
$ownsTemporaryDirectory = $false
$step = 'check prerequisites'

function ConvertTo-NativeArgument([string] $Value) {
    # Windows CommandLineToArgvW escaping, also understood by ProcessStartInfo.
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-AgeBinary([string] $Executable, [string[]] $Arguments) {
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $Executable
    $start.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Executable did not start.' }
        # This check requires an existing unencrypted age identity file; it never
        # prompts for, stores or passes a password through a command line.
        $process.StandardInput.Close()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(60000)) {
            $process.Kill()
            $process.WaitForExit()
            throw 'Executable timed out.'
        }
        $output = $stdout.GetAwaiter().GetResult()
        $null = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'Executable returned a failure.' }
        return $output
    }
    finally { $process.Dispose() }
}

try {
    $identity = Get-Item -LiteralPath $IdentityPath -Force
    if ($identity.PSIsContainer) { throw 'Identity must be a file.' }
    if ([string]::IsNullOrWhiteSpace($AgeExe)) {
        $command = Get-Command age.exe, age -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -eq $command) { throw 'age executable was not found.' }
        $AgeExe = $command.Source
    }
    $age = Get-Item -LiteralPath $AgeExe -Force
    if ($age.PSIsContainer) { throw 'age executable must be a file.' }
    $keygenName = 'age-keygen'
    if ($age.Extension -eq '.exe') { $keygenName = 'age-keygen.exe' }
    $keygen = Get-Item -LiteralPath (Join-Path $age.DirectoryName $keygenName) -Force
    if ($keygen.PSIsContainer) { throw 'age-keygen executable must be a file.' }

    $step = 'derive and compare public recipient'
    $recipient = (Invoke-AgeBinary $keygen.FullName @('-y', $identity.FullName)).Trim()
    if ($recipient -cne $ExpectedRecipient) { throw 'Configured public recipient does not match.' }

    $step = 'create random dummy data'
    $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('lino-owner-key-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $temporaryDirectory
    $ownsTemporaryDirectory = $true
    $inputFile = Join-Path $temporaryDirectory 'dummy.bin'
    $encryptedFile = Join-Path $temporaryDirectory 'dummy.age'
    $restoredFile = Join-Path $temporaryDirectory 'restored.bin'
    $bytes = New-Object byte[] 256
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    [System.IO.File]::WriteAllBytes($inputFile, $bytes)

    $step = 'encrypt random dummy data'
    $null = Invoke-AgeBinary $age.FullName @('--encrypt', '--recipient', $ExpectedRecipient, '--output', $encryptedFile, $inputFile)
    $step = 'decrypt random dummy data'
    $null = Invoke-AgeBinary $age.FullName @('--decrypt', '--identity', $identity.FullName, '--output', $restoredFile, $encryptedFile)
    $step = 'compare restored dummy data'
    $originalHash = (Get-FileHash -LiteralPath $inputFile -Algorithm SHA256).Hash
    $restoredHash = (Get-FileHash -LiteralPath $restoredFile -Algorithm SHA256).Hash
    if ($originalHash -cne $restoredHash) { throw 'Restored data does not match.' }

    # Clean up before reporting success, so a cleanup error cannot look successful.
    $step = 'remove temporary dummy files'
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    $temporaryDirectory = $null
    $ownsTemporaryDirectory = $false
    [ordered]@{
        check = 'lino-owner-key-roundtrip-v1'
        status = 'passed'
        recipient = $ExpectedRecipient
        verified_at = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
        production_data_used = $false
        cloud_backup_restore_verified = $false
    } | ConvertTo-Json -Compress
}
catch {
    # Do not print native output, identity contents, or exception details.
    throw "LiNo owner-key check failed at: $step. No production backup was tested."
}
finally {
    if ($ownsTemporaryDirectory -and $null -ne $temporaryDirectory -and (Test-Path -LiteralPath $temporaryDirectory)) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
