[CmdletBinding()]
param(
    [switch]$PreflightOnly,
    [int]$CooldownScalePercent = 100
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = 'KIMI K3 压测'
$JMeterHome = 'apache-jmeter-5.6.3'
$JMeter = Join-Path $JMeterHome 'bin\jmeter.bat'
$Jmx = Join-Path $Root 'JMeter脚本\KIMI-K3-API性能压测.jmx'
$ApiKey = 'sk-REPLACE_WITH_YOUR_KEY'
$Model = 'kimi-k3-test'
$BaseUri = 'http://198.51.100.10'
$RunId = Get-Date -Format 'yyyyMMdd-HHmmss'
$StartedAt = Get-Date

$ResultDir = Join-Path $Root "原始结果\$RunId"
$HtmlDir = Join-Path $Root "HTML报告\$RunId"
$LogDir = Join-Path $Root "运行日志\$RunId"
$MonitoringDir = Join-Path $Root "服务端监控\$RunId"
@($ResultDir, $HtmlDir, $LogDir, $MonitoringDir) | ForEach-Object {
    New-Item -ItemType Directory -Path $_ -Force | Out-Null
}

$RunStatePath = Join-Path $LogDir 'run-state.json'
$SummaryCsv = Join-Path $ResultDir '阶段汇总.csv'
$RunLog = Join-Path $LogDir '执行总日志.txt'
$env:HEAP = '-Xms1g -Xmx2g -XX:MaxMetaspaceSize=256m'

$Stages = @(
    [pscustomobject]@{ Name='T0'; Mode='非流式预检'; Threads=1;   Loops=3;  Ramp=1;   Stream=$false; Cooldown=0;   Planned=3 },
    [pscustomobject]@{ Name='P1'; Mode='非流式';     Threads=25;  Loops=20; Ramp=30;  Stream=$false; Cooldown=180; Planned=500 },
    [pscustomobject]@{ Name='P2'; Mode='非流式';     Threads=50;  Loops=20; Ramp=60;  Stream=$false; Cooldown=180; Planned=1000 },
    [pscustomobject]@{ Name='P3'; Mode='非流式';     Threads=100; Loops=20; Ramp=120; Stream=$false; Cooldown=240; Planned=2000 },
    [pscustomobject]@{ Name='P4'; Mode='非流式';     Threads=200; Loops=30; Ramp=180; Stream=$false; Cooldown=300; Planned=6000 },
    [pscustomobject]@{ Name='P5'; Mode='非流式';     Threads=400; Loops=50; Ramp=300; Stream=$false; Cooldown=300; Planned=20000 },
    [pscustomobject]@{ Name='S1'; Mode='流式';       Threads=25;  Loops=10; Ramp=30;  Stream=$true;  Cooldown=180; Planned=250 },
    [pscustomobject]@{ Name='S2'; Mode='流式';       Threads=200; Loops=10; Ramp=180; Stream=$true;  Cooldown=240; Planned=2000 },
    [pscustomobject]@{ Name='S3'; Mode='流式';       Threads=400; Loops=10; Ramp=300; Stream=$true;  Cooldown=120; Planned=4000 },
    [pscustomobject]@{ Name='T3'; Mode='恢复验证';   Threads=1;   Loops=10; Ramp=1;   Stream=$false; Cooldown=0;   Planned=10 }
)

function Write-RunLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    $line | Tee-Object -FilePath $RunLog -Append | Write-Host
}

function Get-Percentile {
    param([double[]]$Values, [double]$Percentile)
    if (-not $Values -or $Values.Count -eq 0) { return 0 }
    $sorted = $Values | Sort-Object
    $index = [math]::Ceiling(($Percentile / 100) * $sorted.Count) - 1
    if ($index -lt 0) { $index = 0 }
    return [double]$sorted[$index]
}

