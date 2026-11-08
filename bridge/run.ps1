# Keeps the bridge running: if it crashes (for example after a database update), it starts again in 3 seconds.
# Run from the bridge folder:  .\run.ps1      Stop: press Ctrl+C (twice if needed).
while ($true) {
  npm start
  Write-Host "bridge stopped. Restarting in 3 seconds (Ctrl+C to quit)..."
  Start-Sleep -Seconds 3
}
