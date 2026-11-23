use tauri::image::Image;

type Point = (f32, f32);

enum Stroke {
    Line(Point, Point),
    Arc {
        center: Point,
        radius: f32,
        from: f32,
        sweep: f32,
    },
}

const STROKES: [Stroke; 10] = [
    Stroke::Arc {
        center: (125.5, 386.0),
        radius: 60.0,
        from: 14.0,
        sweep: 166.0,
    },
    Stroke::Line((65.5, 386.0), (65.5, 126.0)),
    Stroke::Arc {
        center: (125.5, 126.0),
        radius: 60.0,
        from: 180.0,
        sweep: 140.22,
    },
    Stroke::Line((171.6, 87.6), (317.1, 262.3)),
    Stroke::Arc {
        center: (261.0, 309.0),
        radius: 73.0,
        from: -39.78,
        sweep: 259.56,
    },
    Stroke::Line((204.9, 262.3), (227.9, 234.6)),
    Stroke::Arc {
        center: (386.5, 386.0),
        radius: 60.0,
        from: 166.0,
        sweep: -166.0,
    },
    Stroke::Line((446.5, 386.0), (446.5, 126.0)),
    Stroke::Arc {
        center: (386.5, 126.0),
        radius: 60.0,
        from: 0.0,
        sweep: -140.22,
    },
    Stroke::Line((340.4, 87.6), (289.2, 149.1)),
];

const STROKE_WIDTH: f32 = 36.0;
const VIEW_ORIGIN: f32 = 36.0;
const VIEW_SIZE: f32 = 440.0;
const PIXELS: u32 = 36;

fn distance_to_segment(p: Point, a: Point, b: Point) -> f32 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let length = dx * dx + dy * dy;
    let t = if length == 0.0 {
        0.0
    } else {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / length).clamp(0.0, 1.0)
    };
    let (x, y) = (a.0 + t * dx, a.1 + t * dy);
    ((p.0 - x).powi(2) + (p.1 - y).powi(2)).sqrt()
}

fn distance_to_arc(p: Point, center: Point, radius: f32, from: f32, sweep: f32) -> f32 {
    let (dx, dy) = (p.0 - center.0, p.1 - center.1);
    let angle = dy.atan2(dx).to_degrees();
    let turned = if sweep >= 0.0 {
        angle - from
    } else {
        from - angle
    };
    if turned.rem_euclid(360.0) <= sweep.abs() {
        return ((dx * dx + dy * dy).sqrt() - radius).abs();
    }
    let end = |degrees: f32| {
        let radians = degrees.to_radians();
        (
            center.0 + radius * radians.cos(),
            center.1 + radius * radians.sin(),
        )
    };
    let near = |q: Point| ((p.0 - q.0).powi(2) + (p.1 - q.1).powi(2)).sqrt();
    near(end(from)).min(near(end(from + sweep)))
}

fn distance(p: Point) -> f32 {
    STROKES
        .iter()
        .map(|stroke| match *stroke {
            Stroke::Line(a, b) => distance_to_segment(p, a, b),
            Stroke::Arc {
                center,
                radius,
                from,
                sweep,
            } => distance_to_arc(p, center, radius, from, sweep),
        })
        .fold(f32::INFINITY, f32::min)
}

fn pixels() -> Vec<u8> {
    let units_per_pixel = VIEW_SIZE / PIXELS as f32;
    let mut rgba = Vec::with_capacity((PIXELS * PIXELS * 4) as usize);
    for row in 0..PIXELS {
        for column in 0..PIXELS {
            let p = (
                VIEW_ORIGIN + (column as f32 + 0.5) * units_per_pixel,
                VIEW_ORIGIN + (row as f32 + 0.5) * units_per_pixel,
            );
            let inside = (STROKE_WIDTH / 2.0 - distance(p)) / units_per_pixel;
            let alpha = (inside + 0.5).clamp(0.0, 1.0);
            rgba.extend_from_slice(&[0, 0, 0, (alpha * 255.0).round() as u8]);
        }
    }
    rgba
}

pub fn image() -> Image<'static> {
    Image::new_owned(pixels(), PIXELS, PIXELS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alpha_at(rgba: &[u8], column: u32, row: u32) -> u8 {
        rgba[((row * PIXELS + column) * 4 + 3) as usize]
    }

    #[test]
    fn draws_the_strokes_and_leaves_the_rest_clear() {
        let rgba = pixels();
        assert_eq!(rgba.len(), (PIXELS * PIXELS * 4) as usize);
        assert!(rgba.chunks(4).all(|pixel| pixel[..3] == [0, 0, 0]));
        let to_pixel = |units: f32| ((units - VIEW_ORIGIN) / VIEW_SIZE * PIXELS as f32) as u32;
        assert_eq!(alpha_at(&rgba, to_pixel(65.5), to_pixel(256.0)), 255);
        assert_eq!(alpha_at(&rgba, to_pixel(261.0), to_pixel(309.0)), 0);
        assert_eq!(alpha_at(&rgba, 0, 0), 0);
        assert_eq!(alpha_at(&rgba, PIXELS - 1, PIXELS - 1), 0);
    }
}
