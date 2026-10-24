//! Windows notifications ("Claude 3 needs your attention") that open that terminal when clicked.
//! Werkbank is a plain .exe, so it registers itself for notifications (name + icon) under its identifier, and
//! registers a link `<identifier>:show/<terminal id>` that a click on the notification starts; the second
//! Werkbank it launches hands the link to the running one (single instance) and quits.

use crate::store::es;
use tauri::{AppHandle, Manager};

/// Writes the registration at startup (current user only, no admin rights); harmless to repeat.
#[cfg(windows)]
pub fn register(app: &AppHandle) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let id = app.config().identifier.clone();
    let dir = app.path().app_config_dir().map_err(es)?;
    std::fs::create_dir_all(&dir).map_err(es)?;
    let icon = dir.join("icon.png");
    std::fs::write(&icon, include_bytes!("../icons/icon.png")).map_err(es)?;
    let exe = std::env::current_exe().map_err(es)?;
    let aumid = format!(r"Software\Classes\AppUserModelId\{id}");
    set(&aumid, "DisplayName", "Werkbank")?;
    set(&aumid, "IconUri", &icon.to_string_lossy())?;
    let link = format!(r"Software\Classes\{id}");
    set(&link, "", "URL:Werkbank")?;
    set(&link, "URL Protocol", "")?;
    set(
        &format!(r"{link}\shell\open\command"),
        "",
        &format!("\"{}\" \"%1\"", exe.display()),
    )?;
    // SAFETY: the HSTRING is a valid, NUL-terminated string for the duration of the call.
    unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(id)).map_err(es) }
}

#[cfg(windows)]
fn set(key: &str, name: &str, value: &str) -> Result<(), String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    let data: Vec<u8> = value
        .encode_utf16()
        .chain([0])
        .flat_map(u16::to_le_bytes)
        .collect();
    let mut k = HKEY::default();
    // SAFETY: the key name is a valid HSTRING for the call and `k` a valid out pointer; the result is checked.
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(key),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut k,
            None,
        )
    }
    .ok()
    .map_err(|e| format!("{key}: {e}"))?;
    // SAFETY: `k` was opened above with KEY_SET_VALUE; `data` is a NUL-terminated UTF-16 string as REG_SZ requires.
    let r = unsafe { RegSetValueExW(k, &HSTRING::from(name), None, REG_SZ, Some(&data)) };
    // SAFETY: `k` was opened above and is not used after this.
    let _ = unsafe { RegCloseKey(k) };
    r.ok().map_err(|e| format!("{key}\\{name}: {e}"))
}

#[cfg(not(windows))]
pub fn register(_: &AppHandle) -> Result<(), String> {
    Ok(())
}

/// The terminal id from a notification link in the arguments of a second start, if any.
pub fn link_target(app: &AppHandle, args: &[String]) -> Option<String> {
    let prefix = format!("{}:show/", app.config().identifier);
    args.iter()
        .find_map(|a| a.strip_prefix(&prefix))
        .map(|id| id.trim_end_matches('/').to_string())
}

/// Shows a notification; clicking it opens terminal `id` (see `link_target`).
#[tauri::command]
pub fn notify(app: AppHandle, id: String, title: String, body: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Data::Xml::Dom::XmlDocument;
        use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
        // the text comes from terminal titles, so it is escaped before it goes into the XML
        let x = |s: &str| {
            s.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;")
        };
        let ident = app.config().identifier.clone();
        let xml = format!(
            r#"<toast activationType="protocol" launch="{}:show/{}"><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual></toast>"#,
            x(&ident),
            x(&id),
            x(&title),
            x(&body)
        );
        let doc = XmlDocument::new().map_err(es)?;
        doc.LoadXml(&HSTRING::from(xml)).map_err(es)?;
        let toast = ToastNotification::CreateToastNotification(&doc).map_err(es)?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(ident))
            .map_err(es)?
            .Show(&toast)
            .map_err(es)?;
    }
    let _ = (app, id, title, body);
    Ok(())
}
