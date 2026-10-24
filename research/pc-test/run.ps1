# PC test harness: run the OmoriSource in-game test driver (same one the device runner uses)
# under NW.js 0.29.0 on this PC.
#
# Usage: run.ps1 <startup|perf|room|verify> [options]
#   startup   launch to the title screen, then quit: startup time, heap and RSS (~25 s)
#   perf      heavy maps (default 14:45:44,111:15:25,87:27:27), fps / frame time / shots per map
#   room      one map (--room MAP:X:Y), optionally --walk or --sweep STEP
#   verify    sprite patch on vs off: cutscene waits and camera-jump captures per map
#   trace     one map (--room MAP:X:Y), deterministically scripted; records one JSONL line of
#             game state per logic step to <variant>/trace.jsonl. Two runs of the same script
#             must produce byte-identical traces; compare with research/pc-test/trace-diff.js.
#             A/B a runtime patch: --variant base --variant nopatch:OMORI_PERF_SPRITES=0
#
# Options (same meaning as research/pmjs-performance/omori-test.sh on the device):
#   --maps LIST            perf/verify maps, "id" or "id:x:y", comma-separated
#   --room MAP:X:Y         room mode map (default 14:45:44)
#   --walk                 room mode: the player walks a loop during the measurement
#   --sweep STEP           room mode: camera on a grid STEP tiles apart, one measurement per point
#   --settle S             seconds after arrival before measuring (default 18)
#   --measure S            seconds per measurement (default 8)
#   --patch on,off         sprite patch state per measurement phase (loads
#                          launcher/omori-performance.js, as the device menu launcher does)
#   --steps N              trace mode: logic steps to record (env OMORI_TEST_TRACE_STEPS)
#   --variant NAME[:K=V,...]
#                          one launch per variant with extra environment (repeatable; values
#                          become plain environment variables and may override the harness
#                          defaults, e.g. --variant base --variant nopatch:OMORI_PERF_SPRITES=0)
#   --shots                save PNG captures of each measurement window
#   --profile              V8 CPU profile of each measurement (<variant>/profiles/)
#   --census               before each measurement, a scene-tree census and calls per frame
#   --timeout S            per launch (default 300); the process is killed if it runs over
#   --out DIR              output directory (default out/<date>-<mode>)
#
# How it works:
# * The NW.js runtime is linked from build/windows/ into .nwjs/ (hard links, no package.json
#   next to OMORI.exe, so the app-directory argument is honored as the README documents).
# * .app/ is a minimal app folder: the repository package.json plus junctions to project/,
#   launcher/ and research/, so the game runs from the byte-identical project/ files with the
#   current launcher/compat.js (which loads launcher/omori-performance.js and
#   research/pmjs-performance/omori-test.js per environment variables).
# * project/save/ is copied to a backup in the output directory before each launch and put back
#   afterwards: the game writes config.rpgsave/TITLEDATA there on exit (it would otherwise be in
#   the player's project/save/ folder; the game files outside save/ are never written).
# * LOCALAPPDATA points into the output directory, so CUTSCENE.json/TITLEDATA under
#   %LOCALAPPDATA%\OMORI and the NW.js Chromium profile don't touch the user's real ones.
# * Results print as "[omori-test] {json}" lines (from the driver's sink file, written via the
#   page's Node fs; the same lines also go through the Chromium logger to <variant>/nw.log).

$ErrorActionPreference = 'Stop'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$OmoriSource = (Resolve-Path (Join-Path $Here '..\..')).Path

$Usage = @'
usage: run.ps1 <startup|perf|room|verify|trace> [--maps LIST] [--room MAP:X:Y] [--walk] [--sweep STEP]
                 [--steps N] [--settle S] [--measure S] [--patch on,off] [--variant NAME[:K=V,...]]
                 [--shots] [--profile] [--census] [--timeout S] [--out DIR]
'@

# ---------------------------------------------------------------- arguments
if ($args.Count -lt 1) { Write-Output $Usage; exit 2 }
$Mode = $args[0]
if ('startup', 'perf', 'room', 'verify', 'trace' -notcontains $Mode) { Write-Output $Usage; exit 2 }

$Maps = ''; $Room = ''; $Walk = ''; $Sweep = ''; $Settle = ''; $Measure = ''; $Patch = ''; $Steps = ''
$Shots = $false; $Profile = $false; $Census = ''; $Timeout = 300; $OutDir = ''
$Variants = @()
for ($i = 1; $i -lt $args.Count; $i++) {
    $a = $args[$i]
    if     ($a -eq '--maps')    { $Maps = $args[++$i] }
    elseif ($a -eq '--room')    { $Room = $args[++$i] }
    elseif ($a -eq '--walk')    { $Walk = '1' }
    elseif ($a -eq '--sweep')   { $Sweep = $args[++$i] }
    elseif ($a -eq '--settle')  { $Settle = $args[++$i] }
    elseif ($a -eq '--measure') { $Measure = $args[++$i] }
    elseif ($a -eq '--patch')   { $Patch = $args[++$i] }
    elseif ($a -eq '--steps')   { $Steps = $args[++$i] }
    elseif ($a -eq '--shots')   { $Shots = $true }
    elseif ($a -eq '--profile') { $Profile = $true }
    elseif ($a -eq '--census')  { $Census = '1' }
    elseif ($a -eq '--timeout') { $Timeout = [int]($args[++$i]) }
    elseif ($a -eq '--out')     { $OutDir = $args[++$i] }
    elseif ($a -eq '--variant') { $Variants += $args[++$i] }
    else { Write-Output "run.ps1: unknown option $a"; Write-Output $Usage; exit 2 }
}
if ($Variants.Count -eq 0) { $Variants = @('base') }

