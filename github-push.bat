@echo off
rem ===========================================================
rem  GitHub へアップロードする（push）
rem  ユーザー名を入れるだけで、リモート設定と push を行います。
rem ===========================================================
setlocal
cd /d "%~dp0"

echo.
echo  ============================================
echo   GitHub へアップロードします
echo  ============================================
echo.
echo  事前に https://github.com/new でリポジトリを
echo  作成しておいてください。
echo.
echo    Repository name : echo-show-clock
echo    Public を選ぶ
echo    チェックボックスは全て外す
echo.

set "GHUSER="
set /p GHUSER=GitHub のユーザー名を入力して Enter: 
if "%GHUSER%"=="" goto :nouser

set "GHREPO=echo-show-clock"
set "GHURL=https://github.com/%GHUSER%/%GHREPO%.git"

echo.
echo  送信先: %GHURL%
echo.

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo  リモートを新規登録します...
  git remote add origin "%GHURL%"
) else (
  echo  リモートの登録先を更新します...
  git remote set-url origin "%GHURL%"
)

echo.
echo  アップロード中です。
echo  初回はブラウザが開くので、GitHub にサインインして許可してください。
echo.

git push -u origin main
if errorlevel 1 goto :failed

echo.
echo  ============================================
echo   アップロードが完了しました
echo  ============================================
echo.
echo  次に、下記ページで GitHub Pages を有効にしてください。
echo    https://github.com/%GHUSER%/%GHREPO%/settings/pages
echo.
echo    Source : Deploy from a branch
echo    Branch : main  と  / (root)  を選んで Save
echo.
echo  1～2分待つと、下記URLで表示できるようになります。
echo    https://%GHUSER%.github.io/%GHREPO%/
echo.
goto :end

:nouser
echo.
echo  ユーザー名が入力されませんでした。中止します。
goto :end

:failed
echo.
echo  ------------------------------------------------
echo   アップロードに失敗しました。よくある原因:
echo     リポジトリをまだ作成していない
echo     ユーザー名またはリポジトリ名が違う
echo     サインインをキャンセルした
echo  ------------------------------------------------

:end
echo.
pause
endlocal
