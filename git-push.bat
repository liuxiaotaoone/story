@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo 当前目录: %cd%
echo 准备提交所有更改...

:: 获取提交信息（如果直接回车则使用默认消息）
set /p commit_msg=请输入提交信息（直接回车使用默认消息）:
if "!commit_msg!"=="" set commit_msg=版本迭代

echo.
echo 执行: git add .
git add .
if errorlevel 1 (
    echo 错误：git add 失败，请检查是否有未跟踪的文件或权限问题。
    pause
    exit /b 1
)

echo.
echo 执行: git commit -m "!commit_msg!"
git commit -m "!commit_msg!"
if errorlevel 1 (
    echo 错误：git commit 失败，可能没有需要提交的更改。
    pause
    exit /b 1
)

echo.
echo 执行: git push
git push
if errorlevel 1 (
    echo 错误：git push 失败，请检查网络或远程仓库权限。
    pause
    exit /b 1
)

echo.
echo 成功！所有更改已提交并推送。
pause