$Build = Join-Path $OmoriSource 'build\windows'
if (-not (Test-Path (Join-Path $Build 'OMORI.exe'))) {
    Write-Output "run.ps1: no OMORI.exe runtime in build/windows; run: python tools/build.py"
    exit 2
}

$RuntimeDir = Join-Path $Here '.nwjs'
$AppDir = Join-Path $Here '.app'
if (-not $OutDir) { $OutDir = Join-Path $Here ('out\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $Mode) }

# ---------------------------------------------------------------- safe tree removal
# Remove-Item -Recurse can recurse INTO junctions on older PowerShell; delete junctions
# explicitly so the linked repositories are never touched.
function Remove-Tree([string]$Path) {
    if ([string]::IsNullOrEmpty($Path) -or -not (Test-Path $Path)) { return }
    Get-ChildItem -LiteralPath $Path -Force | ForEach-Object {
        try {
            if ($_.PSIsContainer) {
                if ($_.LinkType) { [System.IO.Directory]::Delete($_.FullName, $false) }
                else { Remove-Tree $_.FullName }
            } else { $_.Delete() }
        } catch {}
    }
    [System.IO.Directory]::Delete($Path)
}
# ---------------------------------------------------------------- links
function New-HardLink([string]$Link, [string]$Target) {
    try { New-Item -ItemType HardLink -Path $Link -Target $Target -ErrorAction Stop | Out-Null }
    catch {
        cmd.exe /c "mklink /H `"$Link`" `"$Target`"" | Out-Null
        if (-not (Test-Path $Link)) { Copy-Item -LiteralPath $Target -Destination $Link }
    }
}
function New-DirJunction([string]$Link, [string]$Target) {
    try { New-Item -ItemType Junction -Path $Link -Target $Target -ErrorAction Stop | Out-Null }
    catch {
        cmd.exe /c "mklink /J `"$Link`" `"$Target`"" | Out-Null
        if (-not (Test-Path $Link)) { throw "junction failed: $Link -> $Target" }
    }
}
function Copy-HardTree([string]$Source, [string]$Target) {
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        $dst = Join-Path $Target $_.Name
        if ($_.PSIsContainer) { Copy-HardTree $_.FullName $dst }
        else { New-HardLink $dst $_.FullName }
    }
}

# ---------------------------------------------------------------- prepare directories
Write-Output "== runtime from $Build -> $RuntimeDir"
try { Remove-Tree $RuntimeDir } catch { Write-Output "run.ps1: could not clear .nwjs, using it as is" }
New-Item -ItemType Directory -Force -Path $RuntimeDir, $OutDir | Out-Null
$Skip = @('package.json', 'launcher', 'www')
foreach ($item in (Get-ChildItem -LiteralPath $Build -Force)) {
    if ($Skip -contains $item.Name) { continue }
    if ($item.PSIsContainer) { Copy-HardTree $item.FullName (Join-Path $RuntimeDir $item.Name) }
    else { New-HardLink (Join-Path $RuntimeDir $item.Name) $item.FullName }
}

Write-Output "== app folder -> $AppDir"
Remove-Tree $AppDir
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
foreach ($name in 'project', 'launcher', 'research') {
    New-DirJunction (Join-Path $AppDir $name) (Join-Path $OmoriSource $name)
}
# The app manifest is the repository package.json plus stderr logging of browser console output
# (console messages carry the same "[omori-test]" lines the sink file has).
$manifest = Get-Content (Join-Path $OmoriSource 'package.json') -Raw | ConvertFrom-Json
if ($manifest.'chromium-args') { $manifest.'chromium-args' += ' --enable-logging=stderr' }
else { $manifest | Add-Member -NotePropertyName 'chromium-args' -NotePropertyValue '--enable-logging=stderr' }
$json = $manifest | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $AppDir 'package.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

# ---------------------------------------------------------------- run
# Clear variables the runs must not inherit from the calling shell.
'OMORI_TEST_CALLS_MATCH', 'OMORI_COMPAT_DEBUG', 'OMORI_FPS_LOG', 'OMORI_FPS_DIR', 'OMORI_TEST_MODE' | ForEach-Object {
    Remove-Item "Env:$_" -ErrorAction SilentlyContinue
}

# Keep the player's saves byte-identical: the game writes config.rpgsave / TITLEDATA into
# project/save on exit. Backed up per launch and put back afterwards.
$SaveDir = Join-Path $OmoriSource 'project\save'
$SaveBackup = Join-Path $OutDir 'save-backup'
if (Test-Path $SaveDir) { Copy-Item -Recurse -Force -Path $SaveDir -Destination $SaveBackup }

$Exe = Join-Path $RuntimeDir 'OMORI.exe'
foreach ($variant in $Variants) {
    $Name = $variant.Split(':')[0]
    $VDir = Join-Path $OutDir $Name
    New-Item -ItemType Directory -Force -Path $VDir | Out-Null

    $env:OMORI_TEST_MODE   = $Mode
    $env:OMORI_TEST_MAPS   = $Maps
    $env:OMORI_TEST_ROOM   = $Room
    $env:OMORI_TEST_WALK   = $Walk
    $env:OMORI_TEST_SWEEP  = $Sweep
    $env:OMORI_TEST_SETTLE = $Settle
    $env:OMORI_TEST_MEASURE = $Measure
    $env:OMORI_TEST_PATCH  = $Patch
    $env:OMORI_TEST_CENSUS = $Census
    $env:OMORI_TEST_TRACE_STEPS = $Steps
    Remove-Item 'Env:OMORI_TEST_CALLS_MATCH' -ErrorAction SilentlyContinue
    # The launcher always runs the performance patch except in startup mode (--variant may override).
    $env:OMORI_PERF_SPRITES = if ($Mode -eq 'startup') { '' } else { '1' }
    if ($variant.Contains(':')) {
        $pairs = $variant.Substring($variant.IndexOf(':') + 1).Split(',')
        foreach ($pair in $pairs) {
            if ($pair) {
                $k = $pair.Split('=')[0].Trim()
                $v = $pair.Substring($pair.IndexOf('=') + 1)
                if ($v -eq '') { Remove-Item "Env:$k" -ErrorAction SilentlyContinue } else { Set-Item "Env:$k" $v }
            }
        }
    }
    # Isolate the user's %LOCALAPPDATA% (OMORI permanent data + the NW.js browser profile).
    $DataDir = Join-Path $VDir 'data'
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $env:LOCALAPPDATA = $DataDir
    $env:XDG_DATA_HOME = $DataDir
    $env:OMORI_FPS_DIR = New-Item -ItemType Directory -Force -Path (Join-Path $VDir 'fps') | Select-Object -ExpandProperty FullName
    $env:OMORI_TEST_SINK = Join-Path $VDir 'omori-test.jsonl'
    # trace mode writes its per-step JSONL here (diff with research/pc-test/trace-diff.js).
    $env:OMORI_TEST_TRACE = Join-Path $VDir 'trace.jsonl'
    if ($Mode -eq 'trace') { Remove-Item $env:OMORI_TEST_TRACE -ErrorAction SilentlyContinue } else { Remove-Item 'Env:OMORI_TEST_TRACE' -ErrorAction SilentlyContinue }
    $env:OMORI_TEST_SHOTS = $ShotsDir = if ($Shots) { Join-Path $VDir 'shots' } else { '' }
    $env:OMORI_TEST_PROFILE = $ProfileDir = if ($Profile) { Join-Path $VDir 'profiles' } else { '' }
    Remove-Item $env:OMORI_TEST_SINK -ErrorAction SilentlyContinue

    $StdErr = Join-Path $VDir 'nw.log'
    $StdOut = Join-Path $VDir 'nw-stdout.log'
    $Timer = [System.Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath $Exe -WorkingDirectory $RuntimeDir `
        -ArgumentList ('"' + $AppDir + '"') `
        -RedirectStandardOutput $StdOut -RedirectStandardError $StdErr -PassThru
    $TimedOut = $false
    try { Wait-Process -Id $p.Id -Timeout $Timeout -ErrorAction Stop }
    catch {
        if (-not $p.HasExited) { $TimedOut = $true; cmd.exe /c "taskkill /PID $($p.Id) /T /F" 2>&1 | Out-Null }
    }
    $Timer.Stop()

    $Header = '== {0} / {1}  {2:N0}s' -f $Mode, $Name, $Timer.Elapsed.TotalSeconds
    if ($TimedOut) { $Header += '  TIMED OUT' }
    Write-Output $Header
    if (Test-Path $env:OMORI_TEST_SINK) { Get-Content $env:OMORI_TEST_SINK }
    else {
        Write-Output 'no sink file; [omori-test] lines from the stderr log, if any:'
        if (Test-Path $StdErr) {
            Get-Content $StdErr | Select-String -Pattern '\[omori-test\]' | ForEach-Object { $_.Line }
        }
    }
    if (-not (Test-Path $env:OMORI_TEST_SINK) -and -not (Test-Path $StdErr)) {
        Write-Output 'no output at all: the launch may have failed (check the exe and the app folder)'
    }
    Write-Output "logs: $VDir"
}

# Restore the player's saves exactly as they were.
if (Test-Path $SaveBackup) {
    Remove-Tree $SaveDir
    Copy-Item -Recurse -Force -Path $SaveBackup -Destination $SaveDir
}
