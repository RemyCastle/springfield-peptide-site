# Weekly backup of the SPBC shop database (D1 springfieldpeps-db, iCloud Cloudflare account)
# to C:\Users\Remy\backups\springfield\d1-YYYY-MM-DD.sql. Nothing is ever deleted.
# Cloudflare also keeps its own point-in-time history (D1 Time Travel); this is an extra copy
# on Remy's computer.
#
# Run once by hand:    powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Remy\springfield-peptide-site\scripts\backup-d1.ps1
# Weekly (Sunday 12:00, runs late if the PC was asleep) - register once:
#   $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\Users\Remy\springfield-peptide-site\scripts\backup-d1.ps1'
#   $t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 12pm
#   $s = New-ScheduledTaskSettingsSet -StartWhenAvailable
#   Register-ScheduledTask -TaskName 'SPBC weekly database backup' -Action $a -Trigger $t -Settings $s

$ErrorActionPreference = 'Stop'
$dir = 'C:\Users\Remy\backups\springfield'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir ('d1-' + (Get-Date -Format 'yyyy-MM-dd') + '.sql')
$log = Join-Path $dir 'backup-log.txt'

Set-Location 'C:\Users\Remy\springfield-peptide-site'
try {
    npx wrangler d1 export springfieldpeps-db --remote --output $file 2>&1 | Out-Null
    if (-not (Test-Path $file) -or (Get-Item $file).Length -lt 1000) { throw "export file missing or tiny" }
    $kb = [math]::Round((Get-Item $file).Length / 1KB)
    Add-Content $log ("{0} ok {1} ({2} KB)" -f (Get-Date -Format s), $file, $kb)
} catch {
    Add-Content $log ("{0} FAILED: {1}" -f (Get-Date -Format s), $_.Exception.Message)
    exit 1
}
