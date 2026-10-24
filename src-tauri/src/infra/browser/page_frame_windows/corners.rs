//! The rounded corners: the clipping region and the layered caps that smooth its edge pixels.
use super::*;

/// Lays a cap over each rounded corner, above the page and its dim, or hides
/// it when the corner is square or its chrome color is unknown.
pub(super) fn apply_caps(host: HWND, frame: &mut Frame, width: i32, height: i32, radii: [i32; 4]) {
    let radii = radii.map(|radius| radius.clamp(0, width.min(height).max(0) / 2));
    for (corner, radius) in radii.into_iter().enumerate() {
        let Some(color) = frame.corner_color.filter(|_| radius > 0) else {
            if let Some((cap, ..)) = frame.caps[corner] {
                // SAFETY: a cap window this module created.
                unsafe { ShowWindow(cap as HWND, SW_HIDE) };
            }
            continue;
        };
        let cap = match frame.caps[corner] {
            Some((cap, painted_radius, painted_color)) => {
                if painted_radius != radius || painted_color != color {
                    paint_cap(cap as HWND, corner, radius, color);
                    frame.caps[corner] = Some((cap, radius, color));
                }
                cap as HWND
            }
            None => {
                let Some(cap) = create_overlay(host) else {
                    continue;
                };
                paint_cap(cap, corner, radius, color);
                frame.caps[corner] = Some((cap as isize, radius, color));
                cap
            }
        };
        let x = if corner == 1 || corner == 2 {
            width - radius
        } else {
            0
        };
        let y = if corner >= 2 { height - radius } else { 0 };
        // SAFETY: as above; the caps go above the page's windows and its dim.
        unsafe {
            SetWindowPos(cap, HWND_TOP, x, y, radius, radius, SWP_NOACTIVATE);
            ShowWindow(cap, SW_SHOWNA);
        }
    }
}

/// How much of the pixel at (`x`, `y`) of a top-left corner square of side
/// `radius` lies inside the corner's arc, from 0 to 1.
pub(super) fn arc_coverage(radius: i32, x: i32, y: i32) -> f32 {
    const SAMPLES: i32 = 8;
    let center = radius as f32;
    let mut inside = 0;
    for sample_y in 0..SAMPLES {
        for sample_x in 0..SAMPLES {
            let dx = center - (x as f32 + (sample_x as f32 + 0.5) / SAMPLES as f32);
            let dy = center - (y as f32 + (sample_y as f32 + 0.5) / SAMPLES as f32);
            if dx * dx + dy * dy <= center * center {
                inside += 1;
            }
        }
    }
    inside as f32 / (SAMPLES * SAMPLES) as f32
}

/// A pixel of `corner`'s cap in the top-left orientation `arc_coverage` uses.
pub(super) fn top_left_pixel(corner: usize, radius: i32, x: i32, y: i32) -> (i32, i32) {
    let flip_x = corner == 1 || corner == 2;
    let flip_y = corner >= 2;
    (
        if flip_x { radius - 1 - x } else { x },
        if flip_y { radius - 1 - y } else { y },
    )
}

/// Paints the chrome `color` over the part of each pixel outside the arc.
pub(super) fn paint_cap(cap: HWND, corner: usize, radius: i32, color: [u8; 3]) {
    if radius <= 0 {
        return;
    }
    // SAFETY: a DIB and memory DC created, used and released here.
    unsafe {
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: radius,
                // Negative: rows run top to bottom.
                biHeight: -radius,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..std::mem::zeroed()
            },
            ..std::mem::zeroed()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let bitmap = CreateDIBSection(
            std::ptr::null_mut(),
            &info,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        );
        if bitmap.is_null() || bits.is_null() {
            return;
        }
        let pixels = std::slice::from_raw_parts_mut(bits.cast::<u32>(), (radius * radius) as usize);
        for y in 0..radius {
            for x in 0..radius {
                let (tx, ty) = top_left_pixel(corner, radius, x, y);
                let alpha = 1.0 - arc_coverage(radius, tx, ty);
                let premultiply = |channel: u8| (f32::from(channel) * alpha).round() as u32;
                // Premultiplied BGRA.
                pixels[(y * radius + x) as usize] = ((alpha * 255.0).round() as u32) << 24
                    | premultiply(color[0]) << 16
                    | premultiply(color[1]) << 8
                    | premultiply(color[2]);
            }
        }
        let source = CreateCompatibleDC(std::ptr::null_mut());
        let previous = SelectObject(source, bitmap);
        let size = SIZE {
            cx: radius,
            cy: radius,
        };
        let origin = POINT { x: 0, y: 0 };
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };
        UpdateLayeredWindow(
            cap,
            std::ptr::null_mut(),
            std::ptr::null(),
            &size,
            source,
            &origin,
            0,
            &blend,
            ULW_ALPHA,
        );
        SelectObject(source, previous);
        DeleteDC(source);
        DeleteObject(bitmap);
    }
}

/// The client area minus the pixels wholly outside each rounded corner's arc,
/// or null (no clipping) when every corner is square. Pixels the arc crosses
/// stay, for the corner caps to smooth.
///
/// # Safety
/// Returns a region the caller must hand to the system or delete.
pub(super) unsafe fn rounded_region(width: i32, height: i32, radii: [i32; 4]) -> HRGN {
    if radii.iter().all(|&radius| radius <= 0) || width <= 0 || height <= 0 {
        return std::ptr::null_mut();
    }
    let region = CreateRectRgn(0, 0, width, height);
    let radii = radii.map(|radius| radius.clamp(0, width.min(height) / 2));
    for (corner, radius) in radii.into_iter().enumerate() {
        for row in 0..radius {
            // Pixels wholly outside the arc, counted in from the outer edge.
            let cut = (0..radius)
                .take_while(|&x| arc_coverage(radius, x, row) == 0.0)
                .count() as i32;
            if cut == 0 {
                continue;
            }
            let (left, right) = if corner == 1 || corner == 2 {
                (width - cut, width)
            } else {
                (0, cut)
            };
            let top = if corner >= 2 { height - 1 - row } else { row };
            let strip = CreateRectRgn(left, top, right, top + 1);
            CombineRgn(region, region, strip, RGN_DIFF);
            DeleteObject(strip);
        }
    }
    region
}