function Start-ResourceMonitor {
    param([string]$StageName, [string]$OutputPath, [string]$SentinelPath)
    New-Item -ItemType File -Path $SentinelPath -Force | Out-Null
    return Start-Job -ArgumentList $StageName,$OutputPath,$SentinelPath -ScriptBlock {
        param($StageName, $OutputPath, $SentinelPath)
        'timestamp,stage,cpu_percent,available_memory_mb,disk_busy_percent,java_working_set_mb,java_cpu_seconds' | Set-Content -LiteralPath $OutputPath -Encoding utf8
        while (Test-Path -LiteralPath $SentinelPath) {
            try {
                $cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" | Select-Object -ExpandProperty PercentProcessorTime
                $memory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object -ExpandProperty AvailableMBytes
                $disk = Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk -Filter "Name='C:'" | Select-Object -ExpandProperty PercentDiskTime
                $java = @(Get-Process java -ErrorAction SilentlyContinue)
                $workingSet = [math]::Round((($java | Measure-Object WorkingSet64 -Sum).Sum / 1MB), 2)
                $javaCpu = [math]::Round((($java | Measure-Object CPU -Sum).Sum), 2)
                $line = '"{0}","{1}",{2},{3},{4},{5},{6}' -f (Get-Date -Format 'o'),$StageName,$cpu,$memory,$disk,$workingSet,$javaCpu
                Add-Content -LiteralPath $OutputPath -Value $line -Encoding utf8
            } catch {
                Add-Content -LiteralPath $OutputPath -Value ('"{0}","{1}",,,,, # {2}' -f (Get-Date -Format 'o'),$StageName,$_.Exception.Message.Replace(',', ';')) -Encoding utf8
            }
            Start-Sleep -Seconds 5
        }
    }
}

function Stop-ResourceMonitor {
    param($Job, [string]$SentinelPath)
    Remove-Item -LiteralPath $SentinelPath -Force -ErrorAction SilentlyContinue
    Wait-Job -Job $Job -Timeout 15 | Out-Null
    Receive-Job -Job $Job -ErrorAction SilentlyContinue | Out-Null
    Remove-Job -Job $Job -Force -ErrorAction SilentlyContinue
}

function Get-StageSummary {
    param($Stage, [string]$JtlPath, [int]$ExitCode, [string]$MonitorPath)
    if (-not (Test-Path -LiteralPath $JtlPath)) {
        throw "阶段$($Stage.Name)没有生成JTL：$JtlPath"
    }
    $rows = @(Import-Csv -LiteralPath $JtlPath)
    if ($rows.Count -eq 0) {
        throw "阶段$($Stage.Name)的JTL没有样本"
    }
    $elapsed = [double[]]@($rows | ForEach-Object { [double]$_.elapsed })
    $startMs = ($rows | ForEach-Object { [double]$_.timeStamp } | Measure-Object -Minimum).Minimum
    $endMs = ($rows | ForEach-Object { [double]$_.timeStamp + [double]$_.elapsed } | Measure-Object -Maximum).Maximum
    $duration = [math]::Max(0.001, ($endMs - $startMs) / 1000)
    $successCount = @($rows | Where-Object { $_.success -eq 'true' }).Count
    $codes401 = @($rows | Where-Object { $_.responseCode -eq '401' }).Count
    $codes403 = @($rows | Where-Object { $_.responseCode -eq '403' }).Count
    $codes429 = @($rows | Where-Object { $_.responseCode -eq '429' }).Count
    $codes5xx = @($rows | Where-Object { $_.responseCode -match '^5\d\d$' }).Count
    $timeouts = @($rows | Where-Object { $_.failureMessage -match '(?i)timeout|timed out' -or $_.responseMessage -match '(?i)timeout|timed out' }).Count
    $resets = @($rows | Where-Object { $_.failureMessage -match '(?i)connection reset|broken pipe|premature' -or $_.responseMessage -match '(?i)connection reset|broken pipe|premature' }).Count
    $sseIncomplete = @($rows | Where-Object { $_.failureMessage -match 'SSE_(INCOMPLETE|NO_DATA|BUSINESS_ERROR)' }).Count
    $emptyContent = @($rows | Where-Object { $_.failureMessage -match 'EMPTY_CONTENT' }).Count
    $invalidJson = @($rows | Where-Object { $_.failureMessage -match 'INVALID_JSON' }).Count

    $monitorRows = @()
    if (Test-Path -LiteralPath $MonitorPath) { $monitorRows = @(Import-Csv -LiteralPath $MonitorPath | Where-Object { $_.cpu_percent -match '^\d' }) }
    $cpuPeak = if ($monitorRows.Count) { [math]::Round((($monitorRows | ForEach-Object { [double]$_.cpu_percent } | Measure-Object -Maximum).Maximum),2) } else { 0 }
    $cpuAvg = if ($monitorRows.Count) { [math]::Round((($monitorRows | ForEach-Object { [double]$_.cpu_percent } | Measure-Object -Average).Average),2) } else { 0 }
    $memoryMin = if ($monitorRows.Count) { [math]::Round((($monitorRows | ForEach-Object { [double]$_.available_memory_mb } | Measure-Object -Minimum).Minimum),2) } else { 0 }

    [pscustomobject]@{
        Stage=$Stage.Name; Mode=$Stage.Mode; Threads=$Stage.Threads; Loops=$Stage.Loops; Planned=$Stage.Planned
        Samples=$rows.Count; Success=$successCount; Failures=($rows.Count-$successCount)
        SuccessRate=[math]::Round(100*$successCount/$rows.Count,4); ErrorRate=[math]::Round(100*($rows.Count-$successCount)/$rows.Count,4)
        RPS=[math]::Round($rows.Count/$duration,4); DurationSeconds=[math]::Round($duration,3)
        AvgMs=[math]::Round((($elapsed | Measure-Object -Average).Average),2)
        P50Ms=[math]::Round((Get-Percentile $elapsed 50),2); P90Ms=[math]::Round((Get-Percentile $elapsed 90),2)
        P95Ms=[math]::Round((Get-Percentile $elapsed 95),2); P99Ms=[math]::Round((Get-Percentile $elapsed 99),2)
        MinMs=[math]::Round((($elapsed | Measure-Object -Minimum).Minimum),2); MaxMs=[math]::Round((($elapsed | Measure-Object -Maximum).Maximum),2)
        Http401=$codes401; Http403=$codes403; Http429=$codes429; Http5xx=$codes5xx
        Timeouts=$timeouts; Resets=$resets; SseIncomplete=$sseIncomplete; EmptyContent=$emptyContent; InvalidJson=$invalidJson
        ClientCpuAvg=$cpuAvg; ClientCpuPeak=$cpuPeak; ClientMemoryMinMB=$memoryMin; JMeterExitCode=$ExitCode
    }
}

