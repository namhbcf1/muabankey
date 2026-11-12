$ErrorActionPreference = 'Continue'
$out = "C:\Users\ADMIN\Desktop\muabankey\_scratch\probe_out"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$P = 'https://xienhl.com'
$F = 'https://muabankey.bangachieu2.workers.dev'

# name | url | extra curl args
$reqs = @(
  @{ n='spa_primary';      u="$P/";                                     h=@() },
  @{ n='spa_fallback';     u="$F/";                                     h=@() },
  @{ n='noSlash_primary';  u="$P/nope";                                 h=@() },
  @{ n='wh_primary';       u="$P/api/webhooks/health";                  h=@() },
  @{ n='wh_fallback';      u="$F/api/webhooks/health";                  h=@() },
  @{ n='appversion';       u="$P/api/app/version";                      h=@() },
  @{ n='appversion_fb';    u="$F/api/app/version";                      h=@() },
  @{ n='lic_health';       u="$P/api/license/health";                   h=@() },
  @{ n='products';         u="$P/api/products";                         h=@() },
  @{ n='categories';       u="$P/api/categories";                       h=@() },
  @{ n='stats';            u="$P/api/stats";                            h=@() },
  @{ n='health';           u="$P/api/health";                           h=@() },
  @{ n='xg_health';        u="$P/api/xg/health";                        h=@() },
  @{ n='inst_json';        u="$P/i/AOE1-0000-0000-0000";                h=@() },
  @{ n='inst_cmd';         u="$P/i/AOE1-0000-0000-0000.cmd";            h=@() },
  @{ n='inst_ps1';         u="$P/i/AOE1-0000-0000-0000.ps1";            h=@() },
  @{ n='inst_cmd_fb';      u="$F/i/AOE1-0000-0000-0000.cmd";            h=@() },
  @{ n='exe_range';        u="$P/download/xa_nofog_pro.exe";            h=@('-H','Range: bytes=0-63') },
  @{ n='api404';           u="$P/api/does-not-exist";                   h=@() },
  @{ n='api404_fb';        u="$F/api/does-not-exist";                   h=@() },
  @{ n='method_probe';     u="$P/api/webhooks/health";                  h=@() }
)

$results = @()

foreach ($r in $reqs) {
  $bodyFile = Join-Path $out ($r.n + '.body')
  $hdrFile  = Join-Path $out ($r.n + '.hdr')
  $cargs = @('-s','-S','--max-time','25','--max-filesize','200000','-o',$bodyFile,'-D',$hdrFile,
            '-w','%{http_code}|%{time_total}|%{size_download}|%{content_type}|%{num_redirects}|%{url_effective}')
  $cargs += $r.h
  $cargs += $r.u
  $line = & curl.exe @cargs 2>&1 | Out-String
  $line = $line.Trim()
  $parts = $line -split '\|'
  $results += [pscustomobject]@{
    name    = $r.n
    raw     = $line
    code    = if ($parts.Count -ge 5) { $parts[0] } else { 'ERR' }
    secs    = if ($parts.Count -ge 5) { $parts[1] } else { '' }
    bytes   = if ($parts.Count -ge 5) { $parts[2] } else { '' }
    ctype   = if ($parts.Count -ge 5) { $parts[3] } else { '' }
    redirect= if ($parts.Count -ge 5) { $parts[4] } else { '' }
    url     = $r.u
    bodyf   = $bodyFile
    hdrf    = $hdrFile
  }
}

$results | Select-Object name, code, @{n='ms';e={ if($_.secs){[int]([double]$_.secs*1000)}else{''} }}, bytes, ctype, url |
  Format-Table -AutoSize | Out-String -Width 240

"=== BODY PREVIEWS ==="
foreach ($res in $results) {
  $b = ''
  if (Test-Path $res.bodyf) { $b = [System.IO.File]::ReadAllText($res.bodyf) }
  $prev = if ($b.Length -gt 700) { $b.Substring(0,700) } else { $b }
  $prev = $prev -replace "`r",'' -replace "`n",'\n'
  "----- $($res.name) [$($res.code)] len=$($b.Length) -----"
  $prev
  ""
}
