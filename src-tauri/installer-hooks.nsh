!macro NSIS_HOOK_PREINSTALL
    ${If} $UpdateMode == 1
    ${AndIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
        Push $0
        Push $2
        Push $R0

        ; The updater launches this installer just before exiting Banyan.
        ; Wait for the exact installed executable to be released.
        banyan_wait_again:
        StrCpy $2 40
        ${Do}
            ; Use a fresh session so the process list reflects each poll.
            !insertmacro RestartManager_StartSession $R0
            ${If} $R0 == ""
                ${ExitDo}
            ${EndIf}
            !insertmacro RestartManager_RegisterFile $R0 "$INSTDIR\${MAINBINARYNAME}.exe"
            ${If} $0 == 0
                System::Call 'RSTRTMGR::RmGetList(i R0, *i 0, *i 0, p 0, *i 0) i .r0'
            ${EndIf}
            !insertmacro RestartManager_EndSession $R0
            ${If} $0 != ${ERROR_MORE_DATA}
                ${ExitDo}
            ${EndIf}
            Sleep 250
            IntOp $2 $2 - 1
        ${LoopWhile} $2 > 0

        ${If} $2 == 0
            MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Banyan 仍在執行。請儲存工作並關閉 Banyan 的所有視窗，再按「重試」。" /SD IDCANCEL IDRETRY banyan_wait_again
            SetErrorLevel 1
            Abort
        ${EndIf}

        Pop $R0
        Pop $2
        Pop $0
    ${EndIf}
!macroend