function Test-StageGate {
    param($Stage, $Summary, $T0Summary, $PreviousSummary)
    $reasons = [System.Collections.Generic.List[string]]::new()
    if ($Summary.JMeterExitCode -ne 0) { $reasons.Add("JMeter退出码=$($Summary.JMeterExitCode)") }
    if ($Summary.Samples -ne $Stage.Planned) { $reasons.Add("样本数$($Summary.Samples)不等于计划$($Stage.Planned)") }
    if ($Summary.Http401 -gt 0 -or $Summary.Http403 -gt 0) { $reasons.Add("出现鉴权错误：401=$($Summary.Http401)，403=$($Summary.Http403)") }
    if ($Summary.Http5xx * 100 / $Summary.Samples -ge 10) { $reasons.Add("5xx错误率达到10%") }
    if ($Summary.Http429 * 100 / $Summary.Samples -ge 5) { $reasons.Add("429错误率达到5%") }
    if (($Summary.Timeouts + $Summary.Resets) * 100 / $Summary.Samples -ge 10) { $reasons.Add("超时/连接重置达到10%") }
    if ($Summary.ClientMemoryMinMB -gt 0 -and $Summary.ClientMemoryMinMB -lt 256) { $reasons.Add("压测机可用内存低于256MB") }
    if ($Summary.ClientCpuAvg -ge 85) { $reasons.Add("压测机平均CPU达到85%") }
    if ($Stage.Name -eq 'T0' -and ($Summary.Success -ne 3 -or $Summary.ErrorRate -gt 0)) { $reasons.Add('T0未连续3次成功') }
    if ($Stage.Stream -and $Summary.SseIncomplete -gt 0) { $reasons.Add("流式响应不完整=$($Summary.SseIncomplete)") }
    if ($T0Summary -and $PreviousSummary -and $Summary.P95Ms -ge (3 * $T0Summary.P95Ms) -and $Summary.P95Ms -gt $PreviousSummary.P95Ms -and $Summary.ErrorRate -ge 1) {
        $reasons.Add('P95超过基线3倍、继续恶化且错误率达到1%')
    }
    return $reasons
}

