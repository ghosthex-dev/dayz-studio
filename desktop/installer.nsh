; DayZ Studio - additions to electron-builder's NSIS installer (package.json build.nsis.include)

; The EULA page: Install stays disabled until the box is ticked
!define MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX_TEXT "I have read and accept the DayZ Studio End User License Agreement"
!define MUI_LICENSEPAGE_TEXT_TOP "Please read the whole agreement (scroll down to the end)."
!define MUI_LICENSEPAGE_TEXT_BOTTOM "You must accept the agreement to install DayZ Studio."
