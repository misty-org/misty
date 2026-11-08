use super::*;

fn place(pairs: &[(&str, &str)]) -> MenuPlace {
    let values = pairs
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect();
    MenuPlace::from_query(&values)
}

#[test]
fn a_field_position_reads_as_fractions() {
    assert_eq!(
        place(&[("left", "0.25"), ("bottom", "0.5"), ("width", "0.75")]),
        MenuPlace {
            left: 0.25,
            bottom: 0.5,
            width: 0.75
        }
    );
}

#[test]
fn a_page_cannot_place_the_menu_outside_itself() {
    for value in ["-4", "9", "NaN", "inf", "-inf", "nonsense"] {
        let found = place(&[("left", value), ("bottom", value), ("width", value)]);
        for fraction in [found.left, found.bottom, found.width] {
            assert!((0.0..=1.0).contains(&fraction), "{value}: {fraction}");
        }
    }
    assert_eq!(place(&[]), MenuPlace::default());
}