function Invoke-Stage {
    param($Stage)
    $suffix = "{0}-{1}x{2}" -f $Stage.Name,$Stage.Threads,$Stage.Loops
    $jtl = Join-Path $ResultDir "$suffix.jtl"
    $html = Join-Path $HtmlDir $suffix
    $jmeterLog = Join-Path $LogDir "$suffix-jmeter.log"
    $consoleLog = Join-Path $LogDir "$suffix-console.log"
    $monitorPath = Join-Path $LogDir "$suffix-client-resources.csv"
    $sentinel = Join-Path $LogDir "$suffix-monitor.running"
    $preview = if ($Stage.Name -eq 'T0') { Join-Path $LogDir 'T0-first-response.txt' } else { '' }
    $accept = if ($Stage.Stream) { 'text/event-stream' } else { 'application/json' }
    $streamText = $Stage.Stream.ToString().ToLowerInvariant()

    Write-RunLog "开始$($Stage.Name)：$($Stage.Mode)，$($Stage.Threads)线程 × $($Stage.Loops)循环，Ramp-up $($Stage.Ramp)秒"
    $monitorJob = Start-ResourceMonitor -StageName $Stage.Name -OutputPath $monitorPath -SentinelPath $sentinel
    $args = @(
        '-n','-t',$Jmx,'-l',$jtl,'-e','-o',$html,'-j',$jmeterLog,
        "-Jstage=$($Stage.Name)","-Jthreads=$($Stage.Threads)","-Jloops=$($Stage.Loops)","-JrampSeconds=$($Stage.Ramp)",
        "-Jmodel=$Model","-Jstream=$streamText","-Jaccept=$accept","-JapiKey=$ApiKey","-JpreviewFile=$preview",
        '-Jjmeter.save.saveservice.output_format=csv','-Jjmeter.save.saveservice.print_field_names=true',
        '-Jjmeter.save.saveservice.response_data=false','-Jjmeter.save.saveservice.samplerData=false',
        '-Jjmeter.save.saveservice.requestHeaders=false','-Jjmeter.save.saveservice.responseHeaders=false',
        '-Jjmeter.save.saveservice.url=true','-Jjmeter.save.saveservice.thread_name=true',
        '-Jjmeter.save.saveservice.time=true','-Jjmeter.save.saveservice.latency=true','-Jjmeter.save.saveservice.connect_time=true',
        '-Jjmeter.save.saveservice.response_code=true','-Jjmeter.save.saveservice.response_message=true',
        '-Jjmeter.save.saveservice.successful=true','-Jjmeter.save.saveservice.failure_message=true',
        '-Jjmeter.save.saveservice.bytes=true','-Jjmeter.save.saveservice.sent_bytes=true'
    )
    try {
        & $JMeter @args 2>&1 | Tee-Object -FilePath $consoleLog | Write-Host
        $exitCode = $LASTEXITCODE
    } finally {
        Stop-ResourceMonitor -Job $monitorJob -SentinelPath $sentinel
    }
    $summary = Get-StageSummary -Stage $Stage -JtlPath $jtl -ExitCode $exitCode -MonitorPath $monitorPath
    $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ResultDir "$suffix-summary.json") -Encoding utf8
    Write-RunLog ("完成{0}：Samples={1}，成功率={2}% ，RPS={3}，P95={4}ms，P99={5}ms，429={6}，5xx={7}" -f $Stage.Name,$summary.Samples,$summary.SuccessRate,$summary.RPS,$summary.P95Ms,$summary.P99Ms,$summary.Http429,$summary.Http5xx)
    return $summary
}

