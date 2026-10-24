//! The icon embedded in a program's .exe, as RGBA pixels for the UI.

use crate::expand::expand;
use std::path::{Path, PathBuf};

/// Finds a program like Windows does: an absolute path, or a name on PATH (with or without `.exe`).
pub fn resolve(program: &str) -> Option<PathBuf> {
    let p = PathBuf::from(expand(program));
    if p.is_absolute() {
        return p.is_file().then_some(p);
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .flat_map(|dir| [dir.join(&p), dir.join(format!("{}.exe", p.display()))])
        .find(|c| c.is_file())
}

#[cfg(windows)]
pub fn rgba(path: &Path) -> Option<(u32, u32, Vec<u8>)> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::DeleteObject;
    use windows::Win32::UI::Shell::SHDefExtractIconW;
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    // 64 px (low word = large size): the 32 px system size looks blurry on the sidebar's high-DPI rendering
    let mut icon = HICON::default();
    // SAFETY: `wide` is a NUL-terminated UTF-16 path that outlives the call; `icon` is a valid out pointer.
    let found =
        unsafe { SHDefExtractIconW(PCWSTR(wide.as_ptr()), 0, 0, Some(&mut icon), None, 64) };
    if found.is_err() || icon.is_invalid() {
        return None;
    }
    let mut info = ICONINFO::default();
    // SAFETY: `icon` is the valid icon extracted above; `info` is a valid out pointer.
    let ok = unsafe { GetIconInfo(icon, &mut info) }.is_ok();
    // SAFETY: the icon was created for us above and is not used after this.
    let _ = unsafe { DestroyIcon(icon) };
    if !ok {
        return None;
    }
    let pixels = bitmap_pixels(info.hbmColor);
    // SAFETY: GetIconInfo created both bitmaps for the caller to delete; neither is used after this (a null handle,
    // a monochrome icon's missing color bitmap, makes the call fail harmlessly).
    unsafe {
        let _ = DeleteObject(info.hbmColor.into());
        let _ = DeleteObject(info.hbmMask.into());
    }
    let (w, h, mut px) = pixels?;
    // GDI gives BGRA; icons without an alpha channel come back fully transparent
    let no_alpha = px.chunks(4).all(|p| p[3] == 0);
    for p in px.chunks_mut(4) {
        p.swap(0, 2);
        if no_alpha {
            p[3] = 255;
        }
    }
    Some((w, h, px))
}

/// A bitmap's pixels as top-down 32-bit BGRA rows: width, height and the bytes.
#[cfg(windows)]
fn bitmap_pixels(bitmap: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
        BI_RGB, DIB_RGB_COLORS,
    };
    let mut bm = BITMAP::default();
    let size = i32::try_from(std::mem::size_of::<BITMAP>()).ok()?;
    // SAFETY: `bm` is a writable BITMAP of exactly `size` bytes; an invalid or null handle makes the call return 0.
    let got = unsafe {
        GetObjectW(
            bitmap.into(),
            size,
            Some(std::ptr::from_mut(&mut bm).cast()),
        )
    };
    let (w, h) = (
        u32::try_from(bm.bmWidth).ok()?,
        u32::try_from(bm.bmHeight).ok()?,
    );
    if got == 0 || w == 0 || h == 0 {
        return None;
    }
    let mut px = vec![0u8; usize::try_from(w).ok()? * usize::try_from(h).ok()? * 4];
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: u32::try_from(std::mem::size_of::<BITMAPINFOHEADER>()).ok()?,
            biWidth: bm.bmWidth,
            biHeight: -bm.bmHeight, // top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    // SAFETY: creating a memory DC has no preconditions; it is deleted below.
    let dc = unsafe { CreateCompatibleDC(None) };
    // SAFETY: `px` holds exactly `h` rows of `w` 32-bit pixels, the top-down 32 bpp format `bmi` asks for, and
    // outlives the call; an icon's bitmap is not selected into any DC.
    let lines = unsafe {
        GetDIBits(
            dc,
            bitmap,
            0,
            h,
            Some(px.as_mut_ptr().cast()),
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };
    // SAFETY: `dc` was created above and is not used after this.
    let _ = unsafe { DeleteDC(dc) };
    (lines > 0).then_some((w, h, px))
}

#[cfg(not(windows))]
pub fn rgba(_: &Path) -> Option<(u32, u32, Vec<u8>)> {
    None
}

/// An image file set as a profile's "icon"; only image types, since the path comes from the config file.
pub fn image_file(path: &str) -> Option<Vec<u8>> {
    let p = PathBuf::from(expand(path));
    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
    ["png", "ico", "svg", "jpg", "jpeg"]
        .contains(&ext.as_str())
        .then(|| std::fs::read(&p).ok())
        .flatten()
}
