@echo off
REM SYNTHETIC BATFLOW TEST FIXTURE
set MODE=TEST
if "%MODE%"=="TEST" goto done
echo unreachable
:done
exit
