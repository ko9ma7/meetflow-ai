@echo off
chcp 65001 > nul
title Notion AI 회의 노트 시스템
echo ============================================================
echo   Notion AI 회의 노트 및 실시간 받아쓰기 시스템 실행 중...
echo ============================================================
echo.
echo [1] 서버를 시작합니다...
echo [2] 기본 웹 브라우저에서 Notion AI 회의 노트를 엽니다.
echo.
timeout /t 2 > nul
start http://localhost:3000
node server.js
pause
