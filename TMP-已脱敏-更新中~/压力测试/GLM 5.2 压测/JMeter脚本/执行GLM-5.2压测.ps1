[CmdletBinding()]
param(
    [switch]$PreflightOnly,
    [ValidateSet('G2','G3','T0-S','S1','S2','S3','S4','S5','T3-S')]
    [string]$StartAt = 'G2',
    [int]$CooldownScalePercent = 100
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = 'GLM 5.2 压测'
$JMeterHome = 'apache-jmeter-5.6.3'
$JMeter = Join-Path $JMeterHome 'bin\jmeter.bat'
$Jmx = Join-Path $Root 'JMeter脚本\GLM-5.2-API性能压测.jmx'
$ApiKey = 'sk-REPLACE_WITH_YOUR_KEY'
$Model = 'glm-5.2-test'
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
    [pscustomobject]@{ Name='G2';   Mode='非流式门禁'; Threads=1;   Loops=3;  Ramp=1;   Stream=$false; Cooldown=0;   Planned=3 },
    [pscustomobject]@{ Name='G3';   Mode='流式门禁';   Threads=1;   Loops=1;  Ramp=1;   Stream=$true;  Cooldown=0;   Planned=1 },
    [pscustomobject]@{ Name='T0-S'; Mode='流式基线';   Threads=1;   Loops=3;  Ramp=1;   Stream=$true;  Cooldown=0;   Planned=3 },
    [pscustomobject]@{ Name='S1';   Mode='流式';       Threads=50;  Loops=20; Ramp=60;  Stream=$true;  Cooldown=180; Planned=1000 },
    [pscustomobject]@{ Name='S2';   Mode='流式';       Threads=100; Loops=16; Ramp=120; Stream=$true;  Cooldown=240; Planned=1600 },
    [pscustomobject]@{ Name='S3';   Mode='流式';       Threads=200; Loops=13; Ramp=180; Stream=$true;  Cooldown=240; Planned=2600 },
    [pscustomobject]@{ Name='S4';   Mode='流式';       Threads=400; Loops=15; Ramp=300; Stream=$true;  Cooldown=300; Planned=6000 },
    [pscustomobject]@{ Name='S5';   Mode='流式';       Threads=500; Loops=17; Ramp=360; Stream=$true;  Cooldown=300; Planned=8500 },
    [pscustomobject]@{ Name='T3-S'; Mode='流式恢复';   Threads=1;   Loops=10; Ramp=1;   Stream=$true;  Cooldown=0;   Planned=10 }
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
    $sseIncomplete = @($rows | Where-Object { $_.failureMessage -match 'SSE_(CONTENT_TYPE|NO_EVENTS|INCOMPLETE|DUPLICATE_DONE|DONE_NOT_LAST|NO_CHOICES|INVALID_JSON|BUSINESS_ERROR)' }).Count
    $emptyContent = @($rows | Where-Object { $_.failureMessage -match '(SSE_)?EMPTY_CONTENT' }).Count
    $invalidJson = @($rows | Where-Object { $_.failureMessage -match '(SSE_)?INVALID_JSON' }).Count
    $achievedMaxThreads = (($rows | ForEach-Object { [int]$_.allThreads } | Measure-Object -Maximum).Maximum)
    $concurrencyRate = [math]::Round(100 * $achievedMaxThreads / $Stage.Threads, 2)

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
        AchievedMaxThreads=$achievedMaxThreads; ConcurrencyAchievementRate=$concurrencyRate
        ClientCpuAvg=$cpuAvg; ClientCpuPeak=$cpuPeak; ClientMemoryMinMB=$memoryMin; JMeterExitCode=$ExitCode
    }
}

