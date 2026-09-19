#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $AgeExe)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot '..\scripts\backup\verify-owner-key.ps1'
$age = Get-Item -LiteralPath $AgeExe
$keygen = Join-Path $age.DirectoryName 'age-keygen.exe'
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('lino-key-test with spaces-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testDirectory
$before = @(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'lino-owner-key-*' | ForEach-Object Name)
$passed = 0

function Expect-Failure([scriptblock] $Action, [string] $Stage) {
    $failed = $false
    try { $null = & $Action }
    catch {
        $failed = $true
        if ($_.Exception.Message -notlike "*failed at: $Stage.*") {
            throw 'Failure did not report the expected safe stage.'
        }
        if ($_.Exception.Message -match 'AGE-SECRET-KEY-') { throw 'Private key appeared in failure output.' }
    }
    if (-not $failed) { throw 'Expected rejection did not occur.' }
}

try {
    $identity = Join-Path $testDirectory 'identity with spaces.txt'
    $otherIdentity = Join-Path $testDirectory 'other-identity.txt'
    # Keygen prints a public recipient to stderr on successful key generation.
    # Use redirected files so Windows PowerShell does not turn that into an error.
    foreach ($path in @($identity, $otherIdentity)) {
        $process = Start-Process -FilePath $keygen -ArgumentList @('-o', ('"' + $path + '"')) -PassThru -Wait -NoNewWindow -RedirectStandardError (Join-Path $testDirectory 'keygen.stderr') -RedirectStandardOutput (Join-Path $testDirectory 'keygen.stdout')
        if ($process.ExitCode -ne 0) { throw 'Disposable identity generation failed.' }
    }
    $recipient = (& $keygen -y $identity).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Disposable recipient derivation failed.' }
    $otherRecipient = (& $keygen -y $otherIdentity).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Disposable recipient derivation failed.' }
    $identityHash = (Get-FileHash -LiteralPath $identity -Algorithm SHA256).Hash

    $output = & $helper -ExpectedRecipient $recipient -IdentityPath $identity -AgeExe $age.FullName
    if (@($output).Count -ne 1) { throw 'Unexpected helper output.' }
    if ($output -match 'AGE-SECRET-KEY-') { throw 'Private key appeared in success output.' }
    $receipt = $output | ConvertFrom-Json
    if ($receipt.status -cne 'passed' -or $receipt.recipient -cne $recipient -or $receipt.production_data_used -ne $false -or $receipt.cloud_backup_restore_verified -ne $false) { throw 'Invalid success receipt.' }
    if ((Get-FileHash -LiteralPath $identity -Algorithm SHA256).Hash -cne $identityHash) { throw 'Identity file was changed.' }
    $passed++

    Expect-Failure { & $helper -ExpectedRecipient $otherRecipient -IdentityPath $identity -AgeExe $age.FullName } 'derive and compare public recipient'
    $passed++
    Expect-Failure { & $helper -ExpectedRecipient $recipient -IdentityPath (Join-Path $testDirectory 'missing.txt') -AgeExe $age.FullName } 'check prerequisites'
    $passed++
    Expect-Failure { & $helper -ExpectedRecipient $recipient -IdentityPath $identity -AgeExe (Join-Path $testDirectory 'missing.exe') } 'check prerequisites'
    $passed++
    $invalidIdentity = Join-Path $testDirectory 'invalid.txt'
    [IO.File]::WriteAllText($invalidIdentity, 'not an age identity')
    Expect-Failure { & $helper -ExpectedRecipient $recipient -IdentityPath $invalidIdentity -AgeExe $age.FullName } 'derive and compare public recipient'
    $passed++
    Expect-Failure { & $helper -ExpectedRecipient $recipient -IdentityPath $testDirectory -AgeExe $age.FullName } 'check prerequisites'
    $passed++

    $after = @(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'lino-owner-key-*' | ForEach-Object Name)
    if ((($before | Sort-Object) -join "`n") -cne (($after | Sort-Object) -join "`n")) { throw 'Helper temporary directory was left behind.' }
    $passed++
    Write-Output "Owner-key helper: $passed checks passed with disposable identities. Owner key not tested."
}
finally { Remove-Item -LiteralPath $testDirectory -Recurse -Force }
