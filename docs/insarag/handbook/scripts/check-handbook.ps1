param(
    [string]$PythonPath,
    [string]$ZhtwCommand,
    [switch]$Offline,
    [switch]$SelfTest
)
$ErrorActionPreference = 'Stop'
# Prefer the bundled runtime to avoid Windows Store launcher aliases.
if (-not $PythonPath) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) {
        $PythonPath = $bundledPython
    } else {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if ($pythonCommand -and $pythonCommand.Source -notmatch 'WindowsApps') {
            $PythonPath = $pythonCommand.Source
        } else {
            throw 'Python 3.10+ is required. Supply -PythonPath with the executable path.'
        }
    }
}
if (-not $ZhtwCommand -and -not $Offline -and -not $SelfTest) {
    $mcpCommand = Get-Command zhtw-mcp -ErrorAction SilentlyContinue
    if ($mcpCommand) {
        $ZhtwCommand = $mcpCommand.Source
    } else {
        $localMcp = Join-Path $env:USERPROFILE '.local\bin\zhtw-mcp.exe'
        if (Test-Path -LiteralPath $localMcp) {
            $ZhtwCommand = $localMcp
        }
    }
}
$checker = Join-Path $PSScriptRoot 'check_handbook.py'
$handbookRoot = Split-Path -Parent $PSScriptRoot
$checkArguments = @($checker)
if ($SelfTest) {
    $checkArguments += '--selftest'
} else {
    $checkArguments += @('--report', (Join-Path $handbookRoot 'check-report.json'))
    if ($Offline) { $checkArguments += '--offline' }
    if ($ZhtwCommand) { $checkArguments += @('--zhtw-command', $ZhtwCommand) }
}
& $PythonPath @checkArguments
exit $LASTEXITCODE