function Test-StageGate {
    param($Stage, $Summary, $T0Summary, $PreviousSummary)
    $reasons = [System.Collections.Generic.List[string]]::new()
    if ($Summary.JMeterExitCode -ne 0) { $reasons.Add("JMeter退出码=$($Summary.JMeterExitCode)") }
    if ($Summary.Samples -ne $Stage.Planned) { $reasons.Add("样本数$($Summary.Samples)不等于计划$($Stage.Planned)") }
    if ($Summary.Http401 -gt 0 -or $Summary.Http403 -gt 0) { $reasons.Add("出现鉴权错误：401=$($Summary.Http401)，403=$($Summary.Http403)") }
    if ($Summary.ErrorRate -ge 10) { $reasons.Add("总体失败率达到10%，禁止继续升级") }
    if ($Summary.Http5xx * 100 / $Summary.Samples -ge 10) { $reasons.Add("5xx错误率达到10%，禁止继续升级") }
    if ($Summary.Http429 * 100 / $Summary.Samples -ge 10) { $reasons.Add("429错误率达到10%，禁止继续升级") }
    if (($Summary.Timeouts + $Summary.Resets) * 100 / $Summary.Samples -ge 10) { $reasons.Add("超时/连接重置达到10%，禁止继续升级") }
    if ($Summary.ClientMemoryMinMB -gt 0 -and $Summary.ClientMemoryMinMB -lt 256) { $reasons.Add("压测机可用内存低于256MB") }
    if ($Summary.ClientCpuAvg -ge 85) { $reasons.Add("压测机平均CPU达到85%") }
    if ($Stage.Name -in @('S1','S2','S3','S4','S5') -and $Summary.ConcurrencyAchievementRate -lt 90) { $reasons.Add("实际最大并发$($Summary.AchievedMaxThreads)，仅达到目标并发的$($Summary.ConcurrencyAchievementRate)%") }
    if ($Stage.Name -eq 'G2' -and ($Summary.Success -ne 3 -or $Summary.ErrorRate -gt 0)) { $reasons.Add('G2非流式门禁未连续3次成功') }
    if ($Stage.Name -eq 'G3' -and ($Summary.Success -ne 1 -or $Summary.ErrorRate -gt 0)) { $reasons.Add('G3流式门禁未成功') }
    if ($Stage.Name -eq 'T0-S' -and ($Summary.Success -ne 3 -or $Summary.ErrorRate -gt 0)) { $reasons.Add('T0-S流式基线未连续3次成功') }
    if ($Stage.Stream -and $Summary.SseIncomplete * 100 / $Summary.Samples -ge 10) { $reasons.Add("流式响应不完整率达到10%，禁止继续升级") }
    if ($Summary.EmptyContent * 100 / $Summary.Samples -ge 10) { $reasons.Add("业务成功响应正文为空率达到10%，禁止继续升级") }
    if ($Summary.InvalidJson * 100 / $Summary.Samples -ge 10) { $reasons.Add("非流式非法JSON率达到10%，禁止继续升级") }
    if ($T0Summary -and $PreviousSummary -and $Summary.P95Ms -ge (3 * $T0Summary.P95Ms) -and $Summary.P95Ms -gt $PreviousSummary.P95Ms -and $Summary.ErrorRate -ge 1) {
        $reasons.Add('P95超过基线3倍、继续恶化且错误率达到1%')
    }
    return $reasons
}

