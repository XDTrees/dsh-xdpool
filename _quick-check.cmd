@echo off
cd /d D:\dsh-home\_xdpool-src
if not exist _quick-log mkdir _quick-log
echo [1/4] typecheck...
call npx tsc --noEmit -p tsconfig.client.json > _quick-log\tsc.txt 2>&1
>> _quick-log\tsc.txt echo exit=%errorlevel%
echo [2/4] tests (a few minutes)...
call node node_modules\vitest\vitest.mjs run --maxWorkers=1 > _quick-log\test.txt 2>&1
set TESTCODE=%errorlevel%
>> _quick-log\test.txt echo exit=%TESTCODE%
echo [3/4] build...
call node node_modules\tsdown\dist\run.mjs > _quick-log\build.txt 2>&1
set BUILDCODE=%errorlevel%
>> _quick-log\build.txt echo exit=%BUILDCODE%
echo [4/4] sync to install dir...
set OK=0
if "%BUILDCODE%"=="0" if "%TESTCODE%"=="0" set OK=1
if "%OK%"=="1" (
  robocopy lib D:\dsh-home\profiles\desktop\node_modules\dsh-xdpool\lib /E /NFL /NDL /NJH /NJS > _quick-log\sync.txt 2>&1
  copy /Y package.json D:\dsh-home\profiles\desktop\node_modules\dsh-xdpool\package.json >> _quick-log\sync.txt 2>&1
  >> _quick-log\sync.txt echo synced
  echo SYNCED. Restart DSH and check the version in the left rail.
) else (
  > _quick-log\sync.txt echo skipped: build=%BUILDCODE% test=%TESTCODE%
  echo NOT SYNCED: tests or build failed. Tell Quick, it will read the logs.
)
echo.
echo Done. Logs: D:\dsh-home\_xdpool-src\_quick-log\
pause
