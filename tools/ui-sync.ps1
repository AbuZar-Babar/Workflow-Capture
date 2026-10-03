$RepoPath = Split-Path -Parent $PSScriptRoot
$Branch = "feat/ui-ux-modernization"
$IntervalSeconds = 10

Set-Location $RepoPath

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Workflow Capture UI Sync" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Repository : $RepoPath"
Write-Host "Branch     : $Branch"
Write-Host "Interval   : ${IntervalSeconds}s"
Write-Host ""
Write-Host "Watching for new GitHub commits..."
Write-Host "Press Ctrl+C to stop."
Write-Host ""

while ($true) {
    try {
        # Don't touch the user's work if they have local changes.
        $status = git status --porcelain

        if ($status) {
            Write-Host "$(Get-Date -Format 'HH:mm:ss')  Local changes detected. Waiting..." -ForegroundColor Yellow
            Start-Sleep -Seconds $IntervalSeconds
            continue
        }

        # Get latest remote state without modifying the working tree.
        git fetch origin $Branch --quiet

        $local = git rev-parse HEAD
        $remote = git rev-parse "origin/$Branch"

        if ($local -ne $remote) {
            Write-Host "$(Get-Date -Format 'HH:mm:ss')  New commit detected!" -ForegroundColor Green

            git pull --ff-only origin $Branch

            if ($LASTEXITCODE -eq 0) {
                Write-Host "$(Get-Date -Format 'HH:mm:ss')  Pull successful." -ForegroundColor Green
                Write-Host ""
            }
            else {
                Write-Host "$(Get-Date -Format 'HH:mm:ss')  Pull failed. Stopping watcher." -ForegroundColor Red
                break
            }
        }

    }
    catch {
        Write-Host "$(Get-Date -Format 'HH:mm:ss')  Error: $($_.Exception.Message)" -ForegroundColor Red
    }

    Start-Sleep -Seconds $IntervalSeconds
}