function Get-LiveGateDecision {
    param([string]$JtlPath)
    if (-not (Test-Path -LiteralPath $JtlPath)) { return $null }
    try { $rows = @(Import-Csv -LiteralPath $JtlPath -ErrorAction Stop) } catch { return $null }
    if ($rows.Count -eq 0) { return $null }
    $authRows = @($rows | Where-Object { $_.responseCode -in @('401','403') })
    if ($authRows.Count -gt 0) {
        return [pscustomobject]@{ Stop=$true; Reason="检测到401/403鉴权错误，立即停止"; Samples=$rows.Count; WindowFailures=0; WindowRate=0 }
    }
    if ($rows.Count -lt 50) { return [pscustomobject]@{ Stop=$false; Reason=''; Samples=$rows.Count; WindowFailures=0; WindowRate=0 } }
    $window = @($rows | Select-Object -Last 100)
    $failed = @($window | Where-Object { $_.success -ne 'true' }).Count
    $rate = [math]::Round(100 * $failed / $window.Count, 2)
    return [pscustomobject]@{
        Stop=($rate -ge 30)
        Reason="最近$($window.Count)个完成样本失败率=$rate%（$failed/$($window.Count)）"
        Samples=$rows.Count
        WindowFailures=$failed
        WindowRate=$rate
    }
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
    $preview = if ($Stage.Name -in @('G2','G3','T0-S')) { Join-Path $LogDir "$($Stage.Name)-first-response.txt" } else { '' }
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
    $stderrLog = Join-Path $LogDir "$suffix-stderr.log"
    $emergencyStop = $false
    try {
        $quotedArgs = ($args | ForEach-Object {
            $value = [string]$_
            if ($value -match '[\s"]') { '"' + $value.Replace('"','\"') + '"' } else { $value }
        }) -join ' '
        $cmdLine = '/d /c ""' + $JMeter + '" ' + $quotedArgs + '"'
        $process = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdLine -RedirectStandardOutput $consoleLog -RedirectStandardError $stderrLog -PassThru -WindowStyle Hidden
        $lastLiveLog = Get-Date '2000-01-01'
        while (-not $process.HasExited) {
            Start-Sleep -Seconds 5
            $decision = Get-LiveGateDecision -JtlPath $jtl
            if ($decision -and ((Get-Date) - $lastLiveLog).TotalSeconds -ge 30) {
                Write-RunLog "实时门禁：Samples=$($decision.Samples)，最近窗口失败率=$($decision.WindowRate)%"
                $lastLiveLog = Get-Date
            }
            if ($decision -and $decision.Stop) {
                $emergencyStop = $true
                Write-RunLog "触发运行时紧急闸门：$($decision.Reason)，发送JMeter优雅停止命令。"
                & (Join-Path $JMeterHome 'bin\shutdown.cmd') 2>&1 | Add-Content -LiteralPath $consoleLog -Encoding utf8
                break
            }
        }
        if ($emergencyStop -and -not $process.WaitForExit(120000)) {
            Write-RunLog '优雅停止等待120秒后JMeter仍未退出；保留现场并停止继续升级。'
        } else {
            $process.WaitForExit()
        }
        $exitCode = if ($process.HasExited) { $process.ExitCode } else { 3 }
    } finally {
        Stop-ResourceMonitor -Job $monitorJob -SentinelPath $sentinel
    }
    $summary = Get-StageSummary -Stage $Stage -JtlPath $jtl -ExitCode $exitCode -MonitorPath $monitorPath
    $summary | Add-Member -NotePropertyName EmergencyStopped -NotePropertyValue $emergencyStop -Force
    $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ResultDir "$suffix-summary.json") -Encoding utf8
    Write-RunLog ("完成{0}：Samples={1}，成功率={2}% ，RPS={3}，P95={4}ms，P99={5}ms，429={6}，5xx={7}，实时停止={8}" -f $Stage.Name,$summary.Samples,$summary.SuccessRate,$summary.RPS,$summary.P95Ms,$summary.P99Ms,$summary.Http429,$summary.Http5xx,$emergencyStop)
    return $summary
}