function New-FinalReport {
    param([array]$Summaries, [string]$StopReason, [datetime]$EndedAt)
    $reportPath = Join-Path $Root 'KIMI-K3性能压测报告.md'
    $completed = ($Summaries | ForEach-Object Stage) -join '、'
    $maxStable = ($Summaries | Where-Object { $_.Stage -match '^[PS]\d$' -and $_.ErrorRate -lt 1 -and $_.Http5xx -eq 0 } | ForEach-Object Threads | Measure-Object -Maximum).Maximum
    if (-not $maxStable) { $maxStable = '尚未确定' }
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('# KIMI K3 性能压测报告')
    $lines.Add('')
    $lines.Add("> 运行编号：``$RunId``  ")
    $lines.Add("> 唯一模型：``$Model``  ")
    $lines.Add("> 接口：``POST $BaseUri/v1/chat/completions``")
    $lines.Add('')
    $lines.Add('## 一、执行摘要')
    $lines.Add('')
    $lines.Add('| 项目 | 结果 |')
    $lines.Add('|---|---|')
    $lines.Add("| 开始时间 | $($StartedAt.ToString('yyyy-MM-dd HH:mm:ss')) |")
    $lines.Add("| 结束时间 | $($EndedAt.ToString('yyyy-MM-dd HH:mm:ss')) |")
    $lines.Add("| 完成阶段 | $completed |")
    $lines.Add("| 停止原因 | $(if($StopReason){$StopReason}else{'全部计划阶段执行完成'}) |")
    $lines.Add("| 最高初步稳定并发 | $maxStable |")
    $lines.Add('| 归因证据边界 | 当前仅采集JMeter端到端指标和压测机资源；未取得平台/供应商服务端监控，不能单独归因供应商。 |')
    $lines.Add('')
    $lines.Add('## 二、阶段结果')
    $lines.Add('')
    $lines.Add('| 阶段 | 模式 | 并发 | 样本 | 成功率 | RPS | Avg(ms) | P90 | P95 | P99 | Max | 429 | 5xx | 超时 | 重置 | SSE不完整 | 客户端CPU峰值 | 最低可用内存MB |')
    $lines.Add('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    foreach ($s in $Summaries) {
        $lines.Add("| $($s.Stage) | $($s.Mode) | $($s.Threads) | $($s.Samples) | $($s.SuccessRate)% | $($s.RPS) | $($s.AvgMs) | $($s.P90Ms) | $($s.P95Ms) | $($s.P99Ms) | $($s.MaxMs) | $($s.Http429) | $($s.Http5xx) | $($s.Timeouts) | $($s.Resets) | $($s.SseIncomplete) | $($s.ClientCpuPeak)% | $($s.ClientMemoryMinMB) |")
    }
    $lines.Add('')
    $lines.Add('## 三、错误分类')
    $lines.Add('')
    $lines.Add('| 错误 | 合计 |')
    $lines.Add('|---|---:|')
    foreach ($pair in @(
        @('401',($Summaries|Measure-Object Http401 -Sum).Sum),@('403',($Summaries|Measure-Object Http403 -Sum).Sum),
        @('429',($Summaries|Measure-Object Http429 -Sum).Sum),@('5xx',($Summaries|Measure-Object Http5xx -Sum).Sum),
        @('超时',($Summaries|Measure-Object Timeouts -Sum).Sum),@('连接重置',($Summaries|Measure-Object Resets -Sum).Sum),
        @('空回答',($Summaries|Measure-Object EmptyContent -Sum).Sum),@('非法JSON',($Summaries|Measure-Object InvalidJson -Sum).Sum),
        @('SSE不完整/异常',($Summaries|Measure-Object SseIncomplete -Sum).Sum)
    )) { $lines.Add("| $($pair[0]) | $($pair[1]) |") }
    $lines.Add('')
    $lines.Add('## 四、恢复验证')
    $lines.Add('')
    $t0 = $Summaries | Where-Object Stage -eq 'T0' | Select-Object -First 1
    $t3 = $Summaries | Where-Object Stage -eq 'T3' | Select-Object -First 1
    if ($t0 -and $t3) {
        $recovered = ($t3.SuccessRate -eq 100 -and $t3.P95Ms -le 1.5*$t0.P95Ms)
        $lines.Add("T0 P95为$($t0.P95Ms)ms，T3 P95为$($t3.P95Ms)ms；恢复判定：$(if($recovered){'通过'}else{'未通过或需结合SLA复核'})。")
    } else { $lines.Add('未同时完成T0和T3，无法判定高压后恢复能力。') }
    $lines.Add('')
    $lines.Add('## 五、证据位置')
    $lines.Add('')
    $lines.Add("- 原始JTL：``$ResultDir``")
    $lines.Add("- JMeter HTML报告：``$HtmlDir``")
    $lines.Add("- 执行与压测机监控日志：``$LogDir``")
    $lines.Add("- 服务端监控待补充目录：``$MonitoringDir``")
    $lines.Add('')
    $lines.Add('## 六、结论边界')
    $lines.Add('')
    $lines.Add('本报告中的响应时间、吞吐量和错误率是“Token平台 + KIMI K3供应商”的端到端结果。若没有平台分段耗时、连接池、数据库、计费队列和供应商上游指标，不能仅凭JMeter结果断言瓶颈一定属于平台或供应商。')
    $lines | Set-Content -LiteralPath $reportPath -Encoding utf8
    return $reportPath
}

