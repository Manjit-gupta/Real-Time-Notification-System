# Test 3 - Horizontal Scaling Test
# Runs 1, 2, 3 app instances behind nginx + Redis adapter

Set-StrictMode -Off
$ProjectDir = Split-Path -Parent $PSScriptRoot
$K6         = "C:\Program Files\k6\k6.exe"
$BaseUrl    = "http://localhost:4000"
$OutputDir  = Join-Path $PSScriptRoot "scaling-results"

Set-Location $ProjectDir
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

function Wait-ForHealth {
    param([int]$MaxWait = 90)
    Write-Host "  Waiting for app (up to ${MaxWait}s)..."
    $deadline = (Get-Date).AddSeconds($MaxWait)
    while ((Get-Date) -lt $deadline) {
        try {
            $req = [System.Net.HttpWebRequest]::Create("$BaseUrl/login")
            $req.Method = "POST"; $req.ContentType = "application/json"; $req.Timeout = 2000
            $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"email":"x","password":"y"}')
            $req.ContentLength = $bytes.Length
            $req.GetRequestStream().Write($bytes,0,$bytes.Length)
            try { $req.GetResponse() | Out-Null } catch [System.Net.WebException] {
                if ([int]$_.Exception.Response.StatusCode -eq 400) {
                    Write-Host "  App is ready."; return
                }
            }
        } catch {}
        Start-Sleep -Seconds 2
    }
    throw "App did not become healthy within ${MaxWait}s"
}

function Get-Token {
    param([string]$Email,[string]$Password)
    $body = [System.Text.Encoding]::UTF8.GetBytes("{`"email`":`"$Email`",`"password`":`"$Password`"}")
    try {
        $r=[System.Net.HttpWebRequest]::Create("$BaseUrl/signup"); $r.Method="POST"; $r.ContentType="application/json"
        $r.ContentLength=$body.Length; $r.GetRequestStream().Write($body,0,$body.Length)
        try { $r.GetResponse() | Out-Null } catch {}
    } catch {}
    $sess=New-Object System.Net.CookieContainer
    $req=[System.Net.HttpWebRequest]::Create("$BaseUrl/login"); $req.Method="POST"; $req.ContentType="application/json"
    $req.CookieContainer=$sess; $req.ContentLength=$body.Length; $req.GetRequestStream().Write($body,0,$body.Length)
    try { $req.GetResponse() | Out-Null } catch {}
    return ($sess.GetCookies([uri]$BaseUrl) | Where-Object { $_.Name -eq "token" }).Value
}

function Get-UserId {
    param([string]$Token)
    $parts=$Token -split '\.'; $pad=$parts[1].Length % 4
    if ($pad) { $parts[1]+='='*(4-$pad) }
    return ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1])) | ConvertFrom-Json).userId
}

function Parse-K6Summary {
    param([string]$JsonPath)
    if (-not (Test-Path $JsonPath)) { return $null }
    try {
        $raw=Get-Content $JsonPath -Raw | ConvertFrom-Json
        return [PSCustomObject]@{
            TotalRequests=[int]$raw.metrics.http_reqs.values.count
            Throughput   =[math]::Round($raw.metrics.http_reqs.values.rate,2)
            AvgMs        =[math]::Round($raw.metrics.http_req_duration.values.avg,2)
            P90Ms        =[math]::Round($raw.metrics.http_req_duration.values.'p(90)',2)
            P95Ms        =[math]::Round($raw.metrics.http_req_duration.values.'p(95)',2)
            ErrorRate    =[math]::Round($raw.metrics.http_req_failed.values.rate*100,2)
        }
    } catch { Write-Warning "Parse error: $_"; return $null }
}

Write-Host "[BUILD] Building app image..."
docker compose build app

Write-Host "[INFRA] Starting mongo + redis..."
docker compose up -d mongo redis
Start-Sleep -Seconds 8

$Results=[System.Collections.Generic.List[object]]::new()

foreach ($N in 1,2,3) {
    Write-Host ""
    Write-Host "=== SCALING TEST - $N instance(s) ==="

    docker compose up -d --scale app=$N
    Start-Sleep -Seconds 5
    docker compose restart nginx
    Start-Sleep -Seconds 8

    Wait-ForHealth

    $actorToken=Get-Token -Email "scale.actor@test.com" -Password "Scale@Test99"
    $recipToken=Get-Token -Email "scale.recip@test.com"  -Password "Scale@Test99"
    if (-not $actorToken -or -not $recipToken) { Write-Warning "No tokens, skipping"; continue }
    $recipId=Get-UserId -Token $recipToken
    Write-Host "  Recipient: $recipId"

    $sf=Join-Path $OutputDir "summary_${N}inst.json"
    Write-Host "  Running k6..."
    & $K6 run --env "TOKEN=$actorToken" --env "RECIPIENT_ID=$recipId" --env "BASE_URL=$BaseUrl" --summary-export "$sf" (Join-Path $PSScriptRoot "scaling-load-test.js") 2>&1

    $stats=Parse-K6Summary -JsonPath $sf
    if ($stats) {
        $stats | Add-Member -NotePropertyName Instances -NotePropertyValue $N
        $Results.Add($stats)
        Write-Host "  -> $($stats.TotalRequests) reqs | $($stats.Throughput) req/s | P95=$($stats.P95Ms)ms | Errors=$($stats.ErrorRate)%"
    }
}

Write-Host "[CLEANUP] Stopping..."
docker compose down

Write-Host ""
Write-Host "==================================================="
Write-Host "  SCALING TEST SUMMARY"
Write-Host "==================================================="
Write-Host ("  {0,-10} {1,-14} {2,-10} {3,-10} {4,-8}" -f "Instances","Throughput","Avg","P95","Errors")
foreach ($r in $Results) {
    Write-Host ("  {0,-10} {1,-14} {2,-10} {3,-10} {4,-8}" -f $r.Instances,"$($r.Throughput) req/s","$($r.AvgMs)ms","$($r.P95Ms)ms","$($r.ErrorRate)%")
}
Write-Host "==================================================="

$Results | ConvertTo-Json | Out-File (Join-Path $OutputDir "all_results.json") -Encoding UTF8
Write-Host "JSON saved to $OutputDir"