function New-FinalReport {
    param([array]$Summaries, [string]$StopReason, [datetime]$EndedAt)
    $reportPath = Join-Path $Root 'GLM-5.2性能压测报告.md'
    $completed = ($Summaries | ForEach-Object Stage) -join '、'
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("## 运行汇总：$RunId")
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
    $lines.Add('| 结果性质 | 本节为本次运行追加记录；主报告历史内容保持不变。 |')
    $lines.Add('')
    $lines.Add('## 二、阶段结果')
    $lines.Add('')
    $lines.Add('| 阶段 | 模式 | 目标并发 | 实际最大并发 | 并发达成率 | 样本 | 成功率 | RPS | Avg(ms) | P90 | P95 | P99 | Max | 429 | 5xx | 超时 | 重置 | SSE不完整 | 客户端CPU峰值 | 最低可用内存MB |')
    $lines.Add('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    foreach ($s in $Summaries) {
        $lines.Add("| $($s.Stage) | $($s.Mode) | $($s.Threads) | $($s.AchievedMaxThreads) | $($s.ConcurrencyAchievementRate)% | $($s.Samples) | $($s.SuccessRate)% | $($s.RPS) | $($s.AvgMs) | $($s.P90Ms) | $($s.P95Ms) | $($s.P99Ms) | $($s.MaxMs) | $($s.Http429) | $($s.Http5xx) | $($s.Timeouts) | $($s.Resets) | $($s.SseIncomplete) | $($s.ClientCpuPeak)% | $($s.ClientMemoryMinMB) |")
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
    $t0 = $Summaries | Where-Object Stage -eq 'T0-S' | Select-Object -First 1
    $t3 = $Summaries | Where-Object Stage -eq 'T3-S' | Select-Object -First 1
    if ($t0 -and $t3) {
        $recovered = ($t3.SuccessRate -eq 100 -and $t3.P95Ms -le 1.5*$t0.P95Ms)
        $lines.Add("T0-S P95为$($t0.P95Ms)ms，T3-S P95为$($t3.P95Ms)ms；恢复判定：$(if($recovered){'通过'}else{'未通过或需结合SLA复核'})。")
    } else { $lines.Add('未同时完成T0-S和T3-S，无法判定高压后恢复能力。') }
    $lines.Add('')
    $lines.Add('## 五、证据位置')
    $lines.Add('')
    $lines.Add("- 原始JTL：``$ResultDir``")
    $lines.Add("- JMeter HTML报告：``$HtmlDir``")
    $lines.Add("- 执行与压测机监控日志：``$LogDir``")
    $lines.Add('')
    $lines.Add('## 六、结论边界')
    $lines.Add('')
    $lines.Add('本报告中的响应时间、吞吐量和错误率是“Token平台 + GLM 5.2供应商”的端到端结果。若没有平台分段耗时、连接池、数据库、计费队列和供应商上游指标，不能仅凭JMeter结果断言瓶颈一定属于平台或供应商。')
    $existing = if (Test-Path -LiteralPath $reportPath) { Get-Content -LiteralPath $reportPath -Raw } else { '# GLM 5.2 性能压测报告' }
    ($existing.TrimEnd() + "`r`n`r`n" + ($lines -join "`r`n") + "`r`n") | Set-Content -LiteralPath $reportPath -Encoding utf8
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

    $pressureStages = @('S1','S2','S3','S4','S5')
    $pressureStartReached = $StartAt -in @('G2','G3','T0-S','S1')
    $skipRemainingPressure = $false
    foreach ($stage in $Stages) {
        if ($stage.Name -in $pressureStages) {
            if ($stage.Name -eq $StartAt) { $pressureStartReached = $true }
            if (-not $pressureStartReached -or $skipRemainingPressure) { continue }
        }
        if ($PreflightOnly -and $stage.Name -notin @('G2','G3','T0-S')) { break }
        $summary = Invoke-Stage -Stage $stage
        $summaries.Add($summary)
        $summaries | Export-Csv -LiteralPath $SummaryCsv -NoTypeInformation -Encoding utf8
        if ($stage.Name -eq 'T0-S') { $t0Summary = $summary }
        $gateReasons = @(Test-StageGate -Stage $stage -Summary $summary -T0Summary $t0Summary -PreviousSummary $previousSummary)
        if ($gateReasons.Count -gt 0) {
            $stopReason = "$($stage.Name)触发停止条件：" + ($gateReasons -join '；')
            Write-RunLog $stopReason
            if ($stage.Name -in $pressureStages -and $summary.Http401 -eq 0 -and $summary.Http403 -eq 0) {
                $skipRemainingPressure = $true
                $waitSeconds = [math]::Max(0, [math]::Round($stage.Cooldown * $CooldownScalePercent / 100))
                Write-RunLog "停止升档，冷却$waitSeconds秒后仍执行T3-S恢复验证。"
                Start-Sleep -Seconds $waitSeconds
                continue
            }
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