$runState = [ordered]@{ RunId=$RunId; StartedAt=$StartedAt.ToString('o'); Status='RUNNING'; CompletedStages=@(); StopReason=''; ResultDir=$ResultDir; HtmlDir=$HtmlDir; LogDir=$LogDir }
$runState | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $RunStatePath -Encoding utf8
$summaries = [System.Collections.Generic.List[object]]::new()
$stopReason = ''
$t0Summary = $null
$previousSummary = $null

try {
    if (-not (Test-Path -LiteralPath $JMeter)) { throw "找不到JMeter：$JMeter" }
    if (-not (Test-Path -LiteralPath $Jmx)) { throw "找不到JMX：$Jmx" }
    Write-RunLog "运行编号=$RunId；唯一模型=$Model；开始执行模型列表校验"
    $modelsResponse = Invoke-RestMethod -Uri "$BaseUri/v1/models" -Headers @{Authorization="Bearer $ApiKey"} -Method Get -TimeoutSec 30
    $modelsJson = $modelsResponse | ConvertTo-Json -Depth 20
    $modelsJson | Set-Content -LiteralPath (Join-Path $LogDir 'models-response.json') -Encoding utf8
    if ($modelsJson -notmatch [regex]::Escape($Model)) { throw "模型列表不包含$Model，已禁止启动压测" }
    Write-RunLog '模型列表校验通过。'

    foreach ($stage in $Stages) {
        if ($PreflightOnly -and $stage.Name -ne 'T0') { break }
        $summary = Invoke-Stage -Stage $stage
        $summaries.Add($summary)
        $summaries | Export-Csv -LiteralPath $SummaryCsv -NoTypeInformation -Encoding utf8
        if ($stage.Name -eq 'T0') { $t0Summary = $summary }
        $gateReasons = @(Test-StageGate -Stage $stage -Summary $summary -T0Summary $t0Summary -PreviousSummary $previousSummary)
        if ($gateReasons.Count -gt 0) {
            $stopReason = "$($stage.Name)触发停止条件：" + ($gateReasons -join '；')
            Write-RunLog $stopReason
            break
        }
        $previousSummary = $summary
        $runState.CompletedStages = @($summaries | ForEach-Object Stage)
        $runState | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $RunStatePath -Encoding utf8
        if ($stage.Cooldown -gt 0 -and -not $PreflightOnly) {
            $waitSeconds = [math]::Max(0, [math]::Round($stage.Cooldown * $CooldownScalePercent / 100))
            Write-RunLog "阶段冷却$waitSeconds秒后继续。"
            Start-Sleep -Seconds $waitSeconds
        }
    }
} catch {
    $stopReason = "执行异常：$($_.Exception.Message)"
    Write-RunLog $stopReason
} finally {
    $endedAt = Get-Date
    $reportPath = New-FinalReport -Summaries @($summaries) -StopReason $stopReason -EndedAt $endedAt
    $runState.Status = if ($stopReason) { 'STOPPED' } elseif ($PreflightOnly) { 'PREFLIGHT_COMPLETE' } else { 'COMPLETED' }
    $runState.CompletedStages = @($summaries | ForEach-Object Stage)
    $runState.StopReason = $stopReason
    $runState.EndedAt = $endedAt.ToString('o')
    $runState.ReportPath = $reportPath
    $runState | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $RunStatePath -Encoding utf8
    Write-RunLog "执行结束，状态=$($runState.Status)，报告=$reportPath"
}

if ($stopReason) { exit 2 }
exit 0
